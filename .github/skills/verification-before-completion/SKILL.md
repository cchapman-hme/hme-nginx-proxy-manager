---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## Architectural Review Checklist (MANDATORY for feature completion)

When verifying completion of a feature, batch, or implementation plan — not just individual tasks — run this checklist in addition to the standard test/build verification above.

**This catches the class of bugs that pass unit tests but break in production.**

### Resource Lifecycle
- [ ] Every client/connection/session created has an explicit close/cleanup
- [ ] Cleanup happens in shutdown hooks, context managers, or finally blocks
- [ ] What happens if cleanup itself fails? (Logged? Retried? Ignored safely?)

### Async/Sync Boundaries
- [ ] No synchronous I/O (file reads, network calls) inside async functions
- [ ] All coroutines are awaited (no fire-and-forget without explicit reason)
- [ ] Blocking operations use `run_in_executor` or equivalent

### Dependency Audit
- [ ] Every `import` in source code has a corresponding entry in requirements/pyproject/package.json
- [ ] Every `import` in test code has a corresponding entry in dev/test dependencies
- [ ] A clean `pip install` from requirements would actually work

### Config Consistency
- [ ] Docker volume mounts (`:ro` vs `:rw`) match what the app actually needs to write
- [ ] Environment variables referenced in code are defined in .env/.env.example/docker-compose
- [ ] Port mappings in Docker match what the app binds to
- [ ] Python version in Dockerfile matches what CI/dev environment uses

### UI Wiring (if applicable)
- [ ] Every button has a working handler
- [ ] Every link navigates somewhere real
- [ ] Every form submits to an endpoint that exists
- [ ] Loading and error states are visible, not just happy path

### Integration Points
- [ ] Components that were built separately actually connect to each other
- [ ] API routes are registered in the app
- [ ] Database tables/models are created by migrations or init
- [ ] Scheduled tasks are actually scheduled, not just defined

**If any checklist item fails:** Fix before claiming completion. The checklist IS the verification — "tests pass" alone is not sufficient for feature-level completion claims.

---

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
