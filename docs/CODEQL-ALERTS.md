# CodeQL Alert Triage — 2025-06-25

## Summary

GitHub Code Scanning reported 12 CodeQL alerts. Of these:
- **4 fixed** in our code (this commit)
- **8 inherited** from upstream NginxProxyManager — documented below for awareness

---

## Fixed (Our Code)

### Alert #1 — Workflow missing permissions (Medium)
- **File:** `.github/workflows/stale.yml`
- **Fix:** Added explicit `permissions: { issues: write, pull-requests: write }` block

### Alerts #10, #11, #12 — Incomplete URL substring sanitization (High, Test)
- **File:** `backend/sso/tests/logout-redirect.test.js` lines 67, 69, 76
- **Root cause:** `startsWith("http")` matched too broadly — CodeQL flagged it as incomplete URL validation
- **Fix:** Changed to explicit `startsWith("https://") || startsWith("http://")` in both the test helper AND the production code (`backend/sso/server.js` line 214)
- **Note:** The URLs flagged (`evil.com`, `javascript:`) are **test inputs** deliberately testing our validation — the underlying `validateReturnUrl()` is correct

---

## Upstream (Inherited — Not Our Code)

These alerts exist in the original NginxProxyManager codebase. Fixing them would create fork divergence and merge conflicts with upstream updates.

### Alert #9 — CORS misconfiguration for credentials transfer (High)
- **File:** `backend/lib/express/cors.js:4`
- **Issue:** `Access-Control-Allow-Origin` reflects `req.headers.origin` directly with `Access-Control-Allow-Credentials: true`
- **Risk:** Allows any origin to make credentialed requests
- **Upstream concern:** This is the project's CORS middleware design choice

### Alert #6 — Loop bound injection (High)
- **File:** `backend/internal/certificate.js:566`
- **Issue:** `_.map(data.files, ...)` iterates over user-uploaded file list
- **Risk:** Attacker-controlled iteration count (mitigated by upstream file size limits)

### Alert #5 — Double escaping or unescaping (High)
- **File:** `backend/setup.js:151`
- **Issue:** Escaping order is wrong — quotes escaped before backslashes, introducing new backslashes that then get double-escaped
- **Risk:** Potential injection in initial setup credentials

### Alert #4 — Missing rate limiting (High)
- **File:** `backend/routes/users.js:317`
- **Issue:** POST `/api/users/:user_id/login` (loginAs) has no rate limiting
- **Risk:** Brute-force on authentication endpoint

### Alert #3 — Missing rate limiting (High)
- **File:** `backend/routes/tokens.js:67`
- **Issue:** POST `/tokens/2fa` has no rate limiting on 2FA verification
- **Risk:** Brute-force on TOTP codes (6-digit = 1M combinations)

### Alert #2 — Missing rate limiting (High)
- **File:** `backend/routes/nginx/certificates.js:343`
- **Issue:** POST `/certificates/:id/renew` has no rate limiting
- **Risk:** Repeated Let's Encrypt renewal hammering (LE has its own rate limits)

### Alert #8 — Sensitive data read from GET request (Medium)
- **File:** `backend/routes/nginx/certificates.js:346`
- **Issue:** Certificate data served via GET (may expose in logs/referrer)

### Alert #7 — Sensitive data read from GET request (Medium)
- **File:** `backend/routes/nginx/certificates.js:226`
- **Issue:** Certificate download via GET endpoint
