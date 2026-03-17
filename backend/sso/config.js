// backend/sso/config.js
// Reads SSO configuration from NPM's database.
// Supports MySQL/MariaDB (via mysql2) and SQLite (via better-sqlite3).
// Database engine is auto-detected from the same DB_MYSQL_* env vars
// the main NPM app uses.

import { parseGroups } from "./parse-groups.js";

// ---------------------------------------------------------------------------
// Database engine detection — mirrors backend/lib/config.js logic
// ---------------------------------------------------------------------------
const USE_MYSQL = !!(process.env.DB_MYSQL_HOST && process.env.DB_MYSQL_USER && process.env.DB_MYSQL_NAME);
const DB_PATH = process.env.SSO_DB_PATH || process.env.DB_SQLITE_FILE || "/data/database.sqlite";

let _sqliteDb = null;
let _mysqlPool = null;
let _config = null;

// ---------------------------------------------------------------------------
// SQLite backend (lazy import — only loaded when USE_MYSQL is false)
// ---------------------------------------------------------------------------
async function getSqliteDb() {
	if (_sqliteDb) return _sqliteDb;
	try {
		const mod = await import("better-sqlite3");
		const Database = mod.default;
		_sqliteDb = new Database(DB_PATH, { readonly: true });
		return _sqliteDb;
	} catch (err) {
		console.error("[sso] Failed to open SQLite database:", err.message);
		return null;
	}
}

async function sqliteQuery(sql) {
	const db = await getSqliteDb();
	if (!db) return [];
	return db.prepare(sql).all();
}

// ---------------------------------------------------------------------------
// MySQL/MariaDB backend
// ---------------------------------------------------------------------------
async function getMysqlPool() {
	if (_mysqlPool) return _mysqlPool;
	try {
		const mysql = await import("mysql2/promise");
		_mysqlPool = mysql.createPool({
			host: process.env.DB_MYSQL_HOST,
			port: parseInt(process.env.DB_MYSQL_PORT || "3306", 10),
			user: process.env.DB_MYSQL_USER,
			password: process.env.DB_MYSQL_PASSWORD || "",
			database: process.env.DB_MYSQL_NAME,
			waitForConnections: true,
			connectionLimit: 3,
			enableKeepAlive: true,
		});
		return _mysqlPool;
	} catch (err) {
		console.error("[sso] Failed to create MySQL pool:", err.message);
		return null;
	}
}

async function mysqlQuery(sql) {
	const pool = await getMysqlPool();
	if (!pool) return [];
	const [rows] = await pool.query(sql);
	return rows;
}

// ---------------------------------------------------------------------------
// Unified query — delegates to the detected engine
// ---------------------------------------------------------------------------
async function query(sql) {
	if (USE_MYSQL) {
		return mysqlQuery(sql);
	}
	return sqliteQuery(sql);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load SSO settings from the NPM database.
 * @returns {Promise<{ enabled: boolean, tenantId: string, clientId: string, clientSecret: string, cookieDomain: string, redirectUri: string, allowedGroups: string[] } | null>}
 */
export async function loadConfig() {
	try {
		const rows = await query("SELECT id, value FROM setting WHERE id LIKE 'sso-%'");
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
		if (!_loggedEngine) {
			console.log(`[sso] Config loaded from ${USE_MYSQL ? "MySQL" : "SQLite"}`);
			_loggedEngine = true;
		}
		return cfg;
	} catch (err) {
		console.error("[sso] Failed to load config:", err.message);
		return null;
	}
}

let _loggedEngine = false;

/**
 * Load per-host SSO group overrides.
 * Queries all enabled SSO hosts and does exact hostname match via JSON parsing
 * (avoids unreliable SQL LIKE on JSON arrays).
 * @param {string} hostname - The hostname to look up
 * @returns {Promise<string[] | null>} - Array of group IDs, or null for global default
 */
export async function loadHostGroups(hostname) {
	try {
		const rows = await query(
			"SELECT domain_names, sso_forced_groups FROM proxy_host WHERE is_deleted = 0 AND sso_enabled = 1"
		);

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
 * @returns {Promise<object | null>}
 */
export async function reloadConfig() {
	// Close SQLite handle if open
	if (_sqliteDb) {
		_sqliteDb.close();
		_sqliteDb = null;
	}
	// MySQL pool stays open (connection pooling handles reconnects)
	return loadConfig();
}

/**
 * Check if SSO is fully configured.
 * @returns {boolean}
 */
export function isConfigured() {
	if (!_config) return false;
	return _config.enabled && !!_config.tenantId && !!_config.clientId && !!_config.clientSecret && !!_config.cookieDomain;
}
