// backend/lib/sso-helpers.js
// Pure utility functions for SSO validation and change detection.
// Extracted so they can be unit-tested independently of proxy-host internals.

/**
 * SSO fields that are required when sso_enabled is true.
 */
export const SSO_REQUIRED_FIELDS = ["sso_tenant_id", "sso_client_id", "sso_client_secret"];

/**
 * Fields that, when changed, should trigger an SSO sidecar reload.
 */
export const SSO_RELEVANT_FIELDS = [
	"sso_enabled",
	"sso_tenant_id",
	"sso_client_id",
	"sso_client_secret",
	"sso_cookie_domain",
	"sso_allowed_groups",
	"sso_path_groups",
	"domain_names",
];

/**
 * Validate that required SSO fields are present when sso_enabled is true.
 * @param {Object} data - The proxy host data to validate
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateSsoFields(data) {
	if (!data.sso_enabled) return { valid: true, missing: [], errors: [] };
	const missing = SSO_REQUIRED_FIELDS.filter((f) => !data[f] || String(data[f]).trim() === "");
	const errors = [];

	// The login always happens on the first concrete domain, so a host that
	// answers on several names (or a wildcard) needs a shared cookie domain for
	// the session to reach the other names.
	const domains = Array.isArray(data.domain_names) ? data.domain_names : [];
	const concrete = domains.filter((d) => typeof d === "string" && !d.startsWith("*."));
	const hasWildcard = domains.length !== concrete.length;
	if (concrete.length === 0 && domains.length > 0) {
		errors.push(
			"SSO requires at least one non-wildcard domain name (Entra ID does not allow wildcard redirect URIs)",
		);
	}
	if ((domains.length > 1 || hasWildcard) && String(data.sso_cookie_domain || "").trim() === "") {
		missing.push("sso_cookie_domain");
	}

	// nginx `satisfy any` access lists would let an allow-listed IP or a basic
	// auth password bypass the SSO check, and basic auth 401s would loop into
	// the SSO redirect. Keep the two features on separate hosts.
	if (Number(data.access_list_id) > 0) {
		errors.push("SSO cannot be combined with an access list on the same host");
	}

	errors.push(...validatePathGroups(data.sso_path_groups));

	return { valid: missing.length === 0 && errors.length === 0, missing, errors };
}

/**
 * Check sso_path_groups: each rule path starts with "/", uses only
 * [A-Za-z0-9._~-/], has no "." or ".." segment, and appears once (compared
 * case-insensitively, trailing slash ignored, as the sidecar matches them).
 * An empty group list is allowed: that rule admits nobody.
 * @param {unknown} rules
 * @returns {string[]} errors
 */
export function validatePathGroups(rules) {
	if (rules === null || typeof rules === "undefined") return [];
	if (!Array.isArray(rules)) return ["SSO path rules must be a list"];
	const errors = [];
	const seen = new Set();
	for (const rule of rules) {
		const raw = String(rule?.path ?? "");
		const segments = raw.split("/").filter(Boolean);
		if (!/^\/[A-Za-z0-9._~\-/]*$/.test(raw) || segments.some((s) => s === "." || s === "..")) {
			errors.push(`SSO path rule "${raw}" is not a valid path (start with /, letters, digits and . _ ~ - only)`);
			continue;
		}
		const key = `/${segments.join("/")}`.toLowerCase();
		if (seen.has(key)) errors.push(`SSO path rule "${raw}" is listed twice`);
		seen.add(key);
		if (!Array.isArray(rule.groups) || rule.groups.some((g) => typeof g !== "string")) {
			errors.push(`SSO path rule "${raw}" needs a list of group IDs`);
		}
	}
	return errors;
}

/**
 * Check whether an update payload touches any SSO-relevant field.
 * @param {Object} data - The update data
 * @returns {boolean}
 */
export function hasSsoRelevantChanges(data) {
	return SSO_RELEVANT_FIELDS.some((f) => typeof data[f] !== "undefined");
}

/**
 * Normalise a cookie domain for storage: lowercase, trimmed, and a leading
 * "*." (as users tend to copy from the domain list) becomes "." which is what
 * Set-Cookie expects for "this domain and all subdomains".
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseCookieDomain(value) {
	const v = String(value ?? "")
		.trim()
		.toLowerCase();
	return v.startsWith("*.") ? v.slice(1) : v;
}
