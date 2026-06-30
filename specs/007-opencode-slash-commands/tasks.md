# Tasks: OpenCode Slash Commands

**Input**: Design documents from `/specs/007-opencode-slash-commands/`

**Prerequisites**: [plan.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/plan.md) (required), [spec.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/spec.md) (required for user stories), [research.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/research.md), [data-model.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/data-model.md)

**Tests**: Included under each User Story phase to comply with Principle V (Test-First Implementation & Validation) of the platform constitution.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are provided in descriptions.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic types/sockets structure

- [x] T001 [P] Register `activeModel` parameter in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/types/opencode.ts) and [opencode.ts (mobile)](file:///d:/Desktop/codes/IOTA/iota-mobile/src/types/opencode.ts)
- [x] T002 [P] Implement `emitOpenCodeCredentials` in [opencodeSocket.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/opencodeSocket.ts)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core client code files setup that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create [ControlSlashCommands.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/ControlSlashCommands.tsx) and define list of 12 supported slash commands, usages, and descriptions

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Interactive Slash Command Interception (Priority: P1) 🎯 MVP

**Goal**: Intercept chat inputs starting with `/` on the client. Execute client-only commands (`/help`, `/undo`, `/redo`) locally.

**Independent Test**: Submit `/help` to see help card, submit `/undo` and `/redo` to see list state rollback.

### Tests for User Story 1
- [x] T004 [P] [US1] Create unit tests in [ControlSlashCommands.test.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/__tests__/ControlSlashCommands.test.tsx) for testing `/help`, `/undo`, and `/redo` interceptors

### Implementation for User Story 1
- [x] T005 [US1] Implement `useSlashCommands` hook in [ControlSlashCommands.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/ControlSlashCommands.tsx) returning interceptor function
- [x] T006 [US1] Add handler for `/help` to append structured local markdown table card in the chat timeline
- [x] T007 [US1] Add handler for `/undo` and `/redo` to manage a local messages history stack and slice/splice the timeline
- [x] T008 [US1] Mount and invoke `useSlashCommands` hook within `handleSubmitPrompt` in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Real-Time Autocomplete Suggestion UI (Priority: P2)

**Goal**: Display a floating autocomplete popup menu when typing `/` that filters matching commands.

**Independent Test**: Focus input, type `/st`, select `/stats` and verify autocomplete.

### Tests for User Story 2
- [x] T009 [P] [US2] Write unit tests in [ControlSlashCommands.test.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/__tests__/ControlSlashCommands.test.tsx) to verify suggestions show and filter as input text changes

### Implementation for User Story 2
- [x] T010 [P] [US2] Implement `SlashCommandsAutocomplete` component in [ControlSlashCommands.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/ControlSlashCommands.tsx) targeting 60 FPS animation/render performance
- [x] T011 [US2] Render `SlashCommandsAutocomplete` inside the key-avoiding view in [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) and pass input height/text changes

**Checkpoint**: Autocomplete suggestions list is active and fully functional.

---

## Phase 5: User Story 3 - Model Management and Switching (Priority: P2)

**Goal**: Execute `/models` to query models from bridge, and `/models <model>` to update the conversation active model.

**Independent Test**: Run `/models`, verify list streams. Run `/models gpt-5-mini` and prompt to check execution CLI parameter.

### Tests for User Story 3
- [x] T012 [P] [US3] Add unit tests in [opencode.test.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/__tests__/opencode.test.ts) to verify activeModel configuration injection in `buildRunArgs`

### Implementation for User Story 3
- [x] T013 [US3] Intercept commands starting with `/` under socket listener `opencode:message` in [socket.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- [x] T014 [P] [US3] Implement `runModelsQuery()` executing `opencode models` command in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T015 [US3] Read conversation `activeModel` and update argument generation logic inside `buildRunArgs` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T016 [US3] Handle `/models` and `/models <model-name>` queries in [socket.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts) to query CLI or update conversation activeModel

**Checkpoint**: Model management and switching functions end-to-end.

---

## Phase 6: User Story 4 - Additional Slash Commands Integration (Priority: P3)

**Goal**: Implement `/stats`, `/skills`, `/sessions`, `/connect`, `/init`, `/compact`, `/exit`.

**Independent Test**: Verify `/stats` prints ascii table, `/skills` lists projects skills, `/connect` opens credentials config modal, `/init` updates agents docs.

### Tests for User Story 4
- [x] T017 [P] [US4] Write unit tests for stats and session command execution in [socket.test.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/__tests__/socket.test.ts)

### Implementation for User Story 4
- [x] T018 [P] [US4] Implement `runStatsQuery()` running `opencode stats` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T019 [US4] Implement `runSessionsQuery()` running `opencode session list --format json` and `runSessionDelete()` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T020 [P] [US4] Implement `runExportQuery()` running `opencode export` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T021 [P] [US4] Implement `runCompactQuery()` running `opencode run` with summarize instructions in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T022 [US4] Implement local skills directory reader to inspect `.agents/skills` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T023 [US4] Implement workspace init runner executing `update-agent-context.ps1` in [opencode.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T024 [US4] Update [socket.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts) to parse and map `/stats`, `/skills`, `/sessions`, `/export`, `/init`, `/compact`, `/exit` commands to their runners
- [x] T025 [P] [US4] Implement `CredentialsModal` input overlay component for API Keys configuration in [ControlSlashCommands.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/ControlSlashCommands.tsx)
- [x] T026 [US4] Add listener for `opencode:credentials` in [socket.ts (bridge)](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts) to update in-memory credentials dynamically
- [x] T027 [US4] Connect `/connect` and `/auth` in `useSlashCommands` hook to trigger `CredentialsModal` in [ControlSlashCommands.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/ControlSlashCommands.tsx)

**Checkpoint**: All 12 slash commands are fully functional and integrated.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Performance optimizations and quickstart validation

- [x] T028 Add 15-second watchdog execution timeouts on the bridge for stats/models CLI queries
- [x] T029 Add offline socket safety checks to intercept commands requiring bridge connection when offline
- [x] T030 Run manual validations defined in [quickstart.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/quickstart.md)
- [x] T031 [P] Update SpecKit context file references

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 can be implemented first (MVP)
  - Once US1 is ready, US2 (suggestions list UI) and US3 (bridge parser) can start in parallel
  - US4 depends on US3 bridge parser foundations
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### Parallel Opportunities

- T001 and T002 can run in parallel (separate project code boundaries).
- Once Phase 2 completes, Developer A can implement US1 and US2 UI components on the mobile client, while Developer B implements US3/US4 CLI execution commands on the bridge.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Test and validate local `/help`, `/undo`, and `/redo` commands.
