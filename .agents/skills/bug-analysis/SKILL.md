---
name: "bug-analysis"
description: "Analyze a bug/issue in the codebase using parallel subagents, trace the full flow, and list exact root causes with file:line references. Updates docs/learnings with findings."
metadata:
  author: "project"
  source: ".agents/skills/bug-analysis/SKILL.md"
---

## User Input

```text
$ARGUMENTS
```

The user provides:
1. **Issue description** — what is broken, where it's observed (e.g., "preview link doesn't open", "X button does nothing")
2. **Relevant logs** — error messages, console output, stack traces
3. **Where the issue occurs** — which screen, component, flow

## Anti-Hallucination Rules (MUST FOLLOW)

- **NEVER claim an issue exists without reading the actual source file** — you must read the current file contents from disk, not rely on memory or prior context.
- **Every finding MUST include** the exact file path + line number(s) where the problem exists.
- **EVERY finding MUST be cross-verified** by at least 2 independent subagents looking at the issue from different angles before it's listed.
- **Correlation ≠ causation** — if the logs show symptom X, trace the data flow backwards to find the actual root cause. Do NOT assume the log line is the bug.
- **"It works on my machine" is not an answer** — you must find the code-level defect even if it appears intermittent.
- **If you cannot find the exact root cause with high confidence after thorough investigation, state "unable to determine"** rather than guessing. Zero findings is better than hallucinated findings.
- **Always check whether the user says they made fixes** — if they mention fixes were attempted, compare the current file against expected fixes to see if they were applied correctly.

## Execution Steps

### Step 1: Parse User Input

Extract from the user message:
- `ISSUE_DESCRIPTION`: What the user says is broken
- `LOGS`: Any logs/errors provided
- `SURFACE_AREA`: Where the user observes the problem (screen, component, API)

### Step 2: Surface Area Mapping

Map the user's description to code locations:
1. Search the codebase for keywords from the issue description (component names, error messages, log prefixes)
2. Search for all files that could be in the data/event flow
3. Identify the entry point, the handler, and the output/rendering point
4. Build a **preliminary flow map** of files involved

### Step 3: Deploy Parallel Subagents (MANDATORY)

Launch **at least 3 subagents** simultaneously, each analyzing from a different perspective:

**Subagent A — Data/Event Flow Tracer:**
- Trace the full event flow from trigger (user action / system event) → handler → response
- Map every file and line number in the chain
- Identify where data is lost, misrouted, or incorrectly transformed
- Look for: wrong event names, missing payload fields, early returns, swallowed errors

**Subagent B — State & Lifecycle Analyst:**
- Examine component state management, React hooks dependencies, effect cleanup
- Look for: stale closures, missing cleanup functions, wrong dependency arrays, race conditions, improper useRef vs useState
- Check socket event registration/cleanup patterns
- Look for: listener leaks, missing off(), double registrations

**Subagent C — Config & Environment Auditor:**
- Check configuration files, environment variables, platform-specific settings
- Look for: missing whitelist entries (URL schemes, permissions), wrong paths, missing API keys, incorrect ports
- Verify config files against what the code expects

**Additional subagents if needed:**
- **Subagent D — Network/API Flow Analyst**: If the issue involves network requests, trace the full HTTP/WebSocket request-response cycle, check error handling, retry logic
- **Subagent E — Concurrency/Timing Analyst**: If the issue involves async operations, timers, sockets, look for race conditions, ordering bugs

Each subagent MUST:
1. Read the actual files from disk (not from memory)
2. Return findings with exact file paths and line numbers
3. State confidence level for each finding (HIGH / MEDIUM / LOW)
4. If the finding cannot be confirmed by reading code, mark it as UNVERIFIED

### Step 4: Cross-Verification and Consolidation

When all subagents return:

1. Compare findings across agents — **only findings confirmed by ≥2 agents** are listed as HIGH confidence
2. Single-agent findings are listed as MEDIUM/LOW with note "not cross-verified"
3. Eliminate duplicate findings
4. For each final finding, explicitly note:
   - What the code currently does (the bug)
   - What it should do (the fix)
   - The file and line number
   - Which events/data flow it affects

### Step 5: Check for Previous Attempted Fixes

1. Check `docs/learnings/` for any existing files related to the issue
2. Check git log for recent commits related to the issue
3. If the user says fixes were attempted, read the current code to verify if the fix was applied correctly
4. If a previous fix was incomplete or incorrect, add that as a separate finding

### Step 6: Output Findings Report

Output a structured report:

```
## Bug Analysis Report

### Summary
{one-line description of what's broken}

### Flow Trace
{data/event flow from trigger to symptom, with file:line for each step}

### Root Causes

| # | Severity | File | Line(s) | Bug | Fix | Cross-Verified |
|---|----------|------|---------|-----|-----|----------------|
| 1 | HIGH | src/foo.ts | 42-45 | {current broken code} | {correct code} | ✅ A+B |

### Symptoms Explained
{for each bug, explain how it produces the observed symptom}

### What Was Checked
- Data flow trace: {files checked}
- State management: {files checked}
- Config/Platform: {files checked}
- Network/API: {files checked}

### Confidence Assessment
- HIGH confidence findings: {count} (cross-verified by ≥2 agents)
- MEDIUM confidence findings: {count} (single-agent, or partial verification)
- LOW confidence findings: {count} (speculative)
```

### Step 7: Update docs/learnings

1. Read existing files in `docs/learnings/` to check if a file already covers this issue domain
2. If a relevant file exists, append to it (add `## ` section for this issue)
3. If no relevant file exists, create a new file named after the issue domain (e.g., `docs/learnings/preview-flow.md`)
4. Each entry MUST include:
   - Root cause description
   - File paths and line numbers
   - What the fix was
   - Key lesson to prevent recurrence

### Step 8: Offer Next Steps

After the report, ask:
- "Would you like me to create a plan to fix these issues?"
- "Would you like me to fix them directly?"

## Operating Principles

### Anti-Hallucination

- **Read don't remember** — always read the actual file before reporting on it
- **Cross-verify** — no finding is final until ≥2 agents confirm it
- **Show your work** — every finding must trace the evidence chain: symptom → code path → root cause
- **Be honest about uncertainty** — if evidence is ambiguous, say so

### Context Efficiency

- Limit subagents to investigating specific files/areas, not the whole codebase
- Each subagent should have a focused scope
- Use progressive disclosure — start with global search, then narrow to specific files

### Deterministic Analysis

- The same issue + same codebase should produce the same findings
- Findings are based on code structure, not behavior observation
- No "maybe" or "could be" — either the code has the defect or it doesn't
