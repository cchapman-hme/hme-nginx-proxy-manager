---
name: code-review
description: Use when performing a full code review, reviewing a PR, auditing a codebase for quality, or when asked to review code for bugs, security, performance, best practices, and AI slop
---

# Code Review

## Overview

A comprehensive code review combining deep analysis (rubber duck), ruthless critique (be-a-shithead), and best practices evaluation into a single structured process.

**Core principle:** Review code like you're the last line of defense before production. Understand it deeply, critique it honestly, verify it meets standards, then deliver actionable feedback.

## When to Use

- Reviewing a PR or set of changes
- Auditing existing code for quality and security
- Pre-merge review of a feature branch
- User asks to "review this code" or "find bugs"
- Post-implementation quality gate

**When NOT to use:**
- Writing new code (use brainstorming + writing-plans)
- Fixing a specific bug (use systematic-debugging)
- Quick style/format check only (use a linter)

## The Four Phases

```
┌─────────────────────────────────────────────────┐
│                  CODE REVIEW                     │
├─────────────────────────────────────────────────┤
│                                                  │
│  Phase 1: UNDERSTAND (Rubber Duck)               │
│  → Explain the code like teaching a junior dev   │
│  → Surface hidden assumptions                    │
│  → Identify what you CAN'T explain               │
│                                                  │
│  Phase 2: ATTACK (Be a Shithead)                 │
│  → Think like a malicious user                   │
│  → Try to break every assumption                 │
│  → Hunt for security, reliability, perf issues   │
│                                                  │
│  Phase 3: EVALUATE (Best Practices)              │
│  → Check structure, naming, conventions          │
│  → Detect AI slop patterns                       │
│  → Verify error handling, testing, docs          │
│                                                  │
│  Phase 4: REPORT (Deliver Verdict)               │
│  → Grade the code                                │
│  → Prioritize fixes (critical → nice-to-have)    │
│  → Provide specific, actionable fixes            │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: UNDERSTAND (Rubber Duck)

Explain the code as if teaching someone on their first day. If you can't explain it, that's where bugs hide.

**For each significant code segment:**

1. **Plain English summary** — What is this supposed to do?
2. **Step-by-step walkthrough** — What does each part actually do?
3. **Data flow trace** — Follow data from entry to exit. Where could it be corrupted, lost, or leaked?
4. **Assumptions & dependencies** — What MUST be true for this to work?
5. **Questions you can't answer** — These are bugs waiting to happen.

**The uncomfortable questions:**
- "What happens if that's null?"
- "Could a user break this?"
- "What if this runs 10,000 times per second?"
- "Why did you assume that would always be true?"
- "What happens if the network is down?"
- "What if two requests hit this at the same time?"

### Code-Type Specific Questions

**API Endpoints:**
- Malformed JSON? Missing fields? 1000 requests/sec?
- SQL/NoSQL/command injection possible?
- Auth token expired but not detected?
- IDOR — can users access other users' data by changing IDs?
- What does the error response leak?

**Database Queries:**
- 0 rows? 1 row? 1 million rows? Using indexes?
- N+1 query territory? Table scan?
- What locks does this acquire? Deadlock possible?
- Foreign key deleted between queries?
- Transaction timeout — what's left in bad state?

**Async/Promise Code:**
- What if the promise rejects? Unhandled rejection?
- Execution order guaranteed?
- Memory leaks from closures or event listeners?
- What if state changes while awaiting?
- Zombie callbacks after component unmounts?

**UI/Components:**
- Props change while rendering? Infinite re-render loop?
- User clicks button 10 times in 1 second?
- API returns error or empty — what does user see?
- Event listeners cleaned up on unmount?
- Accessible to keyboard and screen reader users?

**Auth/Authorization:**
- Session expires mid-request?
- Privilege escalation possible?
- Passwords/secrets logged anywhere?
- Timing attacks reveal valid usernames?
- Permissions change while user is logged in?

**Background/Batch Jobs:**
- Runs twice simultaneously — safe?
- Crashes halfway — what's the state?
- Processes more data than expected?
- How do you know it succeeded or failed?
- Idempotent? Can safely retry?

**Config/Infrastructure:**
- Wrong config value — what breaks?
- Command injection via environment variables?
- Works across dev/staging/prod?
- Secrets available? What if they're not?
- Typo could bring down production?

---

## Phase 2: ATTACK (Be a Shithead)

Think like a malicious user, a hostile network, and a production system having its worst day — all at once.

### Attacker Mindset

**Input Attacks:**
- SQL Injection: `userId=1' OR '1'='1`
- Path Traversal: `filename=../../etc/passwd`
- XSS: `username=<script>alert(1)</script>`
- Command Injection: `file.exec(userInput)`
- NoSQL Injection: `{$where: "malicious JS"}`
- ReDoS: Regex with catastrophic backtracking on user input

**Auth/Authz Bypass:**
- Access admin endpoints without auth?
- Manipulate userId to access other users' data?
- Send expired/forged tokens?
- Client-side-only permission checks?

**Data Integrity Attacks:**
- Race condition on concurrent requests to same resource?
- Create duplicates by exploiting timing?
- Delete something mid-transaction?
- Break referential integrity?

**DOS Attacks:**
- No rate limiting → 10k requests/sec?
- Trigger expensive operation → exhaust resources?
- File upload → fill disk?
- Unbounded query → exhaust memory?

### Red Flags to Hunt

| Category | What to Look For |
|----------|-----------------|
| **Trust** | User input trusted without validation. External API responses not checked. Database data assumed non-null. |
| **State** | Race conditions. Stale cached data. Orphaned state from failed cleanup. Implicit order-of-operations dependencies. |
| **Resources** | Uncleaned listeners/timers/subscriptions. Unreleased connections/file handles. Possible deadlocks. No timeouts. |
| **Errors** | Unhandled exceptions. Errors caught and ignored. Errors logged then continued as if nothing happened. Cascading failures. |
| **Performance** | N+1 queries. Unbounded list/log/queue growth. Blocking synchronous calls. Missing indexes. Full table scans. |
| **Security** | Injection vectors. Client-side-only auth. Secrets in logs/errors/URLs. IDOR vulnerabilities. CORS `*` in production. |

---

## Phase 3: EVALUATE (Best Practices)

Systematic check against industry standards and language conventions.

### Checklist

**Project Structure:**
- [ ] Follows language/framework directory conventions
- [ ] Separation of concerns (business logic, data, UI, config)
- [ ] Consistent file naming conventions
- [ ] Config separate for dev/staging/prod — no hardcoded secrets

**Code Style & Naming:**
- [ ] Consistent indentation and formatting
- [ ] Descriptive variable/function/class names (not `handleData`, `temp`, `var1`)
- [ ] Functions use verb-based names (`getUserById`, not `user`)
- [ ] Constants properly cased (SCREAMING_SNAKE_CASE or language convention)
- [ ] Booleans prefixed with is/has/can/should

**Error Handling:**
- [ ] Input validated before use
- [ ] Specific exception types caught (not bare `except:` or `catch {}`)
- [ ] Error messages are descriptive and actionable
- [ ] Resources cleaned up in finally/defer/context managers
- [ ] Errors logged with appropriate levels and context

**Testing:**
- [ ] Critical paths and edge cases covered
- [ ] Tests are isolated (don't depend on each other or external state)
- [ ] Descriptive test names (`test_should_reject_invalid_email`)
- [ ] Clear Arrange-Act-Assert structure
- [ ] External dependencies mocked

**Documentation:**
- [ ] Public APIs documented
- [ ] Comments explain WHY, not WHAT
- [ ] No commented-out dead code (use version control)
- [ ] TODOs include ticket numbers or context
- [ ] README gets someone running in under 5 minutes

**Security:**
- [ ] No hardcoded secrets (use env vars or secret manager)
- [ ] Parameterized queries (no string interpolation in SQL)
- [ ] User input sanitized before rendering (XSS prevention)
- [ ] Passwords stored with proper hashing (bcrypt 12+)
- [ ] Dependencies reasonably up to date

**Performance:**
- [ ] Appropriate data structures (set for membership, not list)
- [ ] No N+1 queries
- [ ] Pagination for large datasets
- [ ] Async for I/O-bound operations where framework supports it
- [ ] Streams/generators for large data (not loading everything into memory)

### AI Slop Detection

Code that screams "generated and not reviewed":

| Signal | Why It's Slop | Fix |
|--------|--------------|-----|
| Generic naming (`handleData`, `processItem`, `utils.ts` with 47 functions) | Nobody thought about what this does | Name for what it DOES: `calculateOrderTotal` |
| Comments restating code (`// increment counter` above `counter++`) | Adds noise, not value | Comments explain WHY, not WHAT |
| Over-abstraction (`AbstractFactoryProviderManager` for a TODO app) | Complexity theater | YAGNI. Delete until it hurts. |
| Identical comment/docstring structure across all functions | Cookie-cutter generation | Docstrings where useful, not everywhere |
| Overly verbose variables (`user_input_data_to_be_validated_and_returned`) | Unnatural | `user_input` is fine |
| Perfect but impractical (every function docstring'd, excessive type hints on obvious types) | Real code has some messiness | Remove noise, keep substance |
| Generic error handling everywhere (`catch(e) { console.log("An error occurred: " + e) }`) | Same pattern whether it's a login or a file read | Specific error types, specific handling |
| Copy-paste with minor variations | Same bug in 5 places | Extract to function |
| Orphan code (defined but never called) | Never cleaned up | Delete it. Git remembers. |
| Buzzword comments ("robust and scalable solution", "industry standard", "enterprise-grade") | Says nothing | Describe what it actually does |

---

## Phase 4: REPORT

### Output Format

```markdown
## 🔍 Code Review: `[filename or scope]`

**Overall Grade: [A-F]** — [One-line verdict]

| Grade | Meaning |
|-------|---------|
| A | Clean, idiomatic, handles edge cases. Suspicious that a human wrote this. |
| B | Minor issues. Author clearly tried. |
| C | Works but needs improvement before production. |
| D | Functional by accident. Held together by prayers. |
| F | War crime against computing. |

---

### 🚨 Critical (Fix Before Merge)
Security vulnerabilities, data loss risks, crashes.
Each item: Location → Problem → Impact → Fix

### ⚠️ Important (Fix Before Next Release)
Missing validation, unhandled errors, race conditions, performance bombs.
Each item: Location → Problem → Impact → Fix

### 💀 AI Slop Detected
Generic names, cookie-cutter patterns, orphan code, buzzword comments.
Each item: Location → What's wrong → Fix

### 🔧 Improvements (Should Fix)
Best practice violations, naming issues, missing tests, documentation gaps.
Each item: Location → Problem → Recommendation

### ✅ What's Good
Positive observations worth maintaining.

### 📝 Prioritized Fix List
1. [ ] [Most critical]
2. [ ] [Second priority]
3. [ ] ...

### 🧪 Test Cases Needed
Specific tests that would catch the identified issues.
```

### Detailed Line-by-Line (Optional)

For critical issues or when requested, provide line-by-line breakdown:

```markdown
### Line X-Y
```[language]
// The offending code
```
**Problem:** [Technical explanation]
**Impact:** [What breaks]
**Fix:** [Corrected code or approach]
```

---

## Scaling the Review

| Context | Depth |
|---------|-------|
| Quick PR review | Phase 2 (Attack) + Phase 4 (Report) — focus on security and correctness |
| Standard review | All four phases, checklist-based |
| Detailed audit | All four phases with line-by-line destruction on critical files |
| Learning context | Phase 1 (Understand) emphasis, teach rather than roast |

---

## Rules of Engagement

1. **Be accurate** — Every criticism must be technically correct. Being wrong undermines the entire review.
2. **Be specific** — Point to exact files and lines. "This is bad" is useless. "Line 47 trusts user input in SQL query" is actionable.
3. **Be proportional** — Grade on actual severity. A typo isn't an F.
4. **Be constructive** — Every issue gets a fix. That's the deal.
5. **Insult the code, not the coder** — "This function is a mess" not "You're a mess."
6. **Acknowledge what's good** — Positive reinforcement matters. Mention strengths.
7. **Prioritize** — Not everything needs fixing immediately. Critical > Important > Improvement.
8. **Be honest about uncertainty** — "This looks suspicious but I'd need to see X to confirm."

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Skipping Phase 1 (jumping to critique without understanding) | You can't find bugs in code you don't understand. Always explain first. |
| Only checking happy path | Explicitly test: null, empty, huge, concurrent, malicious, offline. |
| Style nitpicking instead of substance | Focus on what breaks, not what's ugly. |
| Missing the architecture for the trees | Step back — is the overall design sound? |
| Ignoring the positive | Developers who feel attacked stop listening. Note strengths. |
| Vague feedback ("needs improvement") | Specific location, specific problem, specific fix. |
| Assuming all AI suggestions are slop | Some generated code is fine. Judge by quality, not origin. |
| Not checking for IDOR/injection on every endpoint | These are the bugs that get you on the news. Check every time. |
