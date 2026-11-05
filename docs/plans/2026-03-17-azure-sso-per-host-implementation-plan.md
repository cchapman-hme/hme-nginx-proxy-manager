# Per-Host Azure SSO — Implementation Plan

**Design doc:** `docs/plans/2026-03-17-azure-sso-per-host-design.md`
**Branch:** `develop`
**Date:** 2026-03-17

---

## Summary of Changes

Move all Azure SSO configuration from the global `setting` table to per-proxy-host columns on the `proxy_host` table. Keep only a global `sso-enabled` kill switch in settings. Each proxy host can independently configure its own Azure AD app registration, tenant, cookie domain, and allowed groups.

---

## Task 1 — New Database Migration

**File:** `backend/migrations/20260318000000_sso_per_host.js` (NEW)

**Purpose:** Add per-host SSO columns to `proxy_host`, change `sso_enabled` default to 0, rename `sso_forced_groups` → `sso_allowed_groups`.

**Code:**
```js
exports.up = function (knex) {
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
  });
};

exports.down = function (knex) {
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
  });
};
```

**Verification:** Run `npx knex migrate:latest` against a test SQLite DB.

---

## Task 2 — Update Model & Schemas

### 2a — `backend/models/proxy_host.js`

**Current state (L14-26):** `boolFields` array includes `"sso_enabled"`. (L78): `jsonAttributes` includes `"sso_forced_groups"`.

**Changes:**
1. In `jsonAttributes` (L78), replace `"sso_forced_groups"` with `"sso_allowed_groups"`
2. No changes to `boolFields` — `sso_enabled` stays

### 2b — `backend/schema/components/proxy-host-object.json`

**Current state (L29):** `"sso_enabled"` in `required` array. (L152-165): `sso_enabled` and `sso_forced_groups` property defs.

**Changes:**
1. Keep `"sso_enabled"` in the `required` array (L29) — it has a DB default so it's always present. Do NOT add new SSO columns to `required` (they have defaults but aren't essential to the response contract)
2. Replace the `sso_forced_groups` property definition with `sso_allowed_groups` (same shape: `oneOf: [null, array<string>]`)
3. Add new property definitions:
   ```json
   "sso_tenant_id": {
     "type": "string",
     "maxLength": 255,
     "description": "Azure AD Tenant ID for this proxy host",
     "example": ""
   },
   "sso_client_id": {
     "type": "string",
     "maxLength": 255,
     "description": "Azure AD Application (Client) ID for this proxy host",
     "example": ""
   },
   "sso_client_secret": {
     "type": "string",
     "maxLength": 512,
     "description": "Azure AD Client Secret for this proxy host",
     "example": ""
   },
   "sso_cookie_domain": {
     "type": "string",
     "maxLength": 255,
     "description": "Cookie domain for SSO session sharing (e.g. .example.com)",
     "example": ""
   }
   ```

### 2c — `backend/schema/paths/nginx/proxy-hosts/post.json` (L81-86)

**Changes:** Replace `sso_forced_groups` ref with `sso_allowed_groups`. Add refs for `sso_tenant_id`, `sso_client_id`, `sso_client_secret`, `sso_cookie_domain`.

### 2d — `backend/schema/paths/nginx/proxy-hosts/hostID/put.json` (L89-94)

**Changes:** Same as 2c — replace `sso_forced_groups` → `sso_allowed_groups`, add new SSO property refs.

**Verification:** `npx node backend/validate-schema.js` (if available), or POST/PUT to API and check validation passes.

---

## Task 3 — Strip `setup.js` to Keep Only Kill Switch

**File:** `backend/setup.js`

**Current state (L107-141):** `setupSsoSettings()` creates 7 settings: `sso-enabled`, `sso-tenant-id`, `sso-client-id`, `sso-client-secret`, `sso-cookie-domain`, `sso-redirect-uri`, `sso-allowed-groups`.

**Changes:** Keep only the `sso-enabled` setting creation. Remove the other 6.

**New `setupSsoSettings()` body:**
```js
const setupSsoSettings = () => {
  return settingModel
    .query()
    .select(settingModel.raw("COUNT(`id`) as `count`"))
    .where("id", "sso-enabled")
    .first()
    .then((row) => {
      if (!row.count) {
        return settingModel.query().insert({
          id: "sso-enabled",
          name: "Azure SSO Kill Switch",
          description: "Global on/off for Azure SSO across all proxy hosts",
          value: "false",
          meta: {},
        });
      }
    });
};
```

