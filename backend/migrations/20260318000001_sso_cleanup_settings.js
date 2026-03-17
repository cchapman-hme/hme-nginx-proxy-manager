import { migrate as logger } from "../logger.js";

const migrateName = "sso_cleanup_settings";

const up = async function (knex) {
	logger.info(`[${migrateName}] Migrating Up...`);

	// Remove orphaned global SSO settings that were migrated to per-host columns.
	// Only sso-enabled (the global kill switch) is retained.
	await knex("setting")
		.whereNot("id", "sso-enabled")
		.andWhere("id", "like", "sso-%")
		.del();

	logger.info(`[${migrateName}] Orphaned SSO settings removed`);
};

const down = async function (knex) {
	logger.info(`[${migrateName}] Migrating Down...`);

	// Re-create the removed settings with sensible defaults.
	// These were the original global SSO configuration settings.
	const settings = [
		{ id: "sso-tenant-id", name: "Azure Tenant ID", description: "Microsoft Entra ID tenant (directory) ID", value: '""', meta: "{}" },
		{ id: "sso-client-id", name: "Azure Client ID", description: "Application (client) ID of the registered Azure AD app", value: '""', meta: "{}" },
		{ id: "sso-client-secret", name: "Azure Client Secret", description: "Client secret for the Azure AD app", value: '""', meta: "{}" },
		{ id: "sso-redirect-uri", name: "SSO Redirect URI", description: "OAuth2 redirect URI", value: '""', meta: "{}" },
		{ id: "sso-cookie-domain", name: "SSO Cookie Domain", description: "Domain for the SSO session cookie", value: '""', meta: "{}" },
		{ id: "sso-allowed-groups", name: "SSO Allowed Groups", description: "Azure AD group IDs allowed to access SSO-protected hosts", value: '"[]"', meta: "{}" },
	];

	for (const setting of settings) {
		const exists = await knex("setting").where("id", setting.id).first();
		if (!exists) {
			await knex("setting").insert(setting);
		}
	}

	logger.info(`[${migrateName}] SSO settings restored`);
};

export { up, down };
