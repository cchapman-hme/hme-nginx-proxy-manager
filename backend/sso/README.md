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
| `/sso/denied`   | GET    | nginx `error_page 403` | Access-denied page: who is signed in, use a different account, sign out |
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
| `sso_path_groups`    | no       | JSON array of `{ "path", "groups" }` path rules (below)               |

The redirect URI to register in the app registration is
`https://<first non-wildcard domain of the host>/sso/callback`. Entra ID does not
accept wildcard redirect URIs, so a host whose only domain is a wildcard cannot
use SSO.

When `sso_allowed_groups` or `sso_path_groups` is set the sidecar requests the
delegated Graph scope `GroupMember.Read.All` (admin consent required) and reads
`/me/memberOf` with paging. A failed Graph lookup denies access.

### Path rules

`sso_path_groups` gives parts of a host their own groups (UI: Path groups, one
rule per line, `/reports/ = group-id, group-id`). For a request under a rule's
path (the path itself or anything below it; the longest matching rule wins) the
user needs one of the rule's groups, and the host's `sso_allowed_groups`
neither grants nor is required there. Everything outside every rule keeps the
host's groups. So someone can be allowed the rule's paths, the rest of the
host, or both. A rule with no groups admits nobody.

The sidecar matches the path nginx serves, not the raw request line: the query
is dropped, percent-escapes are decoded once, repeated slashes merged and dot
segments resolved, and the comparison ignores case. A malformed path, a path
above the root, or a rule list the sidecar cannot read denies the request
(`access.js`). Rule paths may use only letters, digits, `.`, `_`, `~`, `-` and
`/`; saving a host with an invalid or duplicate rule fails.

Notes:

- Matching ignores case so that a case-insensitive upstream (IIS) cannot be
  reached past a rule with `/REPORTS/`. On a case-sensitive upstream this also
  puts case variants (`/Reports/`) under the rule; do not keep other content in
  such directories.
- Rules protect URLs, not files: a symlink or alias under a rule path that
  points at other content serves it to the rule's groups.
- Adding a rule to a host without allowed groups makes every sign-in on that
  host fetch groups, so the app registration needs the `GroupMember.Read.All`
  consent before the rule is saved (otherwise sign-in fails with 502).
- Membership is read from `/me/memberOf`: direct members only, nested groups
  do not count.
- Rollback: an image without migration `20261119000000_sso_path_groups` will
  not start on a database that has run it. Roll the migration back first
  (`down` drops the column), and expect the host's groups to apply to the
  rule's paths again once it is gone.

## Access-denied page

nginx sends every 403 it raises itself on an SSO host to the sidecar
(`error_page 403 = @sso_denied`): a failed group check, an access list, the
blocked internal endpoints. Upstream 403s pass through unchanged. The page
(`pages.js`, no scripts, strict CSP) explains the denial, shows the signed-in
account, and offers:

- **Sign in with a different account**: `/sso/login` on the host's first
  concrete domain (the one the callback uses, so it also works from a
  secondary domain), returning to the denied page. Entra ID always shows its
  account picker, and picking the same account again re-reads its groups.
- **Sign out**: `/sso/logout`.
- Details to send to an administrator: site, page, account, reason, time.

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
