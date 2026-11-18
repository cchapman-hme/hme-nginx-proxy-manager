// End-to-end tests of the sidecar's page and account routes: starts server.js
// against a synthetic SQLite config database and session store.
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
const HOST = "app.example.test";
const TENANT = "tenant-1";
const ALLOWED = "group-allowed";

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

/** A signed express-session cookie for a session stored directly in the store. */
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
	return { sid, cookie: `npm_sso_sid=${encodeURIComponent(`s:${sid}.${mac}`)}` };
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

/** A request as nginx's public /sso/ location sends it. */
function get(path, { cookie, headers = {} } = {}) {
	return fetch(`${base}${path}`, {
		redirect: "manual",
		headers: {
			"X-Original-Host": HOST,
			"X-Forwarded-For": "192.0.2.10",
			"X-Forwarded-Proto": "https",
			...(cookie ? { Cookie: cookie } : {}),
			...headers,
		},
	});
}

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "sso-pages-"));
	const cfg = new Database(join(dir, "npm.sqlite"));
	cfg.exec(`CREATE TABLE setting (id TEXT PRIMARY KEY, value TEXT);
		CREATE TABLE proxy_host (domain_names TEXT, sso_tenant_id TEXT, sso_client_id TEXT, sso_client_secret TEXT,
			sso_cookie_domain TEXT, sso_allowed_groups TEXT, is_deleted INT, enabled INT, sso_enabled INT);`);
	cfg.prepare("INSERT INTO setting VALUES ('sso-enabled', 'true')").run();
	cfg.prepare("INSERT INTO proxy_host VALUES (?, ?, 'client-1', 'not-a-real-secret', '', ?, 0, 1, 1)").run(
		JSON.stringify([HOST]),
		TENANT,
		JSON.stringify([ALLOWED]),
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

describe("/sso/denied", () => {
	it("names a signed-in account that is not in an allowed group", async () => {
		const { cookie } = sessionCookie(user(["other-group"]));
		const res = await get("/sso/denied", { cookie, headers: { "X-Original-URI": "/settings/a?b=1" } });
		assert.equal(res.status, 403);
		assert.match(res.headers.get("content-type"), /^text\/html/);
		assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
		assert.equal(res.headers.get("cache-control"), "no-store");
		const html = await res.text();
		assert.match(
			html,
			/Signed in as <span class="who">pat@example\.test<\/span>\. This account doesn't have access/,
		);
		assert.match(html, /href="\/sso\/login\?return=%2Fsettings%2Fa%3Fb%3D1"/);
		assert.match(html, /href="\/sso\/logout"/);
	});

	it("is generic for a member (an access-list denial)", async () => {
		const { cookie } = sessionCookie(user([ALLOWED]));
		const html = await (await get("/sso/denied", { cookie, headers: { "X-Original-URI": "/" } })).text();
		assert.match(html, /You can't open this page/);
		assert.doesNotMatch(html, /doesn't have access/);
	});

	it("is generic without a session", async () => {
		const res = await get("/sso/denied", { headers: { "X-Original-URI": "/" } });
		assert.equal(res.status, 403);
		const html = await res.text();
		assert.doesNotMatch(html, /Signed in as|sso\/logout/);
	});

	it("ignores a session from another tenant", async () => {
		const { cookie } = sessionCookie(user(["other-group"], { tenantId: "tenant-2" }));
		const html = await (await get("/sso/denied", { cookie })).text();
		assert.doesNotMatch(html, /pat@example\.test/);
	});

	it("never returns to a foreign or /sso/ URL", async () => {
		for (const uri of ["//evil.example/x", "https://evil.example/x", "/sso/verify"]) {
			const html = await (await get("/sso/denied", { headers: { "X-Original-URI": uri } })).text();
			assert.match(html, /href="\/sso\/login\?return=%2F"/, uri);
		}
	});
});

describe("/sso/me", () => {
	it("returns the signed-in user", async () => {
		const { cookie } = sessionCookie(user([ALLOWED]));
		const res = await get("/sso/me", { cookie });
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { signedIn: true, name: "Pat Example", email: "pat@example.test" });
		assert.equal(res.headers.get("access-control-allow-origin"), null);
	});
	it("says signed out (200) without a session", async () => {
		const res = await get("/sso/me");
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { signedIn: false });
	});
	it("says signed out for an unknown host", async () => {
		const { cookie } = sessionCookie(user([ALLOWED]));
		const res = await get("/sso/me", { cookie, headers: { "X-Original-Host": "other.example.test" } });
		assert.deepEqual(await res.json(), { signedIn: false });
	});
});

describe("/sso/logout and /sso/signed-out", () => {
	it("destroys the session and returns through the registered callback", async () => {
		const { sid, cookie } = sessionCookie(user([ALLOWED]));
		const res = await get("/sso/logout", { cookie });
		assert.equal(res.status, 302);
		const loc = new URL(res.headers.get("location"));
		assert.equal(loc.origin + loc.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/logout`);
		assert.equal(loc.searchParams.get("post_logout_redirect_uri"), `https://${HOST}/sso/callback`);
		assert.equal(sessions.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid), undefined);
	});
	it("keeps an explicit same-site return", async () => {
		const res = await get("/sso/logout?return=/board");
		const loc = new URL(res.headers.get("location"));
		assert.equal(loc.searchParams.get("post_logout_redirect_uri"), `https://${HOST}/board`);
	});
	it("drops a foreign return", async () => {
		const res = await get(`/sso/logout?return=${encodeURIComponent("https://evil.example/")}`);
		const loc = new URL(res.headers.get("location"));
		assert.equal(loc.searchParams.get("post_logout_redirect_uri"), `https://${HOST}/`);
	});
	it("the callback without parameters lands on the signed-out page", async () => {
		const res = await get("/sso/callback");
		assert.equal(res.status, 302);
		assert.equal(res.headers.get("location"), "/sso/signed-out");
		const page = await get("/sso/signed-out");
		assert.equal(page.status, 200);
		assert.match(await page.text(), /You're signed out/);
	});
	it("the signed-out page says so when signed in again", async () => {
		const { cookie } = sessionCookie(user([ALLOWED]));
		assert.match(await (await get("/sso/signed-out", { cookie })).text(), /Signed in as/);
	});
});

describe("sign-in failures", () => {
	it("explains a provider error", async () => {
		const q = new URLSearchParams({ error: "access_denied", error_description: "AADSTS50105: <b>blocked</b>" });
		const res = await get(`/sso/callback?${q}`);
		assert.equal(res.status, 400);
		const html = await res.text();
		assert.match(html, /Sign-in was cancelled or blocked/);
		assert.match(html, /AADSTS50105/);
		assert.doesNotMatch(html, /<b>/);
	});
	it("calls an unknown state an expired sign-in", async () => {
		const res = await get("/sso/callback?code=x&state=y");
		assert.equal(res.status, 403);
		assert.match(await res.text(), /Sign-in expired/);
	});
	it("explains a host without SSO", async () => {
		const res = await get("/sso/login?return=/", { headers: { "X-Original-Host": "other.example.test" } });
		assert.equal(res.status, 503);
		assert.match(await res.text(), /Sign-in isn't set up for this site/);
	});
});

describe("/sso/verify is unchanged", () => {
	it("still answers 403 for a non-member and refuses public calls", async () => {
		const { cookie } = sessionCookie(user(["other-group"]));
		const res = await fetch(`${base}/sso/verify`, { headers: { "X-Original-Host": HOST, Cookie: cookie } });
		assert.equal(res.status, 403);
		const member = sessionCookie(user([ALLOWED]));
		const ok = await fetch(`${base}/sso/verify`, { headers: { "X-Original-Host": HOST, Cookie: member.cookie } });
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get("x-sso-email"), "pat@example.test");
		assert.equal((await get("/sso/verify", { cookie: member.cookie })).status, 403);
	});
});
