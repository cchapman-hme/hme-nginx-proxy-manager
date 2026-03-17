---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## The Process

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**
- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## Design Attack Gate (MANDATORY)

**Before saving the design, attack it.** This gate prevents architectural contradictions, resource lifecycle gaps, and config conflicts from surviving into implementation plans.

**Run these four lenses on the design document:**

### 1. Rubber-Duck the Design
Explain the design as if teaching a junior dev. For each component:
- "What happens when this resource is created? When is it destroyed?"
- "What if this service is down? What's the fallback?"
- "Can you trace data from entry to exit without gaps?"
- Flag anything you can't explain clearly — that's where bugs hide.

### 2. Attack the Design (Be-a-Shithead)
Think like a hostile operator, a flaky network, and a production system on its worst day:
- **Config contradictions** — "Does this config setting conflict with that one?" (e.g., read-only volume + write-back requirement)
- **Resource lifecycle** — "Who creates this? Who cleans it up? What if cleanup fails?"
- **Concurrency** — "What if two instances run simultaneously?"
- **Failure cascades** — "If component A fails, what happens to B, C, D?"

### 3. Best Practices Check
- Does the architecture follow separation of concerns?
- Are async/sync boundaries clean? (No sync I/O in async contexts)
- Are all external dependencies explicitly listed?
- Is the deployment config consistent with the application config?

### 4. Verdict
- If issues found: **Fix the design document before continuing.** Present fixes for approval.
- If clean: Note "Design attack passed — no architectural contradictions found."

---

## After the Design

**Documentation:**
- Write the validated (and attack-reviewed) design to `docs/plans/YYYY-MM-DD-<topic>-design.md`
- Commit the design document to git

**Implementation (if continuing):**
- Ask: "Ready to set up for implementation?"
- Use superpowers:using-git-worktrees to create isolated workspace
- Use superpowers:writing-plans to create detailed implementation plan

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense
