// End-to-end tests of GET /sso/denied and GET /sso/verify: starts server.js
// against a synthetic SQLite config database and session store, then calls it
// the way nginx's @sso_denied location and auth_request do.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SSO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SECRET = "test-session-secret";
const PRIMARY = "a.example.test";
const SECONDARY = "b.example.test";
const OPEN_HOST = "open.example.test";
const TENANT = "tenant-1";
const ALLOWED = "group-allowed";
const RULES_HOST = "rules.example.test";
const BILL = "group-bill";

let dir;
let child;
let base;
let sessions;

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

/** A signed express-session cookie for a session written straight into the store. */
function sessionCookie(ssoUser) {
	const sid = randomBytes(16).toString("hex");
	const expires = Date.now() + 3600_000;
	const data = {
		cookie: { originalMaxAge: 3600_000, expires: new Date(expires).toISOString(), httpOnly: true, path: "/" },
		ssoUser,
	};
	sessions
		.prepare("INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)")
		.run(sid, JSON.stringify(data), expires);
	const mac = createHmac("sha256", SECRET).update(sid).digest("base64").replace(/=+$/, "");
	return `npm_sso_sid=${encodeURIComponent(`s:${sid}.${mac}`)}`;
}

function user(groups, extra = {}) {
	return {
		name: "Pat Example",
		email: "pat@example.test",
		oid: "o1",
		tenantId: TENANT,
		groups,
		groupsFetched: true,
		...extra,
	};
}

/** A request as nginx's @sso_denied location sends it. */
function denied({ host = PRIMARY, uri = "/", cookie, proto = "https" } = {}) {
	return fetch(`${base}/sso/denied`, {
		redirect: "manual",
		headers: {
			"X-Original-Host": host,
			"X-Original-URI": uri,
			"X-Forwarded-For": "192.0.2.10",
			"X-Forwarded-Proto": proto,
			...(cookie ? { Cookie: cookie } : {}),
		},
	});
}

/** The href of the primary button, unescaped. */
function primaryHref(html) {
	const m = /<a class="btn primary" href="([^"]*)">/.exec(html);
	assert.ok(m, "primary button present");
	return m[1].replace(/&amp;/g, "&");
}

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "sso-denied-"));
	const cfg = new Database(join(dir, "npm.sqlite"));
	cfg.exec(`CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT);
		CREATE TABLE proxy_host (domain_names TEXT, sso_tenant_id TEXT, sso_client_id TEXT, sso_client_secret TEXT,
			sso_cookie_domain TEXT, sso_allowed_groups TEXT, sso_path_groups TEXT, is_deleted INT, enabled INT,
			sso_enabled INT);`);
	cfg.prepare("INSERT INTO setting VALUES ('sso-enabled', 'true')").run();
	const insert = cfg.prepare(
		"INSERT INTO proxy_host VALUES (?, ?, 'client-1', 'not-a-real-secret', ?, ?, ?, 0, 1, 1)",
	);
	insert.run(
		JSON.stringify(["*.wild.example.test", PRIMARY, SECONDARY]),
		TENANT,
		".example.test",
		JSON.stringify([ALLOWED]),
		null,
	);
	insert.run(JSON.stringify([OPEN_HOST]), TENANT, "", "[]", null);
	insert.run(
		JSON.stringify([RULES_HOST]),
		TENANT,
		"",
		JSON.stringify([ALLOWED]),
		JSON.stringify([
			{ path: "/ai-backbill/", groups: [BILL] },
			{ path: "/closed", groups: [] },
		]),
	);
	cfg.close();

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, ["server.js"], {
		cwd: SSO_DIR,
		env: {
			PATH: process.env.PATH,
			SSO_PORT: String(port),
			SSO_DB_PATH: join(dir, "npm.sqlite"),
			SSO_SESSION_DB_PATH: join(dir, "sessions.db"),
			SSO_DATA_DIR: dir,
			SSO_SESSION_SECRET: SECRET,
		},
		stdio: ["ignore", "ignore", "inherit"],
	});
	for (let i = 0; ; i++) {
		try {
			const res = await fetch(`${base}/sso/health`);
			if (res.ok) break;
		} catch (_e) {
			if (i > 100) throw new Error("sidecar did not start");
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	sessions = new Database(join(dir, "sessions.db"));
});

