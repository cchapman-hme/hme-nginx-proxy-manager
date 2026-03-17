// backend/sso/config.js
// Reads SSO configuration from NPM's setting table using better-sqlite3.
// SQLite-only for V1 — reads directly from the NPM database file.

import Database from "better-sqlite3";
import { parseGroups } from "./parse-groups.js";

const DB_PATH = process.env.SSO_DB_PATH || "/data/database.sqlite";

let _db = null;
let _config = null;

function getDb() {
	if (_db) return _db;
	try {
		_db = new Database(DB_PATH, { readonly: true });
		return _db;
	} catch (err) {
		console.error("[sso] Failed to open NPM database:", err.message);
		return null;
	}
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
 * Queries all enabled SSO hosts and does exact hostname match via JSON parsing
 * (avoids unreliable SQL LIKE on JSON arrays).
 * @param {string} hostname - The hostname to look up
 * @returns {string[] | null} - Array of group IDs, or null for global default
 */
export function loadHostGroups(hostname) {
	const db = getDb();
	if (!db) return null;

	try {
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

// Re-export for backward compatibility
export { parseGroups } from "./parse-groups.js";

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
