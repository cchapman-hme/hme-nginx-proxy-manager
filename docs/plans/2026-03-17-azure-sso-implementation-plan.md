# Azure SSO for Proxy Hosts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Azure AD SSO authentication to all nginx proxy hosts, with global settings in the admin UI, per-host opt-out, and shared-cookie cross-host SSO.

**Architecture:** An Express SSO sidecar service (port 3180, internal-only) handles MSAL auth code flow. Nginx `auth_request` directives in proxy host configs call the sidecar to verify sessions. A shared cookie on the configurable parent domain enables true cross-host SSO. Global SSO settings live in NPM's `setting` table; per-host SSO fields on `proxy_host` table.

**Tech Stack:** `@azure/msal-node`, `better-sqlite3` (already in project), `express-session`, nginx `auth_request` module, LiquidJS templates.

**Design doc:** `docs/plans/2026-03-16-azure-sso-proxy-hosts-design.md`

---

## Task 1: Database Migration — Add SSO Fields to proxy_host

**Files:**
- Create: `backend/migrations/20260317000000_sso_fields.js`

**Step 1: Create the migration file**

```javascript
// backend/migrations/20260317000000_sso_fields.js
import { migrate as logger } from "../logger.js";

const migrateName = "sso_fields";

const up = function (knex) {
	logger.info(`[${migrateName}] Migrating Up...`);
	return knex.schema
		.alterTable("proxy_host", (table) => {
			table.tinyint("sso_enabled").notNullable().defaultTo(1);
			table.text("sso_forced_groups").nullable().defaultTo(null);
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

const down = function (knex) {
	logger.info(`[${migrateName}] Migrating Down...`);
	return knex.schema
		.alterTable("proxy_host", (table) => {
			table.dropColumn("sso_enabled");
			table.dropColumn("sso_forced_groups");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

export { up, down };
```

**Step 2: Verify migration runs**

Run: `cd backend && node -e "import('./migrate.js').then(m => m.default.latest()).then(() => console.log('OK'))"`

Expected: Migration applies, adds columns to `proxy_host`.

**Step 3: Commit**

```bash
git add backend/migrations/20260317000000_sso_fields.js
git commit -m "feat(sso): add sso_enabled and sso_forced_groups columns to proxy_host"
```

---

## Task 2: Update Proxy Host Model — Add SSO Boolean Fields

**Files:**
- Modify: `backend/models/proxy_host.js` — add `sso_enabled` to `booleanFields` and `sso_forced_groups` to `jsonAttributes`

The model at `backend/models/proxy_host.js` has a `booleanFields` array that auto-converts int↔bool. Add `sso_enabled` to it. Add `sso_forced_groups` to `jsonAttributes` for JSON parse/stringify.

**Step 1: Add `sso_enabled` to the `booleanFields` array**

Find the line with `"trust_forwarded_proto"` in the booleanFields array and add `"sso_enabled"` after it.

**Step 2: Add `sso_forced_groups` to `jsonAttributes`**

Find the `jsonAttributes` line (contains `domain_names`, `meta`, `locations`) and add `sso_forced_groups`.

**Step 3: Commit**

```bash
git add backend/models/proxy_host.js
git commit -m "feat(sso): add sso_enabled and sso_forced_groups to proxy host model"
```

---

## Task 3: Update Proxy Host JSON Schemas

**Files:**
- Modify: `backend/schema/components/proxy-host-object.json` — add `sso_enabled` and `sso_forced_groups` properties + required
- Modify: `backend/schema/paths/nginx/proxy-hosts/post.json` — add to POST create schema
- Modify: `backend/schema/paths/nginx/proxy-hosts/hostID/put.json` — add to PUT update schema

**Step 1: Add properties to proxy-host-object.json**

Add to `required` array: `"sso_enabled"`.

Add to `properties` object (after `trust_forwarded_proto`):
```json
"sso_enabled": {
    "type": "boolean",
    "description": "Enable Azure SSO authentication for this proxy host",
    "example": true
},
"sso_forced_groups": {
    "oneOf": [
        { "type": "null" },
        {
            "type": "array",
            "items": { "type": "string" }
        }
    ],
    "description": "Azure AD group IDs required to access this host (null = use global default)",
    "example": null
}
```

**Step 2: Add to POST create schema (post.json)**

Add to `properties` (after `access_list_id` block):
```json
"sso_enabled": {
    "$ref": "../../../components/proxy-host-object.json#/properties/sso_enabled"
},
"sso_forced_groups": {
    "$ref": "../../../components/proxy-host-object.json#/properties/sso_forced_groups"
}
```

**Step 3: Add to PUT update schema (hostID/put.json)**

Same pattern as POST — add the two `$ref` properties.

**Step 4: Validate schemas**

Run: `cd backend && npm run validate-schema`
Expected: No errors.

**Step 5: Commit**

```bash
git add backend/schema/
git commit -m "feat(sso): add sso_enabled and sso_forced_groups to proxy host schemas"
```

---

## Task 4: Setup SSO Default Settings in Database

**Files:**
- Modify: `backend/setup.js` — add `setupSsoSettings()` function to create SSO setting rows

The existing pattern in `setup.js` is: check if setting exists → if not, insert default. We need to create SSO settings with empty/disabled defaults.

**Step 1: Add setupSsoSettings function**

Add after the `setupDefaultSettings` function (around line 98):

