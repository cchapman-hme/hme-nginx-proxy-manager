# Azure SSO Implementation — Full Audit Report

**Date:** 2026-03-17
**Scope:** All 20 tasks, 10 commits (`c60a7a89..0e4d3e8f`) on `develop`
**Method:** Code Review (4-phase) + Rubber Duck + Be-a-Shithead
**Files Audited:** ~22 files across backend/sso/, backend/internal/, backend/templates/, docker/, frontend/

---

## 🔍 Code Review: Azure SSO for Proxy Hosts

**Overall Grade: C+** — The core architecture is sound, the MSAL integration is clean, and the code follows existing NPM patterns well. However, there are real security vulnerabilities (session fixation, unauthenticated admin endpoints exposed via nginx), an architectural gap (custom locations bypass SSO entirely), a performance bug (7× redundant nginx cascades on save), and zero test coverage on security-critical code.

| Grade | Meaning |
|-------|---------|
| A | Clean, idiomatic, handles edge cases. |
| B | Minor issues. Author clearly tried. |
| **C+** | **Works but needs fixes before production. Core design is good.** |
| D | Functional by accident. |
| F | War crime against computing. |

---

## 🚨 Critical (Fix Before Merge)

### C1. Session Fixation Vulnerability
**Location:** `backend/sso/server.js` lines 131-146 (callback handler)
**Problem:** After successful OAuth authentication in `/sso/callback`, the session ID is NOT regenerated. The user is authenticated into whatever session they arrived with.

**Attack:** If an attacker can set the `npm_sso_sid` cookie on the victim's browser (feasible if they control ANY subdomain under the cookie domain — e.g., a compromised proxy host), they can:
1. Create a session by visiting `/sso/login` (get a session cookie with a known SID)
2. Set that cookie on the victim's browser via a response from a controlled subdomain
3. Victim completes Azure AD authentication
4. Attacker uses the same SID to access all SSO-protected resources as the victim

**Impact:** Complete session hijack. Full impersonation of authenticated users.
**Fix:**
```javascript
// In /sso/callback, BEFORE storing user data:
req.session.regenerate((err) => {
    if (err) {
        console.error("[sso] Session regeneration failed:", err.message);
        return res.status(500).send("SSO authentication failed");
    }
    req.session.ssoUser = {
        name: result.account.name,
        email: result.account.username,
        oid: result.account.homeAccountId,
        groups,
    };
    // Set cookie domain on new session
    if (currentCfg.cookieDomain) {
        req.session.cookie.domain = currentCfg.cookieDomain;
    }
    const returnUrl = ...; // (existing logic)
    req.session.save(() => res.redirect(safe));
});
```

**Note:** `req.session.regenerate()` destroys the old session and creates a new one with a fresh SID. The `returnUrl` and `oauthState` stored on the old session will be lost — these need to be captured BEFORE `regenerate()` is called, then set on the new session.

---

### C2. Unauthenticated Admin Endpoints Exposed via Nginx
**Location:** `backend/templates/proxy_host.conf` lines 37-44 (the `/sso/` location block)
**Problem:** The `/sso/` location proxies ALL sidecar endpoints without authentication (by design — the login flow needs this). But this exposes internal admin endpoints to the public internet:

- `POST /sso/reload` — triggers config reload from database, resets MSAL client
- `GET /sso/health` — exposes whether SSO is configured

**Attack:**
```bash
# Any external user can trigger config reloads
curl -X POST https://any-proxy-host.example.com/sso/reload

# Information disclosure
curl https://any-proxy-host.example.com/sso/health
# Returns: {"ok":true,"configured":true}
```

**Impact:** DOS via rapid config reload spam; information disclosure of SSO configuration state. The reload endpoint also causes the sidecar to reopen the SQLite database and rebuild the MSAL client, which could cause brief authentication outages if timed with real user requests.

**Fix:** Add explicit deny blocks in the nginx template, BEFORE the permissive `/sso/` block:
```nginx
{% if sso_enabled == 1 or sso_enabled == true %}
{% if sso_configured %}
  # Block internal-only SSO endpoints from external access
  location = /sso/reload {
      return 403;
  }
  location = /sso/health {
      return 403;
  }

  # SSO login/callback/logout endpoints (NOT protected by auth_request)
  location /sso/ {
      proxy_pass http://127.0.0.1:3180/sso/;
      ...
  }
{% endif %}
{% endif %}
```
Nginx processes exact-match locations (`=`) before prefix matches, so these deny blocks take priority.

---

