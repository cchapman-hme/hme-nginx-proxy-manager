// backend/sso/access.js
// Which groups a request needs: the host's allowed groups, or the groups of the
// path rule (sso_path_groups) its path falls under.
//
// A path rule REPLACES the host's groups for its paths: a user needs one of the
// rule's groups there, and the host's groups neither grant nor are required. A
// rule with no groups admits nobody. Paths outside every rule keep the host's
// groups, so a user may reach the rule's paths, the rest of the host, or both.
//
// Kept free of database and Express imports so it can be unit-tested alone.

import { isGroupMember } from "./group-check.js";
import { parseGroups } from "./parse-groups.js";

/** Characters a rule path may contain (after the leading slash). */
const RULE_PATH_RE = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * Canonical form of a rule path: lowercase, no trailing slash ("/" stays "/").
 * @param {unknown} path
 * @returns {string | null} null when the path is not a valid rule path
 */
export function normaliseRulePath(path) {
	const p = String(path ?? "").trim();
	if (!RULE_PATH_RE.test(p)) return null;
	const segments = p.split("/").filter(Boolean);
	if (segments.some((s) => s === "." || s === "..")) return null;
	return `/${segments.join("/")}`.toLowerCase();
}

/**
 * Parse proxy_host.sso_path_groups: a JSON array (text in SQLite, already
 * parsed by mysql2) of { path, groups }. Entries with an invalid path are
 * dropped; a missing or invalid group list becomes [] (admits nobody).
 * @param {unknown} value
 * @returns {{ path: string, groups: string[] }[]} longest path first
 */
export function parsePathGroups(value) {
	let parsed = value;
	if (typeof value === "string") {
		if (!value.trim()) return [];
		try {
			parsed = JSON.parse(value);
		} catch (_err) {
			// Unreadable rules must not silently fall back to the host's groups:
			// "/" with no groups closes the whole host.
			return [{ path: "/", groups: [] }];
		}
	}
	if (parsed === null || typeof parsed === "undefined") return [];
	// Anything but a list is a value we cannot place: close the host
	if (!Array.isArray(parsed)) return [{ path: "/", groups: [] }];
	const rules = [];
	for (const entry of parsed) {
		const path = normaliseRulePath(entry?.path);
		if (path === null) {
			// Same reasoning: an entry we cannot place closes the host.
			rules.push({ path: "/", groups: [] });
			continue;
		}
		const groups = Array.isArray(entry.groups)
			? entry.groups.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim())
			: parseGroups(entry.groups);
		rules.push({ path, groups });
	}
	return rules.sort((a, b) => b.path.length - a.path.length);
}

/**
 * The path nginx serves for a raw request URI ($request_uri): query dropped,
 * percent-escapes decoded once, repeated slashes merged and dot segments
 * resolved, as nginx does before choosing a location (and as the upstream
 * does with the URI nginx passes on unchanged). Lowercased for matching.
 * @param {unknown} rawUri
 * @returns {string | null} null when the URI is malformed (callers deny)
 */
export function normaliseRequestPath(rawUri) {
	let uri = typeof rawUri === "string" ? rawUri : "";
	// An absolute-form request target: keep only the path
	const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(uri);
	if (abs) uri = uri.slice(abs[0].length) || "/";
	const q = uri.search(/[?#]/);
	if (q !== -1) uri = uri.slice(0, q);
	if (!uri.startsWith("/")) return null;

	const bytes = [];
	for (let i = 0; i < uri.length; i++) {
		const c = uri.charCodeAt(i);
		if (uri[i] === "%") {
			const hex = uri.slice(i + 1, i + 3);
			if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
			bytes.push(Number.parseInt(hex, 16));
			i += 2;
		} else if (c > 0x7f) {
			for (const b of Buffer.from(uri[i], "utf8")) bytes.push(b);
		} else {
			bytes.push(c);
		}
	}
	if (bytes.includes(0)) return null;
	const decoded = Buffer.from(bytes).toString("latin1");

	const out = [];
	for (const seg of decoded.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (out.length === 0) return null; // above the root: nginx answers 400
			out.pop();
			continue;
		}
		out.push(seg);
	}
	return `/${out.join("/")}`.toLowerCase();
}

/**
 * Whether a normalised request path falls under a rule path.
 * @param {string} path
 * @param {string} rulePath
 */
function underRule(path, rulePath) {
	return rulePath === "/" || path === rulePath || path.startsWith(`${rulePath}/`);
}

/**
 * The groups a request needs.
 * @param {{ allowedGroups: string[], pathRules?: { path: string, groups: string[] }[] }} hostCfg
 * @param {unknown} rawUri
 * @returns {{ groups: string[], rule: string | null } | null} null: malformed URI
 */
export function requiredAccess(hostCfg, rawUri) {
	const path = normaliseRequestPath(rawUri);
	if (path === null) return null;
	for (const rule of hostCfg.pathRules || []) {
		if (underRule(path, rule.path)) return { groups: rule.groups, rule: rule.path };
	}
	return { groups: hostCfg.allowedGroups || [], rule: null };
}

/**
 * Whether sign-in must fetch the user's groups for this host.
 * @param {{ allowedGroups: string[], pathRules?: unknown[] }} hostCfg
 */
export function needsGroups(hostCfg) {
	return (hostCfg.allowedGroups || []).length > 0 || (hostCfg.pathRules || []).length > 0;
}

/**
 * Decide a request for a signed-in user of the host's tenant.
 * @returns {"allow" | "login" | "deny"} login: the session holds no group data
 */
export function decide(hostCfg, user, rawUri) {
	const need = requiredAccess(hostCfg, rawUri);
	if (!need) return "deny";
	if (need.rule === null && need.groups.length === 0) return "allow";
	if (!user.groupsFetched) return "login";
	if (need.groups.length === 0) return "deny";
	return isGroupMember(user.groups || [], need.groups) ? "allow" : "deny";
}