**Note:** Existing DB rows for the other 6 settings will remain but are harmless — they're simply unused. A cleanup migration could remove them later.

**Verification:** Start the app with a fresh DB and confirm only `sso-enabled` is created.

---

## Task 4 — Update `internal/nginx.js` SSO Context

**File:** `backend/internal/nginx.js`

### 4a — `generateConfig()` (L241-260)

**Current behavior:** Queries `setting` table for `sso-%` rows, checks global tenant/client/secret/cookie are all present.

**New behavior:** Derive `sso_configured` directly from the host's own per-host columns (already on the `host` object from the DB query). Only check the global kill switch.

**Replace L241-260 with:**
```js
// SSO context for proxy hosts — derive from per-host columns
let ssoPromise = Promise.resolve();
if (nice_host_type === "proxy_host") {
  if (ssoContext) {
    // Use prefetched context (bulk generation optimization)
    host.sso_configured = ssoContext.globalEnabled && !!(
      host.sso_tenant_id &&
      host.sso_client_id &&
      host.sso_client_secret &&
      host.sso_cookie_domain
    );
    host.sso_redirect_host = host.domain_names?.[0] || "";
  } else {
    ssoPromise = settingModel.query().where("id", "sso-enabled").first().then((row) => {
      const globalEnabled = row?.value === "true";
      host.sso_configured = globalEnabled && !!(
        host.sso_enabled &&
        host.sso_tenant_id &&
        host.sso_client_id &&
        host.sso_client_secret &&
        host.sso_cookie_domain
      );
      host.sso_redirect_host = host.domain_names?.[0] || "";
    }).catch(() => {
      host.sso_configured = false;
    });
  }
}
```

### 4b — `bulkGenerateConfigs()` (L425-443)

**Current behavior:** Prefetches all `sso-%` settings, builds `configured` boolean from global settings.

**New behavior:** Only prefetch the `sso-enabled` kill switch. Per-host columns are already on each host row.

**Replace L425-443 with:**
```js
// For proxy hosts, prefetch only the global SSO kill switch
let ssoContextPromise = Promise.resolve(null);
if (hostType === "proxy_host") {
  ssoContextPromise = settingModel.query().where("id", "sso-enabled").first().then((row) => {
    return {
      globalEnabled: row?.value === "true",
    };
  }).catch(() => ({ globalEnabled: false }));
}
```

**Verification:** Save a proxy host with SSO columns filled, confirm nginx config has `auth_request` block. Save one without → confirm no SSO block.

---

## Task 5 — Update `internal/setting.js` Kill Switch Cascade

**File:** `backend/internal/setting.js`

**Current state (L76-99):** When `sso-enabled` is saved, regenerates all proxy host configs, reloads nginx, and POSTs to `/sso/reload`.

