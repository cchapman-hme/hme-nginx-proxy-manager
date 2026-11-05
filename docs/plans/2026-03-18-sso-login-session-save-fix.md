# SSO Login Session Save Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent first-visit OAuth flows from failing with `Invalid OAuth state` by saving the SSO session before redirecting to the identity provider.

**Architecture:** Add a small SSO login helper that persists `oauthState`, `returnUrl`, and cookie-domain changes before issuing the login redirect. Cover the regression with a focused unit test, then wire the existing `/sso/login` route to use the helper.

**Tech Stack:** Node.js, `node:test`, Express session, existing SSO sidecar modules.

---

### Task 1: Add failing regression test

**Files:**
- Create: `backend/sso/tests/login-session.test.js`
- Test target: `backend/sso/login-session.js`

**Step 1: Write the failing test**
- Add a test asserting the login flow does not call `res.redirect()` until `req.session.save()` completes.
- Add a test asserting the helper stores `oauthState`, validated `returnUrl`, and cookie domain before saving.

**Step 2: Run test to verify it fails**
- Run: `npm test -- login-session.test.js`
- Expected: failure because `login-session.js` does not exist yet.

### Task 2: Implement minimal helper

**Files:**
- Create: `backend/sso/login-session.js`
- Modify: `backend/sso/server.js`

**Step 3: Write minimal implementation**
- Implement helper that mutates the session, calls `req.session.save(callback)`, and redirects only inside the callback.
- Keep existing return URL validation behavior.

**Step 4: Run tests to verify they pass**
- Run: `npm test -- login-session.test.js`
- Expected: pass.

### Task 3: Verify integration

**Files:**
- Modify: `backend/sso/server.js`

**Step 5: Update `/sso/login` to use the helper**
- Replace inline session mutation + immediate redirect with the helper.

**Step 6: Run targeted SSO tests**
- Run: `npm test`
- Expected: all SSO sidecar tests pass.

Plan review passed.
