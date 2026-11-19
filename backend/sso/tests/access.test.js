// Unit tests for per-path SSO group rules (access.js).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, needsGroups, normaliseRequestPath, normaliseRulePath, parsePathGroups, requiredAccess } from "../access.js";

const MAIN = "group-main";
const BILL = "group-bill";
const host = (pathRules, allowedGroups = [MAIN]) => ({ allowedGroups, pathRules: parsePathGroups(pathRules) });
const user = (groups, groupsFetched = true) => ({ groups, groupsFetched, tenantId: "t" });

describe("normaliseRequestPath", () => {
	const cases = [
		["/", "/"],
		["/ai-backbill/", "/ai-backbill"],
		["/AI-Backbill/x.pdf?download=1", "/ai-backbill/x.pdf"],
		["//ai-backbill//2026-10/", "/ai-backbill/2026-10"],
		["/foo/../ai-backbill/x", "/ai-backbill/x"],
		["/./ai-backbill/./x", "/ai-backbill/x"],
		["/%61i-backbill/x", "/ai-backbill/x"],
		["/ai-backbill%2Fx", "/ai-backbill/x"],
		["/foo/%2e%2e/ai-backbill/", "/ai-backbill"],
		["/foo%2F..%2Fai-backbill", "/ai-backbill"],
		["/%2561i-backbill/", "/%61i-backbill"],
		["https://watchtower.example/ai-backbill/x", "/ai-backbill/x"],
		["/ai-backbill/x#frag", "/ai-backbill/x"],
	];
	for (const [raw, want] of cases) {
		it(`${raw} -> ${want}`, () => assert.equal(normaliseRequestPath(raw), want));
	}
	for (const bad of ["", "*", "relative/x", "/%zz", "/%4", "/../x", "/a/../../x", "/a%00b", undefined, null]) {
		it(`rejects ${JSON.stringify(bad)}`, () => assert.equal(normaliseRequestPath(bad), null));
	}
});

describe("parsePathGroups / normaliseRulePath", () => {
	it("normalises rule paths and sorts longest first", () => {
		const rules = parsePathGroups(
			JSON.stringify([
				{ path: "/a/", groups: ["g1"] },
				{ path: "/A/B/", groups: ["g2"] },
			]),
		);
		assert.deepEqual(rules, [
			{ path: "/a/b", groups: ["g2"] },
			{ path: "/a", groups: ["g1"] },
		]);
	});
	it("accepts the array mysql2 already parsed", () => {
		assert.deepEqual(parsePathGroups([{ path: "/x", groups: [BILL] }]), [{ path: "/x", groups: [BILL] }]);
	});
	it("treats null/empty as no rules", () => {
		assert.deepEqual(parsePathGroups(null), []);
		assert.deepEqual(parsePathGroups(""), []);
		assert.deepEqual(parsePathGroups("[]"), []);
	});
	it("closes the whole host when the rules cannot be read", () => {
		assert.deepEqual(parsePathGroups("{not json"), [{ path: "/", groups: [] }]);
		assert.deepEqual(parsePathGroups("{}"), [{ path: "/", groups: [] }]);
		assert.deepEqual(parsePathGroups("5"), [{ path: "/", groups: [] }]);
		assert.deepEqual(parsePathGroups("null"), []);
		assert.deepEqual(parsePathGroups([{ path: "no-slash", groups: [BILL] }]), [{ path: "/", groups: [] }]);
		assert.deepEqual(parsePathGroups([{ path: "/a/../b", groups: [BILL] }]), [{ path: "/", groups: [] }]);
	});
	it("missing groups admit nobody", () => {
		assert.deepEqual(parsePathGroups([{ path: "/x" }]), [{ path: "/x", groups: [] }]);
	});
	it("rejects odd characters in rule paths", () => {
		assert.equal(normaliseRulePath("/a b"), null);
		assert.equal(normaliseRulePath("/a?b"), null);
		assert.equal(normaliseRulePath("/a%2fb"), null);
		assert.equal(normaliseRulePath("/"), "/");
	});
});

