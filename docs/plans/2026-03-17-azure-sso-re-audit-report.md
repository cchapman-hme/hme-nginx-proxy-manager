# SSO Implementation Re-Audit Report

**Date:** 2026-03-17 (Re-audit)
**Scope:** Full SSO implementation — all files under `backend/sso/`, SSO-related changes in `backend/internal/`, `backend/templates/`, `docker/`, `frontend/`
**Previous Grade:** C+ (initial audit)
**Current Grade:** A-

---

## Phase 1: UNDERSTAND

### Architecture
Internal Express sidecar on `127.0.0.1:3180` providing Azure AD authentication for nginx proxy hosts via `auth_request`. The design is clean: nginx delegates auth decisions to the sidecar, which manages MSAL authorization code flow, session lifecycle, and group membership checks.

**Data flow:**
1. User → nginx → `/_sso_verify` (internal) → sidecar checks session cookie
2. No session → 401 → nginx `@sso_redirect` → `/sso/login` → Azure AD
3. Azure AD → `/sso/callback` → token exchange → session regenerated → redirect to validated return URL
4. Subsequent requests → session cookie → `/sso/verify` → 200 → upstream

**Key design decisions (all sound):**
- Session cookie on configurable parent domain for cross-host SSO
- SSO vars injected into location copies so custom locations inherit protection
- Bulk config generation prefetches SSO settings once (N→1 queries)
- Rate limiting at nginx level (5r/s per IP)
- Internal endpoints blocked with exact-match 403 rules
- parseGroups extracted to dependency-free module for testability

### Module Responsibilities (well-separated)
| Module | Responsibility | Dependencies |
|--------|---------------|--------------|
| `server.js` | Routes, request handling | express, config, msal, groups, validation |
| `config.js` | DB reader (read-only) | better-sqlite3, parse-groups |
| `session-store.js` | Session persistence | better-sqlite3, express-session |
| `msal-client.js` | Azure AD token management | @azure/msal-node, config |
| `group-check.js` | Group membership + Graph API | fetch (built-in) |
| `validation.js` | Return URL validation | none |
| `parse-groups.js` | JSON array parsing | none |

---

## Phase 2: ATTACK

### Security Findings (All Previous Criticals Fixed)

| Vector | Status | Evidence |
|--------|--------|----------|
| Session fixation | ✅ Fixed | `session.regenerate()` in callback, returnUrl captured before regeneration |
| Open redirect | ✅ Fixed | `validateReturnUrl()` with 23 test cases — blocks protocol-relative, foreign domains, non-HTTP schemes |
| Internal endpoint exposure | ✅ Fixed | `location = /sso/reload { return 403; }` exact-match blocks |
| Config cascade storm | ✅ Fixed | `row.id === "sso-enabled"` strict equality (one trigger, not seven) |
| Custom location bypass | ✅ Fixed | `_sso.conf` included in `_location.conf`, SSO vars copied to location objects |
| Session flooding | ✅ Fixed | `limit_req_zone` at 5r/s per IP, burst 10 |
| CSRF state | ✅ Present | UUID state parameter, validated on callback |
| SQL injection | ✅ Safe | Parameterized queries via better-sqlite3 prepared statements |
| Cookie flags | ✅ Correct | httpOnly, secure (prod), sameSite lax |

### Remaining Attack Surface (Acceptable for V1)

1. **GET logout** — `/sso/logout` accepts GET. A malicious page could trigger logout via `<img src="/sso/logout">`. This is a known trade-off documented in README. Impact: nuisance logout only, no data loss, session is destroyed server-side.

2. **Post-logout redirect** — `req.query.return` in logout is passed as `post_logout_redirect_uri` to Azure AD. Azure AD validates this against the app registration's configured URIs, so it's externally validated.

3. **`loadHostGroups` per-request DB read** — Queries all SSO-enabled hosts on every verify request. For typical NPM scales (< 500 hosts), this is sub-millisecond on SQLite. A TTL cache would help at scale, but not needed for V1.

---

## Phase 3: EVALUATE

### Checklist Results

**Project Structure:** ✅ All clear
- [x] Clean separation of concerns (7 focused modules)
- [x] Tests in `tests/` directory
- [x] No hardcoded secrets (env vars + DB)
- [x] README documents everything

**Code Style & Naming:** ✅ All clear
- [x] Consistent ESM imports throughout
- [x] Descriptive names: `validateReturnUrl`, `isGroupMember`, `loadHostGroups`, `getSessionSecret`
- [x] Boolean functions prefixed: `isConfigured`, `isGroupMember`
- [x] Constants: `PORT`, `HOST`, `DB_PATH`, `BASE_SCOPES`
- [x] No dead code or commented-out blocks

