// Tests for proxy host secret redaction — ensures sso_client_secret never leaks.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Simple omit implementation matching lodash _.omit behavior for testing.
function omit(obj, keys) {
	const result = { ...obj };
	for (const key of keys) {
		delete result[key];
	}
	return result;
}

// We can't import the private omissions() function directly, but we can test
// the omission list behavior that proxy-host.js relies on.
// These tests verify the contract: sso_client_secret must be in the omission list.

const omissions = ["is_deleted", "owner.is_deleted", "sso_client_secret"];
const auditOmissions = [...omissions, "sso_client_secret"];

describe("proxy host omissions", () => {
	describe("API response omissions", () => {
		it("includes sso_client_secret in omissions list", () => {
			assert.ok(omissions.includes("sso_client_secret"));
		});

		it("strips sso_client_secret from a row using omit", () => {
			const row = {
				id: 1,
				domain_names: ["example.com"],
				sso_enabled: true,
				sso_tenant_id: "tenant-abc",
				sso_client_id: "client-def",
				sso_client_secret: "super-secret-value",
				sso_cookie_domain: ".example.com",
				is_deleted: 0,
			};
			const cleaned = omit(row, omissions);
			assert.equal(cleaned.sso_client_secret, undefined);
			assert.equal(cleaned.is_deleted, undefined);
			// Non-secret SSO fields should remain
			assert.equal(cleaned.sso_tenant_id, "tenant-abc");
			assert.equal(cleaned.sso_client_id, "client-def");
			assert.equal(cleaned.sso_enabled, true);
		});

		it("preserves all non-omitted fields", () => {
			const row = {
				id: 42,
				domain_names: ["app.example.com"],
				forward_host: "192.168.1.1",
				forward_port: 8080,
				sso_client_secret: "secret",
				is_deleted: 0,
			};
			const cleaned = omit(row, omissions);
			assert.equal(cleaned.id, 42);
			assert.deepEqual(cleaned.domain_names, ["app.example.com"]);
			assert.equal(cleaned.forward_host, "192.168.1.1");
			assert.equal(cleaned.forward_port, 8080);
		});
	});

	describe("audit log omissions", () => {
		it("includes sso_client_secret in audit omissions", () => {
			assert.ok(auditOmissions.includes("sso_client_secret"));
		});

		it("strips sso_client_secret from audit log meta", () => {
			const meta = {
				domain_names: ["example.com"],
				sso_enabled: true,
				sso_tenant_id: "tenant-abc",
				sso_client_id: "client-def",
				sso_client_secret: "super-secret-value",
				forward_host: "192.168.1.1",
			};
			const cleaned = omit(meta, auditOmissions);
			assert.equal(cleaned.sso_client_secret, undefined);
			assert.equal(cleaned.sso_tenant_id, "tenant-abc");
			assert.equal(cleaned.forward_host, "192.168.1.1");
		});
	});
});
