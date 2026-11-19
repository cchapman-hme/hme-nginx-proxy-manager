// backend/sso/config.js
// Reads SSO configuration from NPM's database.
// Supports MySQL/MariaDB (via mysql2) and SQLite (via better-sqlite3).
// Database engine is auto-detected from the same DB_MYSQL_* env vars
// the main NPM app uses.

import { existsSync } from "node:fs";
import { parsePathGroups } from "./access.js";
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
// Host config cache. The full list of SSO-enabled hosts is read at most once
// per HOST_CACHE_TTL_MS; lookups are served from that snapshot. The cache is
// cleared on reloadConfig().
// ---------------------------------------------------------------------------
const HOST_CACHE_TTL_MS = 30_000;
let _hostSnapshot = null; // { hosts: HostConfig[], ts: number }

/**
 * Raised when the database cannot be read. Callers must fail closed.
 */
export class SsoConfigError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = "SsoConfigError";
	}
}

// ---------------------------------------------------------------------------
// SQLite backend (lazy import — only loaded when USE_MYSQL is false)
// ---------------------------------------------------------------------------
async function getSqliteDb() {
	if (_sqliteDb) return _sqliteDb;
	// On first boot the backend creates the database after this service has
	// started. Check in JS first: a throw from the native constructor inside an
	// async continuation trips node's --abort_on_uncaught_exception.
	if (!existsSync(DB_PATH)) {
		throw new SsoConfigError(`Database file ${DB_PATH} does not exist yet`);
	}
	const mod = await import("better-sqlite3");
	const Database = mod.default;
	_sqliteDb = new Database(DB_PATH, { readonly: true });
	return _sqliteDb;
}

async function sqliteQuery(sql) {
	const db = await getSqliteDb();
	return db.prepare(sql).all();
}

// ---------------------------------------------------------------------------
// MySQL/MariaDB backend
// ---------------------------------------------------------------------------
async function getMysqlPool() {
	if (_mysqlPool) return _mysqlPool;
	const mysql = await import("mysql2/promise");
	_mysqlPool = mysql.createPool({
		host: process.env.DB_MYSQL_HOST,
		port: Number.parseInt(process.env.DB_MYSQL_PORT || "3306", 10),
		user: process.env.DB_MYSQL_USER,
		password: process.env.DB_MYSQL_PASSWORD || "",
		database: process.env.DB_MYSQL_NAME,
		waitForConnections: true,
		connectionLimit: 3,
		enableKeepAlive: true,
	});
	return _mysqlPool;
}

async function mysqlQuery(sql) {
	const pool = await getMysqlPool();
	const [rows] = await pool.query(sql);
	return rows;
}

// ---------------------------------------------------------------------------
// Unified query — delegates to the detected engine. Throws SsoConfigError.
// ---------------------------------------------------------------------------
async function query(sql) {
	try {
		return USE_MYSQL ? await mysqlQuery(sql) : await sqliteQuery(sql);
	} catch (err) {
		throw new SsoConfigError(`Database query failed: ${err.message}`, err);
	}
}

// ---------------------------------------------------------------------------
// Hostname matching
// ---------------------------------------------------------------------------

/**
 * Normalise a hostname for comparison: lowercase, strip port and trailing dot.
 * @param {string} hostname
 * @returns {string}
 */
export function normaliseHostname(hostname) {
	return String(hostname || "")
		.trim()
		.toLowerCase()
		.replace(/:\d+$/, "")
		.replace(/\.$/, "");
}

/**
 * Whether a request hostname matches a proxy host domain entry.
 * Supports NPM wildcard entries such as "*.example.com" with nginx
 * server_name semantics (any number of labels under the wildcard).
 * @param {string} hostname - normalised request hostname
 * @param {string} domain - domain entry from proxy_host.domain_names
 * @returns {boolean}
 */
export function hostnameMatchesDomain(hostname, domain) {
	const d = normaliseHostname(domain);
	if (!d || !hostname) return false;
	if (d === hostname) return true;
	if (d.startsWith("*.")) {
		// nginx's "*.example.com" server_name matches any number of labels
		// ("a.example.com" and "a.b.example.com"), so mirror that here or a
		// deeper name would hit the server block without a matching SSO config.
		const suffix = d.slice(1); // ".example.com"
		return hostname.length > suffix.length && hostname.endsWith(suffix);
	}
	return false;
}

