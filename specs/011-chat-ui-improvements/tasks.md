# Tasks: Chat UI & UX Improvements

**Input**: Design documents from `/specs/011-chat-ui-improvements/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project compilation check and setup baseline

- [X] T001 Run TypeScript compilation check in `iota-mobile/` to verify a clean workspace baseline

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core stream parsing utilities that must be complete before User Story 1 can be interleaved

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Implement `parseAssistantContent(content: string): ParsedBlock[]` helper function in `iota-mobile/src/utils/opencodeParser.ts` (create `src/utils/` directory) to parse stream chunks, multiple thoughts, intermediate texts, and final responses (see `data-model.md` for `ParsedBlock` type)
- [X] T003 [P] Write Jest unit tests for `parseAssistantContent` (verifying `ParsedBlock[]` output) in `iota-mobile/src/utils/__tests__/opencodeParser.test.ts` for multiple thoughts, streaming (unclosed tags), intermediate text, and final response splits

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Scleaory 1 - Inline Thoughts and Intermediate Text (Priority: P1) 🎯 MVP

**Goal**: Extract and inline thoughts and intermediate text blocks in the timeline interleaved with tool activities, falling back to a message bubble accordion if no tools are executed.

**Independent Test**: Send a prompt that triggers tools. Verify thoughts render interleaved with tools. Expand them to verify collapse behavior and duration labels. Send a prompt that doesn't run tools, verify it falls back to bubble accordion.

### Implementation for User Story 1

- [X] T004 [US1] Update `onMessage` and `onMessageDelta` in `iota-mobile/src/screens/ControlScreen.tsx` to call `parseAssistantContent` and cache the result as `ParsedBlock[]` in `message.metadata.parsedBlocks` with discovery timestamps (see `data-model.md`)
- [X] T005 [US1] Update `groupedTimelineItems` memo in `iota-mobile/src/screens/ControlScreen.tsx` to extract inline blocks from assistant messages when tools are present, convert to `InterleavedItem[]`, merge into `turn.activities`, and sort chronologically with existing tool/file/approval items (see `data-model.md` for `InterleavedItem` type)
- [X] T006 [US1] Render inline blocks (`type: 'thought_block'` / `'intermediate_text'`) in `iota-mobile/src/components/control/ChatTimeline.tsx` alongside existing tool/file/approval cards, using the chronologically-sorted activities from the memo (the sorting/merge lives in memo at T005)
- [X] T007 [US1] Implement rendering of inline thought blocks (collapsed by default, header: `"Thought for <duration>   >"`) and intermediate text in `iota-mobile/src/components/control/ChatTimeline.tsx`
- [X] T008 [US1] Add `isTimelineItem` prop to `ChatMessageBubble.tsx` and render *only* the final response block of text when the bubble is inside a timeline with tools present
- [X] T009 [US1] Update existing `renderThinkingAccordion` in `ChatMessageBubble.tsx` as the no-tools fallback — update header text, collapse behavior, and duration labels per spec
- [X] T010 [US1] Write Jest unit tests for timeline chronological interleaving in `iota-mobile/src/components/control/__tests__/ChatTimeline.test.tsx`
- [ ] T010b [P] [US1] Write Jest unit tests for `submittingRef` input guard in `iota-mobile/src/screens/__tests__/ControlScreen.test.tsx` to verify duplicate submissions are blocked

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Clean, Borderless UI Hierarchy (Priority: P1)

**Goal**: Simplify the mobile visual hierarchy by removing redundant borders and nested outlines (borderless style).

**Independent Test**: Expand a turn containing tools and diffs, check that there are no overlapping borders and background shifts are used for separation.

### Implementation for User Story 2

- [X] T011 [US2] Remove borders and inner lines from `thinkingContainer` in `iota-mobile/src/components/control/ChatTimeline.tsx`
- [X] T012 [P] [US2] Remove borders from `statusRow`, `toolDetailCard`, and `diffCard` in `iota-mobile/src/components/control/ToolActivityCard.tsx`
- [X] T013 [P] [US2] Remove borders from `assistantShort`, `thinkingTextContainer`, and `thinkingTextScroll` in `iota-mobile/src/components/control/ChatMessageBubble.tsx`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Resilient Input Submission (Priority: P1)

**Goal**: Prevent duplicate submissions by introducing a synchronous guard on the send action.

**Independent Test**: Tap the send button rapidly twice in succession and verify only one message is sent.

### Implementation for User Story 3

- [X] T014 [US3] Add a synchronous `submittingRef` guard in `handleSubmitPrompt` within `iota-mobile/src/screens/ControlScreen.tsx` to block duplicate emissions

**Checkpoint**: All P1 user stories should now be independently functional

---

## Phase 6: User Story 4 - Collapsible/Scrollable Tool Previews & Monospace Text wrapping (Priority: P2)

**Goal**: Prevent screen overflows and page-stretching by capping heights and adding horizontal scrolls.

**Independent Test**: View a long terminal stdout, verify horizontal scrolling works and terminal/search results are capped at max-height with toggles. Verify timeline does not stretch when 20+ tools run.

### Implementation for User Story 4

- [X] T015 [US4] Wrap stdout/stderr outputs inside a horizontal ScrollView and hide overflow on `terminalContainer` in `iota-mobile/src/components/control/ToolActivityCard.tsx`
- [X] T016 [US4] Implement `cleanSummaryLabel` formatting for collapsed tool cards (e.g. `Read file.ts #L1-50`) in `iota-mobile/src/components/control/ToolActivityCard.tsx` and suppress verbose metadata/outputs when collapsed
- [X] T017 [US4] Set `maxHeight: 250` - `300` on terminal outputs and search results, rendering a dynamic "Show more" expand/collapse toggle in `iota-mobile/src/components/control/ToolActivityCard.tsx`
- [X] T018 [US4] Set `maxHeight: 300` with vertical scrolling on `thinkingContent` container in `iota-mobile/src/components/control/ChatTimeline.tsx`

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final visual refinements, dynamic texts, and compilation validation

