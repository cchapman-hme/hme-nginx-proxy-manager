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