/**
 * Convert a NPM cookie-domain value into a valid Set-Cookie Domain attribute.
 * "*.example.com" is not valid per RFC 6265 and becomes ".example.com".
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function sanitiseCookieDomain(value) {
	let cookieDomain = String(value || "")
		.trim()
		.toLowerCase();
	if (cookieDomain.startsWith("*.")) {
		cookieDomain = cookieDomain.slice(1);
	}
	return cookieDomain;
}

/**
 * Read proxy_host.domain_names. mysql2 returns the JSON column already parsed;
 * SQLite returns JSON text.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseDomainNames(value) {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch (_err) {
			return [];
		}
	}
	return Array.isArray(parsed) ? parsed : [];
}

/**
 * Build the config object for one proxy_host row.
 * @param {object} row
 * @returns {HostConfig | null}
 */
export function rowToHostConfig(row) {
	const domains = parseDomainNames(row.domain_names);
	if (domains.length === 0) return null;

	const primary = domains.map(normaliseHostname).find((d) => d && !d.startsWith("*."));

	return {
		domains,
		tenantId: String(row.sso_tenant_id || "").trim(),
		clientId: String(row.sso_client_id || "").trim(),
		clientSecret: String(row.sso_client_secret || ""),
		cookieDomain: sanitiseCookieDomain(row.sso_cookie_domain),
		allowedGroups: parseGroups(row.sso_allowed_groups),
		// Path rules (sso_path_groups) replace allowedGroups for their paths: access.js
		pathRules: parsePathGroups(row.sso_path_groups),
		// Entra ID does not allow wildcard redirect URIs, so the callback always
		// goes to the first concrete domain name of the host.
		redirectUri: primary ? `https://${primary}/sso/callback` : null,
	};
}

async function getHostSnapshot() {
	if (_hostSnapshot && Date.now() - _hostSnapshot.ts < HOST_CACHE_TTL_MS) {
		return _hostSnapshot.hosts;
	}
	const rows = await query(
		"SELECT domain_names, sso_tenant_id, sso_client_id, sso_client_secret, " +
			"sso_cookie_domain, sso_allowed_groups, sso_path_groups " +
			"FROM proxy_host WHERE is_deleted = 0 AND enabled = 1 AND sso_enabled = 1",
	);
	const hosts = rows.map(rowToHostConfig).filter(Boolean);
	_hostSnapshot = { hosts, ts: Date.now() };
	return hosts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _loggedEngine = false;

/**
 * Load the global SSO kill-switch from the NPM database.
 * Only reads `sso-enabled` from the `setting` table.
 * @returns {Promise<{ enabled: boolean }>}
 * @throws {SsoConfigError}
 */
export async function loadGlobalConfig() {
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
}

/**
 * @typedef {object} HostConfig
 * @property {string[]} domains
 * @property {string} tenantId
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} cookieDomain
 * @property {string[]} allowedGroups
 * @property {{ path: string, groups: string[] }[]} pathRules - longest path first
 * @property {string | null} redirectUri
 */

/**
 * Load per-host SSO configuration for a request hostname.
 * Returns null when the host has no (enabled) SSO configuration.
 * @param {string} hostname
 * @returns {Promise<HostConfig | null>}
 * @throws {SsoConfigError} when the database cannot be read (callers must fail closed)
 */
export async function loadHostConfig(hostname) {
	const wanted = normaliseHostname(hostname);
	if (!wanted) return null;
	const hosts = await getHostSnapshot();
	// Prefer an exact match over a wildcard match
	const exact = hosts.find((h) => h.domains.some((d) => normaliseHostname(d) === wanted));
	if (exact) return exact;
	return hosts.find((h) => h.domains.some((d) => hostnameMatchesDomain(wanted, d))) || null;
}

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
 * @returns {Promise<{ enabled: boolean }>}
 */
export async function reloadConfig() {
	// Connections stay open: a read-only SQLite handle sees committed writes
	// and closing it would race in-flight queries.
	_hostSnapshot = null;
	return loadGlobalConfig();
}

/**
 * Release database handles (shutdown).
 */
export async function closeConfig() {
	if (_sqliteDb) {
		_sqliteDb.close();
		_sqliteDb = null;
	}
	if (_mysqlPool) {
		await _mysqlPool.end().catch(() => {});
		_mysqlPool = null;
	}
}

export { parseGroups } from "./parse-groups.js";
