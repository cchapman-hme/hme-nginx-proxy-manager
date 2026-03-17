# SSO Sidecar — Azure AD Authentication for Proxy Hosts

An internal Express server that provides Azure AD SSO authentication for nginx proxy hosts via the `auth_request` module.

## Architecture

```
Browser → nginx (proxy_host) → /_sso_verify (internal) → SSO sidecar (127.0.0.1:3180)
                                    │
                                    ├─ 200 → pass through to upstream
                                    ├─ 401 → redirect to /sso/login → Azure AD
                                    └─ 403 → "Group membership required"
```

- **Listens on:** `127.0.0.1:3180` (loopback only — never exposed to the internet)
- **Process manager:** s6-overlay longrun service
- **Session storage:** SQLite at `/data/sso/sessions.db` (WAL mode, auto-prune every 15 min)
- **Config source:** Reads `sso-*` settings from NPM's main SQLite database (read-only)

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/sso/verify` | GET | nginx internal | `auth_request` handler — returns 200/401/403 |
| `/sso/login` | GET | Public | Initiates MSAL authorization code flow |
| `/sso/callback` | GET | Public | Azure AD OAuth callback — exchanges code for token |
| `/sso/logout` | GET | Public | Destroys session, redirects to Azure AD logout |
| `/sso/reload` | POST | **Blocked externally** | Reloads config from DB (nginx returns 403) |
| `/sso/health` | GET | **Blocked externally** | Health check (nginx returns 403) |

## Cookie & Cross-Host SSO

SSO works across multiple proxy hosts by setting a shared session cookie on a parent domain:

- **Cookie name:** `npm_sso_sid`
- **Cookie domain:** Configured via "SSO Cookie Domain" setting (e.g., `.example.com`)
- **Cookie flags:** `httpOnly`, `secure` (in production), `sameSite: lax`
- **Max age:** 8 hours

**HTTPS Requirement:** In production (`NODE_ENV=production`), the session cookie is set with the `secure` flag. SSO will not work on HTTP-only proxy hosts — HTTPS is required on all SSO-protected hosts.

## Configuration

All settings are stored in the NPM `setting` table and managed via the web UI (Settings → Azure SSO):

| Setting ID | Description | Required |
|------------|-------------|----------|
| `sso-enabled` | Master switch — enables/disables SSO globally | Yes |
| `sso-tenant-id` | Azure AD tenant ID (UUID) | Yes |
| `sso-client-id` | App registration client ID (UUID) | Yes |
| `sso-client-secret` | App registration client secret | Yes |
| `sso-cookie-domain` | Parent domain for session cookies (e.g., `.example.com`) | Yes |
| `sso-redirect-uri` | OAuth2 callback URL (e.g., `https://auth.example.com/sso/callback`) | Yes |
| `sso-allowed-groups` | JSON array of Azure AD group IDs for global access control | No |

### Per-Host Settings

Each proxy host has:
- **SSO Enabled** (default: on) — toggle SSO for individual hosts
- **SSO Forced Groups** — Azure AD group IDs required to access this specific host (overrides global default)

## Group Membership Checks

When `sso-allowed-groups` (global) or `sso_forced_groups` (per-host) are configured:

1. During OAuth callback, the sidecar fetches the user's group memberships from Microsoft Graph API (`/v1.0/me/memberOf`)
2. On each request, `/sso/verify` checks the stored groups against requirements
3. Per-host groups are checked first, then global groups

### Known Behavior: Graph API Failures

If the Microsoft Graph API is unreachable or returns an error during authentication, the user's group list is stored as empty (`[]`). This means:

- **Users with group restrictions will be denied access** (403) until they re-authenticate with a working Graph API connection
- This is **fail-closed** behavior (secure but potentially disruptive)
- There is no grace period or group cache beyond the session lifetime (8 hours)

**Workaround:** If Graph API is down, temporarily remove group restrictions from the SSO settings to restore access.

## Custom Locations

SSO protection is applied to both the default location (`/`) and all custom locations configured on a proxy host. The `auth_request` directive is included via the `_sso.conf` template in both `proxy_host.conf` and `_location.conf`.

## Security Notes

### Session Fixation Protection
The OAuth callback handler regenerates the session ID after successful authentication (`req.session.regenerate()`). This prevents session fixation attacks where an attacker pre-sets a session cookie on the victim's browser.

### Return URL Validation
After authentication, the redirect URL is validated:
- Relative paths (`/dashboard`) are accepted
- Absolute URLs matching the cookie domain (`https://app.example.com/page`) are accepted
- Protocol-relative URLs (`//evil.com`) are rejected
- Foreign domains are rejected
- Non-HTTP(S) schemes (`javascript:`, `data:`) are rejected

### Rate Limiting
SSO login endpoints are rate-limited at the nginx level (`5 requests/second` per client IP, burst of 10) to prevent session flooding attacks.

### CSRF on Logout
The logout endpoint (`GET /sso/logout`) is accessible via GET request. This means a malicious page could trigger a logout via an image tag (`<img src="/sso/logout">`). This is a known trade-off — logout CSRF is generally considered acceptable risk, and changing to POST would require a form submission which degrades the user experience for a low-severity issue.

### Internal Endpoints
The `/sso/reload` and `/sso/health` endpoints are blocked from external access by nginx exact-match location rules returning 403. They remain accessible internally from the backend via loopback (`127.0.0.1:3180`).

## SQLite-Only Limitation (V1)

The SSO sidecar reads configuration directly from the NPM SQLite database file using `better-sqlite3` (read-only mode). This means SSO is **only supported when NPM uses SQLite** as its database backend.

MySQL and PostgreSQL support would require the sidecar to use a different database driver, which is planned for a future version.

## Files

```
backend/sso/
├── server.js          — Express server, route handlers
├── config.js          — Settings reader (NPM database)
├── session-store.js   — SQLite session store
├── msal-client.js     — MSAL ConfidentialClientApplication wrapper
├── group-check.js     — Microsoft Graph group membership checks
├── validation.js      — Return URL validation
├── package.json       — Dependencies
├── README.md          — This file
└── tests/
    ├── validation.test.js   — URL validation tests
    ├── group-check.test.js  — Group membership tests
    └── config.test.js       — Config parsing tests
```

## Running Tests

```bash
cd backend/sso
node --test tests/
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSO login redirects but never completes | Redirect URI mismatch | Ensure `sso-redirect-uri` exactly matches the App Registration's redirect URI |
| "SSO is not configured" error | Missing required settings | Check all 5 required settings are filled in |
| 403 "Group membership required" | User not in required group | Add user to the Azure AD group, or remove group restriction |
| Cookie not shared across hosts | Wrong cookie domain | Set `sso-cookie-domain` to the parent domain (e.g., `.example.com`) |
| SSO doesn't work on HTTP hosts | Secure cookie flag | Use HTTPS on all SSO-protected proxy hosts |
| Groups denied after Graph API outage | Fail-closed behavior | Remove group restrictions temporarily, or wait for users to re-authenticate |
