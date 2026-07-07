# Implementation Plan: Chat UI & UX Improvements

**Branch**: `011-chat-ui-improvements` | **Date**: 2026-07-02 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/011-chat-ui-improvements/spec.md)

**Input**: Feature specification from `/specs/011-chat-ui-improvements/spec.md`

## Summary

This plan addresses 17 specific UI and UX findings identified in `chat-control-screen-review.md`. The primary focus is to:
1. Extract and render thoughts/intermediate text inline in the timeline interleaved with tool activities when tools are present, falling back to a message bubble accordion only if no tools are executed.
2. Simplify the visual hierarchy by removing unnecessary bordered cards and nested boundaries (borderless style).
3. Introduce strict max-height bounds on terminal windows, search results, and thinking containers to optimize vertical mobile scrolling.
4. Prevent double-tap submission issues via synchronous input guards.
5. Fix terminal overflow on small screen sizes (iPhone SE).

---

## Technical Context

**Language/Version**: TypeScript, React Native (Expo)

**Primary Dependencies**: React Native, `@expo/vector-icons`, `react-native-markdown-display`

**Storage**: Memory, State

**Testing**: Jest, React Native Testing Library

**Target Platform**: iOS, Android

**Project Type**: Mobile Application (UI/UX Layer)

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle II: Mobile-First Optimization & Performance**:
  - *Requirement*: Large terminal logs must prevent blocking. Backdrop blurs must degrade gracefully.
  - *Alignment*: Capping the turn timeline's thinking content height at `300px` with internal scrolling prevents rendering massive lists inline, saving UI memory and scrolling effort. Wrapping terminal outputs in a horizontal ScrollView avoids viewport overflows on small screens (iPhone SE).
- **Principle V: Test-First Implementation & Validation**:
  - *Requirement*: Automated tests for logic changes.
  - *Alignment*: We will write Jest unit tests to verify the correctness of the assistant message stream parsing and interleaving algorithms.

---

## Project Structure

### Documentation (this feature)

```text
specs/011-chat-ui-improvements/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # OpenCode event structure and UI/UX board
├── data-model.md        # Extended message metadata schemas
├── quickstart.md        # Scenario walkthrough validation guide
└── contracts/
    └── components.md    # Updated component interface types
```

### Source Code

```text
iota-mobile/
└── src/
    ├── components/
    │   └── control/
    │       ├── ChatMessageBubble.tsx
    │       ├── ChatTimeline.tsx
    │       ├── ToolActivityCard.tsx
    │       └── ControlScreenConstants.tsx
    ├── screens/
    │   └── ControlScreen.tsx
    └── types/
        └── opencode.ts
```

---

## Proposed Changes

### 1. Message Parsing & Caching (`ControlScreen.tsx`)
We need to parse streaming chunks and complete messages into discrete `ParsedBlock` items (see `data-model.md`) and persist them in the message's `metadata.parsedBlocks` to preserve discovery timestamps:
- Write a helper `parseAssistantContent(content: string): ParsedBlock[]` that handles both closed and unclosed (streaming) `<thought>` tags, extracting multiple thoughts and intermediate text blocks.
- In `ControlScreen.tsx`, inside `onMessage` and `onMessageDelta`, update the assistant message's `metadata.parsedBlocks`.
- Ensure that if a block at index `i` is modified (appended), we keep its original discovery timestamp to ensure chronological sorting doesn't jump.

### 2. Timeline Interleaving & Heights (`ChatTimeline.tsx`)
- Read `parsedBlocks` from the assistant message.
- If there are tools/activities in the turn:
  - Extract all thought blocks and intermediate text blocks (except the final response block) as `inlineBlocks`.
  - Combine `turn.activities` (tools, file changes, approvals) and `inlineBlocks` into a single array of `InterleavedItem` (see `data-model.md`).
  - Sort this array chronologically by `timestamp` (the merge+sort logic lives in `ControlScreen.tsx`'s `groupedTimelineItems` memo; `ChatTimeline.tsx` renders the sorted result).
  - Render thought blocks and intermediate texts inline inside the thinking accordion.
  - Collapsed inline thought blocks must be collapsed by default and show `"Thought for <duration>   >"` in their header.
- Keep the timeline thinking section collapsed by default after completion (`FR-009`). After final response, the collapsed thinking box header must say `"Worked for <duration>"` instead of `"Ran N tools"`.
- Set `maxHeight: 300` with vertical scrolling on `thinkingContent` (`FR-008`).
- Remove borders from `thinkingContainer` (`FR-006`).
- Style the "Thinking..." header to use `primary.glow` and bold weight when the activity spinner is active (`FR-010`).

### 3. Tool Activity Display (`ToolActivityCard.tsx`)
- Compute a `cleanSummaryLabel` dynamically from the metadata (e.g. `Read file.ts #L1-50` or `Ran npm test`) when tool rows are collapsed (`FR-003`).
- When collapsed, hide `activity.summary` to prevent stdout/snippet leaks (`FR-003`, `FR-016`, `FR-017`).
- Wrap terminal stdout/stderr inside a horizontal `ScrollView` and set `overflow: 'hidden'` on `terminalContainer` to fix SE viewport overflows (`FR-008`).
- Set `maxHeight: 250` on stdout/stderr output and search results, rendering a dynamic collapse/expand toggle (`FR-008`).
- Remove borders from `statusRow`, `toolDetailCard`, and `diffCard`. Keep only background color shifts (`FR-006`).
- Reduce redundant inner padding in the expanded tool detail path (`toolDetailContent:10px`, `terminalContainer:8px` stacking) to recover 50-60px/side on small screens (`FR-011`).

### 4. Message Bubble Adjustments (`ChatMessageBubble.tsx`)
- If tools are present in the turn:
  - Accept `isTimelineItem` prop from the parent (set when the bubble is rendered inside a timeline that contains tools).
  - Render *only* the final response block inside the main assistant message bubble. Do not render thoughts or intermediate text there.
  - If the assistant is still running and hasn't produced a final response block yet, the bubble shouldn't be rendered.
- If NO tools are present in the turn:
  - Fall back to rendering the thoughts inside a collapsible accordion at the top of the bubble.
  - Thread `runStatusText` into the accordion so the header dynamically reflects current AI activity rather than showing a static "Thought Process" label (finding 6).
- Strip borders from `assistantShort` and the thought accordion text container (`FR-006`).
- Remove unnecessary `borderTopWidth` and `borderTopColor` from `thinkingTextScroll`.

### 5. Input Submission Guard (`ControlScreen.tsx`)
- Add `const submittingRef = useRef(false)` in `ControlScreen`.
- In `handleSubmitPrompt`, check `if (submittingRef.current) return;`.
- Set `submittingRef.current = true` synchronously before emitting.
- Set `submittingRef.current = false` inside state changes once messages are updated/rendered.

---

## Verification Plan

### Automated Tests
We will write Jest tests in `iota-mobile` to verify the helper functions:
- `parseAssistantContent` parser: verifies that it parses multiple thoughts, intermediate texts, streaming inputs (unclosed tags), and correctly splits final responses.
- Timeline interleaving builder: verifies that combined items are sorted chronologically.
- `submittingRef` input guard: verifies that rapid double-tap submissions are blocked synchronously.

To run tests:
```bash
cd iota-mobile
npm test
```

### Manual Verification
1. Launch the Expo application.
2. Execute tasks that generate intermediate thoughts and tool executions.
3. Verify that the UI matches the mocks: borderless cards, proper scrolling height bounds, horizontal scrolls in terminal, dynamic status labels.
4. Attempt rapid dual tapping on the send button to verify duplicate submission prevention.
