// backend/sso/validation.js
// Return URL validation for SSO redirect safety.

/**
 * Validate a return URL for safe redirection after SSO authentication.
 * Accepts:
 *   - Relative paths starting with "/" (but not "//")
 *   - Absolute URLs whose hostname matches or is a subdomain of the cookie domain
 * Rejects everything else (protocol-relative URLs, foreign domains, javascript: URIs, etc.)
 *
 * @param {string | null | undefined} returnUrl — URL to validate
 * @param {string} cookieDomain — configured cookie domain (e.g. ".example.com" or "example.com")
 * @returns {string} — safe URL, defaults to "/"
 */
export function validateReturnUrl(returnUrl, cookieDomain) {
	if (!returnUrl) return "/";

	// Allow relative paths (but block protocol-relative "//evil.com")
	if (returnUrl.startsWith("/") && !returnUrl.startsWith("//")) {
		return returnUrl;
	}

	// Allow absolute URLs that match the cookie domain
	try {
		const parsed = new URL(returnUrl);

		// Only allow http/https schemes
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return "/";
		}

		const domain = (cookieDomain || "").replace(/^\./, "");
		if (
			domain &&
			(parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))
		) {
			return returnUrl;
		}
	} catch (_e) {
		// Malformed URL — reject
	}

	return "/";
}