```javascript
/**
 * Creates default SSO settings if they don't already exist in the database
 *
 * @returns {Promise}
 */
const setupSsoSettings = async () => {
	const ssoSettings = [
		{
			id: "sso-enabled",
			name: "SSO Enabled",
			description: "Master toggle for Azure SSO authentication on proxy hosts",
			value: "false",
			meta: {},
		},
		{
			id: "sso-tenant-id",
			name: "SSO Tenant ID",
			description: "Azure AD Tenant ID for SSO authentication",
			value: "",
			meta: {},
		},
		{
			id: "sso-client-id",
			name: "SSO Client ID",
			description: "Azure AD App Registration Client ID",
			value: "",
			meta: {},
		},
		{
			id: "sso-client-secret",
			name: "SSO Client Secret",
			description: "Azure AD App Registration Client Secret",
			value: "",
			meta: {},
		},
		{
			id: "sso-cookie-domain",
			name: "SSO Cookie Domain",
			description: "Shared cookie domain for cross-host SSO (e.g. .hme.com)",
			value: "",
			meta: {},
		},
		{
			id: "sso-redirect-uri",
			name: "SSO Redirect URI",
			description: "OAuth callback URL for Azure AD (e.g. https://sso.hme.com/sso/callback)",
			value: "",
			meta: {},
		},
		{
			id: "sso-allowed-groups",
			name: "SSO Allowed Groups",
			description: "Default Azure AD group IDs allowed access (JSON array, empty = all users)",
			value: "[]",
			meta: {},
		},
	];

	for (const setting of ssoSettings) {
		const row = await settingModel
			.query()
			.select("id")
			.where({ id: setting.id })
			.first();

		if (!row?.id) {
			await settingModel.query().insert(setting);
		}
	}
	logger.info("SSO settings initialized");
};
```

**Step 2: Add to startup chain**

Change the export default at the bottom from:
```javascript
export default () => setupDefaultUser().then(setupDefaultSettings).then(setupCertbotPlugins).then(setupLogrotation);
```
to:
```javascript
export default () => setupDefaultUser().then(setupDefaultSettings).then(setupSsoSettings).then(setupCertbotPlugins).then(setupLogrotation);
```

**Step 3: Commit**

```bash
git add backend/setup.js
git commit -m "feat(sso): add default SSO settings to database setup"
```

---

## Task 5: SSO Settings API — Backend Setting Update Cascade

**Files:**
- Modify: `backend/internal/setting.js` — add SSO setting save handler that triggers nginx bulk config regeneration

When SSO settings are updated, all proxy hosts with `sso_enabled=1` must have their nginx configs regenerated (same pattern as access-list changes triggering bulk config regen).

**Step 1: Add SSO cascade to the `update` function**

In `backend/internal/setting.js`, in the `update` method, after the `if (row.id === "default-site")` block (around line 75), add:

```javascript
// When SSO settings change, regenerate all proxy host configs
if (row.id.startsWith("sso-")) {
    const proxyHostModel = (await import("../models/proxy_host.js")).default;
    const hosts = await proxyHostModel
        .query()
        .where("is_deleted", 0)
        .eager("[certificate, access_list.[clients,items]]");

    if (hosts.length) {
        const internalNginxMod = (await import("./nginx.js")).default;
        await internalNginxMod.bulkGenerateConfigs("proxy_host", hosts);
        await internalNginxMod.reload();
    }

    return row;
}
```

**Step 2: Commit**

```bash
git add backend/internal/setting.js
git commit -m "feat(sso): regenerate proxy configs when SSO settings change"
```

---

## Task 6: Nginx Config Generation — Inject SSO Context

**Files:**
- Modify: `backend/internal/nginx.js` — enrich template context with `sso_configured` flag and SSO settings

In the `generateConfig` function (around line 215), after `host.ipv6 = internalNginx.ipv6Enabled();`, add SSO context assembly.

**Step 1: Add SSO context to generateConfig**

Add after `host.ipv6 = internalNginx.ipv6Enabled();` (around line 250):

```javascript
// SSO context — read settings from DB if this is a proxy_host
if (nice_host_type === "proxy_host") {
    try {
        const settingModel = (await import("../models/setting.js")).default;
        const ssoSettings = await settingModel.query().where("id", "like", "sso-%");
        const ssoMap = {};
        for (const s of ssoSettings) {
            ssoMap[s.id] = s.value;
        }
        host.sso_configured = !!(
            ssoMap["sso-enabled"] === "true" &&
            ssoMap["sso-tenant-id"] &&
            ssoMap["sso-client-id"] &&
            ssoMap["sso-client-secret"] &&
            ssoMap["sso-cookie-domain"]
        );
        host.sso_redirect_host = host.domain_names?.[0] || "";
    } catch (_err) {
        host.sso_configured = false;
    }
}
```

**Note:** The `generateConfig` function currently returns a Promise chain. This needs to become async or use an additional `.then()`. Since the function already uses promise chains, the cleanest approach is to add the SSO query inside the existing `locationsPromise.then()` block, before `renderEngine.parseAndRender()`.

**Step 2: Commit**

```bash
git add backend/internal/nginx.js
git commit -m "feat(sso): inject SSO context into nginx template generation"
```

---

## Task 7: Nginx Templates — Create _sso.conf and Update proxy_host.conf

**Files:**
- Create: `backend/templates/_sso.conf`
- Modify: `backend/templates/proxy_host.conf`

**Step 1: Create `_sso.conf` partial**

```nginx
{% if sso_enabled == 1 or sso_enabled == true %}
{% if sso_configured %}
    # Azure SSO authentication
    auth_request /_sso_verify;
    auth_request_set $sso_user  $upstream_http_x_sso_user;
    auth_request_set $sso_email $upstream_http_x_sso_email;
    proxy_set_header X-SSO-User  $sso_user;
    proxy_set_header X-SSO-Email $sso_email;
    error_page 401 = @sso_redirect;
{% endif %}
{% endif %}
```

**Step 2: Update `proxy_host.conf` — add SSO locations and include**

Add SSO server-level locations inside the `server {}` block, BEFORE `{{ locations }}`. Add them after `{{ advanced_config }}`:

```nginx
{% if sso_enabled == 1 or sso_enabled == true %}
{% if sso_configured %}
  # SSO internal verify endpoint
  location = /_sso_verify {
      internal;
      proxy_pass http://127.0.0.1:3180/sso/verify;
      proxy_pass_request_body off;
      proxy_set_header Content-Length "";
      proxy_set_header X-Original-URI $request_uri;
      proxy_set_header X-Original-Host $host;
      proxy_set_header Cookie $http_cookie;
  }

  # SSO redirect for unauthenticated requests
  location @sso_redirect {
      return 302 $scheme://{{ sso_redirect_host }}/sso/login?return=$scheme://$host$request_uri;
  }

  # SSO login/callback/logout endpoints (NOT protected by auth_request)
  location /sso/ {
      proxy_pass http://127.0.0.1:3180/sso/;
      proxy_set_header Host $host;
      proxy_set_header X-Original-Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
{% endif %}
{% endif %}
```

