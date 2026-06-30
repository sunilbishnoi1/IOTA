# Tasks: OpenCode Control Chat Fixes

**Input**: Design documents from `/specs/005-control-chat-opencode-fixes/`

**Prerequisites**: [plan.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/plan.md) (required), [spec.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/spec.md) (required for user stories), [research.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/research.md), [data-model.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/data-model.md)

**Tests**: Tests are requested in the implementation plan to verify `opencodeEvents` normalization and capability states.

**Organization**: Tasks are grouped by user story in priority order (P1 -> P2 -> P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Bridge / Backend**: `iota-bridge/src/`
- **Mobile Client**: `iota-mobile/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and test framework setup

- [x] T001 Initialize unit test file for OpenCode event parsing in [iota-bridge/src/services/__tests__/opencodeEvents.test.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/__tests__/opencodeEvents.test.ts)
- [x] T002 Verify TypeScript compilation by running `npm run build` in [iota-bridge](file:///D:/Desktop/codes/IOTA/iota-bridge)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core unified logger infrastructure that must be complete before logs are piped

- [x] T003 Create logging service implementation in [iota-bridge/src/services/logger.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/logger.ts) to write to `bridge.log`
- [x] T004 Integrate logging service in [iota-bridge/src/index.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/index.ts) to initialize logger on server start

---

## Phase 3: User Story 1 - Clean and Reliable Chat Flow (Priority: P1) 🎯 MVP

**Goal**: Support streaming and rendering nested assistant response payloads and filter step lifecycle events.

**Independent Test**: Run bridge, submit a prompt, and verify that the streaming response begins and completes successfully.

### Tests for User Story 1

- [x] T005 [P] [US1] Write unit tests for nested `part` payloads and step events in [iota-bridge/src/services/__tests__/opencodeEvents.test.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/__tests__/opencodeEvents.test.ts)

### Implementation for User Story 1

- [x] T006 [US1] Update `normalizeOpenCodePayload` in [iota-bridge/src/services/opencodeEvents.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts) to extract content from nested `part` fields
- [x] T007 [US1] Explicitly map `step_start` and `step_finish` events to return empty arrays `[]` in [iota-bridge/src/services/opencodeEvents.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)
- [x] T008 [US1] Run unit tests via `npm test` in [iota-bridge](file:///D:/Desktop/codes/IOTA/iota-bridge) to verify normalization logic passes

**Checkpoint**: User Story 1 is functional. Nested payloads are parsed, and step events do not spam.

---

## Phase 4: User Story 3 - Native and Config-Free Model Access (Priority: P1)

**Goal**: Enable default out-of-the-box credential-free model run execution.

**Independent Test**: Connect mobile app and submit a prompt without local API credentials, verifying execution completes successfully.

### Implementation for User Story 3

- [x] T009 [US3] Add default `--model opencode/deepseek-v4-flash-free` argument in `buildRunArgs` in [iota-bridge/src/services/opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T010 [US3] Remove API key validation gating from `checkCapability` in [iota-bridge/src/services/opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts) and [iota-bridge/src/services/socket.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)

**Checkpoint**: Capability is marked `available` without credentials, and runs use the free model by default.

---

## Phase 5: User Story 4 - High-Availability Run Fallbacks (Priority: P1)

**Goal**: Support direct run fallback if attaching to the warm daemon fails or conflicts.

**Independent Test**: Block port `4096`, submit prompt, and verify prompt execution falls back to direct run mode transparently.

### Implementation for User Story 4

- [x] T011 [US4] Implement direct run fallback inside `opencodeRunner.run` in [iota-bridge/src/services/opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- [x] T012 [US4] Update active process tracking and target execution handle in `stop()` inside [iota-bridge/src/services/opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts) to handle fallback execution
- [x] T013 [US4] Add diagnostic log output for fallback triggers and exit states in [iota-bridge/src/services/opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)

**Checkpoint**: Process spawns fallback to direct run if warm server attach fails, without returning a timeout/hang to the user.

---

## Phase 6: User Story 2 - Consolidated Run Status Reporting (Priority: P2)

**Goal**: Prevent timeline spamming by overwriting intermediate lifecycle run status messages using stable IDs.

**Independent Test**: Run a prompt, verify only one status message is visible in the chat timeline, and updates in-place.

### Implementation for User Story 2

- [x] T014 [US2] Update status ID to stable `run-${status.requestId}` format in `emitRunStatus` in [iota-bridge/src/services/socket.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- [x] T015 [US2] Update status ID in `createRunStatusMessage` in [iota-mobile/src/screens/ControlScreen.tsx](file:///D:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx) to match the bridge ID

**Checkpoint**: Only a single status bubble remains in the timeline per prompt, updating dynamically.

---

## Phase 7: User Story 5 - Conversation History Navigation Sync (Priority: P2)

**Goal**: Preserve timeline conversation state across screen navigation and component unmount/remount.

**Independent Test**: Navigate away during a run, return, and check that the active timeline and placeholder state is fully restored and de-duplicated.

### Implementation for User Story 5

- [x] T016 [US5] Await stored conversation ID load before initiating socket connect / `opencode:sync` inside `connectSocket` in [iota-mobile/src/screens/ControlScreen.tsx](file:///D:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- [x] T017 [US5] Refine state merging and de-duplication inside `mergeMessages` in [iota-mobile/src/screens/ControlScreen.tsx](file:///D:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

**Checkpoint**: Conversation state is completely synchronized and de-duplicated on screen remount.

---

## Phase 8: User Story 6 - Unified Diagnostics and Operations Log (Priority: P3)

**Goal**: Capture all bridge connections, lifecycle status transitions, errors, and subprocess execution outputs.

**Independent Test**: Check that `bridge.log` is created and lists execution steps, stdout, and stderr.

### Implementation for User Story 6

- [x] T018 [US6] Pipe process execution outputs (stdout and stderr) to logging service inside `opencode.ts` and `socket.ts`
- [x] T019 [US6] Log key bridge event messages (socket connection, status changes, errors) using the logging service in [iota-bridge/src/services/socket.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)

**Checkpoint**: Complete diagnostic traces are stored in `bridge.log`.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, full build checks, and walkthrough documentation

- [x] T020 Run `npm run build` in [iota-bridge](file:///D:/Desktop/codes/IOTA/iota-bridge) to ensure there are no compilation or type errors
- [x] T021 Run verification scenarios 1-4 from [quickstart.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/quickstart.md) to confirm all user stories are resolved
- [x] T022 [P] Create/update the walkthrough document [walkthrough.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/walkthrough.md) to log test results and execution traces

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS US6 logging tasks.
- **User Stories (Phases 3-8)**:
  - US1 (Phase 3), US3 (Phase 4), US4 (Phase 5) are P1 priorities. They can proceed in parallel once Setup finishes.
  - US2 (Phase 6), US5 (Phase 7) are P2 priorities. They should be implemented after US1 is functional.
  - US6 (Phase 8) depends on Foundational (Phase 2) logging service being completed first.
- **Polish (Phase 9)**: Depends on all user story phases (Phases 3-8) being completed.

### Parallel Opportunities

- Unit tests creation (`T005`) and setup tasks can run in parallel.
- US1 normalization and US3 model updates can be implemented in parallel as they target different files (`opencodeEvents.ts` vs `opencode.ts`).
- US2 status ID fixes can be done in parallel with US5 navigation fixes.

---

## Parallel Example: User Story 1 & 3

```bash
# Developer A: Implement JSON normalizer fixes (US1)
Task: "Update normalizeOpenCodePayload in iota-bridge/src/services/opencodeEvents.ts to extract content from nested part fields"

# Developer B: Implement model config fixes (US3)
Task: "Add default --model opencode/deepseek-v4-flash-free argument in buildRunArgs in iota-bridge/src/services/opencode.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1, 3, 4 Only)

1. Complete Phase 1: Setup
2. Complete Phase 3: User Story 1 (Nested payload parsing)
3. Complete Phase 4: User Story 3 (Default free model)
4. Complete Phase 5: User Story 4 (Warm server fallback)
5. **STOP and VALIDATE**: Verify a basic prompt executes successfully and streams to the chat timeline.

### Incremental Delivery

1. Foundation & MVP: Setup, US1, US3, US4 -> Basic flow is working and robust.
2. Clean UX: Implement US2 status overwriting -> Timeline is clean.
3. Resilient Navigation: Implement US5 navigation synchronization -> Screens can be switched without losing chat.
4. Serviceability: Implement Foundational logging and US6 log output mapping -> Diagnostics are saved to file.
5. Final Polish: Run quickstart test scenarios and document walkthrough.
