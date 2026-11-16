// Parses a JSON string of group IDs into an array, filtering falsy values.
// Extracted to avoid pulling in better-sqlite3 for unit testing.

/**
 * @param {string | string[] | null | undefined} val — JSON-encoded array of group IDs,
 *   or an array when the database driver has already parsed it
 * @returns {string[]}
 */
export function parseGroups(val) {
	if (!val) return [];
	if (Array.isArray(val)) return val.filter(Boolean);
	try {
		const parsed = JSON.parse(val);
		return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
	} catch (_err) {
		return [];
	}
}
