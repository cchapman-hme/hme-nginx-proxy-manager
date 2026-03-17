// backend/sso/msal-client.js
// MSAL ConfidentialClientApplication wrapper for Azure AD auth code flow.
// Supports multiple app registrations via Map cache keyed by tenantId:clientId.

import { ConfidentialClientApplication } from "@azure/msal-node";

const _clients = new Map();

const BASE_SCOPES = ["openid", "profile", "email"];

function clientKey(cfg) {
	return `${cfg.tenantId}:${cfg.clientId}`;
}

/**
 * Get or create the MSAL client for a specific host config.
 * Caches clients by tenantId:clientId so hosts sharing the same
 * app registration reuse the same client instance.
 * @param {{ tenantId: string, clientId: string, clientSecret: string }} hostConfig
 * @returns {ConfidentialClientApplication}
 */
export function getMsalClient(hostConfig) {
	if (!hostConfig?.tenantId || !hostConfig?.clientId || !hostConfig?.clientSecret) {
		throw new Error("SSO not configured for this host");
	}

	const key = clientKey(hostConfig);
	let client = _clients.get(key);
	if (client) return client;

	client = new ConfidentialClientApplication({
		auth: {
			clientId: hostConfig.clientId,
			authority: `https://login.microsoftonline.com/${hostConfig.tenantId}`,
			clientSecret: hostConfig.clientSecret,
		},
	});
	_clients.set(key, client);
	return client;
}

/**
 * Get the auth code URL for login.
 * @param {{ tenantId: string, clientId: string, clientSecret: string }} hostConfig
 * @param {string} state - CSRF state
 * @param {string} redirectUri - OAuth callback URL
 * @param {boolean} includeGroups - Whether to request group membership scope
 * @returns {Promise<string>}
 */
export async function getAuthCodeUrl(hostConfig, state, redirectUri, includeGroups = false) {
	const scopes = [...BASE_SCOPES];
	if (includeGroups) scopes.push("GroupMember.Read.All");
	return getMsalClient(hostConfig).getAuthCodeUrl({
		scopes,
		redirectUri,
		state,
		prompt: "select_account",
	});
}

/**
 * Exchange auth code for token.
 * @param {{ tenantId: string, clientId: string, clientSecret: string }} hostConfig
 * @param {string} code - Authorization code from Azure AD
 * @param {string} redirectUri - Must match the one used in getAuthCodeUrl
 * @param {boolean} includeGroups - Whether to request group membership scope
 * @returns {Promise<object>}
 */
export async function acquireTokenByCode(hostConfig, code, redirectUri, includeGroups = false) {
	const scopes = [...BASE_SCOPES];
	if (includeGroups) scopes.push("GroupMember.Read.All");
	return getMsalClient(hostConfig).acquireTokenByCode({
		code,
		scopes,
		redirectUri,
	});
}

/**
 * Reset all cached clients (for config reload).
 */
export function resetAllClients() {
	_clients.clear();
}