**Error Handling:** ✅ All clear
- [x] DB errors caught with `console.error` and safe fallbacks
- [x] MSAL errors → 500 with generic message (no leak)
- [x] Graph API failure → empty groups → fail-closed
- [x] Session regeneration failure handled explicitly
- [x] Config reload failure silently ignored (sidecar may not be running)
- [x] Invalid URLs rejected to "/"

**Testing:** ✅ Solid
- [x] 50 test cases across 3 modules
- [x] Zero external dependencies (node:test)
- [x] Isolated: no DB, no network, no mocking needed
- [x] Descriptive test names (`"rejects domain suffix attack"`)
- [x] Edge cases: null, undefined, empty, malicious, performance
- [ ] No integration tests (acceptable for V1, recommended for V2)

**Documentation:** ✅ Comprehensive
- [x] Architecture diagram with data flow
- [x] Endpoint table with auth requirements
- [x] Configuration reference (all setting IDs)
- [x] Security notes (5 sections)
- [x] Troubleshooting table (6 common issues)
- [x] HTTPS requirement shown in UI (info alert)
- [x] File tree in README

**Security:** ✅ All clear
- [x] No hardcoded secrets
- [x] Parameterized queries
- [x] Return URL validation
- [x] Rate limiting
- [x] Session fixation protection
- [x] Internal endpoints blocked
- [x] CSRF state on OAuth flow

**Performance:** ✅ All clear
- [x] Bulk generation: 1 SSO query instead of N
- [x] isGroupMember: Set for O(1) lookups
- [x] Session store: WAL mode, prepared statements
- [x] Auto-prune expired sessions every 15 min

### AI Slop Detection: Clean
- No generic naming (`handleData`, `processItem`)
- No buzzword comments ("robust", "scalable", "enterprise-grade")
- No over-abstraction (no factory of factories)
- No cookie-cutter docstrings (docs where useful, not everywhere)
- No orphan code (everything imported is used)
- Comments explain WHY not WHAT

---

## Phase 4: REPORT

### Overall Grade: A-

**One-line verdict:** Clean, secure, well-tested SSO implementation that addresses all previous audit findings. The A- (vs A) is for three "V2 wishlist" items, none of which are production blockers.

---

### ✅ What's Good

1. **Security posture is solid.** Session fixation, open redirect, CSRF, rate limiting, internal endpoint blocking — all handled correctly with defense in depth.

2. **Module separation is clean.** Each file has one job. validation.js (45 lines), parse-groups.js (17 lines), group-check.js (40 lines) — small, focused, testable.

3. **Tests are meaningful.** 50 tests covering security boundaries, edge cases, and performance. They test the right things — not just happy paths.

4. **Documentation is comprehensive.** The README tells you everything: architecture, endpoints, config, security notes, troubleshooting. The HTTPS note in the UI prevents misconfigurations.

5. **nginx integration is correct.** SSO promise resolves before location rendering, SSO vars copied to locations, _sso.conf included in both default and custom locations.

6. **Bulk optimization matters.** Prefetching SSO settings once instead of N times in `bulkGenerateConfigs` shows awareness of the cascade performance path.

7. **Fail-closed on Graph API failure.** The secure default: users with group restrictions are denied if Graph is unreachable. Documented with workaround.

---

### 🔧 V2 Wishlist (Not Blocking A-)

| # | Item | Rationale |
|---|------|-----------|
| W1 | POST for logout | More correct than GET, but requires form/JS. Low-severity CSRF. |
| W2 | Integration tests | Unit tests are good; end-to-end flow testing with mocked Azure AD would catch wiring issues. |
| W3 | `loadHostGroups` caching | Per-request DB read is fine for V1 scales, but a 30s TTL cache would help at 1000+ hosts. |

---

### 📊 Improvement from Initial Audit

| Finding | Initial Status | Current Status |
|---------|---------------|----------------|
| C1: Session fixation | 🔴 Critical | ✅ Fixed |
| C2: Exposed admin endpoints | 🔴 Critical | ✅ Fixed |
| C3: 7× cascade per save | 🔴 Critical | ✅ Fixed |
| I1: Custom locations bypass SSO | 🟡 Important | ✅ Fixed |
| I2: No rate limiting | 🟡 Important | ✅ Fixed |
| I3: Zero tests | 🟡 Important | ✅ Fixed (50 tests) |
| I4: Graph API failure behavior | 🟡 Important | ✅ Documented |
| R1: GET logout CSRF | 🔵 Improvement | ✅ Documented |
| R2: HTTPS requirement | 🔵 Improvement | ✅ UI alert |
| R3: No README | 🔵 Improvement | ✅ Comprehensive |
| R4: Return URL lost on regenerate | 🔵 Improvement | ✅ Fixed |
| R5: SSO query per config | 🔵 Improvement | ✅ Prefetch optimization |

**All 12 findings addressed. Grade improved from C+ to A-.**
