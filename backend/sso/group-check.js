// backend/sso/group-check.js
// Azure AD group membership check via Microsoft Graph API.

const GRAPH_MEMBER_OF = "https://graph.microsoft.com/v1.0/me/memberOf?$select=id&$top=999";
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch the user's Azure AD group memberships, following Graph paging.
 * @param {string} accessToken - Bearer token with GroupMember.Read.All scope
 * @returns {Promise<string[] | null>} - Array of group IDs, or null when the
 *   lookup failed (callers must treat null as "unknown", not "no groups")
 */
export async function fetchUserGroups(accessToken) {
	const ids = [];
	let url = GRAPH_MEMBER_OF;
	try {
		for (let page = 0; url && page < MAX_PAGES; page++) {
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${accessToken}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!res.ok) {
				console.error(`[sso] Graph API group membership check failed: HTTP ${res.status}`);
				return null;
			}
			const data = await res.json();
			for (const g of data.value || []) {
				if (typeof g?.id === "string") ids.push(g.id);
			}
			url = typeof data["@odata.nextLink"] === "string" ? data["@odata.nextLink"] : null;
		}
		return ids;
	} catch (err) {
		console.error("[sso] Group membership fetch error:", err.message);
		return null;
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
	if (!Array.isArray(userGroups)) return false;
	const required = new Set(requiredGroups.map((g) => String(g).toLowerCase()));
	return userGroups.some((id) => required.has(String(id).toLowerCase()));
}
