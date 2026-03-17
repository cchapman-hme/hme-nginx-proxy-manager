// Tests for SSO validation helpers — field validation and change detection.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSsoFields, hasSsoRelevantChanges, SSO_REQUIRED_FIELDS, SSO_RELEVANT_FIELDS } from "../../lib/sso-helpers.js";

describe("validateSsoFields", () => {
	describe("when sso_enabled is false/falsy (should always pass)", () => {
		it("passes when sso_enabled is false", () => {
			const result = validateSsoFields({ sso_enabled: false });
			assert.equal(result.valid, true);
			assert.deepEqual(result.missing, []);
		});
		it("passes when sso_enabled is 0", () => {
			const result = validateSsoFields({ sso_enabled: 0 });
			assert.equal(result.valid, true);
		});
		it("passes when sso_enabled is undefined", () => {
			const result = validateSsoFields({});
			assert.equal(result.valid, true);
		});
		it("passes when sso_enabled is null", () => {
			const result = validateSsoFields({ sso_enabled: null });
			assert.equal(result.valid, true);
		});
	});

	describe("when sso_enabled is true with all fields present (should pass)", () => {
		it("passes with all required fields filled", () => {
			const result = validateSsoFields({
				sso_enabled: true,
				sso_tenant_id: "tenant-123",
				sso_client_id: "client-456",
				sso_client_secret: "secret-789",
			});
			assert.equal(result.valid, true);
			assert.deepEqual(result.missing, []);
		});
		it("passes with sso_enabled as 1 (integer truthy)", () => {
			const result = validateSsoFields({
				sso_enabled: 1,
				sso_tenant_id: "t",
				sso_client_id: "c",
				sso_client_secret: "s",
			});
			assert.equal(result.valid, true);
		});
	});

	describe("when sso_enabled is true with missing fields (should fail)", () => {
		it("fails when all SSO fields are missing", () => {
			const result = validateSsoFields({ sso_enabled: true });
			assert.equal(result.valid, false);
			assert.deepEqual(result.missing, SSO_REQUIRED_FIELDS);
		});
		it("fails when sso_tenant_id is empty string", () => {
			const result = validateSsoFields({
				sso_enabled: true,
				sso_tenant_id: "",
				sso_client_id: "client-456",
				sso_client_secret: "secret-789",
			});
			assert.equal(result.valid, false);
			assert.deepEqual(result.missing, ["sso_tenant_id"]);
		});
		it("fails when sso_client_id is whitespace-only", () => {
			const result = validateSsoFields({
				sso_enabled: true,
				sso_tenant_id: "tenant-123",
				sso_client_id: "   ",
				sso_client_secret: "secret-789",
			});
			assert.equal(result.valid, false);
			assert.deepEqual(result.missing, ["sso_client_id"]);
		});
		it("fails when sso_client_secret is missing", () => {
			const result = validateSsoFields({
				sso_enabled: true,
				sso_tenant_id: "tenant-123",
				sso_client_id: "client-456",
			});
			assert.equal(result.valid, false);
			assert.deepEqual(result.missing, ["sso_client_secret"]);
		});
		it("reports multiple missing fields", () => {
			const result = validateSsoFields({
				sso_enabled: true,
				sso_tenant_id: "tenant-123",
			});
			assert.equal(result.valid, false);
			assert.equal(result.missing.length, 2);
			assert.ok(result.missing.includes("sso_client_id"));
			assert.ok(result.missing.includes("sso_client_secret"));
		});
	});
});

describe("hasSsoRelevantChanges", () => {
	describe("returns true for SSO-relevant fields", () => {
		for (const field of SSO_RELEVANT_FIELDS) {
			it(`detects ${field}`, () => {
				assert.equal(hasSsoRelevantChanges({ [field]: "value" }), true);
			});
		}
		it("detects sso_enabled set to false", () => {
			assert.equal(hasSsoRelevantChanges({ sso_enabled: false }), true);
		});
		it("detects sso_enabled set to undefined value (key exists)", () => {
			// This tests that undefined values are still detected since typeof undefined !== "undefined" is false
			// but the key existing with value undefined in a spread is different
			const data = { sso_enabled: undefined };
			// Note: "sso_enabled" in data is true, but typeof data.sso_enabled is "undefined"
			// Our function uses typeof, so this would NOT detect it — which is correct behavior
			// because undefined means "not provided in this update"
			assert.equal(hasSsoRelevantChanges(data), false);
		});
	});

	describe("returns false for non-SSO fields only", () => {
		it("returns false for empty object", () => {
			assert.equal(hasSsoRelevantChanges({}), false);
		});
		it("returns false for non-SSO fields", () => {
			assert.equal(hasSsoRelevantChanges({
				forward_host: "example.com",
				forward_port: 80,
				ssl_forced: true,
				certificate_id: 5,
			}), false);
		});
		it("returns false when only id is present", () => {
			assert.equal(hasSsoRelevantChanges({ id: 42 }), false);
		});
	});

	describe("mixed payloads", () => {
		it("returns true when SSO field is mixed with other fields", () => {
			assert.equal(hasSsoRelevantChanges({
				forward_host: "example.com",
				sso_enabled: true,
				certificate_id: 3,
			}), true);
		});
	});
});
