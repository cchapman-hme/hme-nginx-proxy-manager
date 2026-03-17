// Tests for SSO migration module format — ensures no CJS in ESM project.
// This validates that migration files use proper ESM exports.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "..", "migrations");

describe("SSO migration module format", () => {
	const ssoMigrations = [
		"20260318000000_sso_per_host.js",
		"20260318000001_sso_cleanup_settings.js",
	];

	for (const filename of ssoMigrations) {
		describe(filename, () => {
			const content = readFileSync(join(migrationsDir, filename), "utf8");

			it("does NOT use CommonJS exports.up", () => {
				assert.ok(!content.includes("exports.up"), `${filename} uses CommonJS exports.up — will crash in ESM project`);
			});

			it("does NOT use CommonJS exports.down", () => {
				assert.ok(!content.includes("exports.down"), `${filename} uses CommonJS exports.down — will crash in ESM project`);
			});

			it("does NOT use module.exports", () => {
				assert.ok(!content.includes("module.exports"), `${filename} uses module.exports — will crash in ESM project`);
			});

			it("uses 'export { up, down }' pattern", () => {
				assert.ok(
					content.includes("export { up, down }"),
					`${filename} should use 'export { up, down }' to match project conventions`,
				);
			});

			it("imports the migration logger", () => {
				assert.ok(
					content.includes('import { migrate as logger } from "../logger.js"'),
					`${filename} should import the migration logger`,
				);
			});

			it("defines a migrateName constant", () => {
				assert.ok(
					content.includes("const migrateName"),
					`${filename} should define a migrateName for logging`,
				);
			});
		});
	}
});
