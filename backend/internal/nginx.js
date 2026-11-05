import fs from "node:fs";
import net from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import _ from "lodash";
import errs from "../lib/error.js";
import utils from "../lib/utils.js";
import { debug, nginx as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import certificateModel from "../models/certificate.js";
import settingModel from "../models/setting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const internalNginx = {
	/**
	 * Derive the SSO template variables for a proxy host.
	 * The client secret is intentionally not checked: it is stripped from API
	 * rows by omissions() and only the SSO sidecar needs it. Create/update
	 * validation guarantees it exists whenever sso_enabled is set.
	 *
	 * @param {Object}  host           mutable template context
	 * @param {Boolean} globalEnabled  value of the sso-enabled kill switch
	 */
	applySsoContext: (host, globalEnabled) => {
		host.sso_configured = !!(globalEnabled && host.sso_enabled && host.sso_tenant_id && host.sso_client_id);
		// Entra ID does not accept wildcard redirect URIs, so the login redirect
		// always targets the first concrete domain name of the host.
		const domains = Array.isArray(host.domain_names) ? host.domain_names : [];
		host.sso_redirect_host = domains.find((d) => typeof d === "string" && !d.startsWith("*.")) || "";
		if (!host.sso_redirect_host) {
			host.sso_configured = false;
		}
	},

	/**
	 * This will:
	 * - test the nginx config first to make sure it's OK
	 * - create / recreate the config for the host
	 * - test again
	 * - IF OK:  update the meta with online status
	 * - IF BAD: update the meta with offline status and remove the config entirely
	 * - then reload nginx
	 *
	 * @param   {Object|String}  model
	 * @param   {String}         host_type
	 * @param   {Object}         host
	 * @returns {Promise}
	 */
	configure: (model, host_type, host) => {
		let combined_meta = {};

		return internalNginx
			.test()
			.then(() => {
				// Nginx is OK
				// We're deleting this config regardless.
				// Don't throw errors, as the file may not exist at all
				// Delete the .err file too
				return internalNginx.deleteConfig(host_type, host, true);
			})
			.then(() => {
				return internalNginx.generateConfig(host_type, host);
			})
			.then(() => {
				// Test nginx again and update meta with result
				return internalNginx
					.test()
					.then(() => {
						// nginx is ok
						combined_meta = _.assign({}, host.meta, {
							nginx_online: true,
							nginx_err: null,
						});

						return model.query().where("id", host.id).patch({
							meta: combined_meta,
						});
					})
					.catch((err) => {
						// Remove the error_log line because it's a docker-ism false positive that doesn't need to be reported.
						// It will always look like this:
						//   nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (6: No such device or address)

						const valid_lines = [];
						const err_lines = err.message.split("\n");
						err_lines.map((line) => {
							if (line.indexOf("/var/log/nginx/error.log") === -1) {
								valid_lines.push(line);
							}
							return true;
						});

						debug(logger, "Nginx test failed:", valid_lines.join("\n"));

						// config is bad, update meta and delete config
						combined_meta = _.assign({}, host.meta, {
							nginx_online: false,
							nginx_err: valid_lines.join("\n"),
						});

						return model
							.query()
							.where("id", host.id)
							.patch({
								meta: combined_meta,
							})
							.then(() => {
								// Keep the failed config as a .err file for inspection
								return internalNginx.renameConfigAsError(host_type, host);
							})
							.then(() => {
								// The rename removed the live config already, don't touch the .err file
								return internalNginx.deleteConfig(host_type, host, false);
							});
					});
			})
			.then(() => {
				return internalNginx.reload();
			})
			.then(() => {
				return combined_meta;
			});
	},

	/**
	 * @returns {Promise}
	 */
	test: () => {
		debug(logger, "Testing Nginx configuration");
		return utils.execFile("/usr/sbin/nginx", ["-t", "-g", "error_log off;"]);
	},

	/**
	 * @returns {Promise}
	 */
	reload: () => {
		return internalNginx.test().then(() => {
			logger.info("Reloading Nginx");
			return utils.execFile("/usr/sbin/nginx", ["-s", "reload"]);
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Integer} host_id
	 * @returns {String}
	 */
	getConfigName: (host_type, host_id) => {
		if (host_type === "default") {
			return "/data/nginx/default_host/site.conf";
		}
		return `/data/nginx/${internalNginx.getFileFriendlyHostType(host_type)}/${host_id}.conf`;
	},

	/**
	 * Generates custom locations
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	renderLocations: (host) => {
		return new Promise((resolve, reject) => {
			let template;

			try {
				template = fs.readFileSync(`${__dirname}/../templates/_location.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			const renderEngine = utils.getRenderEngine();
			let renderedLocations = "";

			const locationRendering = async () => {
				for (let i = 0; i < host.locations.length; i++) {
					const locationCopy = Object.assign(
						{},
						{ access_list_id: host.access_list_id },
						{ certificate_id: host.certificate_id },
						{ ssl_forced: host.ssl_forced },
						{ caching_enabled: host.caching_enabled },
						{ block_exploits: host.block_exploits },
						{ allow_websocket_upgrade: host.allow_websocket_upgrade },
						{ http2_support: host.http2_support },
						{ hsts_enabled: host.hsts_enabled },
						{ hsts_subdomains: host.hsts_subdomains },
						{ access_list: host.access_list },
						{ certificate: host.certificate },
						{ sso_enabled: host.sso_enabled, sso_configured: host.sso_configured || false },
						host.locations[i],
					);

					// A location with its own access list overrides the host's,
					// otherwise it inherits the host's access list
					let locationAccessList = null;
					if (locationCopy.access_list_id > 0 && locationCopy.access_list_id !== host.access_list?.id) {
						locationAccessList = await accessListModel
							.query()
							.where("is_deleted", 0)
							.andWhere("id", locationCopy.access_list_id)
							.withGraphFetched("[clients,items]")
							.first();
					}
					if (locationAccessList) {
						locationCopy.access_list = locationAccessList;
					} else {
						locationCopy.access_list_id = host.access_list_id;
						locationCopy.access_list = host.access_list;
					}

					if (locationCopy.forward_host.indexOf("/") > -1) {
						const splitted = locationCopy.forward_host.split("/");

						locationCopy.forward_host = splitted.shift();
						locationCopy.forward_path = `/${splitted.join("/")}`;
					}

					renderedLocations += await renderEngine.parseAndRender(template, locationCopy);
				}
			};

			locationRendering()
				.then(() => resolve(renderedLocations))
				.catch(reject);
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	generateConfig: async (host_type, host_row, ssoContext = null) => {
		// Prevent modifying the original object:
		const host = JSON.parse(JSON.stringify(host_row));
		// Only the SSO sidecar needs the client secret; keep it out of templates and debug logs
		delete host.sso_client_secret;
		const nice_host_type = internalNginx.getFileFriendlyHostType(host_type);

		await internalNginx.loadRenderRelations(nice_host_type, host);

		// SSO context for proxy hosts — derive from per-host columns and the
		// global kill switch (prefetched by bulkGenerateConfigs when available)
		if (nice_host_type === "proxy_host") {
			let globalEnabled = false;
			if (ssoContext) {
				globalEnabled = !!ssoContext.globalEnabled;
			} else {
				try {
					const row = await settingModel.query().where("id", "sso-enabled").first();
					globalEnabled = row?.value === "true";
				} catch (_err) {
					globalEnabled = false;
				}
			}
			internalNginx.applySsoContext(host, globalEnabled);
		}

		debug(logger, `Generating ${nice_host_type} Config:`, JSON.stringify(host, null, 2));

		const renderEngine = utils.getRenderEngine();

		return new Promise((resolve, reject) => {
			let template = null;
			const filename = internalNginx.getConfigName(nice_host_type, host.id);

			try {
				template = fs.readFileSync(`${__dirname}/../templates/${nice_host_type}.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			let origLocations;

			// Manipulate the data a bit before sending it to the template
			if (nice_host_type !== "default") {
				host.use_default_location = true;
				if (typeof host.advanced_config !== "undefined" && host.advanced_config) {
					host.use_default_location = !internalNginx.advancedConfigHasDefaultLocation(host.advanced_config);
				}
			}

			// For redirection hosts, if the scheme is not http or https, set it to $scheme
			if (
				nice_host_type === "redirection_host" &&
				["http", "https"].indexOf(host.forward_scheme.toLowerCase()) === -1
			) {
				host.forward_scheme = "$scheme";
			}

			// A stream forwarding to an IPv6 literal must have the address wrapped in
			// square brackets before nginx appends ":<port>". Without the brackets nginx
			// reads the trailing ":<port>" as part of the address and rejects the upstream
			// ("invalid port in upstream"), so the stream saves but never activates (#5740).
			if (nice_host_type === "stream" && net.isIPv6(host.forwarding_host)) {
				host.forwarding_host = `[${host.forwarding_host}]`;
			}

			// Check for / in custom locations (sync — must happen before rendering)
			if (host.locations) {
				origLocations = [].concat(host.locations);
				_.map(host.locations, (location) => {
					if (location.path === "/") {
						host.use_default_location = false;
					}
				});
			}

			// Set the IPv6 setting for the host
			host.ipv6 = internalNginx.ipv6Enabled();

			// Render locations (they inherit the SSO vars), then the main template.
			let locationsPromise = Promise.resolve();
			if (host.locations) {
				locationsPromise = internalNginx.renderLocations(host).then((renderedLocations) => {
					host.locations = renderedLocations;
				});
			}

			locationsPromise.then(() => {
				renderEngine
					.parseAndRender(template, host)
					.then((config_text) => {
						fs.writeFileSync(filename, config_text, { encoding: "utf8" });
						debug(logger, "Wrote config:", filename, config_text);

						// Restore locations array
						host.locations = origLocations;

						resolve(true);
					})
					.catch((err) => {
						debug(logger, `Could not write ${filename}:`, err.message);
						reject(new errs.ConfigurationError(err.message));
					});
			}).catch((err) => {
				debug(logger, `Could not render locations for ${filename}:`, err.message);
				reject(new errs.ConfigurationError(err.message));
			});
		});
	},

	/**
	 * The templates rely on the certificate and access list relations being loaded.
	 * Not every caller fetches them (or fetches them fully), and when they're missing
	 * the config silently renders without SSL or without any access rules (#5919).
	 * Load anything that is referenced but not loaded onto the given host object.
	 *
	 * @param   {String}  host_type
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	loadRenderRelations: async (host_type, host) => {
		if (host.certificate_id > 0 && host.certificate?.id !== host.certificate_id) {
			const certificate = await certificateModel
				.query()
				.where("is_deleted", 0)
				.andWhere("id", host.certificate_id)
				.first();
			host.certificate = certificate ? JSON.parse(JSON.stringify(certificate)) : null;
		}

		if (host_type === "proxy_host" && host.access_list_id > 0) {
			if (
				host.access_list?.id !== host.access_list_id ||
				!Array.isArray(host.access_list.clients) ||
				!Array.isArray(host.access_list.items)
			) {
				const accessList = await accessListModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", host.access_list_id)
					.withGraphFetched("[clients,items]")
					.first();
				host.access_list = accessList ? JSON.parse(JSON.stringify(accessList)) : null;
			}

			if (!host.access_list) {
				logger.warn(
					`Proxy Host #${host.id} references Access List #${host.access_list_id} which does not exist`,
				);
			} else if (!host.access_list.clients.length && !host.access_list.items.length) {
				logger.warn(
					`Proxy Host #${host.id} uses Access List #${host.access_list_id} which has no clients or authorizations, no access restrictions will apply`,
				);
			}
		}
	},

	/**
	 * This generates a temporary nginx config listening on port 80 for the domain names listed
	 * in the certificate setup. It allows the letsencrypt acme challenge to be requested by letsencrypt
	 * when requesting a certificate without having a hostname set up already.
	 *
	 * @param   {Object}  certificate
	 * @returns {Promise}
	 */
	generateLetsEncryptRequestConfig: (certificate) => {
		debug(logger, "Generating LetsEncrypt Request Config:", certificate);
		const renderEngine = utils.getRenderEngine();

		return new Promise((resolve, reject) => {
			let template = null;
			const filename = `/data/nginx/temp/letsencrypt_${certificate.id}.conf`;

			try {
				template = fs.readFileSync(`${__dirname}/../templates/letsencrypt-request.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			certificate.ipv6 = internalNginx.ipv6Enabled();

			renderEngine
				.parseAndRender(template, certificate)
				.then((config_text) => {
					fs.writeFileSync(filename, config_text, { encoding: "utf8" });
					debug(logger, "Wrote config:", filename, config_text);
					resolve(true);
				})
				.catch((err) => {
					debug(logger, `Could not write ${filename}:`, err.message);
					reject(new errs.ConfigurationError(err.message));
				});
		});
	},

	/**
	 * A simple wrapper around unlinkSync that writes to the logger
	 *
	 * @param   {String}  filename
	 */
	deleteFile: (filename) => {
		if (!fs.existsSync(filename)) {
			return;
		}
		try {
			debug(logger, `Deleting file: ${filename}`);
			fs.unlinkSync(filename);
		} catch (err) {
			debug(logger, "Could not delete file:", JSON.stringify(err, null, 2));
		}
	},

	/**
	 *
	 * @param   {String} host_type
	 * @returns String
	 */
	getFileFriendlyHostType: (host_type) => {
		return host_type.replace(/-/g, "_");
	},

	/**
	 * This removes the temporary nginx config file generated by `generateLetsEncryptRequestConfig`
	 *
	 * @param   {Object}  certificate
	 * @returns {Promise}
	 */
	deleteLetsEncryptRequestConfig: (certificate) => {
		const config_file = `/data/nginx/temp/letsencrypt_${certificate.id}.conf`;
		return new Promise((resolve /*, reject*/) => {
			internalNginx.deleteFile(config_file);
			resolve();
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @param   {Boolean} [delete_err_file]
	 * @returns {Promise}
	 */
	deleteConfig: (host_type, host, delete_err_file) => {
		const config_file = internalNginx.getConfigName(
			internalNginx.getFileFriendlyHostType(host_type),
			typeof host === "undefined" ? 0 : host.id,
		);
		const config_file_err = `${config_file}.err`;

		return new Promise((resolve /*, reject*/) => {
			internalNginx.deleteFile(config_file);
			if (delete_err_file) {
				internalNginx.deleteFile(config_file_err);
			}
			resolve();
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @returns {Promise}
	 */
	renameConfigAsError: (host_type, host) => {
		const config_file = internalNginx.getConfigName(
			internalNginx.getFileFriendlyHostType(host_type),
			typeof host === "undefined" ? 0 : host.id,
		);
		const config_file_err = `${config_file}.err`;

		return new Promise((resolve /*, reject*/) => {
			fs.unlink(config_file_err, () => {
				// ignore result, a previous .err file may not exist
				fs.rename(config_file, config_file_err, () => {
					// also ignore result, as this is a debugging informative file anyway
					resolve();
				});
			});
		});
	},

	/**
	 * @param   {String}  hostType
	 * @param   {Array}   hosts
	 * @returns {Promise}
	 */
	bulkGenerateConfigs: (hostType, hosts) => {
		// For proxy hosts, prefetch only the global SSO kill switch
		let ssoContextPromise = Promise.resolve(null);
		if (hostType === "proxy_host") {
			ssoContextPromise = settingModel.query().where("id", "sso-enabled").first().then((row) => {
				return {
					globalEnabled: row?.value === "true",
				};
			}).catch(() => ({ globalEnabled: false }));
		}

		return ssoContextPromise.then((ssoContext) => {
			const promises = [];
			hosts.map((host) => {
				promises.push(internalNginx.generateConfig(hostType, host, ssoContext));
				return true;
			});
			return Promise.all(promises);
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Array}   hosts
	 * @returns {Promise}
	 */
	bulkDeleteConfigs: (host_type, hosts) => {
		const promises = [];
		hosts.map((host) => {
			promises.push(internalNginx.deleteConfig(host_type, host, true));
			return true;
		});

		return Promise.all(promises);
	},

	/**
	 * @param   {string}  config
	 * @returns {boolean}
	 */
	advancedConfigHasDefaultLocation: (cfg) => !!cfg.match(/^(?:.*;)?\s*?location\s*?\/\s*?{/im),

	/**
	 * @returns {boolean}
	 */
	ipv6Enabled: () => {
		if (typeof process.env.DISABLE_IPV6 !== "undefined") {
			const disabled = process.env.DISABLE_IPV6.toLowerCase();
			return !(disabled === "on" || disabled === "true" || disabled === "1" || disabled === "yes");
		}

		return true;
	},
};

export default internalNginx;