Add `{% include "_sso.conf" %}` inside the `location / {}` block, BEFORE `{% include "_access.conf" %}`.

**Step 3: Commit**

```bash
git add backend/templates/_sso.conf backend/templates/proxy_host.conf
git commit -m "feat(sso): add nginx SSO templates and auth_request directives"
```

---

## Task 8: SSO Sidecar — Config Reader

**Files:**
- Create: `backend/sso/config.js`

This module reads SSO settings from NPM's main database (`/data/database.sqlite` for SQLite or the configured knex connection).

**Step 1: Create config.js**

```javascript
// backend/sso/config.js
// Reads SSO configuration from NPM's setting table.
// Uses better-sqlite3 directly for lightweight, synchronous reads.

import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const DB_PATH = process.env.SSO_DB_PATH || "/data/database.sqlite";

let _config = null;
let _db = null;

function getDb() {
	if (_db) return _db;
	if (!existsSync(DB_PATH)) return null;
	_db = new Database(DB_PATH, { readonly: true });
	return _db;
}

/**
 * Load SSO settings from the NPM database.
 * @returns {{ enabled: boolean, tenantId: string, clientId: string, clientSecret: string, cookieDomain: string, redirectUri: string, allowedGroups: string[] } | null}
 */
export function loadConfig() {
	const db = getDb();
	if (!db) return null;

	try {
		const rows = db.prepare("SELECT id, value FROM setting WHERE id LIKE 'sso-%'").all();
		const map = {};
		for (const row of rows) {
			map[row.id] = row.value;
		}

		const cfg = {
			enabled: map["sso-enabled"] === "true",
			tenantId: map["sso-tenant-id"] || "",
			clientId: map["sso-client-id"] || "",
			clientSecret: map["sso-client-secret"] || "",
			cookieDomain: map["sso-cookie-domain"] || "",
			redirectUri: map["sso-redirect-uri"] || "",
			allowedGroups: parseGroups(map["sso-allowed-groups"]),
		};

		_config = cfg;
		return cfg;
	} catch (err) {
		console.error("[sso] Failed to load config:", err.message);
		return null;
	}
}

/**
 * Load per-host SSO group overrides.
 * @param {string} hostname - The hostname to look up
 * @returns {string[] | null} - Array of group IDs, or null for global default
 */
export function loadHostGroups(hostname) {
	const db = getDb();
	if (!db) return null;

	try {
		const row = db.prepare(
			"SELECT sso_forced_groups FROM proxy_host WHERE is_deleted = 0 AND domain_names LIKE ? AND sso_enabled = 1"
		).get(`%${hostname}%`);

		if (!row || !row.sso_forced_groups) return null;
		return parseGroups(row.sso_forced_groups);
	} catch (_err) {
		return null;
	}
}

function parseGroups(val) {
	if (!val) return [];
	try {
		const parsed = JSON.parse(val);
		return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
	} catch (_err) {
		return [];
	}
}

/**
 * Get cached config (call loadConfig first).
 * @returns {object | null}
 */
export function getConfig() {
	return _config;
}

/**
 * Reload config from DB (called after settings change).
 */
export function reloadConfig() {
	if (_db) {
		_db.close();
		_db = null;
	}
	return loadConfig();
}

/**
 * Check if SSO is fully configured.
 * @returns {boolean}
 */
export function isConfigured() {
	const cfg = _config || loadConfig();
	if (!cfg) return false;
	return cfg.enabled && !!cfg.tenantId && !!cfg.clientId && !!cfg.clientSecret && !!cfg.cookieDomain;
}
```

**Step 2: Commit**

```bash
git add backend/sso/config.js
git commit -m "feat(sso): add SSO config reader from NPM database"
```

---

## Task 9: SSO Sidecar — Session Store

**Files:**
- Create: `backend/sso/session-store.js`

Same pattern as Paige's session store — SQLite-backed express-session store.

**Step 1: Create session-store.js**

```javascript
// backend/sso/session-store.js
// SQLite-backed session store for the SSO sidecar.

import session from "express-session";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SESSION_DB_PATH = process.env.SSO_SESSION_DB_PATH || "/data/sso/sessions.db";

export class SsoSessionStore extends session.Store {
	constructor() {
		super();
		const dir = dirname(SESSION_DB_PATH);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		this.db = new Database(SESSION_DB_PATH);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				sid TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				expires INTEGER NOT NULL
			)
		`);
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_sso_expires ON sessions(expires)");
		this._get = this.db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires > ?");
		this._set = this.db.prepare("INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)");
		this._del = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
		this._prune = this.db.prepare("DELETE FROM sessions WHERE expires <= ?");
		this._pruneInterval = setInterval(() => this.prune(), 15 * 60 * 1000);
	}

	get(sid, cb) {
		try {
			const row = this._get.get(sid, Date.now());
			cb(null, row ? JSON.parse(row.data) : null);
		} catch (e) {
			cb(e);
		}
	}

	set(sid, data, cb) {
		try {
			const maxAge = data.cookie?.maxAge || 8 * 60 * 60 * 1000;
			this._set.run(sid, JSON.stringify(data), Date.now() + maxAge);
			cb?.(null);
		} catch (e) {
			cb?.(e);
		}
	}

	destroy(sid, cb) {
		try {
			this._del.run(sid);
			cb?.(null);
		} catch (e) {
			cb?.(e);
		}
	}

	prune() {
		this._prune.run(Date.now());
	}

	close() {
		clearInterval(this._pruneInterval);
		this.db.close();
	}
}
```

**Step 2: Commit**

```bash
git add backend/sso/session-store.js
git commit -m "feat(sso): add SQLite session store for SSO sidecar"
```

---

## Task 10: SSO Sidecar — MSAL Client

**Files:**
- Create: `backend/sso/msal-client.js`

**Step 1: Create msal-client.js**

```javascript
// backend/sso/msal-client.js
// MSAL ConfidentialClientApplication wrapper for Azure AD auth code flow.

