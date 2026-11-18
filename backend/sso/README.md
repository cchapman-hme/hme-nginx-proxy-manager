# SSO Sidecar — Microsoft Entra ID authentication for proxy hosts

An internal Express service that adds Microsoft Entra ID (Azure AD) sign-in to
individual nginx proxy hosts using nginx's `auth_request` module. It is part of
the `cchapman-hme/hme-nginx-proxy-manager` fork and runs inside the same
container as Nginx Proxy Manager.

## Architecture

```
Browser → nginx (proxy host) → /_sso_verify (internal) → sidecar 127.0.0.1:3180
                                    │
                                    ├─ 200 → request is proxied to the upstream
                                    ├─ 401 → 302 to /sso/login → Entra ID → /sso/callback
                                    └─ 403 → error_page → @sso_denied → /sso/denied page
```

- **Listens on:** `127.0.0.1:3180` (loopback only; never exposed directly)
- **Process manager:** s6-overlay longrun service `sso` (`docker/rootfs/etc/s6-overlay/s6-rc.d/sso`)
- **Session storage:** SQLite at `/data/sso/sessions.db` (WAL mode, pruned every 15 min)
- **Session secret:** `SSO_SESSION_SECRET` env var, else generated once into `/data/sso/session-secret`
- **Config source:** the NPM database, read-only. SQLite (`/data/database.sqlite`) or
  MySQL/MariaDB, auto-detected from the same `DB_MYSQL_*` variables the backend uses.

## Endpoints

| Endpoint        | Method | Reachable from     | Purpose                                                   |
|-----------------|--------|--------------------|-----------------------------------------------------------|
| `/sso/verify`   | GET    | nginx `auth_request` only | Returns 200 / 401 / 403 for the current session   |
| `/sso/login`    | GET    | Public             | Starts the authorization-code flow                        |
| `/sso/callback` | GET    | Public             | Exchanges the code for tokens, creates the session        |
| `/sso/logout`   | GET    | Public             | Destroys the session and signs out of Entra ID            |
| `/sso/signed-out` | GET  | Public             | Landing page after sign-out, with a sign-in button        |
| `/sso/denied`   | GET    | nginx `error_page 403` | 403 page: who is signed in, use a different account, sign out |
| `/sso/me`       | GET    | Public (same origin) | `{signedIn, name, email}` for the site's own account menu; 401 when signed out |
| `/sso/reload`   | POST   | Backend only       | Drops caches after host or setting changes (nginx 403s it)|
| `/sso/health`   | GET    | Loopback only      | Health check (nginx 403s it)                              |

nginx rate-limits `/sso/` to 5 requests/second per client IP (burst 10).

## Configuration

**Global kill switch** — Settings → Azure SSO. Stored as the `sso-enabled` setting.
When it is off, every host passes through regardless of its own settings.

**Per host** — Proxy Host → SSO tab. Stored on the `proxy_host` row:

| Column               | Required | Notes                                                                 |
|----------------------|----------|-----------------------------------------------------------------------|
| `sso_enabled`        | yes      | Enables SSO for the host (default off)                                |
| `sso_tenant_id`      | yes      | Entra ID directory (tenant) ID                                        |
| `sso_client_id`      | yes      | Application (client) ID of the app registration                       |
| `sso_client_secret`  | yes      | Client secret. Never returned by the API; leave blank on edit to keep |
| `sso_cookie_domain`  | no       | e.g. `.example.com` to share one session across subdomains            |
| `sso_allowed_groups` | no       | JSON array of group object IDs; empty allows any tenant user          |

The redirect URI to register in the app registration is
`https://<first non-wildcard domain of the host>/sso/callback`. Entra ID does not
accept wildcard redirect URIs, so a host whose only domain is a wildcard cannot
use SSO.

When `sso_allowed_groups` is set the sidecar requests the delegated Graph scope
`GroupMember.Read.All` (admin consent required) and reads `/me/memberOf` with
paging. A failed Graph lookup denies access.

## Security properties

- Fails closed: database errors during `auth_request` return 503, never 200.
- OAuth `state` is random, stored server-side, bound to the host that started
  the login, and single use. The session is regenerated at login start and
  again after the token exchange (no session fixation).
- Return URLs are validated: relative paths only, or absolute URLs on the cookie
  domain or the requesting host. Protocol-relative, backslash, credential and
  control-character forms are rejected.
- Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 hour max age.
- Sessions issued for one tenant are not accepted by hosts of another tenant.
- Session IDs, codes and tokens are never logged. `Cache-Control: no-store` is
  set on every response.
- `/sso/verify`, `/sso/reload` and `/sso/health` return 403 from nginx so they
  cannot be reached from the internet.

## Requirements

- HTTPS on every SSO-protected host (the cookie carries the `Secure` flag when
  `NODE_ENV=production`, which the image sets).
- Upstream applications receive `X-SSO-User` and `X-SSO-Email` headers from
  nginx and should trust them only from this proxy.

## Development

```bash
cd backend/sso
npm ci
npm test
```

Environment overrides: `SSO_PORT`, `SSO_DATA_DIR`, `SSO_DB_PATH`,
`SSO_SESSION_DB_PATH`, `SSO_SESSION_SECRET`, `SSO_SECURE_COOKIE=true`.

## Pages and account menu

Failures are HTML pages (`pages.js`) with the next step, not bare status text:

- **No access (403).** nginx sends every 403 it raises on an SSO host to the
  sidecar (`error_page 403 = @sso_denied`): the group check, an access list,
  the blocked internal endpoints. The page names the signed-in account when
  the group check failed and offers **Use a different account** (`/sso/login`,
  which always shows Entra ID's account picker) and **Sign out**. Upstream
  403s pass through unchanged.
- **Sign-in failed.** Entra ID errors (with the AADSTS code only), expired or
  reused sign-in links, token and group-lookup failures, and hosts without
  SSO each get a page with **Try again** where retrying can help.
- **Signed out.** `/sso/logout` without `?return=` sends Entra ID's
  `post_logout_redirect_uri` to the host's registered callback, which
  forwards a parameterless request to `/sso/signed-out`. A protected page as
  the return target would start a new sign-in straight away. An explicit
  same-site `?return=` is still honoured.

A protected site can show the signed-in user and a sign-out control by
fetching `/sso/me` (same origin, `credentials: "same-origin"`); link to
`/sso/logout` to sign out and to `/sso/login?return=<path>` to switch
accounts.
