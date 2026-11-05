// backend/sso/validation.js
// Return URL validation for SSO redirect safety.

/**
 * Validate a return URL for safe redirection after SSO authentication.
 * Accepts:
 *   - Relative paths starting with "/" (but not "//" or "/\", which browsers
 *     treat as protocol-relative)
 *   - Absolute http(s) URLs whose hostname matches or is a subdomain of the
 *     cookie domain, or equals the host that received the request
 * Rejects everything else (foreign domains, javascript: URIs, etc.)
 *
 * @param {unknown} returnUrl - URL to validate (anything that is not a string is rejected)
 * @param {string | null | undefined} cookieDomain - configured cookie domain (".example.com" or "example.com")
 * @param {string | null | undefined} [requestHost] - hostname that received the request
 * @returns {string} safe URL, defaults to "/"
 */
export function validateReturnUrl(returnUrl, cookieDomain, requestHost = "") {
	if (typeof returnUrl !== "string" || returnUrl === "") return "/";
	// Control characters can split headers or confuse URL parsing
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
	if (/[\u0000-\u001f\u007f]/.test(returnUrl)) return "/";

	// Allow relative paths (but block protocol-relative "//evil.com" and "/\evil.com")
	if (returnUrl.startsWith("/")) {
		return returnUrl.startsWith("//") || returnUrl.startsWith("/\\") ? "/" : returnUrl;
	}

	// Allow absolute URLs on our own host or cookie domain
	try {
		const parsed = new URL(returnUrl);

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return "/";
		}
		if (parsed.username || parsed.password) {
			return "/";
		}

		const hostname = parsed.hostname.toLowerCase();
		const domain = String(cookieDomain || "")
			.trim()
			.toLowerCase()
			.replace(/^\*?\./, "");
		if (domain && (hostname === domain || hostname.endsWith(`.${domain}`))) {
			return returnUrl;
		}

		const ownHost = String(requestHost || "")
			.trim()
			.toLowerCase()
			.replace(/:\d+$/, "");
		if (ownHost && hostname === ownHost) {
			return returnUrl;
		}
	} catch (_e) {
		// Malformed URL — reject
	}

	return "/";
}

/**
 * Return a query-string value only when it is a single plain string.
 * Express's query parser can yield arrays or objects for repeated keys.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function queryString(value) {
	return typeof value === "string" ? value : undefined;
}

/**
 * Make a value safe for an HTTP response header. Node rejects characters
 * outside Latin-1, so anything non-ASCII is percent-encoded (RFC 3986).
 * @param {unknown} value
 * @returns {string}
 */
export function headerSafe(value) {
	const str = String(value ?? "");
	return /^[\x20-\x7e]*$/.test(str) ? str : encodeURIComponent(str);
}

/**
 * The `return` value as nginx sends it: everything after the first
 * "?return=" of the raw URL, so an unencoded query string in the original
 * request URI is preserved instead of being split by the query parser.
 * @param {import("express").Request} req
 * @returns {string | undefined}
 */
export function rawReturnParam(req) {
	const url = String(req.originalUrl || req.url || "");
	const idx = url.indexOf("?return=");
	if (idx === -1) return queryString(req.query.return);
	const raw = url.slice(idx + "?return=".length);
	try {
		return decodeURIComponent(raw);
	} catch (_err) {
		return raw;
	}
}
