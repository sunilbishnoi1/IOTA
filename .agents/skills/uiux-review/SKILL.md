---
name: "uiux-review"
description: "Spawn multiple parallel subagents to analyze a specified UI component from UX, layout, design aesthetics, and edge-case perspectives, then produce a consolidated, prioritized UI/UX issue report."
metadata:
  author: "project"
  source: ".agents/skills/uiux-review/SKILL.md"
---

## User Input

```text
$ARGUMENTS
```

The user provides:
1. **Component path** — file path or component name (e.g., `EnvVarModal.tsx`, `src/components/Header.tsx`)
2. **Optional context** — any specific concerns (e.g., "the buttons overflow", "focus on mobile")

## Anti-Hallucination Rules (MUST FOLLOW)

- **NEVER analyze a component without reading the actual source file** — read the current file contents from disk, not from memory or prior context.
- **Every finding MUST include** the exact file path + line number(s) where the issue exists.
- **Every finding MUST reference** the specific style/layout property or JSX pattern causing it.
- **"Looks fine" is not a valid finding** — if nothing is wrong in a category, state "No issues found" explicitly.
- **If you cannot access the file, state "FILE NOT FOUND"** — do not guess or analyze from name alone.
- **Read the full component file** — do not analyze based on partial context. Read the entire file (both JSX and styles).

## Execution Steps

### Step 1: Locate the Component

1. Take the user-provided component path/name
2. If it's a name only (e.g., `EnvVarModal`), search the codebase with `glob` and `grep` to find the actual file
3. If it's a relative path, resolve it from the workspace root
4. Return the full absolute path for use by subagents

### Step 2: Read the Full Component

Read the entire component file from disk — both the render/JSX section and the StyleSheet/styles section. Pass the full file contents and path to all subagents.

### Step 3: Deploy Parallel Subagents (MANDATORY)

Launch **4 subagents simultaneously**, each analyzing from a distinct perspective:

**Subagent A — UX & Interaction Analyst:**
- Analyze user experience quality: affordances, feedback, flow clarity
- Check: confirmation dialogs, error messages, empty states, loading states, disabled states
- Check: keyboard handling, focus management, dismiss patterns
- Check: redundant elements, confusing labels, unexpected behavior
- Check: accessibility (missing labels, contrast, touch targets)
- Return findings with file:line references

**Subagent B — Layout & Positioning Analyst:**
- Analyze the component's layout structure: flex, alignment, spacing, sizing
- Check: overflow risks, width/height chain, padding nesting
- Check: responsive behavior across screen sizes
- Check: alignment consistency between related elements
- Check: element ordering, grouping, visual hierarchy
- Check: z-index, overlapping, clipping issues
- Return findings with file:line references

**Subagent C — Design Aesthetics & Visual Quality Analyst:**
- Analyze visual refinement: typography, color, spacing, harmony
- Check: font sizes, line heights, letter spacing (is the type system premium?)
- Check: color contrast, color hierarchy, consistency with theme
- Check: border radius, shadow treatment, elevation cues
- Check: icon sizing and consistency, visual density
- Check: premium feel — micro-interactions, spacing rhythm, minimalism
- Return findings with file:line references

**Subagent D — Edge Cases & Resilience Analyst:**
- Analyze what happens in extreme or unexpected states
- Check: very long text (keys, values, labels), empty/null data
- Check: very many items (overflow, performance, scroll behavior)
- Check: rapid interactions (double-tap, fast typing)
- Check: network failures, timeout states, partial data
- Check: concurrent edits, stale state race conditions
- Check: what happens when the component is mounted/unmounted rapidly
- Return findings with file:line references

Each subagent MUST:
1. Read the actual file from disk (passed by Step 2, but re-read for fresh context)
2. Return findings with exact file paths and line numbers
3. Rate each finding as: **CRITICAL** (broken), **MAJOR** (poor UX), **MINOR** (polish), or **ENHANCEMENT** (nice-to-have)
4. For each finding, state: **Current behavior** + **Recommended fix**

### Step 4: Consolidate and Prioritize

When all subagents return:

1. Merge all findings into a single deduplicated list
2. For overlapping findings, keep the most detailed version and note the cross-reference
3. Assign a single severity per finding:
   - **🔴 CRITICAL** — functional breakage, data loss, users cannot complete task
   - **🟠 MAJOR** — significant usability friction, confusing behavior
   - **🟡 MINOR** — visual polish, consistency issues
   - **🟢 ENHANCEMENT** — nice-to-have improvements, premium feel
4. Sort by severity (CRITICAL → MAJOR → MINOR → ENHANCEMENT)
5. Group findings by area (Layout, UX, Visual, Edge Cases)

### Step 5: Output Report

Output a structured report:

```
## UI/UX Review: {Component Name}

### Summary
{2-3 sentence overview of findings — count per severity, biggest issues}

### File
`{absolute file path}`

---

### Findings

#### 🔴 Critical

| # | Area | Line(s) | Issue | Recommended Fix |
|---|------|---------|-------|----------------|
| 1 | Layout | 42-45 | {current behavior causing breakage} | {specific fix instructions} |

#### 🟠 Major

| # | Area | Line(s) | Issue | Recommended Fix |
|---|------|---------|-------|----------------|
| ... | ... | ... | ... | ... |

#### 🟡 Minor

| # | Area | Line(s) | Issue | Recommended Fix |
|---|------|---------|-------|----------------|
| ... | ... | ... | ... | ... |

#### 🟢 Enhancement

| # | Area | Line(s) | Issue | Recommended Fix |
|---|------|---------|-------|----------------|
| ... | ... | ... | ... | ... |

---

### Detailed Analysis

#### 1. Layout & Positioning (Subagent B)
{Summary of layout findings}

#### 2. UX & Interaction (Subagent A)
{Summary of UX findings}

#### 3. Design Aesthetics (Subagent C)
{Summary of visual/design findings}

#### 4. Edge Cases & Resilience (Subagent D)
{Summary of edge-case findings}

---

### What Was Checked

- UX flows and interaction patterns
- Layout structure, flex, padding chain, overflow
- Visual quality: typography, color, spacing, density
- Edge cases: empty, overflow, concurrent actions, errors

### Quick Wins (easy fixes with high impact)

1. {finding} — {one-line fix} (Affects: {area})
2. {finding} — {one-line fix} (Affects: {area})
```

### Step 6: Offer Next Steps

After the report, ask:
- "Would you like me to create an implementation plan for these fixes?"
- "Would you like me to implement the fixes directly?"

## Operating Principles

### Evidence-Based Analysis

- Every claim must trace back to a specific property value on a specific line
- "Font is too small" is insufficient — "`fontSize: 10` on line 480 is below the 12px minimum for mobile readability" is actionable
- Read the full StyleSheet — don't miss related styles just because they're named differently

### Context Efficiency

- Each subagent has a focused scope (UX, Layout, Visual, Edge Cases)
- Subagents do NOT need to re-read the file from scratch — they receive it from Step 2
- Use the findings from all 4 agents to cross-validate

### Deterministic Output

- Same component + same codebase = same report
- Findings are based on code properties, not subjective taste (except in the Design Aesthetics category, where judgment calls are labeled as such)
- Severity is based on user impact, not implementation effort

### No Hallucinated Issues

- If a subagent says "this button lacks an accessibility label", verify by checking the actual JSX for `accessibilityLabel`
- If a subagent says "font contrast fails WCAG", verify by reading the actual color values from theme and styles
- When in doubt, state "UNVERIFIED" next to the finding
