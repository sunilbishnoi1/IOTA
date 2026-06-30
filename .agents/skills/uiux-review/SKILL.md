---
name: "uiux-review"
description: "Spawn multiple parallel subagents to analyze a specified mobile UI component from UX, layout, design aesthetics, and edge-case perspectives, then produce a consolidated, prioritized mobile UI/UX issue report."
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
- **This is a mobile app** — all findings must be evaluated in the context of a mobile touch-screen interface (phone/tablet). Never apply desktop or web standards. Mobile touch targets, viewport constraints, and platform conventions (iOS/Android HIG) take priority.

## Execution Steps

### Step 1: Locate the Component

1. Take the user-provided component path/name
2. If it's a name only (e.g., `EnvVarModal`), search the codebase with `glob` and `grep` to find the actual file
3. If it's a relative path, resolve it from the workspace root
4. Return the full absolute path for use by subagents

### Step 2: Read the Full Component

Read the entire component file from disk — both the render/JSX section and the StyleSheet/styles section. Pass the full file contents and path to all subagents.

### Step 3: Deploy Parallel Subagents (MANDATORY)

Launch **5 subagents simultaneously**, each analyzing from a distinct perspective:

**Subagent A — UX & Interaction Analyst (Mobile):**
- Analyze user experience quality for mobile touch interfaces: affordances, feedback, flow clarity
- Check: confirmation dialogs, error messages, empty states, loading states, disabled states
- Check: keyboard handling (mobile keyboard avoidance), focus management, dismiss patterns
- Check: one-handed usability, thumb-zone placement, bottom-sheet vs modal appropriateness
- Check: redundant elements, confusing labels, unexpected behavior
- Check: mobile accessibility (missing `accessibilityLabel`, contrast ratio WCAG AA, minimum 44×44pt touch targets per Apple HIG / Material Design)
- Return findings with file:line references

**Subagent B — Layout & Positioning Analyst (Mobile):**
- Analyze the component's layout structure for mobile viewports: flex, alignment, spacing, sizing
- Check: overflow risks on small screens (e.g. iPhone SE 320px width), width/height chain, padding nesting
- Check: responsive behavior across common mobile screen sizes (320px–428px width)
- Check: alignment consistency between related elements
- Check: safe area insets (notch, home indicator) — does the component respect them?
- Check: element ordering, grouping, visual hierarchy
- Check: z-index, overlapping, clipping issues
- Return findings with file:line references

**Subagent C — Design Aesthetics & Visual Quality Analyst (Mobile):**
- Analyze visual refinement for mobile: typography, color, spacing, harmony
- Check: font sizes against mobile readability standards (minimum 12px body, 11px caption at absolute smallest)
- Check: color contrast, color hierarchy, consistency with theme
- Check: border radius, shadow treatment, elevation cues (mobile platform conventions)
- Check: icon sizing and consistency, visual density appropriate for mobile screens
- Check: premium feel — micro-interactions, spacing rhythm, minimalism, native-platform feel
- Check: dark mode / low-light readability if applicable
- Return findings with file:line references

**Subagent D — Edge Cases & Resilience Analyst (Mobile):**
- Analyze what happens in extreme or unexpected states on mobile devices
- Check: very long text (keys, values, labels) causing truncation or layout breakage on small screens
- Check: very many items (overflow, performance, scroll behavior, memory on mobile)
- Check: rapid interactions (double-tap, fast typing on soft keyboard)
- Check: network failures, timeout states, partial data (common on mobile connections)
- Check: concurrent edits, stale state race conditions
- Check: keyboard overlay — does the keyboard push the form out of view?
- Check: what happens when the component is mounted/unmounted rapidly (navigation transitions)
- Return findings with file:line references

**Subagent E — Market Design Research Analyst:**
- Use **web search** and **web fetch** tools to find best-in-class, modern design examples for this exact component type (e.g., if the component is a settings modal, search for "best mobile settings modal UI 2026", "premium mobile environment variable editor design")
- Search across multiple sources: Dribbble, Behance, Material Design guidelines, Apple HIG, UI/UX pattern libraries, and recent design articles (2025–2026)
- For each reference found: save the URL, describe the design pattern, and note what makes it effective (spacing, typography, interaction pattern, color treatment, etc.)
- Compile a **Design Inspiration Board** with:
  - URL / source
  - Pattern name (e.g., "Bottom sheet with inline editing", "Expandable card reveal")
  - Key takeaways that could apply to our component
  - Suggested adaptations for our codebase (concrete, implementable ideas)
- Return findings with source URLs and actionable inspiration points

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
6. Include the Design Inspiration Board from Subagent E as a separate section

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

#### 5. Market Design Research (Subagent E)
{Key patterns discovered and how they compare to current implementation}

---

### Design Inspiration Board

| Source | Pattern | Key Takeaways | Suggested Adaptation |
|--------|---------|---------------|---------------------|
| {URL} | {pattern name} | {what makes it great} | {how to apply in our codebase} |
| {URL} | {pattern name} | {what makes it great} | {how to apply in our codebase} |

---

### What Was Checked

- Mobile UX flows and interaction patterns (touch, thumb zones, keyboard)
- Mobile layout: flex, padding chain, overflow on small viewports, safe areas
- Mobile visual quality: typography, color, spacing, density, platform conventions
- Mobile edge cases: keyboard overlay, slow networks, small-screen truncation
- Market design research: web search for best-in-class mobile patterns (2025–2026)

### Quick Wins (easy fixes with high mobile UX impact)

1. {finding} — {one-line fix} (Affects: {area})
2. {finding} — {one-line fix} (Affects: {area})
```

### Step 6: Offer Next Steps

After the report, ask:
- "Would you like me to create an implementation plan for these fixes?"
- "Would you like me to implement the fixes directly?"

## Operating Principles

### Mobile-First Evaluation

- This is a React Native / Expo mobile application — all findings must be evaluated against mobile UX standards, not desktop web standards.
- Reference Apple HIG (44×44pt minimum touch target) and Material Design guidelines as the authoritative standards.
- Always consider the smallest supported viewport (iPhone SE: 320×568) as the baseline for overflow/layout checks.
- Consider one-handed thumb zones, keyboard avoidance, and safe area insets in all layout analysis.

### Evidence-Based Analysis

- Every claim must trace back to a specific property value on a specific line
- "Font is too small" is insufficient — "`fontSize: 10` on line 480 is below the 12px minimum for mobile readability" is actionable
- Read the full StyleSheet — don't miss related styles just because they're named differently

### Context Efficiency

- Each subagent has a focused scope (UX, Layout, Visual, Edge Cases, Design Research)
- Subagents A–D do NOT need to re-read the file from scratch — they receive it from Step 2
- Subagent E should use web search and web fetch independently; it does not need the component file content
- Use the findings from all 5 agents to produce the final report

### Deterministic Output

- Same component + same codebase = same report
- Findings are based on code properties, not subjective taste (except in the Design Aesthetics category, where judgment calls are labeled as such)
- Severity is based on user impact, not implementation effort

### No Hallucinated Issues

- If a subagent says "this button lacks an accessibility label", verify by checking the actual JSX for `accessibilityLabel`
- If a subagent says "font contrast fails WCAG", verify by reading the actual color values from theme and styles
- When in doubt, state "UNVERIFIED" next to the finding