### C3. SSO Settings Cascade Fires 7× Per Save
**Location:** `backend/internal/setting.js` lines 73-95, `frontend/src/pages/Settings/SsoSettings.tsx` lines 32-56
**Problem:** The frontend saves 7 SSO settings sequentially (6 settings + sso-enabled last). Every `sso-*` setting triggers the cascade:
1. Query ALL proxy hosts with eager loading
2. Bulk regenerate ALL nginx configs
3. Reload nginx
4. POST to sidecar `/sso/reload`

That's **7× full nginx config regeneration + 7× nginx reload + 7× sidecar reload** for a single "Save" click. With 50 proxy hosts, that's 350 config file writes and 7 nginx reloads in a few seconds.

**Impact:** Heavy I/O and CPU spike on save. Brief periods where hosts have inconsistent SSO config (some regenerated with new tenant ID but old client secret). Potential nginx reload failures under rapid succession.

**Fix:** Either:
- **Option A (simple):** Only trigger the cascade when `row.id === "sso-enabled"`. Since the frontend saves it last, this acts as the "commit" signal.
- **Option B (better):** Add a bulk SSO settings API endpoint that saves all 7 settings in one transaction, then triggers the cascade once.
- **Option C (simplest):** Save non-cascade settings without the `sso-` prefix check, only cascade when `sso-enabled` is specifically saved.

Recommended: **Option A** — change the condition from `row.id.startsWith("sso-")` to `row.id === "sso-enabled"`:
```javascript
// Only cascade when the master switch is toggled (saved last by frontend)
if (row.id === "sso-enabled") {
    // ... cascade logic
}
```

---

## ⚠️ Important (Fix Before Next Release)

### I1. Custom Locations Completely Bypass SSO
**Location:** `backend/templates/proxy_host.conf` vs `backend/templates/_location.conf`
**Problem:** The `{% include "_sso.conf" %}` directive is placed inside the default `location / {}` block. Custom locations rendered via `{{ locations }}` use `_location.conf`, which includes `_access.conf` but NOT `_sso.conf`.

**Consequences:**
- Any custom location path (e.g., `/api`, `/admin`) has NO SSO protection
- If a custom location has `path = "/"`, SSO is completely disabled for the entire host (because `use_default_location` becomes false and the default `location / {}` is never rendered)
- There is no warning in the UI about this

**Impact:** Silent SSO bypass for any host with custom locations. Users may believe their `/api` path is SSO-protected when it's not.

**Fix options:**
1. Add `{% include "_sso.conf" %}` to `_location.conf` — requires passing SSO variables into location rendering context
2. Move `auth_request` to server scope instead of location scope (but this would conflict with the unprotected `/sso/` location)
3. Add a UI warning when SSO is enabled AND custom locations exist: "Custom locations are not protected by SSO"

Recommended: **Option 3** for V1 (document the limitation), then **Option 1** for V2.

### I2. No Rate Limiting on Public SSO Endpoints
**Location:** `backend/sso/server.js` — `/sso/login`, `/sso/callback`
**Problem:** No rate limiting on any endpoint. Each `/sso/login` request creates a session record in SQLite. Session pruning runs every 15 minutes.

**Attack:** An attacker can flood `/sso/login` to create millions of session records, filling disk and degrading SQLite performance: `for i in $(seq 1 100000); do curl https://host.example.com/sso/login & done`

**Impact:** Session SQLite DB grows unbounded, disk fill, degraded SSO performance.
**Fix:** Add `express-rate-limit` to the sidecar, or rate-limit at the nginx level:
```nginx
# In proxy_host.conf, add rate limiting for SSO login
limit_req_zone $binary_remote_addr zone=sso_login:10m rate=5r/s;
location /sso/ {
    limit_req zone=sso_login burst=10 nodelay;
    proxy_pass http://127.0.0.1:3180/sso/;
    ...
}
```

### I3. Zero Test Coverage
**Location:** `backend/sso/` — no test files
**Problem:** Zero tests for security-critical authentication code. No unit tests for:
- Config parsing edge cases (malformed JSON, missing values, empty strings)
- Return URL validation (relative paths, absolute URLs, malicious redirects)
- Group membership checks (empty arrays, null values, case sensitivity)
- Session store operations (expiry, concurrent access, corrupted data)
- MSAL client config hash change detection

**Impact:** Any refactoring or bug fix could introduce regressions in auth logic with no safety net.
**Fix:** Add test files. Priority order:
1. `tests/sso/return-url-validation.test.js` — open redirect prevention
2. `tests/sso/group-check.test.js` — authorization logic
3. `tests/sso/config.test.js` — settings parsing, host group lookup
4. `tests/sso/session-store.test.js` — session lifecycle

