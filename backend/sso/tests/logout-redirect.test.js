// Tests for SSO logout redirect safety — validates the pattern used in server.js.
// We test the validateReturnUrl + absolute URL construction logic that /sso/logout uses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateReturnUrl } from "../validation.js";

const COOKIE_DOMAIN = ".example.com";

/**
 * Simulates the logout redirect logic from server.js:
 * 1. Raw return URL comes from req.query.return
 * 2. Validated through validateReturnUrl
 * 3. If result is relative, build absolute URL for Azure AD logout
 */
function buildLogoutRedirectUri(rawReturn, cookieDomain, protocol, originalHost) {
	const safe = validateReturnUrl(rawReturn, cookieDomain || "");
	// Use explicit scheme match — safe has already passed validateReturnUrl
	const isAbsolute = safe.startsWith("https://") || safe.startsWith("http://");
	return isAbsolute ? safe : `${protocol}://${originalHost}${safe}`;
}

describe("SSO logout redirect safety", () => {
	describe("safe returns", () => {
		it("allows relative path and builds absolute URL", () => {
			const uri = buildLogoutRedirectUri("/dashboard", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/dashboard");
		});

		it("allows absolute URL matching cookie domain", () => {
			const uri = buildLogoutRedirectUri("https://app.example.com/page", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/page");
		});

		it("defaults to / when no return param provided", () => {
			const rawReturn = undefined;
			const fallback = rawReturn || `https://app.example.com/`;
			const uri = buildLogoutRedirectUri(fallback, COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/");
		});
	});

	describe("malicious returns (should be rejected)", () => {
		it("rejects foreign domain → falls back to relative / → builds safe absolute", () => {
			const uri = buildLogoutRedirectUri("https://evil.com/steal", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/");
		});

		it("rejects protocol-relative URL", () => {
			const uri = buildLogoutRedirectUri("//evil.com/steal", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/");
		});

		it("rejects javascript: URI", () => {
			const uri = buildLogoutRedirectUri("javascript:alert(1)", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/");
		});

		it("rejects domain suffix attack (notexample.com)", () => {
			const uri = buildLogoutRedirectUri("https://notexample.com/x", COOKIE_DOMAIN, "https", "app.example.com");
			assert.equal(uri, "https://app.example.com/");
		});
	});

	describe("Azure AD logout URL construction", () => {
		it("builds proper Azure AD logout URL with safe redirect", () => {
			const tenantId = "my-tenant-id";
			const postLogoutUri = buildLogoutRedirectUri("/", COOKIE_DOMAIN, "https", "app.example.com");
			const azureUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;
			assert.ok(azureUrl.includes("login.microsoftonline.com"));
			assert.ok(azureUrl.includes(encodeURIComponent("https://app.example.com/")));
			assert.ok(!azureUrl.includes("evil.com"));
		});

		it("never sends attacker URL to Azure AD", () => {
			const tenantId = "my-tenant-id";
			const postLogoutUri = buildLogoutRedirectUri("https://evil.com/steal", COOKIE_DOMAIN, "https", "app.example.com");
			const azureUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`;
			assert.ok(!azureUrl.includes("evil.com"));
			assert.ok(azureUrl.includes(encodeURIComponent("https://app.example.com/")));
		});
	});
});
