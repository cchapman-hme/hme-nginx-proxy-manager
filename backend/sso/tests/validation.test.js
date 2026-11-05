// Tests for return URL validation — prevents open redirect attacks.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { headerSafe, rawReturnParam, validateReturnUrl } from "../validation.js";

const COOKIE_DOMAIN = ".example.com";

describe("validateReturnUrl", () => {
	describe("relative paths (should accept)", () => {
		it("accepts /", () => {
			assert.equal(validateReturnUrl("/", COOKIE_DOMAIN), "/");
		});
		it("accepts /dashboard", () => {
			assert.equal(validateReturnUrl("/dashboard", COOKIE_DOMAIN), "/dashboard");
		});
		it("accepts path with query string", () => {
			assert.equal(validateReturnUrl("/path?query=1&foo=bar", COOKIE_DOMAIN), "/path?query=1&foo=bar");
		});
		it("accepts path with hash", () => {
			assert.equal(validateReturnUrl("/page#section", COOKIE_DOMAIN), "/page#section");
		});
		it("accepts deeply nested path", () => {
			assert.equal(validateReturnUrl("/a/b/c/d", COOKIE_DOMAIN), "/a/b/c/d");
		});
	});

	describe("absolute URLs matching cookie domain (should accept)", () => {
		it("accepts exact domain match", () => {
			assert.equal(validateReturnUrl("https://example.com/page", COOKIE_DOMAIN), "https://example.com/page");
		});
		it("accepts subdomain match", () => {
			assert.equal(
				validateReturnUrl("https://app.example.com/page", COOKIE_DOMAIN),
				"https://app.example.com/page",
			);
		});
		it("accepts deep subdomain match", () => {
			assert.equal(validateReturnUrl("https://a.b.example.com/", COOKIE_DOMAIN), "https://a.b.example.com/");
		});
		it("accepts http scheme on matching domain", () => {
			assert.equal(validateReturnUrl("http://app.example.com/x", COOKIE_DOMAIN), "http://app.example.com/x");
		});
		it("works without leading dot on cookie domain", () => {
			assert.equal(validateReturnUrl("https://app.example.com/", "example.com"), "https://app.example.com/");
		});
	});

	describe("malicious inputs (should reject → return /)", () => {
		it("rejects protocol-relative URL", () => {
			assert.equal(validateReturnUrl("//evil.com", COOKIE_DOMAIN), "/");
		});
		it("rejects foreign domain", () => {
			assert.equal(validateReturnUrl("https://evil.com/steal", COOKIE_DOMAIN), "/");
		});
		it("rejects domain suffix attack", () => {
			// "notexample.com" ends with "example.com" but is NOT a subdomain
			assert.equal(validateReturnUrl("https://notexample.com/x", COOKIE_DOMAIN), "/");
		});
		it("rejects javascript: URI", () => {
			assert.equal(validateReturnUrl("javascript:alert(1)", COOKIE_DOMAIN), "/");
		});
		it("rejects data: URI", () => {
			assert.equal(validateReturnUrl("data:text/html,<h1>hi</h1>", COOKIE_DOMAIN), "/");
		});
		it("rejects ftp: scheme", () => {
			assert.equal(validateReturnUrl("ftp://example.com/file", COOKIE_DOMAIN), "/");
		});
		it("rejects empty string", () => {
			assert.equal(validateReturnUrl("", COOKIE_DOMAIN), "/");
		});
		it("rejects null", () => {
			assert.equal(validateReturnUrl(null, COOKIE_DOMAIN), "/");
		});
		it("rejects undefined", () => {
			assert.equal(validateReturnUrl(undefined, COOKIE_DOMAIN), "/");
		});
		it("rejects malformed URL", () => {
			assert.equal(validateReturnUrl("ht tp://bad", COOKIE_DOMAIN), "/");
		});
	});

	describe("edge cases", () => {
		it("rejects when cookie domain is empty", () => {
			assert.equal(validateReturnUrl("https://example.com/", ""), "/");
		});
		it("still accepts relative paths when cookie domain is empty", () => {
			assert.equal(validateReturnUrl("/dashboard", ""), "/dashboard");
		});
		it("rejects when cookie domain is null-ish", () => {
			assert.equal(validateReturnUrl("https://example.com/", null), "/");
		});
	});
});

describe("validateReturnUrl with request host", () => {
	it("accepts an absolute URL on the requesting host when no cookie domain is set", () => {
		assert.equal(
			validateReturnUrl("https://app.example.com/page?x=1", "", "app.example.com"),
			"https://app.example.com/page?x=1",
		);
	});
	it("ignores the port on the requesting host", () => {
		assert.equal(
			validateReturnUrl("https://app.example.com/", "", "app.example.com:8443"),
			"https://app.example.com/",
		);
	});
	it("still rejects other hosts", () => {
		assert.equal(validateReturnUrl("https://evil.example.net/", "", "app.example.com"), "/");
	});
	it("rejects backslash protocol-relative tricks", () => {
		assert.equal(validateReturnUrl("/\\evil.com", COOKIE_DOMAIN), "/");
	});
	it("rejects URLs with embedded credentials", () => {
		assert.equal(validateReturnUrl("https://user:pw@app.example.com/", COOKIE_DOMAIN), "/");
	});
	it("rejects control characters", () => {
		assert.equal(validateReturnUrl("/path\r\nSet-Cookie: x=y", COOKIE_DOMAIN), "/");
	});
	it("rejects non-string values such as repeated query params", () => {
		assert.equal(validateReturnUrl(["/a", "/b"], COOKIE_DOMAIN), "/");
	});
});

describe("headerSafe", () => {
	it("passes printable ASCII through", () => {
		assert.equal(headerSafe("Jane Doe <jane@example.com>"), "Jane Doe <jane@example.com>");
	});
	it("percent-encodes non-Latin-1 names instead of throwing", () => {
		assert.equal(headerSafe("Šarlote 王"), encodeURIComponent("Šarlote 王"));
	});
	it("stringifies nullish values", () => {
		assert.equal(headerSafe(undefined), "");
	});
});

describe("rawReturnParam", () => {
	it("keeps an unencoded query string in the return value intact", () => {
		const req = {
			originalUrl: "/sso/login?return=https://app.example.com/p?a=1&b=2",
			query: { return: "https://app.example.com/p?a=1" },
		};
		assert.equal(rawReturnParam(req), "https://app.example.com/p?a=1&b=2");
	});
	it("falls back to the parsed query when return is not the first parameter", () => {
		const req = { originalUrl: "/sso/login?x=1&return=/dash", query: { return: "/dash" } };
		assert.equal(rawReturnParam(req), "/dash");
	});
	it("decodes an encoded value", () => {
		const req = { originalUrl: "/sso/login?return=%2Fdash%3Fq%3D1", query: {} };
		assert.equal(rawReturnParam(req), "/dash?q=1");
	});
});