import { ConfidentialClientApplication } from "@azure/msal-node";
import { getConfig } from "./config.js";

let _msalClient = null;
let _lastConfigHash = null;

const BASE_SCOPES = ["openid", "profile", "email"];

function configHash(cfg) {
	return `${cfg.tenantId}:${cfg.clientId}:${cfg.clientSecret}`;
}

/**
 * Get or create the MSAL client. Recreates if config changes.
 * @returns {ConfidentialClientApplication}
 */
export function getMsalClient() {
	const cfg = getConfig();
	if (!cfg) throw new Error("SSO not configured");

	const hash = configHash(cfg);
	if (_msalClient && _lastConfigHash === hash) return _msalClient;

	_msalClient = new ConfidentialClientApplication({
		auth: {
			clientId: cfg.clientId,
			authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
			clientSecret: cfg.clientSecret,
		},
	});
	_lastConfigHash = hash;
	return _msalClient;
}

/**
 * Get the auth code URL for login.
 * @param {string} state - CSRF state
 * @param {string} redirectUri - OAuth callback URL
 * @param {boolean} includeGroups - Whether to request group membership scope
 * @returns {Promise<string>}
 */
export async function getAuthCodeUrl(state, redirectUri, includeGroups = false) {
	const scopes = [...BASE_SCOPES];
	if (includeGroups) scopes.push("GroupMember.Read.All");
	return getMsalClient().getAuthCodeUrl({
		scopes,
		redirectUri,
		state,
		prompt: "select_account",
	});
}

/**
 * Exchange auth code for token.
 * @param {string} code - Authorization code from Azure AD
 * @param {string} redirectUri - Must match the one used in getAuthCodeUrl
 * @param {boolean} includeGroups - Whether to request group membership scope
 * @returns {Promise<object>}
 */
export async function acquireTokenByCode(code, redirectUri, includeGroups = false) {
	const scopes = [...BASE_SCOPES];
	if (includeGroups) scopes.push("GroupMember.Read.All");
	return getMsalClient().acquireTokenByCode({
		code,
		scopes,
		redirectUri,
	});
}

/**
 * Reset client (for config reload).
 */
export function resetClient() {
	_msalClient = null;
	_lastConfigHash = null;
}
```

**Step 2: Commit**

```bash
git add backend/sso/msal-client.js
git commit -m "feat(sso): add MSAL client wrapper for SSO sidecar"
```

---

## Task 11: SSO Sidecar — Group Membership Check

**Files:**
- Create: `backend/sso/group-check.js`

**Step 1: Create group-check.js**

```javascript
// backend/sso/group-check.js
// Azure AD group membership check via Microsoft Graph API.

/**
 * Fetch the user's Azure AD group memberships.
 * @param {string} accessToken - Bearer token with GroupMember.Read.All scope
 * @returns {Promise<string[]>} - Array of group IDs
 */
export async function fetchUserGroups(accessToken) {
	try {
		const res = await fetch("https://graph.microsoft.com/v1.0/me/memberOf?$select=id", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) {
			console.error(`[sso] Graph API group membership check failed: ${res.status}`);
			return [];
		}
		const data = await res.json();
		return (data.value || []).map((g) => g.id);
	} catch (err) {
		console.error("[sso] Group membership fetch error:", err.message);
		return [];
	}
}

/**
 * Check if user is a member of at least one of the required groups.
 * @param {string[]} userGroups - User's group IDs
 * @param {string[]} requiredGroups - Required group IDs
 * @returns {boolean}
 */
export function isGroupMember(userGroups, requiredGroups) {
	if (!requiredGroups || requiredGroups.length === 0) return true;
	const required = new Set(requiredGroups);
	return userGroups.some((id) => required.has(id));
}
```

**Step 2: Commit**

```bash
git add backend/sso/group-check.js
git commit -m "feat(sso): add Azure AD group membership checker"
```

---

## Task 12: SSO Sidecar — Express Server

**Files:**
- Create: `backend/sso/server.js`

This is the main sidecar service. Handles `/sso/login`, `/sso/callback`, `/sso/verify`, `/sso/logout`, `/sso/reload`.

**Step 1: Create server.js**

```javascript
// backend/sso/server.js
// SSO sidecar Express server.
// Listens on 127.0.0.1:3180 (internal only).
// Handles Azure AD MSAL auth code flow for nginx auth_request.

import express from "express";
import session from "express-session";
import { randomUUID } from "node:crypto";
import { loadConfig, reloadConfig, getConfig, isConfigured, loadHostGroups } from "./config.js";
import { SsoSessionStore } from "./session-store.js";
import { getAuthCodeUrl, acquireTokenByCode, resetClient } from "./msal-client.js";
import { fetchUserGroups, isGroupMember } from "./group-check.js";

const app = express();
const PORT = 3180;
const HOST = "127.0.0.1";

// Load initial config
loadConfig();

