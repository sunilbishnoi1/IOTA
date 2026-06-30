# Tasks: Fix "New Chat" and Add Session Persistence

**Input**: Design documents from `/specs/009-fix-new-chat-persistence/`

**Prerequisites**: [plan.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/plan.md), [spec.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/spec.md), [research.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/research.md), [data-model.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/data-model.md), [socket-api.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/contracts/socket-api.md)

**Tests**: Tests are optional and are executed as part of the Phase 8 verification tasks.

**Organization**: Tasks are grouped by setup/foundational stages and then by user stories in priority order.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Set up required type modifications and socket event emitters.

- [X] T001 Update `OpenCodeConversation` interface to support the new `title` field in [types/opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/types/opencode.ts)
- [X] T002 [P] Add socket event emitters `emitOpenCodeNewSession`, `emitOpenCodeListConversations`, `emitOpenCodeDeleteConversation` in [services/opencodeSocket.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/opencodeSocket.ts)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core disk persistence mechanisms on the bridge.

**⚠️ CRITICAL**: No user story implementation can begin until these disk persistence methods are ready.

- [X] T003 Implement `loadConversationsFromDisk` and `ensureLoaded` in [services/opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts)
- [X] T004 [P] Implement atomic `saveConversation` write utility using temporary files and rename in [services/opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts)

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Create an independent "New Chat" session (Priority: P1) 🎯 MVP

**Goal**: Clear active UI state on mobile and spawn a fresh OpenCode CLI process on the bridge without previous session context.

**Independent Test**: Scenario 1 in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/quickstart.md) (verify a new chat doesn't know context from a previous chat).

- [X] T005 [US1] Add the `opencode:new_session` socket listener on the bridge in [services/socket.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- [X] T006 [US1] Remove the `syncFromCliSessions` fallback on unknown conversation IDs in `opencode:sync` in [services/socket.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- [X] T007 [US1] Modify `syncFromCliSessions` so that it is only called explicitly (not as fallback) in [services/opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [X] T008 [US1] Update `performResetConversation` to emit `opencode:new_session` in [screens/ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: User Story 1 is functional. New chats are completely isolated.

---

## Phase 4: User Story 4 - Cache isolation on mobile device (Priority: P2)

**Goal**: Scope local chat caches in `SecureStore` by conversation ID to prevent cross-session UI pollution.

**Independent Test**: Scenario 4 in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/quickstart.md).

- [X] T009 [US4] Update `getChatCache` and `saveChatCache` in [services/secureStore.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/secureStore.ts) to accept `conversationId` and append it to the storage keys.
- [X] T010 [US4] Add upgrade fallback logic in `getChatCache` to migrate `iota_chat_cache_${scope}` to the new scoped key format in [services/secureStore.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/secureStore.ts)
- [X] T011 [US4] Update [screens/ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) to load and save chat cache based on `conversationId` changes.

**Checkpoint**: User Story 4 is functional. Message cache is fully isolated.

---

## Phase 5: User Story 2 - Switch between past conversations and persist history (Priority: P2)

**Goal**: Implement the custom sliding History Drawer UI on mobile and synchronization/deletion handlers on the bridge to manage past conversations.

**Independent Test**: Scenarios 2 and 3 in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/quickstart.md).

- [X] T012 [US2] Expose `getAllConversations` and `deleteConversation` in [services/opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts)
- [X] T013 [US2] Add the `opencode:list_conversations` and `opencode:delete_conversation` socket event listeners on the bridge in [services/socket.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- [X] T014 [US2] Implement the `HistoryDrawer.tsx` component in [components/control/HistoryDrawer.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/HistoryDrawer.tsx) using the `Animated` API.
- [X] T015 [US2] Integrate the `HistoryDrawer` and add the History button in the header right bar of [screens/ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx).

**Checkpoint**: User Story 2 is functional. Past conversations can be switched and deleted.

---

## Phase 6: User Story 3 - Automatic session metadata and titles (Priority: P3)

**Goal**: Auto-generate conversation titles from the first user message.

**Independent Test**: Verify that the first message sent generates a concise title in the history drawer.

- [X] T016 [US3] Add title generation logic in `addMessage` in [services/opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts) when a conversation's first user message is received.

**Checkpoint**: User Story 3 is functional. Titles are generated automatically.

---

## Phase 7: User Story 5 - Garbage collection of old sessions (Priority: P3)

**Goal**: Keep disk usage bounded by pruning conversations exceeding the 50-session limit.

**Independent Test**: Scenario 5 in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/quickstart.md).

- [X] T017 [US5] Implement `pruneOldConversations` in [services/opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts) and call it after saving a conversation.

**Checkpoint**: User Story 5 is functional. Old conversations are pruned correctly.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting updates and verification tests.

- [X] T018 Update `/sessions` slash command output in [services/opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts) to list both IOTA conversations and CLI sessions.
- [X] T019 Run bridge tests using `npm run test` inside `iota-bridge`.
- [X] T020 Run mobile tests using `npm run test` inside `iota-mobile`.
- [X] T021 Execute manual validation scenarios in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/quickstart.md).

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) - blocks all user stories.
- **User Stories (Phases 3-7)**: All depend on Foundational (Phase 2).
  - Can proceed sequentially (Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7).
- **Polish (Phase 8)**: Depends on all user story phases.

### Parallel Opportunities
- T002 (Mobile socket emitters) can run in parallel with T001 (Bridge types).
- T004 (Atomic file writes) can run in parallel with T003 (Load conversations).
- Once Phase 2 is complete, US1 and US4 can be developed in parallel, but US2 depends on both being finished to allow correct switching.

---

## Implementation Strategy

### MVP First (User Stories 1 & 4 Only)
1. Complete Setup and Foundational.
2. Complete User Story 1 (New Chat isolation).
3. Complete User Story 4 (Cache isolation).
4. **STOP and VALIDATE**: Verify that new chats are clean and that restarting the app doesn't pollute the UI.
