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
// Host config cache — maps hostname → config object.
// Cleared on reloadConfig(), TTL prevents stale reads between reloads.
// ---------------------------------------------------------------------------
const _hostCache = new Map();
const HOST_CACHE_TTL_MS = 30_000; // 30 seconds

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

let _loggedEngine = false;

/**
 * Load the global SSO kill-switch from the NPM database.
 * Only reads `sso-enabled` from the `setting` table.
 * @returns {Promise<{ enabled: boolean } | null>}
 */
export async function loadGlobalConfig() {
	try {
		const rows = await query("SELECT id, value FROM setting WHERE id = 'sso-enabled'");
		const cfg = {
			enabled: rows.length > 0 && rows[0].value === "true",
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

/**
 * Load per-host SSO configuration from the proxy_host table.
 * Results are cached for HOST_CACHE_TTL_MS to avoid querying on every auth_request.
 * Cache is cleared on reloadConfig().
 * @param {string} hostname - The hostname to look up
 * @returns {Promise<{ tenantId: string, clientId: string, clientSecret: string, cookieDomain: string, allowedGroups: string[], redirectUri: string } | null>}
 */
export async function loadHostConfig(hostname) {
	// Check cache first
	const cached = _hostCache.get(hostname);
	if (cached && Date.now() - cached.ts < HOST_CACHE_TTL_MS) {
		return cached.value;
	}

	try {
		const rows = await query(
			"SELECT domain_names, sso_enabled, sso_tenant_id, sso_client_id, " +
			"sso_client_secret, sso_cookie_domain, sso_allowed_groups " +
			"FROM proxy_host WHERE is_deleted = 0 AND sso_enabled = 1"
		);
		for (const row of rows) {
			const domains = JSON.parse(row.domain_names || "[]");
			if (domains.includes(hostname)) {
				const result = {
					tenantId: row.sso_tenant_id || "",
					clientId: row.sso_client_id || "",
					clientSecret: row.sso_client_secret || "",
					cookieDomain: row.sso_cookie_domain || "",
					allowedGroups: parseGroups(row.sso_allowed_groups),
					redirectUri: `https://${domains[0]}/sso/callback`,
				};
				_hostCache.set(hostname, { value: result, ts: Date.now() });
				return result;
			}
		}
		_hostCache.set(hostname, { value: null, ts: Date.now() });
		return null;
	} catch (err) {
		console.error("[sso] Failed to load host config:", err.message);
		return null;
	}
}

// Re-export for backward compatibility
export { parseGroups } from "./parse-groups.js";

/**
 * Get cached global config (call loadGlobalConfig first).
 * @returns {{ enabled: boolean } | null}
 */
export function getGlobalConfig() {
	return _config;
}

/**
 * Reload config from DB (called after settings change).
 * Clears all caches and reloads global config.
 * @returns {Promise<{ enabled: boolean } | null>}
 */
export async function reloadConfig() {
	_config = null;
	_hostCache.clear();
	// Close SQLite handle if open so it picks up fresh data
	if (_sqliteDb) {
		_sqliteDb.close();
		_sqliteDb = null;
	}
	// MySQL pool stays open (connection pooling handles reconnects)
	return loadGlobalConfig();
}
