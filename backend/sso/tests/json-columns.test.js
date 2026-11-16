// MySQL/MariaDB (mysql2) returns JSON columns already parsed, SQLite returns
// them as text. Host config must come out the same either way.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDomainNames, rowToHostConfig } from "../config.js";
import { parseGroups } from "../parse-groups.js";

const base = {
	sso_tenant_id: "11111111-1111-1111-1111-111111111111",
	sso_client_id: "22222222-2222-2222-2222-222222222222",
	sso_client_secret: "secret",
	sso_cookie_domain: ".example.com",
	sso_allowed_groups: '["33333333-3333-3333-3333-333333333333"]',
};

describe("parseDomainNames", () => {
	it("accepts the JSON text SQLite returns", () => {
		assert.deepEqual(parseDomainNames('["app.example.com"]'), ["app.example.com"]);
	});
	it("accepts the array mysql2 returns for a JSON column", () => {
		assert.deepEqual(parseDomainNames(["app.example.com"]), ["app.example.com"]);
	});
	it("returns an empty list for empty, invalid or non-array values", () => {
		assert.deepEqual(parseDomainNames(null), []);
		assert.deepEqual(parseDomainNames(""), []);
		assert.deepEqual(parseDomainNames("not json"), []);
		assert.deepEqual(parseDomainNames('{"a":1}'), []);
		assert.deepEqual(parseDomainNames({ a: 1 }), []);
	});
});

describe("rowToHostConfig", () => {
	it("builds the same config from a MySQL row as from a SQLite row", () => {
		const sqlite = rowToHostConfig({ ...base, domain_names: '["app.example.com"]' });
		const mysql = rowToHostConfig({ ...base, domain_names: ["app.example.com"] });
		assert.deepEqual(mysql, sqlite);
		assert.equal(mysql.redirectUri, "https://app.example.com/sso/callback");
		assert.deepEqual(mysql.allowedGroups, ["33333333-3333-3333-3333-333333333333"]);
	});
	it("keeps group restrictions when the driver returns them parsed", () => {
		const cfg = rowToHostConfig({
			...base,
			domain_names: ["app.example.com"],
			sso_allowed_groups: ["33333333-3333-3333-3333-333333333333"],
		});
		assert.deepEqual(cfg.allowedGroups, ["33333333-3333-3333-3333-333333333333"]);
	});
	it("drops a row with no domains", () => {
		assert.equal(rowToHostConfig({ ...base, domain_names: [] }), null);
		assert.equal(rowToHostConfig({ ...base, domain_names: "[]" }), null);
	});
});

describe("parseGroups", () => {
	it("accepts an already-parsed array and drops falsy entries", () => {
		assert.deepEqual(parseGroups(["a", "", null, "b"]), ["a", "b"]);
	});
});
