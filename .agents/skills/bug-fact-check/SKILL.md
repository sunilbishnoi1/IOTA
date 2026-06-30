---
name: "bug-fact-check"
description: "Fact-check the output of the bug-analysis skill by independently verifying each finding against the actual codebase, web sources, and system knowledge. Rates each claim as TRUE, PARTIALLY TRUE, or FALSE with reasoning."
metadata:
  author: "project"
  source: ".agents/skills/bug-fact-check/SKILL.md"
---

## User Input

```text
$ARGUMENTS
```

The user provides:
1. **Bug Analysis Report** — the structured output from a bug-analysis skill run (or any structured bug report with file:line references and claimed root causes)
2. **Optionally**: the original issue description that was fed to bug-analysis

## Goal

Independently verify every factual claim made in the bug analysis report. For each finding, determine its veracity by reading the actual source code, checking referenced line numbers, and using web search/fetch for external dependencies or known issues. Output a structured fact-check verdict.

## Anti-Hallucination Rules (MUST FOLLOW)

- **Read don't remember** — you MUST read every referenced source file from disk. Never rely on memory or prior context for file contents.
- **Verify every line number** — for each claimed `file:line` reference, read the actual line and confirm the bug exists there.
- **No assumption of correctness** — the bug analysis report is presumed *guilty until proven innocent*. Every claim must be independently confirmed.
- **If the file path doesn't exist**, mark the finding as FALSE immediately.
- **If the line number doesn't match the bug description**, mark the finding as PARTIALLY TRUE or FALSE.
- **External dependencies** — use web search or web fetch to verify claims about third-party APIs, library behavior, platform docs, or known issues.
- **"Unable to verify" is a valid verdict** — if you cannot confirm or refute a claim after thorough investigation, state UNABLE TO VERIFY rather than guessing.

## Execution Steps

### Step 1: Parse the Bug Analysis Report

Extract all structured findings from the report:

- **Finding ID** (e.g., `#1`, `R1`)
- **Severity** (HIGH, MEDIUM, LOW)
- **File path** and **line number(s)**
- **Claimed bug** — what the code currently does wrong
- **Claimed fix** — what the code should do instead
- **Cross-verification status** (which subagents confirmed it)
- **Confidence assessment** from the report

Also extract any other factual claims:
- Flow trace steps (e.g., "event X flows from file A to file B")
- Symptoms explanations
- "What was checked" claims

### Step 2: Independent Verification Per Finding

For **each** finding, perform the following verification loop:

#### A. File Path & Line Number Verification
1. Check if the file path exists in the codebase
2. If it exists, read the specific lines referenced
3. Confirm the claimed buggy code is actually present at those lines
4. If the file doesn't exist or the lines don't match, flag immediately

#### B. Bug Existence Verification
1. Read surrounding context (at least ±15 lines around the claimed location)
2. Trace the data/control flow locally to confirm the bug is real
3. Check if the behavior described matches what the code actually does
4. Look for any conditions, guards, or error handling the report may have missed

#### C. Fix Correctness Verification
1. Verify the claimed fix actually resolves the bug
2. Check that the fix doesn't introduce new issues (side effects, type errors, logic breaks)
3. Confirm any referenced API/functions in the fix actually exist and work as described

#### D. Dependency & External Verification
1. For claims about external libraries, frameworks, or APIs: use **web search** or **web fetch** to verify behavior
2. For platform-specific claims (Android, iOS, browser): check official documentation
3. For claims about environment/config: read the actual config files and verify

### Step 3: Check docs/learnings for Context

1. Read all files in `docs/learnings/`
2. Cross-reference with findings — do the learnings support or contradict the bug report?
3. Note any previous fixes or attempted fixes related to the same issue

### Step 4: Output Fact-Check Report

Produce a structured report:

```
## Bug Analysis Fact-Check Report

### Summary
- Total findings in report: {N}
- TRUE: {count} — independently confirmed
- PARTIALLY TRUE: {count} — some aspects correct, some incorrect
- FALSE: {count} — demonstrably incorrect
- UNABLE TO VERIFY: {count} — insufficient evidence either way

### Detailed Verdicts

#### Finding #{id}: {severity} — {short description}
**Verdict**: TRUE / PARTIALLY TRUE / FALSE / UNABLE TO VERIFY

**Evidence**:
- Read `{file}:{line}` — {what the code actually says}
- {additional evidence from web search, docs, etc.}

**Discrepancy** (if any):
- Report claimed: {what report said}
- Actual: {what code actually does}
- {explanation of discrepancy}

**Fix Assessment**:
- Claimed fix: {fix from report}
- Verified: {YES / NO / PARTIALLY}
- Notes: {any issues with the fix}

---

#### Finding #{id}: ...
```

### Step 5: Overall Report Quality Assessment

After individual verdicts, provide a summary assessment of the bug analysis report's quality:

**Report Quality**:
- **Accuracy**: {percentage of TRUE findings}
- **Thoroughness**: {did the report miss important context? Were all relevant files checked?}
- **Fix Quality**: {are the proposed fixes sound?}
- **Hallucination Risk**: {LOW / MEDIUM / HIGH — based on number of FALSE findings}
- **Recommendation**: {should the report be trusted? Should specific findings be re-investigated?}

### Step 6: Update docs/learnings

If this fact-check uncovers significant errors in the bug-analysis that should be documented to prevent recurrence:

1. Append findings to the relevant `docs/learnings/*.md` file
2. If the error was a process failure (e.g., hallucinated line numbers), consider whether the bug-analysis skill itself needs updating

## Operating Principles

### Anti-Hallucination (Double-Strength)

- The fact-checker's #1 job is to catch hallucinations in the bug analysis
- Every line number must be READ, not assumed
- Every claimed behavior must be TRACED in the actual control flow
- If the report says "file X at line Y has bug Z", and line Y doesn't exist or is a comment, that's a FALSE
- If the report says "function foo is called with wrong args", verify by tracing the actual call site

### Verification Hierarchy

1. **Source code** (highest authority) — what the code actually says
2. **Official documentation** (web fetch) — for library/API behavior
3. **docs/learnings** — for historical context
4. **Web search** — for known issues, bug reports, changelogs
5. **Reasoning** — for logical deductions about control flow (lowest authority without code evidence)

### Context Efficiency

- Read only the lines needed to verify each finding, plus enough context (±15 lines) to understand the flow
- Batch file reads when multiple findings reference the same file
- Use web search/fetch only when necessary for external verification
- Progressive disclosure: start with exact lines, expand if ambiguous

### Independence

- Do NOT treat the bug analysis report as authoritative
- Form your own judgment based on the evidence you collect
- If a finding is TRUE but for the wrong reason, mark it PARTIALLY TRUE
- If a finding is FALSE but the bug does exist elsewhere in the file, note the discrepancy

## Context

$ARGUMENTS