- [X] T019 Update Completed Thinking Box header to show `"Worked for <duration>"` instead of `"Ran N tools"` in `iota-mobile/src/components/control/ChatTimeline.tsx`
- [X] T019b Thread `runStatusText` into the no-tools fallback accordion in `ChatMessageBubble.tsx` so the "Thought Process" header dynamically reflects current AI activity (finding 6)
- [X] T020 Highlight "Thinking..." header with glowing primary colors and bold weight when activity spinner is active in `iota-mobile/src/components/control/ChatTimeline.tsx`
- [X] T021 Clean up double margins/gap styling in `iota-mobile/src/components/control/ToolActivityCard.tsx` and reduce redundant inner padding in the expanded tool detail path (`toolDetailContent`, `terminalContainer`, etc.) to recover 50-60px/side on small screens (finding 29)
- [X] T022 [P] Run `npm run lint` and verify TypeScript compilation in `iota-mobile/` codebase
- [X] T023 Validate the implementation against all scenarios in `specs/011-chat-ui-improvements/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1) is the MVP and must be completed first
  - User Story 2, 3, and 4 can proceed in parallel once foundation and US1 models/types are ready
- **Polish (Final Phase)**: Depends on all user stories being complete

### Parallel Opportunities

- All tasks marked [P] can run in parallel
- Once Foundational phase completes, Developer A can work on US1 timeline interleaving, Developer B can work on US2 border removal, and Developer C can implement US3 submission guards

---

## Parallel Example: User Story 2

```bash
# Launch border removal tasks together:
Task: "Remove borders from ToolActivityCard in iota-mobile/src/components/control/ToolActivityCard.tsx"
Task: "Remove borders from ChatMessageBubble in iota-mobile/src/components/control/ChatMessageBubble.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Verify chronological interleaving works end-to-end

### Incremental Delivery

1. Complete Setup + Foundational
2. Implement User Story 1 (MVP) -> Test and Validate
3. Implement User Story 2 (Clean borderless) -> Test and Validate
4. Implement User Story 3 (Double-tap guard) -> Test and Validate
5. Implement User Story 4 (Capping and wrapping) -> Test and Validate
6. Perform final Phase 7 Polish and TypeScript compiler checks