### I4. Graph API Failure = All Group-Restricted Users Denied
**Location:** `backend/sso/group-check.js` lines 10-22
**Problem:** `fetchUserGroups()` returns `[]` on any error (network, auth, rate limit). Since `isGroupMember([], requiredGroups)` returns `false` when `requiredGroups` has items, a Graph API outage causes ALL group-restricted users to be denied access.

**Design trade-off:** This is fail-closed (secure but potentially disruptive). The opposite (fail-open) would be a security risk.

**Impact:** Microsoft Graph API downtime = complete SSO lockout for group-restricted hosts.
**Fix:** Document this behavior. Optionally, add a configurable grace period or cache TTL for group memberships. The current behavior is the SAFE default — don't change to fail-open.

---

## 💀 AI Slop Detected

**Verdict: Minimal slop.** The code is clean, intentionally structured, and follows existing NPM patterns. No buzzword comments, no orphan code, no generic naming. This passes the slop test.

Minor observations:

| Location | Observation | Verdict |
|----------|-------------|---------|
| Comment `// Gate 2 fix` in server.js | Helpful for reviewers but should reference issue/PR number | Context-specific — keep for now |
| `_err` parameter naming | Used 3× for intentionally ignored errors | Consistent pattern — acceptable |
| `parseGroups()` helper | Only used in config.js | Appropriate extraction for readability |

---

## 🔧 Improvements (Should Fix)

### R1. Logout via GET Enables CSRF
**Location:** `backend/sso/server.js` lines 184-198
**Problem:** `GET /sso/logout` destroys the session. Any page can trigger a logout via an image tag: `<img src="https://host.example.com/sso/logout">`.
**Impact:** Low — logout CSRF is generally considered acceptable risk.
**Fix:** Change to `POST /sso/logout` and add a CSRF token, or accept the trade-off.

### R2. Cookie `secure` Flag Requires HTTPS
**Location:** `backend/sso/server.js` line 49
**Problem:** `secure: process.env.NODE_ENV === "production"` — in production Docker container, `NODE_ENV=production` is set. This means the session cookie REQUIRES HTTPS. SSO will silently fail for HTTP-only proxy hosts.
**Impact:** Users won't understand why SSO doesn't work on HTTP proxy hosts. No UI warning.
**Fix:** Add a note in the SSO settings UI: "SSO requires HTTPS on all protected proxy hosts."

### R3. No SSO Sidecar README
**Location:** `backend/sso/` — no README
**Fix:** Add `backend/sso/README.md` covering: architecture, config, troubleshooting, known limitations.

### R4. Session `returnUrl` Lost on Regenerate
**Location:** Related to C1 fix
**Problem:** When implementing session regeneration (C1), the `returnUrl` stored on the old session via `/sso/login` will be destroyed. Must save and restore it:
```javascript
const savedReturnUrl = req.session.returnUrl;
req.session.regenerate((err) => {
    req.session.returnUrl = savedReturnUrl; // restore after regeneration
    req.session.ssoUser = { ... };
    // ...
});
```

### R5. SSO Settings Query Per Config Generation
**Location:** `backend/internal/nginx.js` lines 247-264
**Problem:** Every time a proxy host config is generated, it queries `SELECT * FROM setting WHERE id LIKE 'sso-%'`. During bulk generation (startup, cascade), this runs N times — once per host.
**Fix:** Query SSO settings once, pass to all config generations. The `bulkGenerateConfigs` method could prefetch SSO settings and inject them into each host context.

---

## ✅ What's Good

1. **Clean MSAL integration** — The `msal-client.js` wrapper with config hash change detection is elegant. Lazy client creation, proper scope management, clean separation.

2. **Session store implementation** — `SsoSessionStore` is solid: WAL mode, index on expiry, periodic pruning, clean shutdown. This is production-quality SQLite usage.

3. **OAuth state parameter handling** — CSRF protection via `oauthState` is correctly implemented with generation-before-redirect and single-use validation.

4. **Return URL validation (post-fix)** — Accepts both relative paths and absolute URLs matching the cookie domain. Rejects `//` protocol-relative URLs. Handles malformed URLs gracefully.

5. **Config cascade design** — The sso-* change → bulk regen → nginx reload → sidecar reload pipeline is architecturally sound (the 7× redundancy is a bug, not a design flaw).

6. **Template integration** — Using existing `{% include %}` pattern for `_sso.conf` is consistent with how `_access.conf` and `_hsts.conf` work. The `internal;` directive on `/_sso_verify` prevents direct access.

7. **Frontend follows existing patterns** — Formik form, Tabler UI, locale strings, tab navigation — all consistent with existing settings and modal patterns. The `humps` auto-transformation means no manual camelCase↔snake_case conversion.

8. **Docker s6 integration** — Longrun service, prepare dependency, restart loop with 1s delay, clean shutdown — follows the exact pattern of existing NPM services.

