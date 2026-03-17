// backend/sso/server.js
// SSO sidecar Express server.
// Listens on 127.0.0.1:3180 (internal only).
// Handles Azure AD MSAL auth code flow for nginx auth_request.

import express from "express";
import session from "express-session";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig, reloadConfig, getConfig, isConfigured, loadHostGroups } from "./config.js";
import { SsoSessionStore } from "./session-store.js";
import { getAuthCodeUrl, acquireTokenByCode, resetClient } from "./msal-client.js";
import { fetchUserGroups, isGroupMember } from "./group-check.js";

const app = express();
const PORT = 3180;
const HOST = "127.0.0.1";

// ---------------------------------------------------------------------------
// Persistent session secret (Gate 2 fix: survives restarts)
// ---------------------------------------------------------------------------
function getSessionSecret() {
	const secretPath = "/data/sso/session-secret";
	const dir = "/data/sso";
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
	const secret = randomUUID();
	writeFileSync(secretPath, secret, { mode: 0o600 });
	return secret;
}

// ---------------------------------------------------------------------------
// Load initial config and set up session
// ---------------------------------------------------------------------------
const cfg = loadConfig();
const sessionStore = new SsoSessionStore();

app.use(
	session({
		store: sessionStore,
		secret: process.env.SSO_SESSION_SECRET || getSessionSecret(),
		resave: false,
		saveUninitialized: false,
		name: "npm_sso_sid",
		cookie: {
			domain: cfg?.cookieDomain || undefined,
			httpOnly: true,
			secure: process.env.NODE_ENV === "production" || process.env.SSO_SECURE_COOKIE === "true",
			sameSite: "lax",
			maxAge: 8 * 60 * 60 * 1000, // 8 hours
		},
	})
);

// ---------------------------------------------------------------------------
// GET /sso/verify — called by nginx auth_request (internal only)
// ---------------------------------------------------------------------------
app.get("/sso/verify", async (req, res) => {
	if (!isConfigured()) {
		// SSO not configured — pass through (200 = allow)
		return res.sendStatus(200);
	}

	if (!req.session?.ssoUser) {
		return res.sendStatus(401);
	}

	// Check per-host group restrictions
	const originalHost = req.headers["x-original-host"];
	if (originalHost) {
		const hostGroups = loadHostGroups(originalHost);
		if (hostGroups && hostGroups.length > 0) {
			const userGroups = req.session.ssoUser.groups || [];
			if (!isGroupMember(userGroups, hostGroups)) {
				return res.status(403).send("Group membership required");
			}
		}
	}

	// Check global group restrictions
	const currentCfg = getConfig();
	if (currentCfg.allowedGroups && currentCfg.allowedGroups.length > 0) {
		const userGroups = req.session.ssoUser.groups || [];
		if (!isGroupMember(userGroups, currentCfg.allowedGroups)) {
			return res.status(403).send("Group membership required");
		}
	}

	res.set("X-SSO-User", req.session.ssoUser.name || "");
	res.set("X-SSO-Email", req.session.ssoUser.email || "");
	return res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// GET /sso/login — initiate MSAL auth code flow
// ---------------------------------------------------------------------------
app.get("/sso/login", async (req, res) => {
	if (!isConfigured()) {
		return res.status(503).send("SSO is not configured");
	}

	const currentCfg = getConfig();
	const returnUrl = req.query.return || "/";
	const state = randomUUID();
	req.session.oauthState = state;
	req.session.returnUrl = returnUrl;

	// Set cookie domain for SSO
	if (currentCfg.cookieDomain) {
		req.session.cookie.domain = currentCfg.cookieDomain;
	}

	try {
		const hasGroups = (currentCfg.allowedGroups && currentCfg.allowedGroups.length > 0);
		const authUrl = await getAuthCodeUrl(state, currentCfg.redirectUri, hasGroups);
		res.redirect(authUrl);
	} catch (err) {
		console.error("[sso] Login error:", err.message);
		res.status(500).send("SSO login failed");
	}
});

// ---------------------------------------------------------------------------
// GET /sso/callback — MSAL callback, exchange code for token
// ---------------------------------------------------------------------------
app.get("/sso/callback", async (req, res) => {
	const { code, state } = req.query;

	if (!code || !state) {
		return res.status(400).send("Missing code or state");
	}

	if (!req.session.oauthState || state !== req.session.oauthState) {
		return res.status(403).send("Invalid OAuth state");
	}
	delete req.session.oauthState;

	const currentCfg = getConfig();

	try {
		const hasGroups = (currentCfg.allowedGroups && currentCfg.allowedGroups.length > 0);
		const result = await acquireTokenByCode(code, currentCfg.redirectUri, hasGroups);

		// Fetch group memberships if needed
		let groups = [];
		if (hasGroups && result.accessToken) {
			groups = await fetchUserGroups(result.accessToken);
		}

		// Store user in session
		req.session.ssoUser = {
			name: result.account.name,
			email: result.account.username,
			oid: result.account.homeAccountId,
			groups,
		};

		// Set cookie domain
		if (currentCfg.cookieDomain) {
			req.session.cookie.domain = currentCfg.cookieDomain;
		}

		const returnUrl = req.session.returnUrl || "/";
		delete req.session.returnUrl;

		// Validate return URL
		let safe = "/";
		if (returnUrl) {
			if (returnUrl.startsWith("/") && !returnUrl.startsWith("//")) {
				safe = returnUrl;
			} else {
				try {
					const parsed = new URL(returnUrl);
					// Allow if hostname matches cookie domain or is a subdomain of it
					const cookieDomain = (currentCfg.cookieDomain || "").replace(/^\./, "");
					if (cookieDomain && (parsed.hostname === cookieDomain || parsed.hostname.endsWith("." + cookieDomain))) {
						safe = returnUrl;
					}
				} catch (_e) {
					// Invalid URL — use default
				}
			}
		}
		res.redirect(safe);
	} catch (err) {
		console.error("[sso] Callback error:", err.message);
		res.status(500).send("SSO authentication failed");
	}
});

// ---------------------------------------------------------------------------
// GET /sso/logout — destroy session, redirect to Azure AD logout
// ---------------------------------------------------------------------------
app.get("/sso/logout", (req, res) => {
	const currentCfg = getConfig();
	req.session.destroy(() => {
		if (currentCfg?.tenantId) {
			const postLogoutUri = req.query.return || `${req.protocol}://${req.headers["x-original-host"] || req.hostname}/`;
			res.redirect(
				`https://login.microsoftonline.com/${currentCfg.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`
			);
		} else {
			res.redirect("/");
		}
	});
});

// ---------------------------------------------------------------------------
// POST /sso/reload — reload config from DB
// ---------------------------------------------------------------------------
app.post("/sso/reload", (_req, res) => {
	reloadConfig();
	resetClient();
	console.log("[sso] Config reloaded");
	res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sso/health — health check
// ---------------------------------------------------------------------------
app.get("/sso/health", (_req, res) => {
	res.json({ ok: true, configured: isConfigured() });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
	const startCfg = getConfig();
	if (startCfg?.enabled) {
		console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (configured: ${isConfigured()})`);
	} else {
		console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (SSO disabled — waiting for configuration)`);
	}
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on("SIGTERM", () => {
	console.log("[sso] SIGTERM received, shutting down...");
	server.close(() => {
		sessionStore.close();
		process.exit(0);
	});
});
