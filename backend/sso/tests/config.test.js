// Tests for SSO config parsing — settings deserialization safety.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGroups } from "../parse-groups.js";

describe("parseGroups", () => {
	describe("valid JSON arrays", () => {
		it("parses a JSON array of strings", () => {
			assert.deepEqual(parseGroups('["a","b","c"]'), ["a", "b", "c"]);
		});
		it("parses a single-element array", () => {
			assert.deepEqual(parseGroups('["only-one"]'), ["only-one"]);
		});
		it("parses an empty array", () => {
			assert.deepEqual(parseGroups("[]"), []);
		});
	});

	describe("filtering", () => {
		it("filters out empty strings", () => {
			assert.deepEqual(parseGroups('["a","","b"]'), ["a", "b"]);
		});
		it("filters out null values inside array", () => {
			assert.deepEqual(parseGroups('["a",null,"b"]'), ["a", "b"]);
		});
		it("filters out false values inside array", () => {
			assert.deepEqual(parseGroups('[false,"a",0,"b"]'), ["a", "b"]);
		});
	});

	describe("non-array JSON (should return empty)", () => {
		it("returns empty for JSON string", () => {
			assert.deepEqual(parseGroups('"just a string"'), []);
		});
		it("returns empty for JSON number", () => {
			assert.deepEqual(parseGroups("42"), []);
		});
		it("returns empty for JSON object", () => {
			assert.deepEqual(parseGroups('{"key":"value"}'), []);
		});
		it("returns empty for JSON boolean", () => {
			assert.deepEqual(parseGroups("true"), []);
		});
	});

	describe("invalid / empty input (should return empty)", () => {
		it("returns empty for null", () => {
			assert.deepEqual(parseGroups(null), []);
		});
		it("returns empty for undefined", () => {
			assert.deepEqual(parseGroups(undefined), []);
		});
		it("returns empty for empty string", () => {
			assert.deepEqual(parseGroups(""), []);
		});
		it("returns empty for invalid JSON", () => {
			assert.deepEqual(parseGroups("not json at all"), []);
		});
		it("returns empty for partial JSON", () => {
			assert.deepEqual(parseGroups('["a","b"'), []);
		});
	});
});
