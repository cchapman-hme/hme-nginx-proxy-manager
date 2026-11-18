// Tests for the sidecar's HTML pages (pages.js).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aadstsCode, deniedPage, esc, loginHref, logoutHref, signInFailedPage, signedOutPage } from "../pages.js";

describe("esc", () => {
	it("escapes markup and quotes", () => {
		assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
	});
	it("turns nullish into empty text", () => {
		assert.equal(esc(undefined), "");
		assert.equal(esc(null), "");
	});
});

describe("links", () => {
	it("login link encodes the return path as the last parameter", () => {
		assert.equal(loginHref("/settings?tab=a&b=1"), "/sso/login?return=%2Fsettings%3Ftab%3Da%26b%3D1");
		assert.equal(loginHref(""), "/sso/login?return=%2F");
	});
	it("logout link has no return by default", () => {
		assert.equal(logoutHref(), "/sso/logout");
		assert.equal(logoutHref("/"), "/sso/logout");
		assert.equal(logoutHref("/x"), "/sso/logout?return=%2Fx");
	});
});

describe("deniedPage", () => {
	it("names the account and offers another account and sign-out for a group denial", () => {
		const html = deniedPage({
			host: "app.example.test",
			user: { name: "Pat", email: "pat@example.test" },
			reason: "group",
			returnPath: "/settings",
		});
		assert.match(html, /pat@example\.test/);
		assert.match(html, /This account doesn't have access/);
		assert.match(html, /href="\/sso\/login\?return=%2Fsettings"/);
		assert.match(html, /href="\/sso\/logout"/);
		assert.match(html, /<title>No access · app\.example\.test<\/title>/);
	});
	it("is generic without a session and has no sign-out", () => {
		const html = deniedPage({ host: "app.example.test", user: null, reason: "", returnPath: "/" });
		assert.match(html, /You can't open this page/);
		assert.doesNotMatch(html, /sso\/logout/);
		assert.doesNotMatch(html, /Signed in as/);
	});
	it("escapes the account name", () => {
		const html = deniedPage({
			host: "h",
			user: { email: `<img src=x onerror="alert(1)">` },
			reason: "group",
			returnPath: "/",
		});
		assert.doesNotMatch(html, /<img/);
		assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
	});
	it("has no script", () => {
		assert.doesNotMatch(deniedPage({ host: "h", user: null, returnPath: "/" }), /<script/i);
	});
});

describe("signedOutPage", () => {
	it("offers sign-in when signed out", () => {
		const html = signedOutPage({ host: "h", user: null });
		assert.match(html, /You're signed out/);
		assert.match(html, /href="\/sso\/login\?return=%2F"/);
	});
	it("says who is signed in when a session exists", () => {
		const html = signedOutPage({ host: "h", user: { email: "pat@example.test" } });
		assert.match(html, /Signed in as <span class="who">pat@example\.test<\/span>/);
		assert.match(html, /href="\/sso\/logout"/);
	});
});

describe("signInFailedPage", () => {
	it("explains a provider error and shows the AADSTS code only", () => {
		const html = signInFailedPage({
			host: "h",
			kind: "provider",
			error: "access_denied",
			description: "AADSTS50105: Your administrator has configured <b>x</b>. Trace ID: abc",
			returnPath: "/x",
		});
		assert.match(html, /Sign-in was cancelled or blocked\./);
		assert.match(html, /AADSTS50105/);
		assert.doesNotMatch(html, /Trace ID|<b>/);
		assert.match(html, /href="\/sso\/login\?return=%2Fx"/);
	});
	it("falls back to the escaped error code", () => {
		const html = signInFailedPage({ host: "h", kind: "provider", error: "<odd>" });
		assert.match(html, /&lt;odd&gt;/);
	});
	it("has no retry when the host is not configured", () => {
		const html = signInFailedPage({ host: "h", kind: "config" });
		assert.match(html, /Sign-in isn't set up for this site/);
		assert.doesNotMatch(html, /sso\/login/);
	});
	it("calls a stale state an expired sign-in", () => {
		assert.match(signInFailedPage({ host: "h", kind: "state" }), /Sign-in expired/);
	});
});

describe("aadstsCode", () => {
	it("extracts the code", () => {
		assert.equal(aadstsCode("AADSTS700016: Application not found"), "AADSTS700016");
		assert.equal(aadstsCode("no code"), "");
		assert.equal(aadstsCode(undefined), "");
	});
});
