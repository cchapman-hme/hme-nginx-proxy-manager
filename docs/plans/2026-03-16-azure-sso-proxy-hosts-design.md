# Azure SSO for Proxy Hosts — Design Document

**Date:** 2026-03-16
**Status:** Approved

## Overview

Add Azure AD SSO authentication to all nginx proxy hosts managed by NPM. One login on any proxy host authenticates the user across all proxy hosts (true SSO via shared cookie domain). Settings managed via the NPM admin UI, not env vars.

## Requirements

1. **Global default ON, per-host opt-out** — All proxy hosts require SSO by default; each host can disable it individually.
2. **Azure settings in admin UI** — Tenant ID, Client ID, Client Secret, Cookie Domain, Redirect URI, and Allowed Groups stored in DB, managed via a new SSO Settings page.
3. **Independent from access lists** — SSO and basic auth/IP rules coexist. A proxy host can have SSO, an access list, both, or neither.
4. **Per-host group filtering** — Optional Azure AD group restrictions per proxy host (e.g., only DevOps team can access Jenkins).
5. **NPM admin UI unchanged** — SSO protects proxied services only; admin dashboard keeps its existing login.
6. **Shared cookie domain** — All proxy hosts share a configurable parent domain (e.g., `.hme.com`). Cookie domain configurable via settings.

## Architecture

### SSO Sidecar Service

A small Express micro-service inside the same container, started via s6-overlay. Listens on `127.0.0.1:3180` (internal only).

```
backend/sso/
  server.js        — Express app: /sso/login, /sso/callback, /sso/verify, /sso/logout, /sso/reload
  session-store.js — SQLite session store (DB at /data/sso/sessions.db)
  msal-client.js   — MSAL ConfidentialClientApplication, reads config from NPM's setting table
  group-check.js   — Graph API group membership check (per-host groups via X-Original-Host header)
  config.js        — Reads SSO settings from NPM's /data/database.sqlite setting table
```

**Endpoints:**

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /sso/login?return=URL` | Public | Initiate MSAL auth code flow, store return URL in session |
| `GET /sso/callback?code=&state=` | Public | Exchange code for token, create session, redirect to return URL |
| `GET /sso/verify` | Internal (nginx only) | Return 200 + user headers if valid session, 401 if not |
| `GET /sso/logout` | Public | Destroy session, optionally redirect to Azure AD logout |
| `POST /sso/reload` | Internal | Reload config from DB after settings change |

**Session storage:** `better-sqlite3` at `/data/sso/sessions.db`. Cookie on configurable domain, `httpOnly`, `secure`, `sameSite=lax`, 8hr TTL.

### Nginx Template Integration

**New partial: `_sso.conf`** — Included in `location /` blocks (both `proxy_host.conf` and `_location.conf`):

```nginx
{% if sso_enabled and sso_configured %}
  # Azure SSO authentication
  auth_request /_sso_verify;
  auth_request_set $sso_user  $upstream_http_x_sso_user;
  auth_request_set $sso_email $upstream_http_x_sso_email;
  proxy_set_header X-SSO-User  $sso_user;
  proxy_set_header X-SSO-Email $sso_email;
  error_page 401 = @sso_redirect;
{% endif %}
```

**Server-level SSO locations** — Added once per `server {}` block in `proxy_host.conf`:

```nginx
{% if sso_enabled and sso_configured %}
  location = /_sso_verify {
      internal;
      proxy_pass http://127.0.0.1:3180/sso/verify;
      proxy_pass_request_body off;
      proxy_set_header Content-Length "";
      proxy_set_header X-Original-URI $request_uri;
      proxy_set_header X-Original-Host $host;
      proxy_set_header Cookie $http_cookie;
  }

  location @sso_redirect {
      return 302 $scheme://$host/sso/login?return=$scheme://$host$request_uri;
  }

  location /sso/ {
      proxy_pass http://127.0.0.1:3180/sso/;
      proxy_set_header Host $host;
      proxy_set_header X-Original-Host $host;
  }
{% endif %}
```

**Key design decisions:**
- `/sso/` location is at server level, NOT inside `location /` → not subject to `auth_request` → no chicken-and-egg
- `_sso.conf` included before `_access.conf` → SSO blocks request before basic auth runs (no `satisfy` interaction needed)
- `sso_configured` flag: true only when all required SSO settings exist in DB → incomplete config = no auth directives emitted (safe pass-through at config level)

### Data Model

**Global settings** — stored in existing `setting` table:

| Key | Value | Notes |
|-----|-------|-------|
| `sso-enabled` | `true`/`false` | Master toggle |
| `sso-tenant-id` | UUID | Azure AD tenant |
| `sso-client-id` | UUID | App registration |
| `sso-client-secret` | string | App registration secret |
| `sso-cookie-domain` | `.hme.com` | Shared cookie domain |
| `sso-redirect-uri` | URL | OAuth callback URL |
| `sso-allowed-groups` | JSON array | Global default group filter (optional) |

**Per-host fields** — new columns on `proxy_host` table (migration):

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `sso_enabled` | int (bool) | `1` | SSO on this host (default ON) |
| `sso_forced_groups` | text (JSON) | `null` | Override: required Azure AD group IDs |

**Config generation:** `nginx.js` `generateConfig()` enriches template context with `sso_configured` flag (true when all required settings exist). Template guards with `{% if sso_enabled and sso_configured %}`.

**Settings save cascade:** After saving SSO settings, trigger `bulkGenerateConfigs()` + `reload()` for all proxy hosts — same pattern as access list changes.

### Docker Integration

- New s6 service at `docker/rootfs/etc/s6-overlay/s6-rc.d/sso/`
- Depends on `prepare` service (same as existing services)
- Uses same Node.js runtime already in container
- Starts always; handles "not configured" gracefully (idle mode)

### Dependencies

- `@azure/msal-node` — MSAL auth (same as Paige)
- `better-sqlite3` — already available in NPM

### Frontend

1. **SSO Settings page** — New admin nav item. Form: Tenant ID, Client ID, Client Secret (masked), Cookie Domain, Redirect URI, Allowed Groups. Warning about Azure AD app registration sync.
2. **Proxy Host modal** — SSO toggle (default ON), optional group override field. Warning if host domain doesn't match cookie domain.

## Security

- `/_sso_verify` marked `internal` — cannot be called externally
- Cookie: `httpOnly`, `secure`, `sameSite=lax`
- Client secret in DB (same security level as other NPM secrets)
- Fail closed: sidecar down → 502, not pass-through
- CSRF state validation on callback

## Design Attack Results

**Passed.** No architectural contradictions. Implementation notes:
1. Sidecar must handle "SSO not configured" without crashing
2. Settings save must trigger bulk config regeneration
3. UI should warn about Azure AD app registration sync and cookie domain mismatch
