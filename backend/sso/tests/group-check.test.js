// Tests for Azure AD group membership checks — authorization logic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGroupMember } from "../group-check.js";

describe("isGroupMember", () => {
	describe("membership checks", () => {
		it("returns true when user has at least one required group", () => {
			assert.equal(isGroupMember(["a", "b"], ["b", "c"]), true);
		});
		it("returns false when user has none of the required groups", () => {
			assert.equal(isGroupMember(["a"], ["b", "c"]), false);
		});
		it("returns true when user has all required groups", () => {
			assert.equal(isGroupMember(["a", "b", "c"], ["a", "c"]), true);
		});
		it("returns true with single matching group", () => {
			assert.equal(isGroupMember(["x"], ["x"]), true);
		});
	});

	describe("empty / null required groups (should allow all)", () => {
		it("returns true when requiredGroups is empty array", () => {
			assert.equal(isGroupMember(["a"], []), true);
		});
		it("returns true when requiredGroups is null", () => {
			assert.equal(isGroupMember(["a"], null), true);
		});
		it("returns true when requiredGroups is undefined", () => {
			assert.equal(isGroupMember(["a"], undefined), true);
		});
		it("returns true when both are empty", () => {
			assert.equal(isGroupMember([], []), true);
		});
	});

	describe("empty user groups with requirements (should deny)", () => {
		it("returns false when user has no groups but groups are required", () => {
			assert.equal(isGroupMember([], ["a"]), false);
		});
	});

	describe("UUID group IDs (real-world format)", () => {
		const userGroups = [
			"550e8400-e29b-41d4-a716-446655440000",
			"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
		];
		const required = [
			"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
			"f47ac10b-58cc-4372-a567-0e02b2c3d479",
		];

		it("matches UUID group IDs correctly", () => {
			assert.equal(isGroupMember(userGroups, required), true);
		});
		it("rejects when no UUID matches", () => {
			assert.equal(
				isGroupMember(userGroups, ["f47ac10b-58cc-4372-a567-0e02b2c3d479"]),
				false,
			);
		});
	});

	describe("large group lists (performance)", () => {
		it("handles 1000 groups efficiently", () => {
			const userGroups = Array.from({ length: 1000 }, (_, i) => `group-${i}`);
			const required = ["group-999"];
			assert.equal(isGroupMember(userGroups, required), true);
		});
	});
});