describe("decide", () => {
	const rules = [{ path: "/ai-backbill/", groups: [BILL] }];

	it("main-site member: site yes, rule path no", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user([MAIN]), "/index.html"), "allow");
		assert.equal(decide(cfg, user([MAIN]), "/ai-backbill/"), "deny");
		assert.equal(decide(cfg, user([MAIN]), "/ai-backbill"), "deny");
		assert.equal(decide(cfg, user([MAIN]), "/ai-backbill/2026-10/bills/771.pdf"), "deny");
	});
	it("rule-only member: rule path yes, site no", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user([BILL]), "/ai-backbill/index.html"), "allow");
		assert.equal(decide(cfg, user([BILL]), "/"), "deny");
		assert.equal(decide(cfg, user([BILL]), "/settings"), "deny");
	});
	it("member of both: everything", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user([MAIN, BILL]), "/"), "allow");
		assert.equal(decide(cfg, user([MAIN, BILL]), "/ai-backbill/"), "allow");
	});
	it("neither: nothing", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user(["other"]), "/"), "deny");
		assert.equal(decide(cfg, user(["other"]), "/ai-backbill/"), "deny");
	});
	it("a prefix is a path segment boundary, not a string prefix", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user([MAIN]), "/ai-backbill-old/x"), "allow");
		assert.equal(decide(cfg, user([BILL]), "/ai-backbill-old/x"), "deny");
	});
	it("encodings, dot segments and case cannot escape a rule", () => {
		const cfg = host(rules);
		for (const uri of [
			"/x/../ai-backbill/a",
			"/%61i-backbill/a",
			"/AI-BACKBILL/a",
			"//ai-backbill/a",
			"/ai-backbill%2fa",
			"/x%2f..%2fai-backbill/a",
		]) {
			assert.equal(decide(cfg, user([MAIN]), uri), "deny", uri);
			assert.equal(decide(cfg, user([BILL]), uri), "allow", uri);
		}
		assert.equal(decide(cfg, user([BILL]), "/ai-backbill/../index.html"), "deny");
	});
	it("a rule with no groups admits nobody, not even host members", () => {
		const cfg = host([{ path: "/ai-backbill/", groups: [] }]);
		assert.equal(decide(cfg, user([MAIN]), "/ai-backbill/"), "deny");
		assert.equal(decide(cfg, user([MAIN]), "/"), "allow");
	});
	it("a host without allowed groups stays open outside its rules", () => {
		const cfg = host(rules, []);
		assert.equal(decide(cfg, user([], false), "/"), "allow");
		assert.equal(decide(cfg, user([], false), "/ai-backbill/"), "login");
		assert.equal(decide(cfg, user([]), "/ai-backbill/"), "deny");
		assert.equal(decide(cfg, user([BILL]), "/ai-backbill/"), "allow");
	});
	it("asks for sign-in when the session has no group data", () => {
		const cfg = host(rules);
		assert.equal(decide(cfg, user([], false), "/"), "login");
		assert.equal(decide(cfg, user([], false), "/ai-backbill/"), "login");
	});
	it("denies a malformed URI", () => {
		assert.equal(decide(host(rules), user([MAIN, BILL]), "/%zz"), "deny");
		assert.equal(decide(host(rules), user([MAIN, BILL]), undefined), "deny");
	});
	it("matches group IDs case-insensitively", () => {
		assert.equal(decide(host(rules), user([BILL.toUpperCase()]), "/ai-backbill/"), "allow");
	});
	it("the longest rule wins", () => {
		const cfg = host([
			{ path: "/r", groups: ["g-r"] },
			{ path: "/r/inner", groups: ["g-inner"] },
		]);
		assert.equal(decide(cfg, user(["g-r"]), "/r/inner/x"), "deny");
		assert.equal(decide(cfg, user(["g-inner"]), "/r/inner/x"), "allow");
		assert.equal(decide(cfg, user(["g-inner"]), "/r/other"), "deny");
	});
	it("existing hosts without rules behave as before", () => {
		const cfg = { allowedGroups: [MAIN] };
		assert.equal(decide(cfg, user([MAIN]), "/anything"), "allow");
		assert.equal(decide(cfg, user(["x"]), "/anything"), "deny");
		assert.equal(requiredAccess(cfg, "/a").rule, null);
	});
});

describe("needsGroups", () => {
	it("is true when the host or any rule restricts by group", () => {
		assert.equal(needsGroups({ allowedGroups: [], pathRules: [] }), false);
		assert.equal(needsGroups({ allowedGroups: [MAIN], pathRules: [] }), true);
		assert.equal(needsGroups({ allowedGroups: [], pathRules: [{ path: "/x", groups: [] }] }), true);
		assert.equal(needsGroups({ allowedGroups: [] }), false);
	});
});
