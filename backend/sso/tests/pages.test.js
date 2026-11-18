// Tests for the access-denied page (pages.js).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deniedPage, esc, initials, loginUrlFor } from "../pages.js";
import { rawReturnParam, validateReturnUrl } from "../validation.js";

const NOW = new Date("2026-11-18T15:04:59Z");
const base = {
	host: "app.example.com",
	path: "/reports?q=1",
	loginUrl: "https://app.example.com/sso/login?return=https%3A%2F%2Fapp.example.com%2Freports%3Fq%3D1",
	logoutUrl: "/sso/logout",
	now: NOW,
};
const pat = { name: "Pat Example", email: "pat@example.com" };

describe("esc", () => {
	it("escapes HTML metacharacters", () => {
		assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
	});
	it("treats null and undefined as empty", () => {
		assert.equal(esc(null), "");
		assert.equal(esc(undefined), "");
	});
});

describe("initials", () => {
	it("uses the first two words of the name", () => {
		assert.equal(initials({ name: "pat van example" }), "PV");
	});
	it("falls back to the email's local part", () => {
		assert.equal(initials({ email: "jo@example.com" }), "J");
	});
	it("keeps astral characters whole", () => {
		assert.equal(initials({ name: "𝒜lex Doe" }), "𝒜D");
	});
	it("never returns an empty badge", () => {
		assert.equal(initials({}), "?");
	});
});

describe("loginUrlFor", () => {
	it("starts sign-in on the callback host and returns to this host", () => {
		const url = loginUrlFor({
			scheme: "https",
			host: "b.example.com",
			redirectUri: "https://a.example.com/sso/callback",
			path: "/x?y=1&z=2",
		});
		assert.equal(url, "https://a.example.com/sso/login?return=https%3A%2F%2Fb.example.com%2Fx%3Fy%3D1%26z%3D2");
	});

	it("round-trips through /sso/login's raw return parsing and validation", () => {
		const url = loginUrlFor({
			scheme: "https",
			host: "b.example.com",
			redirectUri: "https://a.example.com/sso/callback",
			path: "/x?y=1&z=2",
		});
		const parsed = new URL(url);
		const ret = rawReturnParam({ originalUrl: parsed.pathname + parsed.search, query: {} });
		assert.equal(ret, "https://b.example.com/x?y=1&z=2");
		assert.equal(validateReturnUrl(ret, ".example.com", "a.example.com"), ret);
	});

	it("uses this host when there is no redirect URI", () => {
		assert.equal(
			loginUrlFor({ scheme: "https", host: "a.example.com", redirectUri: null, path: "/" }),
			"https://a.example.com/sso/login?return=https%3A%2F%2Fa.example.com%2F",
		);
	});

	it("keeps plain http like nginx's @sso_redirect, and defaults to https", () => {
		assert.match(loginUrlFor({ scheme: "http", host: "a.test", path: "/" }), /^http:\/\/a\.test\/sso\/login/);
		assert.match(loginUrlFor({ scheme: "gopher", host: "a.test", path: "/" }), /^https:\/\/a\.test\//);
	});
});

describe("deniedPage", () => {
	it("explains a group denial, names the account and offers another one", () => {
		const html = deniedPage({ ...base, user: pat, reason: "group" });
		assert.match(html, /<h1>This account doesn't have access<\/h1>/);
		assert.match(html, /<strong>app\.example\.com<\/strong> is only open to members of specific groups/);
		assert.match(html, /<span class="name">Pat Example<\/span><span class="email">pat@example\.com<\/span>/);
		assert.match(html, /<div class="avatar" aria-hidden="true">PE<\/div>/);
		assert.match(html, /Just been given access\?/);
		assert.ok(
			html.includes(`<a class="btn primary" href="${esc(base.loginUrl)}">Sign in with a different account</a>`),
		);
		assert.match(html, /<a class="btn" href="\/sso\/logout">Sign out<\/a>/);
		assert.match(html, /<dt>Account<\/dt><dd>pat@example\.com<\/dd>/);
		assert.match(html, /<dt>Reason<\/dt><dd>Not in an allowed group<\/dd>/);
		assert.match(html, /<dt>Page<\/dt><dd>\/reports\?q=1<\/dd>/);
		assert.match(html, /<dt>Time<\/dt><dd>2026-11-18 15:04 UTC<\/dd>/);
	});

	it("is generic for a signed-in account denied for another reason", () => {
		const html = deniedPage({ ...base, user: pat, reason: "" });
		assert.match(html, /<h1>You can't open this page<\/h1>/);
		assert.match(html, /You're signed in, but access to this page/);
		assert.doesNotMatch(html, /specific groups/);
		assert.match(html, /Sign in with a different account/);
		assert.match(html, /<dt>Reason<\/dt><dd>Access restricted<\/dd>/);
	});

	it("offers plain sign-in and no sign-out without a session", () => {
		const html = deniedPage({ ...base, user: null, reason: "group" });
		assert.match(html, /<h1>You can't open this page<\/h1>/);
		assert.match(html, />Sign in<\/a>/);
		assert.doesNotMatch(html, /Sign out/);
		assert.doesNotMatch(html, /class="account"/);
		assert.doesNotMatch(html, /<dt>Account<\/dt>/);
	});

	it("shows an account that only has an email", () => {
		const html = deniedPage({ ...base, user: { email: "jo@example.com" }, reason: "group" });
		assert.match(html, /<div class="who"><span class="email">jo@example\.com<\/span><\/div>/);
	});

	it("escapes every value it prints", () => {
		const html = deniedPage({
			...base,
			host: `<b>"h"</b>`,
			path: "/<script>alert(1)</script>",
			loginUrl: `https://a/"><x>`,
			user: { name: "<img src=x onerror=alert(1)>", email: "e@x\"'.com" },
			reason: "group",
		});
		assert.doesNotMatch(html, /<script>|<img|<b>"h"|"><x>/);
		assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
		assert.match(html, /e@x&quot;&#39;\.com/);
	});

	it("is a complete page with no scripts or external resources", () => {
		const html = deniedPage({ ...base, user: pat, reason: "group" });
		assert.match(html, /^<!doctype html>/);
		assert.match(html, /<html lang="en">/);
		assert.match(html, /<meta name="viewport"/);
		assert.match(html, /<title>Access denied · app\.example\.com<\/title>/);
		assert.doesNotMatch(html, /<script|<link|src=|@import|url\(/);
	});
});
