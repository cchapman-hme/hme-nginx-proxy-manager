import { migrate as logger } from "../logger.js";

const migrateName = "sso_path_groups";

/**
 * Per-path SSO group rules: a JSON array of { path, groups }. A rule's groups
 * replace sso_allowed_groups for the paths under it (backend/sso/access.js).
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.alterTable("proxy_host", (table) => {
			table.text("sso_path_groups").nullable().defaultTo(null);
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.alterTable("proxy_host", (table) => {
			table.dropColumn("sso_path_groups");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table restored`);
		});
};

export { up, down };