**Changes:** The cascade logic stays — the kill switch still needs to regenerate all proxy host configs and notify the sidecar. Only change the comment and remove any references to other `sso-*` settings (there aren't any in the cascade).

**Minimal change:** Update the comment at L76 to clarify it's the kill switch. No functional change needed — the current cascade already only fires on `sso-enabled`.

Also need to add: after any proxy host create/update that changes SSO fields, POST to `/sso/reload` to clear the sidecar's config cache. This goes in **Task 8** (proxy-host internal) or **Task 6** (config.js).

**Verification:** Toggle kill switch → confirm all proxy configs regenerate.

---

## Task 6 — Rewrite `backend/sso/config.js`

**File:** `backend/sso/config.js` (181 lines → ~150 lines)

**Current behavior:** `loadConfig()` queries `setting` table for `sso-%` rows, caches globally. `loadHostGroups()` queries `proxy_host` by hostname for `sso_forced_groups`.

**New behavior:**
- `loadConfig()` → renamed to `loadGlobalConfig()` — only reads `sso-enabled` from `setting` table
- New `loadHostConfig(hostname)` → queries `proxy_host` by hostname, returns per-host SSO config
- `loadHostGroups()` → removed (replaced by `loadHostConfig`)
- `getConfig()` → returns `{ enabled: boolean }` (kill switch only)
- `isConfigured()` → removed (use per-host check instead)

**New public API:**
```js
export async function loadGlobalConfig()
  // Returns { enabled: boolean }

export async function loadHostConfig(hostname)
  // Queries proxy_host by hostname (JSON domain_names column)
  // Returns { tenantId, clientId, clientSecret, cookieDomain, allowedGroups, redirectUri } or null

export function getGlobalConfig()
  // Returns cached { enabled: boolean }

export async function reloadConfig()
  // Clears all caches, reloads global config
```

**Key implementation detail for `loadHostConfig`:**
```js
export async function loadHostConfig(hostname) {
  try {
    const rows = await query(
      "SELECT domain_names, sso_enabled, sso_tenant_id, sso_client_id, " +
      "sso_client_secret, sso_cookie_domain, sso_allowed_groups " +
      "FROM proxy_host WHERE is_deleted = 0 AND sso_enabled = 1"
    );
    for (const row of rows) {
      const domains = JSON.parse(row.domain_names || "[]");
      if (domains.includes(hostname)) {
        return {
          tenantId: row.sso_tenant_id || "",
          clientId: row.sso_client_id || "",
          clientSecret: row.sso_client_secret || "",
          cookieDomain: row.sso_cookie_domain || "",
          allowedGroups: parseGroups(row.sso_allowed_groups),
          redirectUri: `https://${domains[0]}/sso/callback`,
        };
      }
    }
    return null;
  } catch (err) {
    console.error("[sso] Failed to load host config:", err.message);
    return null;
  }
}
```

**Verification:** Unit test — mock DB, call `loadHostConfig("app.example.com")`, verify correct host config returned.

---

## Task 7 — Rewrite `backend/sso/msal-client.js`

**File:** `backend/sso/msal-client.js` (82 lines → ~90 lines)

**Current behavior:** Single cached `ConfidentialClientApplication` using global config.

**New behavior:** `Map<string, ConfidentialClientApplication>` keyed by `tenantId:clientId`. Functions take explicit config parameter instead of reading global.

**New public API:**
```js
export function getMsalClient(hostConfig)
  // hostConfig = { tenantId, clientId, clientSecret }
  // Returns cached or new ConfidentialClientApplication

export async function getAuthCodeUrl(hostConfig, state, redirectUri, includeGroups)
export async function acquireTokenByCode(hostConfig, code, redirectUri, includeGroups)
export function resetAllClients()
  // Clears entire Map
```

**Key changes:**
```js
const _clients = new Map();

function clientKey(cfg) {
  return `${cfg.tenantId}:${cfg.clientId}`;
}

export function getMsalClient(hostConfig) {
  const key = clientKey(hostConfig);
  let client = _clients.get(key);
  if (client) return client;

  client = new ConfidentialClientApplication({
    auth: {
      clientId: hostConfig.clientId,
      authority: `https://login.microsoftonline.com/${hostConfig.tenantId}`,
      clientSecret: hostConfig.clientSecret,
    },
  });
  _clients.set(key, client);
  return client;
}

export function resetAllClients() {
  _clients.clear();
}
```

**Verification:** Create two clients with different tenant+client, verify Map has 2 entries. Call `resetAllClients()`, verify empty.

---

## Task 8 — Rewrite `backend/sso/server.js`

**File:** `backend/sso/server.js` (255 lines → ~280 lines)

**Current behavior:** All endpoints use `getConfig()` (global). `isConfigured()` checks global config.

**New behavior:** All endpoints resolve the host from `x-original-host` header, then call `loadHostConfig(hostname)` for per-host config.

### 8a — Replace imports (L10-11)
```js
// Old:
import { loadConfig, reloadConfig, getConfig, isConfigured, loadHostGroups } from "./config.js";
import { getAuthCodeUrl, acquireTokenByCode, resetClient } from "./msal-client.js";

