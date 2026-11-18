// backend/sso/server.js
// SSO sidecar Express server.
// Listens on 127.0.0.1:3180 (loopback only). nginx proxies the public
// /sso/login, /sso/callback and /sso/logout endpoints to it and calls
// /sso/verify through auth_request. Each proxy host carries its own
// Entra ID (Azure AD) app registration.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import express from "express";
import session from "express-session";
import {
	closeConfig,
	getGlobalConfig,
	loadGlobalConfig,
	loadHostConfig,
	normaliseHostname,
	reloadConfig,
} from "./config.js";
import { fetchUserGroups, isGroupMember } from "./group-check.js";
import { saveLoginSessionAndRedirect } from "./login-session.js";
import { acquireTokenByCode, getAuthCodeUrl, resetAllClients } from "./msal-client.js";
import { PAGE_CSP, aadstsCode, deniedPage, signInFailedPage, signedOutPage } from "./pages.js";
import { SsoSessionStore } from "./session-store.js";
import { headerSafe, queryString, rawReturnParam, validateReturnUrl } from "./validation.js";

const app = express();
const PORT = Number.parseInt(process.env.SSO_PORT || "3180", 10);
const HOST = "127.0.0.1";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const DATA_DIR = process.env.SSO_DATA_DIR || "/data/sso";

app.disable("x-powered-by");
// Exact paths only: nginx blocks /sso/verify, /sso/reload and /sso/health by
// path, so case or trailing-slash variants must not reach other handlers.
app.set("case sensitive routing", true);
app.set("strict routing", true);

// Trust nginx reverse proxy — required for secure cookies to work.
// Without this, Express sees req.secure=false (HTTP from nginx) and
// refuses to set Secure cookies, even though the client connection is HTTPS.
// Nginx forwards X-Forwarded-Proto which Express reads when trust proxy is on.
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// Persistent session secret (survives restarts)
// ---------------------------------------------------------------------------
function getSessionSecret() {
	if (process.env.SSO_SESSION_SECRET) return process.env.SSO_SESSION_SECRET;
	const secretPath = `${DATA_DIR}/session-secret`;
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
	if (existsSync(secretPath)) {
		const existing = readFileSync(secretPath, "utf8").trim();
		if (existing) return existing;
	}
	const secret = randomBytes(32).toString("hex");
	writeFileSync(secretPath, secret, { mode: 0o600 });
	return secret;
}

/**
 * Hostname of the protected site that received the request.
 * nginx always sets X-Original-Host from $host; req.hostname is only a
 * fallback for direct loopback calls.
 * @param {import("express").Request} req
 * @returns {string}
 */
function originalHost(req) {
	const header = req.headers["x-original-host"];
	return normaliseHostname(typeof header === "string" && header ? header : req.hostname);
}

/**
 * True when the request came through nginx's public /sso/ location, which
 * always sets X-Forwarded-For. Loopback-only endpoints reject such requests.
 * @param {import("express").Request} req
 */
function viaPublicProxy(req) {
	return typeof req.headers["x-forwarded-for"] !== "undefined";
}

/**
 * Send one of the sidecar's HTML pages (pages.js).
 * @param {import("express").Response} res
 * @param {number} status
 * @param {string} html
 */
function sendPage(res, status, html) {
	res.status(status);
	res.set("Content-Type", "text/html; charset=utf-8");
	res.set("Content-Security-Policy", PAGE_CSP);
	res.set("X-Content-Type-Options", "nosniff");
	res.set("Referrer-Policy", "no-referrer");
	return res.send(html);
}

/**
 * A sign-in failure page for this request's host.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {number} status
 * @param {{ kind: string, error?: string, description?: string, returnPath?: string }} detail
 */
function sendSignInFailed(req, res, status, detail) {
	return sendPage(res, status, signInFailedPage({ host: originalHost(req), ...detail }));
}

/**
 * The session's user when it was issued for this host's tenant, else null.
 * @param {import("express").Request} req
 * @param {{ tenantId: string } | null} hostCfg
 */
function sessionUserFor(req, hostCfg) {
	const user = req.session?.ssoUser;
	if (!user || !hostCfg || user.tenantId !== hostCfg.tenantId) return null;
	return user;
}

/**
 * Wrap an async route handler so rejections become 5xx responses instead of
 * crashing the process.
 */
function route(handler) {
	return (req, res) => {
		handler(req, res).catch((err) => {
			console.error(`[sso] ${req.method} ${req.path} failed:`, err.message);
			if (!res.headersSent) {
				sendSignInFailed(req, res, 503, { kind: "server" });
			}
		});
	};
}

// ---------------------------------------------------------------------------
// Load initial config and set up session
// ---------------------------------------------------------------------------
const sessionStore = new SsoSessionStore();

app.use((_req, res, next) => {
	// Auth responses must never be cached by browsers or intermediaries
	res.set("Cache-Control", "no-store");
	next();
});

app.use(
	session({
		store: sessionStore,
		secret: getSessionSecret(),
		resave: false,
		saveUninitialized: false,
		name: "npm_sso_sid",
		cookie: {
			domain: undefined, // set dynamically per-host
			httpOnly: true,
			secure: process.env.NODE_ENV === "production" || process.env.SSO_SECURE_COOKIE === "true",
			sameSite: "lax",
			maxAge: SESSION_MAX_AGE_MS,
		},
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/verify — called by nginx auth_request (internal only)
// Fails closed: any error reading configuration denies the request.
// ---------------------------------------------------------------------------
app.get(
	"/sso/verify",
	route(async (req, res) => {
		if (viaPublicProxy(req)) {
			return res.sendStatus(403);
		}
		// nginx only calls this endpoint for hosts whose config enables SSO, so
		// every answer other than "valid session" denies: missing host header,
		// missing or disabled host config and database errors all fail closed.
		const host = originalHost(req);
		if (!host) {
			return res.sendStatus(503);
		}

		const hostCfg = await loadHostConfig(host);
		if (!hostCfg) {
			return res.sendStatus(401);
		}

		const user = req.session?.ssoUser;
		if (!user) {
			return res.sendStatus(401);
		}

		// Session issued for a different tenant → re-authenticate
		if (user.tenantId !== hostCfg.tenantId) {
			return res.sendStatus(401);
		}

		// Check per-host group restrictions. A session created on a host without
		// group restrictions has no membership data; send the user back through
		// login so the groups get fetched for this host.
		if (hostCfg.allowedGroups.length > 0) {
			if (!user.groupsFetched) {
				return res.sendStatus(401);
			}
			if (!isGroupMember(user.groups || [], hostCfg.allowedGroups)) {
				return res.status(403).send("Group membership required");
			}
		}

		res.set("X-SSO-User", headerSafe(user.name));
		res.set("X-SSO-Email", headerSafe(user.email));
		return res.sendStatus(200);
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/login — initiate MSAL auth code flow
// ---------------------------------------------------------------------------
app.get(
	"/sso/login",
	route(async (req, res) => {
		const global = getGlobalConfig();
		if (!global?.enabled) {
			return sendSignInFailed(req, res, 503, { kind: "config" });
		}

		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host);
		if (!hostCfg?.tenantId || !hostCfg.clientId || !hostCfg.clientSecret) {
			return sendSignInFailed(req, res, 503, { kind: "config" });
		}
		if (!hostCfg.redirectUri) {
			console.warn(`[sso] Login refused — host=${host} has no non-wildcard domain name`);
			return sendSignInFailed(req, res, 503, { kind: "config" });
		}

		const returnUrl = validateReturnUrl(rawReturnParam(req), hostCfg.cookieDomain, host);
		const state = randomBytes(24).toString("base64url");
		const hasGroups = hostCfg.allowedGroups.length > 0;
		const authUrl = await getAuthCodeUrl(hostCfg, state, hostCfg.redirectUri, hasGroups);

		// Regenerate the session before storing OAuth state so a stale cookie
		// from a previous attempt or another subdomain cannot be reused.
		req.session.regenerate((err) => {
			if (err) {
				console.error("[sso] Session regeneration failed during login:", err.message);
				return sendSignInFailed(req, res, 500, { kind: "server", returnPath: returnUrl });
			}
			saveLoginSessionAndRedirect(req, res, {
				state,
				returnUrl,
				cookieDomain: hostCfg.cookieDomain,
				authUrl,
				loginHost: host,
			})
				.then(() => {
					console.log(
						`[sso] Login initiated — host=${host} cookieDomain=${hostCfg.cookieDomain || "(none)"}`,
					);
				})
				.catch((saveErr) => {
					console.error("[sso] Login session save failed:", saveErr.message);
					if (!res.headersSent) sendSignInFailed(req, res, 500, { kind: "server", returnPath: returnUrl });
				});
		});
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/callback — MSAL callback, exchange code for token
// ---------------------------------------------------------------------------
app.get(
	"/sso/callback",
	route(async (req, res) => {
		const code = queryString(req.query.code);
		const state = queryString(req.query.state);
		const providerError = queryString(req.query.error);

		if (providerError) {
			const description = queryString(req.query.error_description);
			console.warn(
				`[sso] Identity provider returned error=${providerError} ${aadstsCode(description)}`.trimEnd(),
			);
			return sendSignInFailed(req, res, 400, { kind: "provider", error: providerError, description });
		}
		// Entra ID's sign-out sends the browser here with no parameters: the
		// callback is the one URI registered on the app (see /sso/logout).
		if (!code && !state) {
			return res.redirect("/sso/signed-out");
		}
		if (!code || !state) {
			return sendSignInFailed(req, res, 400, { kind: "state" });
		}

		const host = originalHost(req);
		const pending = req.session;
		if (!pending?.oauthState || state !== pending.oauthState || pending.loginHost !== host) {
			console.warn(
				`[sso] Invalid OAuth state — host=${host} hasCookie=${!!req.headers.cookie} sessionHasState=${!!pending?.oauthState}`,
			);
			return sendSignInFailed(req, res, 403, { kind: "state" });
		}
		delete req.session.oauthState;
		delete req.session.loginHost;

		const hostCfg = await loadHostConfig(host);
		if (!hostCfg?.redirectUri) {
			return sendSignInFailed(req, res, 503, { kind: "config" });
		}

		// Capture return URL before session regeneration destroys it
		const savedReturnUrl = validateReturnUrl(req.session.returnUrl, hostCfg.cookieDomain, host);
		const hasGroups = hostCfg.allowedGroups.length > 0;

		let result;
		try {
			result = await acquireTokenByCode(hostCfg, code, hostCfg.redirectUri, hasGroups);
		} catch (err) {
			console.error("[sso] Token exchange failed:", err.message);
			return sendSignInFailed(req, res, 401, { kind: "token", returnPath: savedReturnUrl });
		}

		// Fetch group memberships if needed. A failed lookup is "unknown", which
		// must deny access rather than silently granting it.
		let groups = [];
		if (hasGroups) {
			groups = result.accessToken ? await fetchUserGroups(result.accessToken) : null;
			if (groups === null) {
				return sendSignInFailed(req, res, 502, { kind: "groups", returnPath: savedReturnUrl });
			}
		}

		// Regenerate session to prevent session fixation attacks.
		req.session.regenerate((err) => {
			if (err) {
				console.error("[sso] Session regeneration failed:", err.message);
				return sendSignInFailed(req, res, 500, { kind: "server", returnPath: savedReturnUrl });
			}

			req.session.ssoUser = {
				name: result.account?.name || "",
				email: result.account?.username || "",
				oid: result.account?.localAccountId || result.account?.homeAccountId || "",
				tenantId: hostCfg.tenantId, // Store for cross-host tenant validation
				groups,
				groupsFetched: hasGroups,
			};

			if (hostCfg.cookieDomain) {
				req.session.cookie.domain = hostCfg.cookieDomain;
			}

			req.session.save((saveErr) => {
				if (saveErr) {
					console.error("[sso] Session save failed:", saveErr.message);
					return sendSignInFailed(req, res, 500, { kind: "server", returnPath: savedReturnUrl });
				}
				console.log(`[sso] Login completed — host=${host} user=${req.session.ssoUser.email || "(unknown)"}`);
				res.redirect(savedReturnUrl);
			});
		});
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/logout — destroy session, redirect to Entra ID logout
// Without ?return= the browser comes back through /sso/callback (the URI
// registered on the app, so Entra ID honours it) to /sso/signed-out, instead
// of to a protected page that would start a new sign-in straight away.
// ---------------------------------------------------------------------------
app.get(
	"/sso/logout",
	route(async (req, res) => {
		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host).catch(() => null);
		const cookieDomain = hostCfg?.cookieDomain || "";
		const rawReturn = queryString(req.query.return);
		const safeReturn = rawReturn ? validateReturnUrl(rawReturn, cookieDomain, host) : "";
		const isAbsolute = safeReturn.startsWith("https://") || safeReturn.startsWith("http://");
		const absoluteUri = !safeReturn
			? hostCfg?.redirectUri || `${req.protocol}://${host}/sso/signed-out`
			: isAbsolute
				? safeReturn
				: `${req.protocol}://${host}${safeReturn}`;
		const user = req.session?.ssoUser;

		req.session.destroy(() => {
			if (cookieDomain) {
				res.clearCookie("npm_sso_sid", { domain: cookieDomain, path: "/" });
			}
			res.clearCookie("npm_sso_sid", { path: "/" });
			if (user) {
				console.log(`[sso] Logout — host=${host} user=${user.email || "(unknown)"}`);
			}
			if (hostCfg?.tenantId) {
				const tenant = encodeURIComponent(hostCfg.tenantId);
				res.redirect(
					`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(absoluteUri)}`,
				);
			} else {
				res.redirect(safeReturn || "/sso/signed-out");
			}
		});
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/signed-out — landing page after sign-out
// ---------------------------------------------------------------------------
app.get(
	"/sso/signed-out",
	route(async (req, res) => {
		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host).catch(() => null);
		return sendPage(res, 200, signedOutPage({ host, user: sessionUserFor(req, hostCfg) }));
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/denied — the 403 page. nginx serves it for every 403 it raises on
// an SSO host (error_page 403 = @sso_denied), passing the denied request URI
// in X-Original-URI. Says who is signed in and offers another account.
// ---------------------------------------------------------------------------
app.get(
	"/sso/denied",
	route(async (req, res) => {
		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host).catch(() => null);
		const user = sessionUserFor(req, hostCfg);
		const groupDenied =
			!!user &&
			hostCfg.allowedGroups.length > 0 &&
			user.groupsFetched &&
			!isGroupMember(user.groups || [], hostCfg.allowedGroups);
		const uri = req.headers["x-original-uri"];
		let returnPath = validateReturnUrl(typeof uri === "string" ? uri : "", hostCfg?.cookieDomain, host);
		if (returnPath.startsWith("/sso/")) returnPath = "/";
		return sendPage(res, 403, deniedPage({ host, user, reason: groupDenied ? "group" : "", returnPath }));
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/me — the signed-in user, for the protected site's own UI
// (an account menu with sign-out). Same origin only: no CORS headers.
// ---------------------------------------------------------------------------
app.get(
	"/sso/me",
	route(async (req, res) => {
		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host).catch(() => null);
		const user = sessionUserFor(req, hostCfg);
		res.set("X-Content-Type-Options", "nosniff");
		if (!user) {
			return res.status(401).json({ signedIn: false });
		}
		return res.json({
			signedIn: true,
			name: String(user.name || ""),
			email: String(user.email || ""),
		});
	}),
);

// ---------------------------------------------------------------------------
// POST /sso/reload — reload config from DB (loopback only; nginx blocks it)
// ---------------------------------------------------------------------------
app.post(
	"/sso/reload",
	route(async (req, res) => {
		if (viaPublicProxy(req)) {
			return res.sendStatus(403);
		}
		await reloadConfig();
		resetAllClients();
		console.log("[sso] Config reloaded");
		res.json({ ok: true });
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/health — health check (loopback only; nginx blocks it)
// ---------------------------------------------------------------------------
app.get("/sso/health", (req, res) => {
	if (viaPublicProxy(req)) {
		return res.sendStatus(403);
	}
	const global = getGlobalConfig();
	res.json({ ok: true, enabled: global?.enabled || false });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
let server;
const BOOT_RETRY_MS = 3000;

async function bootstrap() {
	// On a fresh install the backend creates and migrates the database after
	// this service has started, so keep retrying instead of crash-looping.
	for (let attempt = 1; ; attempt++) {
		try {
			const cfg = await loadGlobalConfig();
			server = app.listen(PORT, HOST, () => {
				console.log(
					`[sso] SSO sidecar listening on ${HOST}:${PORT} (kill switch: ${cfg.enabled ? "ON" : "OFF"})`,
				);
			});
			return;
		} catch (err) {
			if (attempt === 1 || attempt % 10 === 0) {
				console.warn(`[sso] Waiting for database (attempt ${attempt}): ${err.message}`);
			}
			await new Promise((resolve) => setTimeout(resolve, BOOT_RETRY_MS));
		}
	}
}

bootstrap();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
	console.log(`[sso] ${signal} received, shutting down...`);
	const finish = () => {
		sessionStore.close();
		closeConfig().finally(() => process.exit(0));
	};
	if (server) {
		server.close(finish);
		setTimeout(finish, 5000).unref();
	} else {
		finish();
	}
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
