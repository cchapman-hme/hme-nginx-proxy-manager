# Azure SSO for Proxy Hosts — Revised Design (Per-Host)

**Date:** 2026-03-17
**Status:** Approved
**Supersedes:** `2026-03-16-azure-sso-proxy-hosts-design.md`

## Overview

Azure AD SSO authentication for nginx proxy hosts. **All SSO configuration is per-proxy-host** — each host has its own app registration, cookie domain, and allowed groups. A global kill switch enables/disables the SSO feature entirely.

## Requirements

1. **Global kill switch** — A single `sso-enabled` setting in admin Settings. When OFF, no proxy host can use SSO regardless of per-host config.
2. **Per-host SSO configuration** — Each proxy host has its own: SSO toggle, Tenant ID, Client ID, Client Secret, Cookie Domain, Allowed Groups.
3. **Per-host opt-in** — SSO is OFF by default on every proxy host. Admin must explicitly enable and configure it.
4. **Redirect URI auto-generated** — `https://{domain_names[0]}/sso/callback` — displayed read-only, not user-entered.
5. **Allowed Groups required** — At least one Azure AD group ID required when SSO is enabled on a host.
6. **Cross-host SSO** — Hosts sharing the same cookie domain + session = cross-host SSO works automatically.
7. **NPM admin UI unchanged** — SSO protects proxied services only; admin dashboard keeps its existing login.
8. **Fail-safe** — If any SSO condition isn't met, host serves normally without SSO.

## Data Model

### Global Settings (setting table)

| Key | Purpose |
|-----|---------|
| `sso-enabled` | Kill switch — must be ON for any per-host SSO to activate |

### Per-Proxy-Host Fields (proxy_host table)

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `sso_enabled` | int (bool) | `0` | SSO on this host (opt-in) |
| `sso_tenant_id` | text | `null` | Azure AD Tenant ID |
| `sso_client_id` | text | `null` | App Registration Client ID (GUID) |
| `sso_client_secret` | text | `null` | App Registration Client Secret |
| `sso_cookie_domain` | text | `null` | Cookie domain (e.g. `.hme.com`) |
| `sso_allowed_groups` | text (JSON) | `null` | Required Azure AD group IDs (min 1 when SSO on) |

No `sso_redirect_uri` column — auto-generated as `https://{domain_names[0]}/sso/callback`.

### SSO Activation Rule

A proxy host has SSO active **only if ALL are true**:
1. Global `sso-enabled` = `true` (kill switch)
2. Per-host `sso_enabled` = `1`
3. Per-host `sso_tenant_id`, `sso_client_id`, `sso_client_secret`, `sso_cookie_domain` all non-empty
4. Per-host `sso_allowed_groups` has at least 1 group ID
5. Host has at least one domain name

If any condition fails → host serves normally, no SSO directives emitted.

## Architecture

### SSO Sidecar (`backend/sso/`)

Express micro-service inside the container, started via s6-overlay. Listens on `127.0.0.1:3180` (internal only).

**Per-host config loading:**
- `loadHostConfig(hostname)` — queries `proxy_host` table for that hostname's SSO columns. Returns per-host config or null.
- Global kill switch checked first; if off, returns null immediately.
- MSAL client cache keyed by `tenantId+clientId` — supports multiple app registrations simultaneously.

**Endpoints:**

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /sso/verify` | Internal (nginx) | Check session + host groups + tenant match |
| `GET /sso/login?return=URL` | Public | Initiate MSAL auth code flow with per-host app registration |
| `GET /sso/callback?code=&state=` | Public | Exchange code, create session, redirect |
| `GET /sso/logout` | Public | Destroy session |
| `GET /sso/reload` | Internal | Reload config (cache invalidation) |
| `GET /sso/health` | Internal | Health check |

**Session storage:** SQLite at `/data/sso/sessions.db`. Session stores:
- `ssoUser.name`, `ssoUser.email`, `ssoUser.oid`
- `ssoUser.groups` — Azure AD group memberships
- `ssoUser.tenantId` — tenant used during login (for cross-host tenant validation)

### Security: Tenant Validation

When hosts share a cookie domain but use different Azure AD tenants, the session's `tenantId` must match the target host's `sso_tenant_id`. Mismatch → treat as unauthenticated → redirect to login. This prevents a session from tenant A granting access to a host configured for tenant B.

### Nginx Template Integration

Same as original design — `auth_request` directive in `_sso.conf`, SSO locations in `proxy_host.conf`. Template guards with `{% if sso_enabled and sso_configured %}`.

**Key difference:** `nginx.js` `generateConfig()` now checks the host's own columns (not global settings) to set `sso_configured`:
- `host.sso_configured = host.sso_enabled && !!host.sso_tenant_id && !!host.sso_client_id && !!host.sso_client_secret && !!host.sso_cookie_domain && hasGroups`

### Frontend

**Global SSO Settings page (`SsoSettings.tsx`):**
- Kill switch toggle
- Read-only table: all SSO-enabled hosts with their auto-generated redirect URIs (for Azure AD registration reference)

**Proxy Host create/edit modal — SSO section:**
- SSO toggle (off by default)
- When on: Tenant ID, Client ID, Client Secret (masked), Cookie Domain, Allowed Groups inputs
- Read-only: auto-generated Redirect URI
- Shown on both the per-host modal AND in the global settings summary table

## Design Attack Results

**Passed with one fix incorporated:**
- Tenant validation added to `/sso/verify` — session tenant must match host tenant. Prevents cross-tenant session reuse on shared cookie domains.
- No other architectural contradictions found.