after(() => {
	sessions?.close();
	child?.kill("SIGTERM");
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /sso/denied", () => {
	it("explains a group denial as a 403 HTML page with safe headers", async () => {
		const res = await denied({ uri: "/reports/a?b=1&c=2", cookie: sessionCookie(user(["other-group"])) });
		assert.equal(res.status, 403);
		assert.match(res.headers.get("content-type"), /^text\/html; charset=utf-8/);
		assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
		assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
		assert.equal(res.headers.get("cache-control"), "no-store");
		assert.equal(res.headers.get("x-content-type-options"), "nosniff");
		assert.equal(res.headers.get("set-cookie"), null, "showing the page must not touch the session");
		const html = await res.text();
		assert.match(html, /This account doesn't have access/);
		assert.match(html, /<span class="email">pat@example\.test<\/span>/);
		assert.match(html, /Sign in with a different account/);
		assert.match(html, /href="\/sso\/logout">Sign out/);
		assert.equal(
			primaryHref(html),
			`https://${PRIMARY}/sso/login?return=${encodeURIComponent(`https://${PRIMARY}/reports/a?b=1&c=2`)}`,
		);
	});

	it("starts sign-in on the callback host when denied on a secondary domain", async () => {
		const res = await denied({ host: SECONDARY, uri: "/x", cookie: sessionCookie(user([])) });
		const href = primaryHref(await res.text());
		assert.equal(href, `https://${PRIMARY}/sso/login?return=${encodeURIComponent(`https://${SECONDARY}/x`)}`);
	});

	it("matches group IDs case-insensitively: a member gets the generic page", async () => {
		const res = await denied({ cookie: sessionCookie(user([ALLOWED.toUpperCase()])) });
		assert.equal(res.status, 403);
		const html = await res.text();
		assert.match(html, /You can't open this page/);
		assert.match(html, /You're signed in, but access to this page/);
		assert.doesNotMatch(html, /specific groups/);
	});

	it("is generic on a host without group restrictions", async () => {
		const html = await (await denied({ host: OPEN_HOST, cookie: sessionCookie(user([])) })).text();
		assert.match(html, /You can't open this page/);
		assert.match(html, /Sign in with a different account/);
		assert.match(primaryHref(html), new RegExp(`^https://${OPEN_HOST.replace(/\./g, "\\.")}/sso/login\\?return=`));
	});

	it("offers sign-in without a session", async () => {
		const res = await denied({ uri: "/p" });
		assert.equal(res.status, 403);
		const html = await res.text();
		assert.match(html, />Sign in<\/a>/);
		assert.doesNotMatch(html, /Sign out|class="account"/);
	});

	it("ignores a session issued for another tenant", async () => {
		const html = await (await denied({ cookie: sessionCookie(user([], { tenantId: "other" })) })).text();
		assert.doesNotMatch(html, /pat@example\.test/);
		assert.match(html, />Sign in<\/a>/);
	});

	it("ignores a tampered session cookie", async () => {
		const cookie = sessionCookie(user(["other-group"])).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
		const html = await (await denied({ cookie })).text();
		assert.doesNotMatch(html, /pat@example\.test/);
	});

	it("never returns to a sidecar URL or another site", async () => {
		for (const uri of ["/sso/verify", "//evil.test/x", "https://evil.test/", ""]) {
			const html = await (await denied({ uri, cookie: sessionCookie(user([])) })).text();
			assert.equal(
				primaryHref(html),
				`https://${PRIMARY}/sso/login?return=${encodeURIComponent(`https://${PRIMARY}/`)}`,
				`uri=${JSON.stringify(uri)}`,
			);
		}
	});

	it("escapes the account name and path", async () => {
		const cookie = sessionCookie(user([], { name: "<script>alert(1)</script>" }));
		const html = await (await denied({ uri: '/"><script>x</script>', cookie })).text();
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	it("answers when the host is unknown", async () => {
		const res = await denied({ host: "unknown.example.test" });
		assert.equal(res.status, 403);
		assert.match(await res.text(), /You can't open this page/);
	});
});

/** A request as nginx's auth_request subrequest sends it (no X-Forwarded-For). */
function verify({ host = RULES_HOST, uri = "/", cookie } = {}) {
	return fetch(`${base}/sso/verify`, {
		redirect: "manual",
		headers: {
			"X-Original-Host": host,
			"X-Original-URI": uri,
			...(cookie ? { Cookie: cookie } : {}),
		},
	});
}

describe("GET /sso/verify with path rules", () => {
	it("main-site member: the site but not the rule's paths", async () => {
		const cookie = sessionCookie(user([ALLOWED]));
		assert.equal((await verify({ uri: "/", cookie })).status, 200);
		assert.equal((await verify({ uri: "/queue.html?x=1", cookie })).status, 200);
		assert.equal((await verify({ uri: "/ai-backbill/", cookie })).status, 403);
		assert.equal((await verify({ uri: "/ai-backbill", cookie })).status, 403);
		assert.equal((await verify({ uri: "/x/../ai-backbill/2026-10/bills/771.pdf", cookie })).status, 403);
		assert.equal((await verify({ uri: "/%61i-backbill/", cookie })).status, 403);
	});

	it("rule-only member: the rule's paths but not the site", async () => {
		const cookie = sessionCookie(user([BILL]));
		const ok = await verify({ uri: "/ai-backbill/index.html", cookie });
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get("x-sso-email"), "pat@example.test");
		assert.equal((await verify({ uri: "/", cookie })).status, 403);
		assert.equal((await verify({ uri: "/ai-backbill/../index.html", cookie })).status, 403);
	});

	it("member of both: everything except a rule with no groups", async () => {
		const cookie = sessionCookie(user([ALLOWED, BILL]));
		assert.equal((await verify({ uri: "/", cookie })).status, 200);
		assert.equal((await verify({ uri: "/ai-backbill/", cookie })).status, 200);
		assert.equal((await verify({ uri: "/closed/x", cookie })).status, 403);
	});

	it("a session without group data is sent back through sign-in", async () => {
		const cookie = sessionCookie(user([], { groupsFetched: false }));
		assert.equal((await verify({ uri: "/ai-backbill/", cookie })).status, 401);
		assert.equal((await verify({ uri: "/", cookie })).status, 401);
	});

	it("no session: sign-in", async () => {
		assert.equal((await verify({ uri: "/ai-backbill/" })).status, 401);
	});

	it("hosts without rules are unchanged", async () => {
		assert.equal((await verify({ host: PRIMARY, uri: "/ai-backbill/", cookie: sessionCookie(user([ALLOWED])) })).status, 200);
		assert.equal((await verify({ host: PRIMARY, uri: "/", cookie: sessionCookie(user([BILL])) })).status, 403);
		assert.equal((await verify({ host: OPEN_HOST, uri: "/", cookie: sessionCookie(user([], { groupsFetched: false })) })).status, 200);
	});

	it("the denied page explains a rule denial as a group denial", async () => {
		const html = await (await denied({ host: RULES_HOST, uri: "/ai-backbill/", cookie: sessionCookie(user([ALLOWED])) })).text();
		assert.match(html, /This account doesn't have access/);
		const member = await (await denied({ host: RULES_HOST, uri: "/ai-backbill/", cookie: sessionCookie(user([BILL])) })).text();
		assert.match(member, /You can't open this page/);
	});

	it("refuses calls that came through the public proxy", async () => {
		const res = await fetch(`${base}/sso/verify`, {
			headers: { "X-Original-Host": RULES_HOST, "X-Original-URI": "/", "X-Forwarded-For": "192.0.2.1" },
		});
		assert.equal(res.status, 403);
	});
});