9. **Graceful degradation** — When SSO is not configured, `/sso/verify` returns 200 (pass-through). This means SSO can be enabled globally in the migration without breaking existing deployments until config is actually entered.

---

## 📝 Prioritized Fix List

1. [ ] **C1.** Session fixation: Add `req.session.regenerate()` in callback (preserve returnUrl)
2. [ ] **C2.** Block `/sso/reload` and `/sso/health` from external access in nginx template
3. [ ] **C3.** Change cascade trigger from `startsWith("sso-")` to `=== "sso-enabled"`
4. [ ] **I1.** Add UI warning for custom locations + SSO (document V1 limitation)
5. [ ] **I2.** Add rate limiting to `/sso/login` and `/sso/callback`
6. [ ] **I3.** Write test suite for critical auth logic (URL validation, group check, config parsing)
7. [ ] **I4.** Document Graph API failure behavior in SSO README
8. [ ] **R2.** Add HTTPS requirement note to SSO settings UI
9. [ ] **R3.** Write SSO sidecar README
10. [ ] **R5.** Optimize SSO settings query in bulk config generation

---

## 🧪 Test Cases Needed

### Return URL Validation
```javascript
// Should accept
assert(validate("/") === "/");
assert(validate("/dashboard") === "/dashboard");
assert(validate("/path?query=1") === "/path?query=1");
assert(validate("https://app.example.com/page") === "https://app.example.com/page"); // matches .example.com cookie

// Should reject (redirect to "/")
assert(validate("//evil.com") === "/");
assert(validate("https://evil.com/steal") === "/");
assert(validate("javascript:alert(1)") === "/");
assert(validate("") === "/");
assert(validate(null) === "/");
assert(validate("https://example.com.evil.com") === "/"); // suffix attack
```

### Group Membership
```javascript
assert(isGroupMember(["a", "b"], ["b", "c"]) === true);    // intersection
assert(isGroupMember(["a"], ["b", "c"]) === false);          // no match
assert(isGroupMember([], ["a"]) === false);                   // empty user groups
assert(isGroupMember(["a"], []) === true);                    // no requirements
assert(isGroupMember(["a"], null) === true);                  // null requirements
assert(isGroupMember([], []) === true);                       // both empty
```

### Config Parsing
```javascript
assert(parseGroups(null) === []);
assert(parseGroups("") === []);
assert(parseGroups("not json") === []);
assert(parseGroups('["a","b"]') === ["a", "b"]);
assert(parseGroups('["a","","b"]') === ["a", "b"]);  // filter empty
assert(parseGroups('"string"') === []);               // not an array
```

### Session Fixation
```javascript
// After authentication, session ID should be different from before
const sidBefore = getSessionId(response);
const sidAfter = completeOAuth(sidBefore);
assert(sidBefore !== sidAfter);
```

### Rate Limiting
```javascript
// 100 rapid requests to /sso/login should get throttled
for (let i = 0; i < 100; i++) requests.push(fetch("/sso/login"));
const results = await Promise.all(requests);
const throttled = results.filter(r => r.status === 429);
assert(throttled.length > 0);
```

---

## 🔥 Be-a-Shithead Addendum

### Phase 0: What I'd Exploit First

If I had 10 minutes with this system and wanted to cause damage:

1. **Subdomain takeover → session fixation:** If I control any subdomain under the cookie domain (e.g., a decommissioned proxy host), I set a `npm_sso_sid` cookie with a known value. Next victim who authenticates gives me their session. **Blocked by: Fix C1.**

2. **Reload spam:** `while true; do curl -X POST https://host/sso/reload; done` — Force constant config reloads, disrupting auth for all users. **Blocked by: Fix C2.**

3. **Session flooding:** `for i in $(seq 1 1000000); do curl -s https://host/sso/login > /dev/null & done` — Create a million session records in SQLite, fill the disk. **Blocked by: Fix I2.**

4. **Custom location bypass:** Create a proxy host with SSO enabled, then add a custom location at `/api`. Access the backend API without SSO at `https://host/api`. **Blocked by: Fix I1 (warning) or future _sso.conf in locations.**

### Phase 1: What Survives the Attack

After fixes C1-C3 and I1-I2 are applied, the remaining attack surface is small:
- OAuth state expiry edge case (session timeout during Azure AD login flow — UX issue, not security)
- Group membership caching for 8 hours (design decision, documented)
- CSRF logout via GET (low risk, documented)

### Verdict

The bones are good. The MSAL integration, session store, and nginx template architecture are solid. The bugs found are the kind you EXPECT in a first pass of security-critical code — they're the reason code review exists. Fix the three criticals and this is production-worthy.
