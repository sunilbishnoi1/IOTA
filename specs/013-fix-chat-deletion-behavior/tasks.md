# Tasks: Fix Chat Deletion & New Session Behavior

**Input**: Design documents from `/specs/013-fix-chat-deletion-behavior/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

No setup tasks required — project is already initialized. All changes are within existing files.

---

## Phase 2: User Story 1 — Deleting current chat creates a new session (Priority: P1) 🎯 MVP

**Goal**: When the user deletes the currently active conversation from the history drawer, a fresh empty chat is automatically created instead of switching to an existing conversation.

**Independent Test**: Open conversation A, open history drawer, delete conversation A. Verify a brand new empty chat is displayed (no messages, no title). Verify the history drawer no longer shows conversation A.

### Implementation for User Story 1

- [ ] T001 [P] [US1] Modify `opencodeStore.deleteConversation` in `iota-bridge/src/services/opencodeStore.ts` to not auto-select the next available conversation when the deleted one was the default; set `defaultConversationId` to `undefined` instead
- [ ] T002 [US1] Modify `socket.ts` `opencode:delete_conversation` handler in `iota-bridge/src/services/socket.ts` to only emit `conversations_list` (not `snapshot`) when the deleted conversation was the active/default one
- [ ] T003 [US1] Update `ControlScreen.tsx` `handleDeleteConversation` in `iota-mobile/src/screens/ControlScreen.tsx` to check if `targetId === conversationId` (active chat being deleted) and call `performResetConversation()` after emitting the delete event
- [ ] T004 [P] [US1] Add bridge test in `iota-bridge/src/services/__tests__/socket.test.ts` for delete handler not emitting snapshot when active conversation is deleted
- [ ] T005 [P] [US1] Add mobile test in `iota-mobile/src/components/control/__tests__/` for delete-active-chat flow triggering new session creation

**Checkpoint**: At this point, deleting the current active chat should create a new empty session and show it to the user.

---

## Phase 3: User Story 2 — Prevent multiple empty chats (Priority: P1)

**Goal**: Tapping "New Chat" while an empty chat already exists is a no-op (or shows a discard-draft confirmation if the empty chat has unsent text). Empty chats are hidden from the history drawer.

**Independent Test**: Tap "New Chat" to create an empty chat. Tap "New Chat" again — verify no second empty chat appears. Open history drawer — verify the empty chat is not listed.

### Implementation for User Story 2

- [X] T006 [P] [US2] Update `ControlScreen.tsx` `handleNewChatPress` in `iota-mobile/src/screens/ControlScreen.tsx` to scan `conversations[]` for any conversation with `messages.length === 0`; if found, skip new chat creation (no-op if current chat is the empty one; switch to the empty chat if viewing a different conversation)
- [X] T007 [US2] Update `ControlScreen.tsx` `handleNewChatPress` in `iota-mobile/src/screens/ControlScreen.tsx` to show `Alert.alert` confirmation dialog when the existing empty chat has non-empty `inputText` (draft present), with "Discard" proceeding to new session and "Cancel" dismissing
- [X] T008 [P] [US2] Update `ControlScreen.tsx` to filter `conversations` before passing to `HistoryDrawer` — exclude conversations with `messages.length === 0` (unless it's the currently active session)
- [X] T009 [P] [US2] Add mobile test in `iota-mobile/src/components/control/__tests__/` for new-chat no-op when empty chat exists
- [X] T010 [P] [US2] Add mobile test for history drawer filtering excluding empty conversations

**Checkpoint**: At this point, duplicate empty chats should be prevented and empty chats hidden from history drawer.

---

## Phase 4: User Story 3 — Deleting a non-active chat from history (Priority: P2)

**Goal**: Deleting a conversation that is not the currently active one leaves the current session unchanged.

**Independent Test**: Open conversation A. Open history drawer and delete conversation B. Verify conversation A is still the active session with its messages intact.

### Implementation for User Story 3

- [ ] T011 [P] [US3] Add defensive guard in `ControlScreen.tsx` `handleDeleteConversation` in `iota-mobile/src/screens/ControlScreen.tsx` to explicitly skip `performResetConversation()` when `targetId !== conversationId`
- [ ] T012 [P] [US3] Add mobile test for non-active deletion leaving current session unchanged

**Checkpoint**: All three user stories should now be independently functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Verification, cleanup, and quality assurance.

- [ ] T013 Run TypeScript compilation check for `iota-mobile` (`cd iota-mobile && npx tsc --noEmit`)
- [ ] T014 Run TypeScript compilation check for `iota-bridge` (`cd iota-bridge && npx tsc --noEmit`)
- [ ] T015 Run full test suite for `iota-mobile` (`cd iota-mobile && npm test`) and verify no regressions
- [ ] T016 Run full test suite for `iota-bridge` (`cd iota-bridge && npm test`) and verify no regressions
- [ ] T017 Verify all 9 validation scenarios from `specs/013-fix-chat-deletion-behavior/quickstart.md` pass on emulator/device

---

## Dependencies & Execution Order

### Phase Dependencies

- **US1 (Phase 2)**: No dependencies — can start immediately
- **US2 (Phase 3)**: No blocking dependencies on US1 — can be implemented in parallel
- **US3 (Phase 4)**: No blocking dependencies — can be implemented in parallel
- **Polish (Phase 5)**: Depends on all phases being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P1)**: No dependencies on other stories
- **User Story 3 (P2)**: No dependencies on other stories

All three user stories operate on distinct concerns (delete-active, new-chat, delete-non-active) and touch different logical paths. They can be implemented independently.

### Within Each User Story

- Bridge changes before mobile changes (for US1 bridge emits different events)
- Core implementation before tests
- Story complete before moving to next priority

### Parallel Opportunities

- All `[P]` tasks within a phase can run in parallel
- All three user stories can run in parallel (different logical paths, overlapping files but no conflicting changes)
- T004 (bridge test) and T005 (mobile test) can run in parallel

---

## Parallel Example: User Story 1

```bash
# Bridge store + socket changes (parallel — different files):
Task: "Modify opencodeStore.deleteConversation in iota-bridge/src/services/opencodeStore.ts"
Task: "Modify socket.ts handler in iota-bridge/src/services/socket.ts"

# Wait for bridge changes, then mobile change:
Task: "Update ControlScreen.tsx handleDeleteConversation in iota-mobile/src/screens/ControlScreen.tsx"

# Tests (parallel — different files/projects):
Task: "Add bridge test in iota-bridge/src/services/__tests__/socket.test.ts"
Task: "Add mobile test in iota-mobile/src/components/control/__tests__/"
```

## Parallel Example: User Story 2

```bash
# All changes can be parallel (different methods in same file, no conflicts):
Task: "Update handleNewChatPress for empty chat detection"
Task: "Add discard-draft dialog for empty chat with unsent text"
Task: "Filter conversations for HistoryDrawer"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: User Story 1 (T001–T005)
2. **STOP and VALIDATE**: Delete active chat → verify new empty chat created
3. Optionally deploy/demo

### Incremental Delivery

1. Complete US1 → Test independently → Deploy/Demo (MVP!)
2. Complete US2 → Test independently → Deploy/Demo
3. Complete US3 → Test independently → Deploy/Demo
4. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:
- Developer A: User Story 1 (T001–T005)
- Developer B: User Story 2 (T006–T010)
- Developer C: User Story 3 (T011–T012)
- All three stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Run TypeScript checks (T013, T014) after each phase to catch type errors early
