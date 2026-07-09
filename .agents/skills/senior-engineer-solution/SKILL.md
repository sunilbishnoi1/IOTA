---
name: "senior-engineer-solution"
description: "Deeply analyze a problem or feature request in the context of the full codebase and produce an expert-level solution approach with architecture, trade-offs, and implementation plan."
metadata:
  author: "project"
  source: ".agents/skills/senior-engineer-solution/SKILL.md"
---

## User Input

```text
$ARGUMENTS
```

The user provides:
1. **Problem or feature description** — what needs to be solved or built, observed behavior vs. desired behavior
2. **Constraints** — e.g., "must be backwards compatible", "perf critical path", "must work offline"
3. **Related context** — which screens, flows, or systems are involved (if known)

## Anti-Hallucination Rules (MUST FOLLOW)

- **NEVER propose a solution without reading the actual code it touches** — you must read relevant source files from disk before designing anything.
- **Every recommendation MUST reference** the exact file path + line number(s) it affects.
- **"Industry best practice" is not sufficient** — the solution must account for the actual codebase patterns, existing abstractions, and conventions. Verify those by reading the codebase first.
- **If you encounter a pattern you don't fully understand, read more files until you do** — do not guess how something works.
- **Prefer proven patterns already in the codebase** over introducing new frameworks or paradigms, unless the problem demonstrably requires it.
- **Always check for existing solutions** — search the codebase for similar features, utility functions, or abstractions before proposing new ones.
- **Check `docs/learnings/`** — do not repeat past mistakes documented there.
- **Cross-verify all critical assumptions** by reading the actual files — if you think "X module handles Y", confirm by reading X's source.

## Execution Steps

### Step 1: Deep Problem Understanding

1. **Read `docs/learnings/`** — check if any past issues relate to this domain and what was learned.
2. **Read recent specs** — check `specs/` for any active or recent specs that touch on this area (especially `specs/*/plan.md` and `specs/*/tasks.md`).
3. **Explore the surface area:**
   - Search the codebase for all files referenced in the problem description
   - Follow imports/data flows to build a map of affected components, services, and data models
   - Read the actual source files (not from memory)
4. **Identify all stakeholders:**
   - Which services/modules are involved?
   - Which data stores (DB, KV, cache, local state)?
   - Which user-facing screens/APIs?
   - Which integration points (external APIs, WebSockets, file system)?

**Output:** A `## Problem Map` section with:
- Affected files and their roles (numbered, with file:line)
- Data/control flow diagram (text-based)
- Identified gaps with the current implementation

### Step 2: Requirements Definition

Clarify what success looks like:

1. **Functional requirements** — what must the solution do?
2. **Non-functional requirements** — perf, security, reliability, observability, dev experience
3. **Boundaries** — what is explicitly NOT in scope (to keep the solution focused)
4. **Acceptance criteria** — how will we verify the solution works?

**Output:** A `## Requirements` section with clear bullet points.

### Step 3: Research & Alternatives

For non-trivial problems, before locking in an approach:

1. **Search the existing codebase** for prior art — similar patterns already solved
2. **Use web search** to research best practices, library options, or architecture patterns
3. **Use web fetch** to read official docs for any proposed dependencies
4. **Check npm/GitHub** for library health, maintenance status, bundle size if relevant
5. **Evaluate at least 2-3 alternative approaches** before choosing one

**Output:** A `## Research` section with findings and an `## Alternatives Considered` section with trade-off analysis.

### Step 4: Solution Design

Design the solution with these sub-steps:

#### 4a. Architecture & Flow

- Describe the high-level architecture (components, data flow, boundaries)
- Include a text-based diagram showing how data moves through the system
- Specify which new files/functions are needed vs. which existing ones change

#### 4b. Data Model Changes

- Any new types, interfaces, schemas, DB migrations
- Any changes to existing models

#### 4c. API / Interface Contract

- If this touches a service boundary, define the exact contract
- Request/response shapes, error codes, event payloads

#### 4d. Implementation Strategy

- Order of implementation (dependencies between changes)
- Riskiest part first principle — tackle the hardest change early to validate approach
- Migration strategy if needed (e.g., feature flag, gradual rollout, backwards compatibility)

#### 4e. Error Handling & Edge Cases

- What can go wrong at each step?
- How does the system degrade gracefully?
- What is the fallback behavior?

#### 4f. Security & Privacy

- Are there auth/authz implications?
- Is user data handled correctly?
- Are there injection risks or untrusted input?

#### 4g. Testing Strategy

- What unit tests are needed?
- What integration/e2e tests?
- What manual testing is required?

#### 4h. Observability

- Logging: what should be logged at what level?
- Metrics: what should be measured?
- Alerts: what conditions warrant paging?

**Output:** A comprehensive `## Solution Design` section with all sub-sections above.

### Step 5: Implementation Plan

Break the solution into concrete, ordered tasks:

1. Tasks are ordered by dependency (what must be built first)
2. Each task includes: file paths, what changes, approximate complexity (S/M/L/XL)
3. Risks and unknowns are called out explicitly

**Output:** A `## Implementation Plan` section with a task table.

### Step 6: Review Against Codebase Patterns

Before finalizing:

1. Re-read critical files to verify: *does the proposed solution actually integrate cleanly with the existing code?*
2. Check that naming conventions, error handling patterns, and coding style match the codebase
3. Verify the solution doesn't break existing tests (check test files for affected areas)
4. If there are integration points, verify the contracts match existing usage

**Output:** A `## Codebase Fit Check` section noting any integration concerns.

### Step 7: Final Summary

A concise summary the user can use to decide next steps:

```
## Decision Ready Summary

### Chosen Approach
{one-line summary of the chosen approach}

### Why This Approach
{2-3 sentences explaining why this was chosen over alternatives}

### Key Trade-offs
- {trade-off 1}
- {trade-off 2}

### Risk Areas
- {highest risk item}
- {biggest unknown}

### Estimated Effort
{rough estimate: days/weeks, or S/M/L/XL}

```

## Operating Principles

### Context-First Design

- The codebase's existing patterns are the number-one constraint — a perfect solution that requires rewriting half the system is rarely the right answer
- Read before you write — every design decision must be grounded in actual code, not assumptions
- Follow the principle of least surprise — the solution should feel natural to developers who know the codebase

### Evidence-Based Decision Making

- Every trade-off must be stated explicitly with rationale
- "Because it's clean" is not a reason — "Because it removes an existing footgun (docs/learnings/foo.md)" is
- When choosing between alternatives, use a decision matrix if there are 3+ options

### Bias Toward Action

- The output should be an actionable plan, not a philosophy essay
- If something is uncertain, call it out explicitly and propose a spike/prototype to de-risk it
- Favor incremental improvement over big-bang rewrites

### Rigor Without Paralysis

- Not every solution needs subagent parallelism — use your judgment on complexity
- For simple changes (single file, well-understood pattern), Steps 3-4 can be lightweight
- For cross-cutting concerns or high-risk changes, execute the full workflow

### Code Quality Gates

Before signing off on any solution, verify:
1. **Type safety** — no `any`, no unsafe casts, no `@ts-ignore`
2. **Error handling** — every rejection path is accounted for
3. **Testability** — the design makes it possible to write meaningful tests
4. **Observability** — failures produce actionable signals
5. **Backwards compatibility** — existing callers don't break
