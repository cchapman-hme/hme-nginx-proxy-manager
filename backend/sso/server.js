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
 * Wrap an async route handler so rejections become 5xx responses instead of
 * crashing the process.
 */
function route(handler) {
	return (req, res) => {
		handler(req, res).catch((err) => {
			console.error(`[sso] ${req.method} ${req.path} failed:`, err.message);
			if (!res.headersSent) {
				res.status(503).send("SSO temporarily unavailable");
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
			return res.status(503).send("SSO is not enabled");
		}

		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host);
		if (!hostCfg?.tenantId || !hostCfg.clientId || !hostCfg.clientSecret) {
			return res.status(503).send("SSO is not configured for this host");
		}
		if (!hostCfg.redirectUri) {
			return res.status(503).send("SSO requires at least one non-wildcard domain name on this host");
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
				return res.status(500).send("SSO login failed");
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
					if (!res.headersSent) res.status(500).send("SSO login failed");
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
			console.warn(`[sso] Identity provider returned error=${providerError}`);
			return res.status(400).send("Sign-in was not completed");
		}
		if (!code || !state) {
			return res.status(400).send("Missing code or state");
		}

		const host = originalHost(req);
		const pending = req.session;
		if (!pending?.oauthState || state !== pending.oauthState || pending.loginHost !== host) {
			console.warn(
				`[sso] Invalid OAuth state — host=${host} hasCookie=${!!req.headers.cookie} sessionHasState=${!!pending?.oauthState}`,
			);
			return res.status(403).send("Invalid OAuth state");
		}
		delete req.session.oauthState;
		delete req.session.loginHost;

		const hostCfg = await loadHostConfig(host);
		if (!hostCfg?.redirectUri) {
			return res.status(503).send("SSO is not configured for this host");
		}

		// Capture return URL before session regeneration destroys it
		const savedReturnUrl = validateReturnUrl(req.session.returnUrl, hostCfg.cookieDomain, host);
		const hasGroups = hostCfg.allowedGroups.length > 0;

		let result;
		try {
			result = await acquireTokenByCode(hostCfg, code, hostCfg.redirectUri, hasGroups);
		} catch (err) {
			console.error("[sso] Token exchange failed:", err.message);
			return res.status(401).send("SSO authentication failed");
		}

		// Fetch group memberships if needed. A failed lookup is "unknown", which
		// must deny access rather than silently granting it.
		let groups = [];
		if (hasGroups) {
			groups = result.accessToken ? await fetchUserGroups(result.accessToken) : null;
			if (groups === null) {
				return res.status(502).send("Could not verify group membership");
			}
		}

		// Regenerate session to prevent session fixation attacks.
		req.session.regenerate((err) => {
			if (err) {
				console.error("[sso] Session regeneration failed:", err.message);
				return res.status(500).send("SSO authentication failed");
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
					return res.status(500).send("SSO authentication failed");
				}
				console.log(`[sso] Login completed — host=${host} user=${req.session.ssoUser.email || "(unknown)"}`);
				res.redirect(savedReturnUrl);
			});
		});
	}),
);

// ---------------------------------------------------------------------------
// GET /sso/logout — destroy session, redirect to Entra ID logout
// ---------------------------------------------------------------------------
app.get(
	"/sso/logout",
	route(async (req, res) => {
		const host = originalHost(req);
		const hostCfg = await loadHostConfig(host).catch(() => null);
		const cookieDomain = hostCfg?.cookieDomain || "";
		const safeReturn = validateReturnUrl(queryString(req.query.return), cookieDomain, host);
		const isAbsolute = safeReturn.startsWith("https://") || safeReturn.startsWith("http://");
		const absoluteUri = isAbsolute ? safeReturn : `${req.protocol}://${host}${safeReturn}`;

		req.session.destroy(() => {
			if (cookieDomain) {
				res.clearCookie("npm_sso_sid", { domain: cookieDomain, path: "/" });
			}
			res.clearCookie("npm_sso_sid", { path: "/" });
			if (hostCfg?.tenantId) {
				const tenant = encodeURIComponent(hostCfg.tenantId);
				res.redirect(
					`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(absoluteUri)}`,
				);
			} else {
				res.redirect(safeReturn);
			}
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
