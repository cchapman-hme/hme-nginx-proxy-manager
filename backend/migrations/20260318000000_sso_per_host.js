import { migrate as logger } from "../logger.js";

const migrateName = "sso_per_host";

const up = function (knex) {
  logger.info(`[${migrateName}] Migrating Up...`);

  return knex.schema.alterTable("proxy_host", (table) => {
    // New per-host SSO columns
    table.string("sso_tenant_id", 255).defaultTo("").notNullable();
    table.string("sso_client_id", 255).defaultTo("").notNullable();
    table.string("sso_client_secret", 512).defaultTo("").notNullable();
    table.string("sso_cookie_domain", 255).defaultTo("").notNullable();
    table.text("sso_allowed_groups").nullable().defaultTo(null);
  }).then(() => {
    // Migrate data: copy sso_forced_groups → sso_allowed_groups
    return knex.raw(
      "UPDATE proxy_host SET sso_allowed_groups = sso_forced_groups WHERE sso_forced_groups IS NOT NULL"
    );
  }).then(() => {
    // Set sso_enabled default to 0 for all existing rows that still have default 1
    // New hosts will default to 0 (handled by schema default change)
    return knex.raw("UPDATE proxy_host SET sso_enabled = 0 WHERE sso_enabled = 1");
  }).then(() => {
    return knex.schema.alterTable("proxy_host", (table) => {
      table.dropColumn("sso_forced_groups");
    });
  }).then(() => {
    logger.info(`[${migrateName}] proxy_host Table altered`);
  });
};

const down = function (knex) {
  logger.info(`[${migrateName}] Migrating Down...`);

  return knex.schema.alterTable("proxy_host", (table) => {
    table.text("sso_forced_groups").nullable().defaultTo(null);
  }).then(() => {
    return knex.raw(
      "UPDATE proxy_host SET sso_forced_groups = sso_allowed_groups WHERE sso_allowed_groups IS NOT NULL"
    );
  }).then(() => {
    return knex.raw("UPDATE proxy_host SET sso_enabled = 1");
  }).then(() => {
    return knex.schema.alterTable("proxy_host", (table) => {
      table.dropColumn("sso_tenant_id");
      table.dropColumn("sso_client_id");
      table.dropColumn("sso_client_secret");
      table.dropColumn("sso_cookie_domain");
      table.dropColumn("sso_allowed_groups");
    });
  }).then(() => {
    logger.info(`[${migrateName}] proxy_host Table restored`);
  });
};

export { up, down };
