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
