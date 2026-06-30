# Tasks: Control Chat Cursor UI/UX Enhancements

**Input**: Design documents from `/specs/006-control-chat-cursor-ui/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define `createdAt` on the `OpenCodeFileChange` type interface in [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/types/opencode.ts) and [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/types/opencode.ts)
- [x] T002 [P] Set `createdAt` timestamp during payload normalization in [opencodeEvents.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create React Native styles and helper utility types for chat turns in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T004 [P] Attach FlatList ref and create auto-scroll effect for timeline updates in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Collapsible Sequential Thinking logs (Priority: P1) 🎯 MVP

**Goal**: Group all tool activities, file modifications, and approvals under a collapsible thin box that displays the current active tool or execution summary.

**Independent Test**: Start a multi-tool coding run. Verify that the thinking box appears, shows active tool status, and collapses/expands smoothly with sequential logs inside.

### Implementation for User Story 1

- [x] T005 [US1] Implement client-side turn grouping selector in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) using `useMemo` based on message and activity timestamps
- [x] T006 [US1] Create Collapsible Thinking box component (header with spinner, active tool name, or count summary, and collapsible content view) in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T007 [US1] Integrate list of sequential tool calls, file diff cards, and approvals inside the collapsible content area in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T008 [US1] Handle non-permanent spinners and status updates smoothly when active tools finish or fail in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Full-Width Dynamic AI Response Box (Priority: P1)

**Goal**: Enable assistant message response container to dynamically adjust width and span the full viewport width for long content, with reduced padding for user & assistant views.

**Independent Test**: Send a short text message, verify width wraps content. Send a long message/code, verify it stretches to full width. Verify padding is minimized.

### Implementation for User Story 2

- [x] T009 [US2] Redesign user message bubble and AI response container layout and styling in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) to reduce horizontal/vertical padding
- [x] T010 [US2] Remove outer bubble container backgrounds and borders from assistant messages in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) to enable full viewport width
- [x] T011 [US2] Implement dynamic container sizing (flex-start wrap vs full stretch) based on content length in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: At this point, User Stories 1 and 2 should both work.

---

## Phase 5: User Story 3 - Interactive Code Block Utilities (Priority: P2)

**Goal**: Add dark high-contrast backgrounds and copy-to-clipboard functionality to all Markdown code blocks.

**Independent Test**: Tap copy button on an AI response code block, verify "Copied!" feedback, and paste text to confirm.

### Implementation for User Story 3

- [x] T012 [US3] Add `react-native-markdown-display` custom rules to parse and render `fence` and `code_block` tags using a custom component with a copy header bar in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T013 [US3] Integrate `expo-clipboard` to copy selected code blocks and show a temporary "Copied!" feedback text in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: Code block copying should now be fully functional.

---

## Phase 6: User Story 4 - Suggested Quick-Action Prompt Pills (Priority: P2)

**Goal**: Show developer suggested quick action pills in the empty chat state.

**Independent Test**: Open a clean session, tap "Find bugs" pill, verify the input box populates with that text.

### Implementation for User Story 4

- [x] T014 [US4] Design suggested prompt pills container style and add layout in the `ListEmptyComponent` of [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T015 [US4] Bind press handler on prompt pills to populate `inputPrompt` and focus the keyboard in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: Suggested prompt pills should work.

---

## Phase 7: User Story 5 - New Chat Session Reset (Priority: P2)

**Goal**: Enable sessional chat resets via a "New Chat" icon button in the header with a confirmation dialog.

**Independent Test**: Tap "New Chat" button, confirm, and verify the chat timeline is completely cleared.

### Implementation for User Story 5

- [x] T016 [US5] Render a refresh/reset button in the header bar of [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T017 [US5] Implement sessional reset controller (Alert prompt, locally clear all state arrays, generate new conversation ID, save to secure store, emit socket sync) in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: Full conversation reset and session sync should work smoothly.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T018 Verify smooth keyboard avoiding offset behavior on both iOS and Android in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T019 Run automated tests in `iota-bridge` to verify events parsing stability
- [x] T020 Perform manual walkthrough verification using `quickstart.md` and document results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User Story 1 (Collapsible logs) is the MVP and should be implemented first.
  - User Story 2 (Full-width AI response) should be implemented next.
  - User Stories 3, 4, and 5 can be implemented sequentially or in parallel if needed.
- **Polish (Phase 8)**: Depends on all user stories being complete.

---

## Parallel Opportunities

- Setup tasks T001 and T002 can be implemented in parallel.
- Foundational tasks T003 and T004 can be implemented in parallel.
- User Story 2, 3, 4, and 5 can be implemented in parallel after US1 is complete.