// Session setup
const sessionStore = new SsoSessionStore();
app.use(
	session({
		store: sessionStore,
		secret: process.env.SSO_SESSION_SECRET || randomUUID(),
		resave: false,
		saveUninitialized: false,
		name: "npm_sso_sid",
		cookie: {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production" || process.env.SSO_SECURE_COOKIE === "true",
			sameSite: "lax",
			maxAge: 8 * 60 * 60 * 1000, // 8 hours
			domain: undefined, // Set dynamically per-response in login callback
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
	const cfg = getConfig();
	if (cfg.allowedGroups && cfg.allowedGroups.length > 0) {
		const userGroups = req.session.ssoUser.groups || [];
		if (!isGroupMember(userGroups, cfg.allowedGroups)) {
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

	const cfg = getConfig();
	const returnUrl = req.query.return || "/";
	const state = randomUUID();
	req.session.oauthState = state;
	req.session.returnUrl = returnUrl;

	// Set cookie domain for SSO
	if (cfg.cookieDomain) {
		req.session.cookie.domain = cfg.cookieDomain;
	}

	try {
		const hasGroups = (cfg.allowedGroups && cfg.allowedGroups.length > 0);
		const authUrl = await getAuthCodeUrl(state, cfg.redirectUri, hasGroups);
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

	const cfg = getConfig();

	try {
		const hasGroups = (cfg.allowedGroups && cfg.allowedGroups.length > 0);
		const result = await acquireTokenByCode(code, cfg.redirectUri, hasGroups);

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
		if (cfg.cookieDomain) {
			req.session.cookie.domain = cfg.cookieDomain;
		}

		const returnUrl = req.session.returnUrl || "/";
		delete req.session.returnUrl;

		// Validate return URL (must start with / or be same-origin)
		const safe = returnUrl.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : "/";
		res.redirect(safe);
	} catch (err) {
		console.error("[sso] Callback error:", err.message);
		res.status(500).send("SSO authentication failed");
	}
});

// ---------------------------------------------------------------------------
// GET /sso/logout — destroy session
// ---------------------------------------------------------------------------
app.get("/sso/logout", (req, res) => {
	const cfg = getConfig();
	req.session.destroy(() => {
		if (cfg?.tenantId) {
			// Redirect to Azure AD logout for full IdP sign-out
			const postLogoutUri = req.query.return || `${req.protocol}://${req.headers["x-original-host"] || req.hostname}/`;
			res.redirect(
				`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`
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
// Health check
// ---------------------------------------------------------------------------
app.get("/sso/health", (_req, res) => {
	res.json({ ok: true, configured: isConfigured() });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
	const cfg = getConfig();
	if (cfg?.enabled) {
		console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (configured: ${isConfigured()})`);
	} else {
		console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (SSO disabled — waiting for configuration)`);
	}
});

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("[sso] Shutting down...");
	server.close();
	sessionStore.close();
	process.exit(0);
});
```

**Step 2: Commit**

```bash
git add backend/sso/server.js
git commit -m "feat(sso): add SSO sidecar Express server"
```

---

## Task 13: SSO Sidecar — Add package.json for sidecar

**Files:**
- Create: `backend/sso/package.json`

The sidecar needs its own package.json since it runs as a separate Node.js process.

**Step 1: Create package.json**

```json
{
	"name": "npm-sso-sidecar",
	"version": "1.0.0",
	"type": "module",
	"private": true,
	"dependencies": {
		"@azure/msal-node": "^2.16.2",
		"better-sqlite3": "^12.6.2",
		"express": "^5.2.1",
		"express-session": "^1.18.1"
	}
}
```

**Step 2: Commit**

```bash
git add backend/sso/package.json
git commit -m "feat(sso): add SSO sidecar package.json"
```

---

## Task 14: Docker — s6 Service for SSO Sidecar

**Files:**
- Create: `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/type`
- Create: `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/run`
- Create: `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/dependencies.d/prepare`
- Create: `docker/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/sso`

**Step 1: Create service type file**

```plaintext
longrun
```

**Step 2: Create run script**

```bash
#!/command/with-contenv bash
# shellcheck shell=bash

set -e

. /usr/bin/common.sh

cd /app/sso || exit 1

log_info 'Starting SSO sidecar ...'

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  s6-setuidgid "$PUID:$PGID" npm install --production
fi

while :
do
  s6-setuidgid "$PUID:$PGID" bash -c "export HOME=$NPMHOME;node --abort_on_uncaught_exception server.js"
  sleep 1
done
```

**Step 3: Create dependency file (empty file named `prepare`)**

The `dependencies.d/prepare` file is an empty file whose name indicates the dependency.

**Step 4: Create user contents entry (empty file named `sso`)**

Empty file at `user/contents.d/sso`.

**Step 5: Commit**

```bash
git add docker/rootfs/etc/s6-overlay/s6-rc.d/sso/
git add docker/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/sso
git commit -m "feat(sso): add s6 service for SSO sidecar"
```

---

## Task 15: Docker — Update Dockerfile to Copy SSO Sidecar

**Files:**
- Modify: `docker/Dockerfile`

The Dockerfile needs to copy `backend/sso/` into the container at `/app/sso/`. Check the existing copy pattern for the backend and add a similar line for the sso directory.

**Step 1: Add COPY for sso directory**

Find where `backend/` is copied (e.g., `COPY backend /app`) and add:
```dockerfile
COPY backend/sso /app/sso
```

Or if the backend is already copied wholesale, verify `sso/` is a subdirectory of `backend/` and will be included. If the Dockerfile copies specific subdirectories, add the sso copy.

**Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(sso): copy SSO sidecar to container"
```

---

## Task 16: Notify SSO Sidecar on Settings Change

**Files:**
- Modify: `backend/internal/setting.js` — add HTTP POST to sidecar `/sso/reload` after SSO settings save

**Step 1: Add reload notification**

In the SSO cascade block added in Task 5, after the bulk config regeneration, add:

```javascript
// Notify SSO sidecar to reload config
try {
    await fetch("http://127.0.0.1:3180/sso/reload", { method: "POST" });
} catch (_err) {
    // Sidecar may not be running yet — ignore
}
```

**Step 2: Commit**

```bash
git add backend/internal/setting.js
git commit -m "feat(sso): notify SSO sidecar on config change"
```

---

## Task 17: Frontend — SSO Settings Page

**Files:**
- Create: `frontend/src/pages/Settings/SsoSettings.tsx`
- Modify: `frontend/src/pages/Settings/Layout.tsx` — add SSO tab to sidebar nav
- Modify: `frontend/src/locale/src/en.json` — add SSO locale strings

**Step 1: Add locale strings to en.json**

Add to `en.json`:
```json
"settings.sso": { "defaultMessage": "Azure SSO" },
"settings.sso.description": { "defaultMessage": "Configure Azure AD Single Sign-On for proxy hosts" },
"settings.sso.tenant-id": { "defaultMessage": "Tenant ID" },
"settings.sso.client-id": { "defaultMessage": "Client ID" },
"settings.sso.client-secret": { "defaultMessage": "Client Secret" },
"settings.sso.cookie-domain": { "defaultMessage": "Cookie Domain" },
"settings.sso.redirect-uri": { "defaultMessage": "Redirect URI" },
"settings.sso.allowed-groups": { "defaultMessage": "Allowed Groups (comma-separated Azure AD Group IDs)" },
"settings.sso.enabled": { "defaultMessage": "Enable Azure SSO" },
"settings.sso.enabled.description": { "defaultMessage": "When enabled, all proxy hosts require Azure AD SSO authentication by default" },
"settings.sso.save-warning": { "defaultMessage": "Saving will regenerate all proxy host nginx configs." },
"host.sso-enabled": { "defaultMessage": "Azure SSO" },
"host.sso-enabled.description": { "defaultMessage": "Require Azure AD SSO authentication for this proxy host" },
"host.sso-forced-groups": { "defaultMessage": "Required Azure AD Groups" },
"host.sso-forced-groups.description": { "defaultMessage": "Comma-separated Azure AD group IDs. Leave empty to use global default." }
```

**Step 2: Create SsoSettings.tsx**

```tsx
// frontend/src/pages/Settings/SsoSettings.tsx
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function SsoSettings() {
	const { data: enabledData, isLoading: l1 } = useSetting("sso-enabled");
	const { data: tenantData, isLoading: l2 } = useSetting("sso-tenant-id");
	const { data: clientIdData, isLoading: l3 } = useSetting("sso-client-id");
	const { data: clientSecretData, isLoading: l4 } = useSetting("sso-client-secret");
	const { data: cookieDomainData, isLoading: l5 } = useSetting("sso-cookie-domain");
	const { data: redirectUriData, isLoading: l6 } = useSetting("sso-redirect-uri");
	const { data: groupsData, isLoading: l7 } = useSetting("sso-allowed-groups");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isLoading = l1 || l2 || l3 || l4 || l5 || l6 || l7;

	const saveField = (id: string, value: string): Promise<void> => {
		return new Promise((resolve, reject) => {
			setSetting(
				{ id, value, meta: {} },
				{ onSuccess: () => resolve(), onError: reject }
			);
		});
	};

	const onSubmit = async (values: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			await saveField("sso-tenant-id", values.tenantId);
			await saveField("sso-client-id", values.clientId);
			await saveField("sso-client-secret", values.clientSecret);
			await saveField("sso-cookie-domain", values.cookieDomain);
			await saveField("sso-redirect-uri", values.redirectUri);
			await saveField("sso-allowed-groups", values.allowedGroups);
			// Save enabled last — triggers config regeneration
			await saveField("sso-enabled", values.enabled ? "true" : "false");
			showObjectSuccess("setting", "saved");
		} catch (err: any) {
			setErrorMsg(err.message || "Failed to save SSO settings");
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	return (
		<Formik
			initialValues={{
				enabled: enabledData?.value === "true",
				tenantId: tenantData?.value || "",
				clientId: clientIdData?.value || "",
				clientSecret: clientSecretData?.value || "",
				cookieDomain: cookieDomainData?.value || "",
				redirectUri: redirectUriData?.value || "",
				allowedGroups: groupsData?.value || "[]",
			}}
			onSubmit={onSubmit}
		>
			{({ values }) => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<p className="text-muted mb-4">
							<T id="settings.sso.description" />
						</p>
						<Alert variant="warning" show>
							<T id="settings.sso.save-warning" />
						</Alert>

						<div className="mb-3">
							<label className="form-check form-switch" htmlFor="ssoEnabled">
								<Field name="enabled" type="checkbox" className="form-check-input" id="ssoEnabled" />
								<span className="form-check-label">
									<T id="settings.sso.enabled" />
								</span>
							</label>
							<small className="form-hint">
								<T id="settings.sso.enabled.description" />
							</small>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="tenantId">
								<T id="settings.sso.tenant-id" />
							</label>
							<Field name="tenantId" type="text" className="form-control" id="tenantId"
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="clientId">
								<T id="settings.sso.client-id" />
							</label>
							<Field name="clientId" type="text" className="form-control" id="clientId"
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="clientSecret">
								<T id="settings.sso.client-secret" />
							</label>
							<Field name="clientSecret" type="password" className="form-control" id="clientSecret"
								placeholder="••••••••" />
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="cookieDomain">
								<T id="settings.sso.cookie-domain" />
							</label>
							<Field name="cookieDomain" type="text" className="form-control" id="cookieDomain"
								placeholder=".hme.com" />
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="redirectUri">
								<T id="settings.sso.redirect-uri" />
							</label>
							<Field name="redirectUri" type="text" className="form-control" id="redirectUri"
								placeholder="https://sso.hme.com/sso/callback" />
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="allowedGroups">
								<T id="settings.sso.allowed-groups" />
							</label>
							<Field name="allowedGroups" type="text" className="form-control" id="allowedGroups"
								placeholder='["group-id-1", "group-id-2"]' />
						</div>
					</div>
					<div className="card-footer bg-transparent mt-auto">
						<div className="btn-list justify-content-end">
							<Button type="submit" actionType="primary" className="bg-lime"
								isLoading={isSubmitting} disabled={isSubmitting}>
								<T id="save" />
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}
```

**Step 3: Update Layout.tsx to add SSO tab**

Add a state for active tab and render `SsoSettings` when selected. Add a second `<a>` in the sidebar nav for "Azure SSO".

In `Layout.tsx`, add import for `SsoSettings`:
```tsx
import SsoSettings from "./SsoSettings";
```

Add state and tab switching logic. Change the hardcoded nav to support multiple tabs.

**Step 4: Commit**

```bash
git add frontend/src/pages/Settings/SsoSettings.tsx frontend/src/pages/Settings/Layout.tsx frontend/src/locale/src/en.json
git commit -m "feat(sso): add SSO settings page in admin UI"
```

---

## Task 18: Frontend — Proxy Host Modal SSO Fields

**Files:**
- Modify: `frontend/src/modals/ProxyHostModal.tsx` — add `ssoEnabled` initial value and toggle to Details tab

**Step 1: Add `ssoEnabled` to initial values**

In the `initialValues` object, add:
```typescript
ssoEnabled: data?.ssoEnabled ?? true,
ssoForcedGroups: data?.ssoForcedGroups ? data.ssoForcedGroups.join(", ") : "",
```

**Step 2: Add SSO toggle to Details tab options section**

After the `allowWebsocketUpgrade` toggle div, add:
```tsx
<div>
	<label className="row" htmlFor="ssoEnabled">
		<span className="col">
			<T id="host.sso-enabled" />
		</span>
		<span className="col-auto">
			<Field name="ssoEnabled" type="checkbox">
				{({ field }: any) => (
					<label className="form-check form-check-single form-switch">
						<input
							{...field}
							id="ssoEnabled"
							className={cn("form-check-input", {
								"bg-lime": field.checked,
							})}
							type="checkbox"
						/>
					</label>
				)}
			</Field>
		</span>
	</label>
</div>
```

**Step 3: Add ssoForcedGroups field** (optional, below the toggle):
```tsx
<div className="mb-3 mt-2">
	<label className="form-label" htmlFor="ssoForcedGroups">
		<T id="host.sso-forced-groups" />
	</label>
	<Field name="ssoForcedGroups" type="text" className="form-control" id="ssoForcedGroups"
		placeholder="Leave empty for global default" />
	<small className="form-hint">
		<T id="host.sso-forced-groups.description" />
	</small>
</div>
```

**Step 4: Commit**

```bash
git add frontend/src/modals/ProxyHostModal.tsx
git commit -m "feat(sso): add SSO toggle and group fields to proxy host modal"
```

---

## Task 19: Frontend — Data Transformation for SSO Fields

**Files:**
- Check and update: `frontend/src/api/backend.ts` or wherever proxy host payload transformation happens

The backend uses `snake_case` (`sso_enabled`, `sso_forced_groups`) while the frontend uses `camelCase` (`ssoEnabled`, `ssoForcedGroups`). The API layer needs to transform these. Check the existing transformation pattern for `trust_forwarded_proto` ↔ `trustForwardedProto` and follow the same pattern.

Also, `ssoForcedGroups` needs to be converted from comma-separated string to JSON array before sending to the backend.

**Step 1: Locate and update the transformation functions**

Find where `trustForwardedProto` is mapped to/from `trust_forwarded_proto` and add equivalent mappings for `ssoEnabled` ↔ `sso_enabled` and `ssoForcedGroups` ↔ `sso_forced_groups`.

For `ssoForcedGroups`, add transformation: comma-separated string → JSON array of trimmed strings (on send), and JSON array → comma-separated string (on receive).

**Step 2: Commit**

```bash
git add frontend/src/api/
git commit -m "feat(sso): add SSO field transformations in API layer"
```

---

## Task 20: Integration Testing — Build and Verify

**Step 1: Build the Docker image**

```bash
sudo docker compose -f docker/docker-compose.dev.yml up --build -d
```

**Step 2: Verify sidecar starts**

```bash
sudo docker compose -f docker/docker-compose.dev.yml logs sso
# or check inside container:
sudo docker compose -f docker/docker-compose.dev.yml exec app curl http://127.0.0.1:3180/sso/health
```

Expected: `{"ok":true,"configured":false}`

**Step 3: Verify SSO settings page loads**

Open NPM admin UI → Settings → Azure SSO tab. Fill in dummy values and save.

**Step 4: Verify nginx config generation**

Create a proxy host. Check the generated config at `/data/nginx/proxy_host/{id}.conf` — when SSO is configured, it should contain `auth_request /_sso_verify;` and the SSO location blocks.

**Step 5: Verify without SSO configured**

When SSO settings are empty/disabled, proxy host configs should NOT contain any SSO directives. Nginx should load fine.

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(sso): integration testing fixes"
```

---

## Summary of All Files

### Created:
| File | Purpose |
|------|---------|
| `backend/migrations/20260317000000_sso_fields.js` | DB migration for proxy_host SSO columns |
| `backend/templates/_sso.conf` | Nginx SSO auth_request partial template |
| `backend/sso/config.js` | SSO config reader from NPM database |
| `backend/sso/session-store.js` | SQLite session store for sidecar |
| `backend/sso/msal-client.js` | MSAL client wrapper |
| `backend/sso/group-check.js` | Azure AD group membership checker |
| `backend/sso/server.js` | SSO sidecar Express server |
| `backend/sso/package.json` | Sidecar dependencies |
| `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/type` | s6 service type |
| `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/run` | s6 service run script |
| `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/dependencies.d/prepare` | s6 dependency |
| `docker/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/sso` | s6 user contents |
| `frontend/src/pages/Settings/SsoSettings.tsx` | SSO settings admin page |

### Modified:
| File | Change |
|------|--------|
| `backend/models/proxy_host.js` | Add `sso_enabled` to booleanFields, `sso_forced_groups` to jsonAttributes |
| `backend/schema/components/proxy-host-object.json` | Add SSO properties |
| `backend/schema/paths/nginx/proxy-hosts/post.json` | Add SSO to POST schema |
| `backend/schema/paths/nginx/proxy-hosts/hostID/put.json` | Add SSO to PUT schema |
| `backend/setup.js` | Add `setupSsoSettings()` to startup chain |
| `backend/internal/setting.js` | Add SSO settings cascade (bulk regen + sidecar reload) |
| `backend/internal/nginx.js` | Inject SSO context into template generation |
| `backend/templates/proxy_host.conf` | Add SSO locations and include `_sso.conf` |
| `docker/Dockerfile` | Copy sso directory |
| `frontend/src/pages/Settings/Layout.tsx` | Add SSO tab to settings nav |
| `frontend/src/locale/src/en.json` | Add SSO locale strings |
| `frontend/src/modals/ProxyHostModal.tsx` | Add SSO toggle and group fields |
| `frontend/src/api/backend.ts` (or equivalent) | Add SSO field transformations |

---

## GATE 2: Plan Review — Issues Found & Resolutions

### Issue 1: Session Secret Instability (CRITICAL)

**Problem:** Task 12 (`server.js`) uses `randomUUID()` as fallback session secret. Every sidecar restart generates a new secret, invalidating ALL active SSO sessions across all hosts. This makes SSO unreliable.

**Resolution:** Generate a persistent secret on first boot and store it to `/data/sso/session-secret`. On subsequent boots, read from file. Update Task 12 server.js:

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
function getSessionSecret() {
    const secretPath = "/data/sso/session-secret";
    const dir = "/data/sso";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
    const secret = randomUUID();
    writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
}
```

Replace `process.env.SSO_SESSION_SECRET || randomUUID()` with `process.env.SSO_SESSION_SECRET || getSessionSecret()`.

### Issue 2: Dockerfile SSO Dependency Install (CRITICAL)

**Problem:** `COPY backend /app` copies `backend/sso/` to `/app/sso/`, but `yarn install` only installs `/app/package.json` deps. SSO has its own `package.json` with `@azure/msal-node` and `express-session`.

**Resolution:** Update Task 15 to add after the main `yarn install`:

```dockerfile
RUN cd /app/sso && npm install --production && npm cache clean --force
```

### Issue 3: nginx.js Async Boundary (IMPORTANT)

**Problem:** Task 6 says "add after `host.ipv6 = ...`" but the SSO settings query is async (DB read) while that code section is synchronous. It must execute BEFORE `parseAndRender` is called.

**Resolution:** The SSO settings query must be added to the Promise chain. Specifically:
- Create a `ssoPromise` similar to `locationsPromise`
- Chain it: `locationsPromise.then(() => ssoPromise).then(() => renderEngine.parseAndRender(...))`

Revised approach:
```javascript
// After locationsPromise setup and before the locationsPromise.then() block:
let ssoPromise = Promise.resolve();
if (nice_host_type === "proxy_host") {
    ssoPromise = settingModel.query().where("id", "like", "sso-%").then((ssoSettings) => {
        const ssoMap = {};
        for (const s of ssoSettings) ssoMap[s.id] = s.value;
        host.sso_configured = !!(
            ssoMap["sso-enabled"] === "true" &&
            ssoMap["sso-tenant-id"] && ssoMap["sso-client-id"] &&
            ssoMap["sso-client-secret"] && ssoMap["sso-cookie-domain"]
        );
        host.sso_redirect_host = host.domain_names?.[0] || "";
    }).catch(() => { host.sso_configured = false; });
}

// Then chain: locationsPromise.then(() => ssoPromise).then(() => { renderEngine.parseAndRender(...)
```

Also need to add `import settingModel from "../models/setting.js";` at the top of nginx.js.

### Issue 4: loadHostGroups SQL LIKE Substring Match (MODERATE)

**Problem:** `domain_names` is stored as a JSON array string `["app.hme.com"]`. Using `LIKE '%hostname%'` could match `myapp.hme.com` when searching for `app.hme.com`.

**Resolution:** Use `instr()` for SQLite or do a post-query JSON parse check:

```javascript
export function loadHostGroups(hostname) {
    const db = getDb();
    if (!db) return null;
    try {
        // Get all enabled hosts and do exact match on parsed JSON
        const rows = db.prepare(
            "SELECT domain_names, sso_forced_groups FROM proxy_host WHERE is_deleted = 0 AND sso_enabled = 1"
        ).all();
        for (const row of rows) {
            const domains = JSON.parse(row.domain_names || "[]");
            if (domains.includes(hostname)) {
                return parseGroups(row.sso_forced_groups);
            }
        }
        return null;
    } catch (_err) {
        return null;
    }
}
```

### Issue 5: Proxy Host CRUD — No Explicit Field Whitelist (OK)

**Verified:** `proxy-host.js` create uses `proxyHostModel.query().insertAndFetch(thisData)` and update uses `.patch(thisData)`. Objection.js passes through all fields matching DB columns. Since we're adding `sso_enabled` and `sso_forced_groups` to the DB schema AND the JSON validation schema, these fields will flow through automatically. **No code change needed.**

### Issue 6: SSO sidecar DB path (MINOR)

**Problem:** The sidecar reads from `/data/database.sqlite` but NPM can also use MySQL or PostgreSQL. The sidecar's `better-sqlite3` reader only works for SQLite installs.

**Resolution:** For V1, document this as a SQLite-only limitation. The sidecar reads settings directly from SQLite for speed. For MySQL/Postgres deployments, a future version could read settings via an HTTP call to the backend API instead. Add a comment in `config.js`.

### Issue 7: SSO cookie domain setting in session middleware (MINOR)

**Problem:** The session middleware is configured once at startup with `cookie.domain: undefined`, then dynamically set in `/sso/login`. But `express-session` sets cookie domain at session creation time, not modification time — the domain needs to be set when the session is first created.

**Resolution:** Set cookie domain from loaded config at middleware initialization:

```javascript
const cfg = loadConfig();
app.use(session({
    // ...
    cookie: {
        // ...
        domain: cfg?.cookieDomain || undefined,
    },
}));
```

And on `/sso/reload`, restart the sidecar (s6 will auto-restart) to pick up the new cookie domain. The run script already has a `while` loop.

---

## Plan Review Verdict

**5 issues found: 2 CRITICAL, 1 IMPORTANT, 2 MODERATE/MINOR.** All have clear resolutions documented above. The executor MUST apply these fixes during implementation — they are not optional.

The plan is architecturally sound. No wiring gaps (all integration points connect). Resource lifecycle is clean (session store create→prune→close, MSAL client lazy→cache→reset). Dependencies are declared. Config consistency verified (Dockerfile copies and installs correctly after Issue 2 fix).