// New:
import { loadGlobalConfig, reloadConfig, getGlobalConfig, loadHostConfig } from "./config.js";
import { getAuthCodeUrl, acquireTokenByCode, resetAllClients } from "./msal-client.js";
```

### 8b — Bootstrap (L44-45)
```js
// Old: await loadConfig();
// New: await loadGlobalConfig();
```

### 8c — `/sso/verify` (L66-100)
```js
app.get("/sso/verify", async (req, res) => {
  const global = getGlobalConfig();
  if (!global?.enabled) return res.sendStatus(200); // Kill switch off → pass through

  const originalHost = req.headers["x-original-host"];
  if (!originalHost) return res.sendStatus(200); // No host → pass through

  const hostCfg = await loadHostConfig(originalHost);
  if (!hostCfg) return res.sendStatus(200); // Host has no SSO config → pass through

  if (!req.session?.ssoUser) return res.sendStatus(401);

  // Tenant mismatch protection: session from different tenant → re-authenticate
  if (req.session.ssoUser.tenantId && req.session.ssoUser.tenantId !== hostCfg.tenantId) {
    return res.sendStatus(401);
  }

  // Check per-host group restrictions
  if (hostCfg.allowedGroups && hostCfg.allowedGroups.length > 0) {
    const userGroups = req.session.ssoUser.groups || [];
    if (!isGroupMember(userGroups, hostCfg.allowedGroups)) {
      return res.status(403).send("Group membership required");
    }
  }

  res.set("X-SSO-User", req.session.ssoUser.name || "");
  res.set("X-SSO-Email", req.session.ssoUser.email || "");
  return res.sendStatus(200);
});
```

### 8d — `/sso/login` (L105-128)
```js
app.get("/sso/login", async (req, res) => {
  const global = getGlobalConfig();
  if (!global?.enabled) return res.status(503).send("SSO is not configured");

  const originalHost = req.headers["x-original-host"] || req.hostname;
  const hostCfg = await loadHostConfig(originalHost);
  if (!hostCfg || !hostCfg.tenantId || !hostCfg.clientId || !hostCfg.clientSecret) {
    return res.status(503).send("SSO is not configured for this host");
  }

  const returnUrl = req.query.return || "/";
  const state = randomUUID();
  req.session.oauthState = state;
  req.session.returnUrl = returnUrl;

  if (hostCfg.cookieDomain) {
    req.session.cookie.domain = hostCfg.cookieDomain;
  }

  try {
    const hasGroups = hostCfg.allowedGroups && hostCfg.allowedGroups.length > 0;
    const authUrl = await getAuthCodeUrl(hostCfg, state, hostCfg.redirectUri, hasGroups);
    res.redirect(authUrl);
  } catch (err) {
    console.error("[sso] Login error:", err.message);
    res.status(500).send("SSO login failed");
  }
});
```

### 8e — `/sso/callback` (L133-182)
```js
app.get("/sso/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");
  if (!req.session.oauthState || state !== req.session.oauthState) {
    return res.status(403).send("Invalid OAuth state");
  }
  delete req.session.oauthState;

  const originalHost = req.headers["x-original-host"] || req.hostname;
  const hostCfg = await loadHostConfig(originalHost);
  if (!hostCfg) return res.status(503).send("SSO not configured for this host");

  const savedReturnUrl = req.session.returnUrl || "/";

  try {
    const hasGroups = hostCfg.allowedGroups && hostCfg.allowedGroups.length > 0;
    const result = await acquireTokenByCode(hostCfg, code, hostCfg.redirectUri, hasGroups);

    let groups = [];
    if (hasGroups && result.accessToken) {
      groups = await fetchUserGroups(result.accessToken);
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error("[sso] Session regeneration failed:", err.message);
        return res.status(500).send("SSO authentication failed");
      }

      req.session.ssoUser = {
        name: result.account.name,
        email: result.account.username,
        oid: result.account.homeAccountId,
        tenantId: hostCfg.tenantId, // Store for cross-host tenant validation
        groups,
      };

      if (hostCfg.cookieDomain) {
        req.session.cookie.domain = hostCfg.cookieDomain;
      }

      const safe = validateReturnUrl(savedReturnUrl, hostCfg.cookieDomain);
      req.session.save(() => res.redirect(safe));
    });
  } catch (err) {
    console.error("[sso] Callback error:", err.message);
    res.status(500).send("SSO authentication failed");
  }
});
```

### 8f — `/sso/logout` (L188-200)
```js
app.get("/sso/logout", async (req, res) => {
  const originalHost = req.headers["x-original-host"] || req.hostname;
  const hostCfg = await loadHostConfig(originalHost);
  req.session.destroy(() => {
    if (hostCfg?.tenantId) {
      const postLogoutUri = req.query.return || `${req.protocol}://${originalHost}/`;
      res.redirect(
        `https://login.microsoftonline.com/${hostCfg.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutUri)}`
      );
    } else {
      res.redirect("/");
    }
  });
});
```

### 8g — `/sso/reload` (L205-210)
```js
app.post("/sso/reload", async (_req, res) => {
  await reloadConfig();
  resetAllClients();
  console.log("[sso] Config reloaded");
  res.json({ ok: true });
});
```

### 8h — Bootstrap and startup (L232-248)
```js
bootstrap().then(() => {
  const cfg = getGlobalConfig();
  server = app.listen(PORT, HOST, () => {
    if (cfg?.enabled) {
      console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (kill switch: ON)`);
    } else {
      console.log(`[sso] SSO sidecar listening on ${HOST}:${PORT} (kill switch: OFF)`);
    }
  });
});
```

**Verification:** Start sidecar, curl `/sso/verify` with X-Original-Host set to a host that has SSO config → 401 (no session). Set global kill switch to false → 200 (pass through).

---

## Task 9 — Rewrite `frontend/src/pages/Settings/SsoSettings.tsx`

**File:** `frontend/src/pages/Settings/SsoSettings.tsx` (243 lines → ~150 lines)

**Current behavior:** 7-field form (tenant, client, secret, domain, redirect, groups, enabled toggle).

**New behavior:** Kill switch toggle only + info card explaining that SSO is configured per-host.

**New component:**
```tsx
import cn from "classnames";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function SsoSettings() {
  const ssoEnabled = useSetting("sso-enabled");
  const { mutateAsync: setSetting } = useSetSetting();
  const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (ssoEnabled.isLoading) {
    return (
      <div className="card-body"><Loading noLogo /></div>
    );
  }

  if (ssoEnabled.error) {
    return (
      <div className="card-body">
        <Alert variant="danger">{ssoEnabled.error.message}</Alert>
      </div>
    );
  }

  const onSubmit = async (values: any, { setSubmitting }: any) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await setSetting({ id: "sso-enabled", value: values.enabled ? "true" : "false" });
      showObjectSuccess("setting", "saved");
    } catch (err: any) {
      setErrorMsg(<T id={err.message} />);
    } finally {
      setIsSubmitting(false);
      setSubmitting(false);
    }
  };

  return (
    <Formik
      initialValues={{ enabled: ssoEnabled.data?.value === "true" }}
      onSubmit={onSubmit}
    >
      {() => (
        <Form>
          <div className="card-body">
            <Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
              {errorMsg}
            </Alert>
            <Alert variant="info" show>
              <T id="settings.sso.per-host-info" />
            </Alert>

            <div className="mb-3">
              <Field name="enabled" type="checkbox">
                {({ field }: any) => (
                  <label className="form-check form-switch">
                    <input
                      {...field}
                      id="ssoEnabled"
                      className={cn("form-check-input", { "bg-lime": field.checked })}
                      type="checkbox"
                    />
                    <span className="form-check-label">
                      <T id="settings.sso.enabled" />
                    </span>
                  </label>
                )}
              </Field>
              <small className="form-hint">
                <T id="settings.sso.killswitch.description" />
              </small>
            </div>
          </div>
          <div className="card-footer text-end">
            <Button type="submit" actionType="primary" className="bg-lime" isLoading={isSubmitting} disabled={isSubmitting}>
              <T id="save" />
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
}
```

**Verification:** Load `/settings`, see only kill switch toggle.

---

## Task 10 — Expand Proxy Host Modal SSO Section

**File:** `frontend/src/modals/ProxyHostModal.tsx`

**Current state (L99-100):** `ssoEnabled` and `ssoForcedGroups` initial values. (L339-372): Toggle + single text field.

**Changes:**
1. Add `initialValues` for: `ssoTenantId`, `ssoClientId`, `ssoClientSecret`, `ssoCookieDomain`, `ssoAllowedGroups`
2. Replace `ssoForcedGroups` with `ssoAllowedGroups` everywhere
3. Add a dedicated "SSO" tab (instead of burying SSO in Options)
4. Show auto-generated redirect URI as read-only computed field
5. Show/hide SSO fields based on `ssoEnabled` toggle

### New `initialValues` (replace L99-100):
```tsx
// SSO tab
ssoEnabled: data?.ssoEnabled ?? false,
ssoTenantId: data?.ssoTenantId || "",
ssoClientId: data?.ssoClientId || "",
ssoClientSecret: data?.ssoClientSecret || "",
ssoCookieDomain: data?.ssoCookieDomain || "",
ssoAllowedGroups: data?.ssoAllowedGroups ? data.ssoAllowedGroups.join(", ") : "",
```

### New SSO tab (add as 5th tab between SSL and Advanced):
```tsx
<li className="nav-item" role="presentation">
  <a className="nav-link" href="#tab-sso" data-bs-toggle="tab" role="tab">SSO</a>
</li>
```

Tab content:
```tsx
<div className="tab-pane" id="tab-sso" role="tabpanel">
  <div className="mb-3">
    <Field name="ssoEnabled" type="checkbox">
      {({ field }: any) => (
        <label className="form-check form-switch">
          <input {...field} className={cn("form-check-input", { "bg-lime": field.checked })} type="checkbox" />
          <span className="form-check-label"><T id="host.sso-enabled" /></span>
        </label>
      )}
    </Field>
    <small className="form-hint"><T id="host.sso-enabled.description" /></small>
  </div>

  {values.ssoEnabled && (
    <>
      <div className="mb-3">
        <label className="form-label">Redirect URI (auto-generated)</label>
        <input
          className="form-control"
          readOnly
          value={values.domainNames?.[0] ? `https://${values.domainNames[0]}/sso/callback` : "Set a domain name first"}
        />
        <small className="form-hint">Register this URI in your Azure AD App Registration</small>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ssoTenantId"><T id="host.sso.tenant-id" /></label>
        <Field name="ssoTenantId" type="text" className="form-control" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ssoClientId"><T id="host.sso.client-id" /></label>
        <Field name="ssoClientId" type="text" className="form-control" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ssoClientSecret"><T id="host.sso.client-secret" /></label>
        <Field name="ssoClientSecret" type="password" className="form-control" />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ssoCookieDomain"><T id="host.sso.cookie-domain" /></label>
        <Field name="ssoCookieDomain" type="text" className="form-control" placeholder=".example.com" />
        <small className="form-hint">Hosts sharing the same cookie domain share SSO sessions</small>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ssoAllowedGroups"><T id="host.sso.allowed-groups" /></label>
        <Field name="ssoAllowedGroups" type="text" className="form-control" placeholder="group-id-1, group-id-2" />
        <small className="form-hint">At least one Azure AD group ID is required</small>
      </div>
    </>
  )}
</div>
```

### `onSubmit` transform (replace L44-55):
```tsx
const { ssoAllowedGroups, ...rest } = values;
const payload = {
  id: id === "new" ? undefined : id,
  ...rest,
  ssoAllowedGroups: ssoAllowedGroups
    ? ssoAllowedGroups.split(",").map((s: string) => s.trim()).filter(Boolean)
    : null,
};
```

Remove the old SSO fields from the Details tab (L339-372).

### Also update:

**File:** `frontend/src/hooks/useProxyHost.ts` (L29-30)
```tsx
// Replace:
ssoEnabled: true,
ssoForcedGroups: null,

// With:
ssoEnabled: false,
ssoTenantId: "",
ssoClientId: "",
ssoClientSecret: "",
ssoCookieDomain: "",
ssoAllowedGroups: null,
```

**File:** `frontend/src/api/backend/models.ts` (L131-132)
```tsx
// Replace:
ssoEnabled: boolean;
ssoForcedGroups: string[] | null;

// With:
ssoEnabled: boolean;
ssoTenantId: string;
ssoClientId: string;
ssoClientSecret: string;
ssoCookieDomain: string;
ssoAllowedGroups: string[] | null;
```

**Verification:** Open proxy host modal, see SSO tab with all fields. Toggle SSO on → fields appear. Save → check DB columns populated.

---

## Task 11 — Update Locale Strings

**File:** `frontend/src/locale/src/en.json`

**Changes:**
1. Remove old keys: `host.sso-forced-groups`, `host.sso-forced-groups.description`, `settings.sso.tenant-id`, `settings.sso.client-id`, `settings.sso.client-secret`, `settings.sso.cookie-domain`, `settings.sso.redirect-uri`, `settings.sso.allowed-groups`, `settings.sso.enabled.description`
2. Update `settings.sso.enabled.description` → kill switch wording
3. Add new keys for per-host SSO:
```json
"host.sso.tenant-id": { "defaultMessage": "Azure AD Tenant ID" },
"host.sso.client-id": { "defaultMessage": "Azure AD Client ID" },
"host.sso.client-secret": { "defaultMessage": "Azure AD Client Secret" },
"host.sso.cookie-domain": { "defaultMessage": "Cookie Domain" },
"host.sso.allowed-groups": { "defaultMessage": "Required Azure AD Groups" },
"settings.sso.per-host-info": { "defaultMessage": "SSO is configured per proxy host. Use this toggle as a global kill switch to disable SSO across all hosts." },
"settings.sso.killswitch.description": { "defaultMessage": "When disabled, no proxy host will use SSO regardless of its per-host settings" }
```

**Verification:** Run locale check script (`check-locales.cjs`).

---

## Task 12 — Notify Sidecar on Proxy Host SSO Changes

**File:** `backend/internal/proxy-host.js`

**Current behavior:** When proxy host is created/updated, calls `internalNginx.configure()` which regenerates nginx config. But does NOT notify the SSO sidecar.

**Change:** After successful nginx configure on create/update, POST to `http://127.0.0.1:3180/sso/reload` so the sidecar clears its config cache.

**Add helper at top of file (uses Node 18+ built-in `fetch`, same as `setting.js` L89):**
```js
function notifySsoSidecar() {
  return fetch("http://127.0.0.1:3180/sso/reload", { method: "POST" })
    .catch((err) => {
      logger.warn("[proxy-host] SSO sidecar notification failed:", err.message);
    });
}
```

**Call `notifySsoSidecar()` after:**
- L88: `.then((row) => { return internalNginx.configure(...).then(() => { notifySsoSidecar(); return row; }); })`
- L217: Same pattern after `internalNginx.configure()` in update
- L294: After delete config — `internalNginx.deleteConfig(...).then(() => { notifySsoSidecar(); return internalNginx.reload(); })`
- L347: Same for enable/disable

**Note:** Uses Node 18+ built-in `fetch` (same pattern as `setting.js` L89).

**Verification:** Update a proxy host SSO fields → check sidecar logs show "Config reloaded".

---

## Task 13 — Remove Old SSO Settings from Setting Table (Optional Cleanup)

**File:** `backend/migrations/20260318000001_sso_cleanup_settings.js` (NEW)

**Purpose:** Remove orphan `sso-*` settings (everything except `sso-enabled`).

```js
exports.up = function (knex) {
  return knex("setting")
    .where("id", "like", "sso-%")
    .andWhereNot("id", "sso-enabled")
    .del();
};

exports.down = function (knex) {
  // No rollback — settings were already unused
  return Promise.resolve();
};
```

**Verification:** After migration, `SELECT * FROM setting WHERE id LIKE 'sso-%'` returns only `sso-enabled`.

---

## Execution Order

1. **Task 1** — Migration (independent, foundation)
2. **Task 2** — Model & schemas (depends on Task 1)
3. **Task 3** — Strip setup.js (independent)
4. **Task 4** — nginx.js SSO context (depends on Task 2)
5. **Task 5** — setting.js cascade (independent)
6. **Task 6** — sso/config.js rewrite (depends on Task 1)
7. **Task 7** — sso/msal-client.js rewrite (independent)
8. **Task 8** — sso/server.js rewrite (depends on Tasks 6, 7)
9. **Task 12** — proxy-host.js sidecar notification (depends on Task 8)
10. **Task 10** — Frontend proxy host modal (depends on Task 2)
11. **Task 11** — Locale strings (depends on Task 10)
12. **Task 9** — Frontend settings page (independent)
13. **Task 13** — Optional cleanup migration (last)

### Parallelization Groups
- **Group A** (backend core): Tasks 1 → 2 → 4
- **Group B** (backend SSO sidecar): Tasks 6, 7 → 8 → 12
- **Group C** (backend misc): Tasks 3, 5 (parallel, independent)
- **Group D** (frontend): Tasks 10, 11 → 9

Groups A-D can execute in parallel. Tasks 3 and 5 can be done anytime.

---

## Commit Strategy

1. `feat(db): add per-host SSO columns migration` (Tasks 1, 13)
2. `feat(backend): update model/schemas for per-host SSO` (Tasks 2, 3, 4, 5, 12)
3. `feat(sso): rewrite sidecar for per-host config` (Tasks 6, 7, 8)
4. `feat(frontend): per-host SSO UI + kill switch settings` (Tasks 9, 10, 11)
