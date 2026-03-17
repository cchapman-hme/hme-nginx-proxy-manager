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
	"sso_enabled", "sso_tenant_id", "sso_client_id", "sso_client_secret",
	"sso_cookie_domain", "sso_allowed_groups", "domain_names",
];

/**
 * Validate that required SSO fields are present when sso_enabled is true.
 * @param {Object} data - The proxy host data to validate
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateSsoFields(data) {
	if (!data.sso_enabled) return { valid: true, missing: [] };
	const missing = SSO_REQUIRED_FIELDS.filter((f) => !data[f] || String(data[f]).trim() === "");
	return { valid: missing.length === 0, missing };
}

/**
 * Check whether an update payload touches any SSO-relevant field.
 * @param {Object} data - The update data
 * @returns {boolean}
 */
export function hasSsoRelevantChanges(data) {
	return SSO_RELEVANT_FIELDS.some((f) => typeof data[f] !== "undefined");
}
