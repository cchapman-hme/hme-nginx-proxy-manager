// Tests for hostname matching and cookie-domain sanitising used by config.js.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostnameMatchesDomain, normaliseHostname, sanitiseCookieDomain } from "../config.js";

describe("normaliseHostname", () => {
	it("lowercases and trims", () => {
		assert.equal(normaliseHostname("  App.Example.COM "), "app.example.com");
	});
	it("strips a port and trailing dot", () => {
		assert.equal(normaliseHostname("app.example.com:8443"), "app.example.com");
		assert.equal(normaliseHostname("app.example.com."), "app.example.com");
	});
	it("returns empty string for empty input", () => {
		assert.equal(normaliseHostname(""), "");
		assert.equal(normaliseHostname(undefined), "");
	});
});

describe("hostnameMatchesDomain", () => {
	it("matches exact domains case-insensitively", () => {
		assert.equal(hostnameMatchesDomain("app.example.com", "APP.example.com"), true);
	});
	it("matches one label under a wildcard", () => {
		assert.equal(hostnameMatchesDomain("app.example.com", "*.example.com"), true);
	});
	it("matches nested labels under a wildcard like nginx server_name does", () => {
		assert.equal(hostnameMatchesDomain("a.b.example.com", "*.example.com"), true);
	});
	it("does not match the apex under a wildcard", () => {
		assert.equal(hostnameMatchesDomain("example.com", "*.example.com"), false);
	});
	it("rejects suffix attacks", () => {
		assert.equal(hostnameMatchesDomain("notexample.com", "example.com"), false);
		assert.equal(hostnameMatchesDomain("evilexample.com", "*.example.com"), false);
	});
	it("rejects empty values", () => {
		assert.equal(hostnameMatchesDomain("", "example.com"), false);
		assert.equal(hostnameMatchesDomain("example.com", ""), false);
	});
});

describe("sanitiseCookieDomain", () => {
	it("converts a wildcard into a parent-domain cookie", () => {
		assert.equal(sanitiseCookieDomain("*.example.com"), ".example.com");
	});
	it("lowercases and trims", () => {
		assert.equal(sanitiseCookieDomain(" .Example.COM "), ".example.com");
	});
	it("returns empty string for null", () => {
		assert.equal(sanitiseCookieDomain(null), "");
	});
});
