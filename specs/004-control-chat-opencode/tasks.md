# Tasks: Control Chat OpenCode

**Input**: Design documents from `/specs/004-control-chat-opencode/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/opencode-chat-events.md, quickstart.md

**Tests**: Required by the IOTA constitution. Add focused tests where harnesses are introduced and always run build/type validation before marking the feature complete.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment. This revision addresses the **Required Repair Plan** from the latest plan.md update (2026-06-26), which identified six failure areas in the current implementation.

## Current State Summary

The bridge and mobile codebase already has:
- Shared types (`iota-bridge/src/types/opencode.ts`, `iota-mobile/src/types/opencode.ts`)
- OpenCode event normalizer (`iota-bridge/src/services/opencodeEvents.ts`)
- OpenCode conversation store (`iota-bridge/src/services/opencodeStore.ts`)
- OpenCode runner with run/serve/install/session support (`iota-bridge/src/services/opencode.ts`)
- Socket service with `opencode:*` events (`iota-bridge/src/services/socket.ts`)
- Status route with capability response (`iota-bridge/src/routes/status.ts`)
- Mobile socket client (`iota-mobile/src/services/opencodeSocket.ts`)
- ControlScreen with chat timeline, setup panel, diff cards, approval controls (`iota-mobile/src/screens/ControlScreen.tsx`)
- Terminal service isolated as internal-only (`iota-bridge/src/services/terminal.ts`)

**What is broken or missing** (from plan.md Known Failure Analysis & Required Repair Plan):
1. Capability checks use binary-only readiness (`which opencode`) — no project init, credential, or runtime validation
2. Socket handler creates an assistant placeholder before verifying `ensureServer()` or process spawn success
3. `ensureServer()` result is ignored; stale server handles route prompts to broken attach paths
4. stderr is accumulated silently until process close — auth/config failures are invisible
5. Timeline state lives only in component state — navigation unmount loses history
6. Stop does not guarantee the assistant placeholder is finalized before allowing the next prompt
7. No first-output watchdog — spawned process can hang indefinitely creating permanent `Thinking...`
8. Install only tries npm — no curl/bash fallback for the official install script
9. `handleInstallOpenCode` clears chat history (`setMessages([])`) during install
10. `opencode:run_status` lifecycle events are not emitted by socket.ts

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks in the same phase when touching different files
- **[Story]**: Maps task to a specific user story from spec.md
- Every task includes an exact file path

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish typed contracts, test harnesses, and shared infrastructure for repair work.

- [x] T001 Create shared bridge OpenCode event and state types in `iota-bridge/src/types/opencode.ts`
- [x] T002 [P] Create shared mobile OpenCode event and UI state types in `iota-mobile/src/types/opencode.ts`
- [x] T003 Add bridge Jest/Supertest test dependencies, config, and scripts in `iota-bridge/package.json`
- [x] T004 [P] Add mobile TypeScript validation and React Native test scripts in `iota-mobile/package.json`
- [ ] T005 [P] Create bridge test setup file for OpenCode socket/service tests in `iota-bridge/src/__tests__/setup.ts`
- [ ] T006 [P] Create mobile test setup file for Control Screen component tests in `iota-mobile/src/__tests__/setup.ts`
- [ ] T007 Add `OpenCodeRunLifecycle` type with `phase`, `requestId`, `firstActivityAt`, `errorSummary` fields to `iota-bridge/src/types/opencode.ts` per data-model.md `OpenCodeRunLifecycle` entity
- [ ] T008 [P] Add `OpenCodeRunStatus` event type and `opencode:run_status` handler type to `iota-mobile/src/types/opencode.ts` per contracts `opencode:run_status` event

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fix the core bridge runtime issues identified in the Required Repair Plan before any user story repair work begins. These are the root causes of the `Thinking...` hang, stale server, and invisible failures.

### Repair 1: Capability must prove runtime readiness

- [ ] T009 Replace binary-only `checkCapability()` with a multi-phase readiness check that validates `opencode --version` output and workspace root existence, returning granular states (`missing`, `installed_uninitialized`, `server_unavailable`, `available`) in `iota-bridge/src/services/opencode.ts`. Note: `AGENTS.md`/project initialization is optional per OpenCode docs and must NOT block readiness. Provider credentials are optional because OpenCode exposes free/no-key models; transient API keys from mobile should be injected when present, but missing credentials must NOT block readiness or prompt submission.
- [ ] T010 Add `hasTransientCredentials(socketId: string): boolean` method to `iota-bridge/src/services/opencodeStore.ts` that checks whether at least one supported provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) is present in the socket's credential map
- [ ] T011 Update `opencode:message` handler in `iota-bridge/src/services/socket.ts` to call the expanded capability check and reject submission with `OPENCODE_NOT_READY` or `OPENCODE_CREDENTIALS_MISSING` error before creating any assistant message placeholder when capability is not `available`

### Repair 2: Installation must use official fallbacks

- [ ] T012 Add curl/bash official install script fallback to `install()` method — after npm global install fails or npm is missing, attempt `curl -fsSL https://opencode.ai/install | bash`, then re-probe the `opencode` executable with the runtime PATH in `iota-bridge/src/services/opencode.ts`
- [ ] T013 After install succeeds, re-run the expanded multi-phase readiness check (not just binary presence) to correctly transition through `installed_uninitialized` → `available` states; emit `opencode:capability` with each transition in `iota-bridge/src/services/opencode.ts`

### Repair 3: Prompt runs must have explicit lifecycle events

- [ ] T014 Refactor `opencode:message` handler in `iota-bridge/src/services/socket.ts` to NOT create an assistant placeholder until the run process has started successfully — move `createAssistantMessage()` call to after spawn verification; emit `opencode:run_status` with phase `preflight` immediately after accepting the prompt, then `spawned`/`awaiting_first_output` after spawn
- [ ] T015 Add a first-output watchdog timer (configurable, default 20 seconds) in `iota-bridge/src/services/socket.ts` or `iota-bridge/src/services/opencode.ts` that kills the run and emits `OPENCODE_FIRST_OUTPUT_TIMEOUT` error with `retryable: true` if no stdout/stderr/JSON event arrives within the window
- [ ] T016 Stream sanitized stderr lines as `opencode:run_status` events (phase `streaming`, message from stderr) in real time instead of accumulating until process close — detect auth/config/startup failure patterns and emit as `opencode:error` immediately in `iota-bridge/src/services/opencode.ts`
- [ ] T017 On process spawn failure (child `error` event), emit `OPENCODE_START_FAILED` error and finalize the run before any further prompts are accepted in `iota-bridge/src/services/socket.ts`

### Repair 4: Server attach must be gated

- [ ] T018 Make `ensureServer()` return a durable readiness result and use it as a gate in `run()` — if port probe fails after spawn, fall back to direct `opencode run ... --format json` for that prompt instead of attaching to a stale `serveProcess` in `iota-bridge/src/services/opencode.ts`
- [ ] T019 Track and clear stale server handles on close/error events and before each attach run; add `clearStaleServer()` cleanup that kills the `serveProcess` and nulls the reference when port 4096 is unreachable in `iota-bridge/src/services/opencode.ts`
- [ ] T020 Emit `opencode:run_status` with phase `server_start` or `direct_run` to inform mobile which execution path is active in `iota-bridge/src/services/socket.ts`

### Repair 5: Stop must finalize assistant placeholders

- [ ] T021 Update `opencode:stop` handler in `iota-bridge/src/services/socket.ts` to finalize any streaming assistant message as `error` or `stopped` status before clearing `activeRequestId`, ensuring the next `opencode:message` submission is not blocked by `OPENCODE_ALREADY_RUNNING`
- [ ] T022 Update `finishRequest()` in `iota-bridge/src/services/opencodeStore.ts` to also set `conversation.lastError` with a sanitized summary when `failed` is true, and to set `lastRunPhase` to `stopped` on stop

### Legacy cleanup verification

- [x] T023 Remove legacy terminal status assumptions from `iota-bridge/src/services/socket.ts` — `terminal:*` events are not used for Control Screen traffic
- [x] T024 Refactor `iota-bridge/src/services/terminal.ts` so any retained PTY helper is internal-only and not the Control Screen interaction model
- [x] T025 Update bridge status detection to return OpenCode-only capability fields in `iota-bridge/src/routes/status.ts`
- [x] T026 Create mobile OpenCode socket client in `iota-mobile/src/services/opencodeSocket.ts`
- [x] T027 Remove Control Screen imports for `TerminalConsole`, `terminal:input`, `terminal:log`, and legacy multi-agent selection from `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T028 Remove or isolate unused xterm constants from `iota-mobile/src/constants/xtermAssets.ts`

**Checkpoint**: Foundation repaired — the bridge has gated runtime readiness, lifecycle events, watchdog timeout, server attach fallback, and stop finalization. No `Thinking...` hang is possible.

---

## Phase 3: User Story 1 – Start an OpenCode Chat Session (Priority: P1) 🎯 MVP

**Goal**: A connected user can submit a task and see user/assistant chat messages with streaming OpenCode text, without any terminal window. The run must either produce content or a visible retryable error — never an indefinite placeholder.

**Independent Test**: Connect to a Codespace with OpenCode installed, open Control Screen, submit a prompt, and verify a user message plus streaming assistant response appear in a chat timeline with no terminal pane, shell prompt, terminal header, or raw log console. Also verify that if credentials are missing, submission is rejected with a clear error — not a `Thinking...` placeholder.

### Tests for User Story 1

- [ ] T029 [P] [US1] Add bridge tests for `opencode:message` submission lifecycle: preflight reject → run_status emit → first-output watchdog → message_delta → final message → snapshot in `iota-bridge/src/services/__tests__/socket.opencode-message.test.ts`
- [ ] T030 [P] [US1] Add bridge tests for `OPENCODE_NOT_READY` and `OPENCODE_CREDENTIALS_MISSING` rejection when capability is not `available` in `iota-bridge/src/services/__tests__/socket.opencode-message.test.ts`
- [ ] T031 [P] [US1] Add bridge tests for `OPENCODE_FIRST_OUTPUT_TIMEOUT` when spawned process produces no output in `iota-bridge/src/services/__tests__/socket.opencode-message.test.ts`
- [ ] T032 [P] [US1] Add mobile Control Screen tests for rendering user messages, streaming assistant content, `run_status` phase display, and absence of terminal UI in `iota-mobile/src/screens/__tests__/ControlScreen.chat.test.tsx`

### Implementation for User Story 1

- [x] T033 [US1] Implement `opencode:message` handling in `iota-bridge/src/services/socket.ts` using the OpenCode runner and event normalizer
- [ ] T034 [US1] **REPAIR**: Update `opencode:message` handler to use the new gated readiness check and lifecycle events from Phase 2 repairs (T011, T014, T015, T017) — verify no assistant placeholder is created before run start, watchdog is armed, and stderr is streamed in `iota-bridge/src/services/socket.ts`
- [x] T035 [US1] Implement assistant message streaming aggregation and finalization in `iota-bridge/src/services/opencodeStore.ts`
- [x] T036 [US1] Implement prompt submission, composer disabled states, and user message insertion in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T037 [US1] Implement chat timeline rendering for user messages, assistant streaming messages, system rows, and empty state in `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T038 [US1] Add `opencode:run_status` handler to mobile socket client in `iota-mobile/src/services/opencodeSocket.ts` and render run status phases as concise status rows in the timeline in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T039 [US1] Replace terminal-era shortcut chips and agent selector with OpenCode-focused chat controls in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T040 [US1] Verify `TerminalConsole` is not rendered from the OpenCode Control Screen path in `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: User Story 1 works independently as a terminal-free OpenCode chat MVP. Submissions either produce streaming text or a visible retryable error.

---

## Phase 4: User Story 2 – Provision OpenCode Without Terminal Exposure (Priority: P1)

**Goal**: A user can detect missing OpenCode, install it with npm global or official curl fallback, see setup progress, retry failures, and then use the chat composer — without viewing terminal logs and without losing existing chat history.

**Independent Test**: Connect to a Codespace without OpenCode, verify setup state and disabled composer, start installation, observe readable progress/status rows, and confirm: (a) success enables the composer after multi-phase readiness passes, (b) failure shows retry with error summary, (c) existing chat history is preserved during install.

### Tests for User Story 2

- [ ] T041 [P] [US2] Add bridge tests for capability state transitions: `missing` → `installing` → `available`, `missing` → `installing` → `install_failed` → `installing` → `available`, npm fallback to curl fallback, duplicate install blocking in `iota-bridge/src/services/__tests__/opencode-install.test.ts`
- [ ] T042 [P] [US2] Add bridge tests for post-install readiness: `install_failed` when binary present but project uninitialized, `credentials_missing` after install when no provider key in `iota-bridge/src/services/__tests__/opencode-install.test.ts`
- [ ] T043 [P] [US2] Add mobile tests for missing/installing/failed/available setup states and verify chat history is NOT cleared during install in `iota-mobile/src/screens/__tests__/ControlScreen.setup.test.tsx`

### Implementation for User Story 2

- [x] T044 [US2] Implement OpenCode installation command handling and progress normalization in `iota-bridge/src/services/opencode.ts`
- [ ] T045 [US2] **REPAIR**: Add curl/bash install fallback per T012 and post-install multi-phase readiness check per T013 in `iota-bridge/src/services/opencode.ts`
- [x] T046 [US2] Implement `opencode:install` and `opencode:capability` socket flows in `iota-bridge/src/services/socket.ts`
- [ ] T047 [US2] Emit granular `opencode:capability` events for each readiness transition after install (binary found → project check → credentials check → available) in `iota-bridge/src/services/socket.ts`
- [x] T048 [US2] Update `GET /api/status` capability response handling in `iota-bridge/src/routes/status.ts`
- [x] T049 [US2] Implement mobile OpenCode setup card, retry action, concise error summary, and disabled composer behavior in `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T050 [US2] **REPAIR**: Remove `setMessages([])`, `setTools([])`, `setFileChanges([])`, `setApprovals([])` calls from `handleInstallOpenCode()` — install must NOT clear existing chat history in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T051 [US2] Render installation progress as chat-native system/status rows in `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: User Story 2 provisions OpenCode with dual fallback and granular readiness without terminal exposure or history loss.

---

## Phase 5: User Story 3 – Preserve Conversation Continuity (Priority: P2)

**Goal**: A user can reconnect or return to Control Screen and continue the same OpenCode conversation with restored visible context. Stopped/error/streaming messages remain in history. Timeline state survives screen unmount.

**Independent Test**: Start an OpenCode task, disconnect/background the mobile app, reconnect, verify snapshot restore with stopped/error messages preserved, and send a follow-up prompt that continues the same OpenCode session.

### Tests for User Story 3

- [ ] T052 [P] [US3] Add bridge tests for session ID capture, continuation flags, snapshot restore with stopped/error message preservation, and `opencode session list` recovery in `iota-bridge/src/services/__tests__/opencode-session.test.ts`
- [ ] T053 [P] [US3] Add mobile tests for reconnect/sync rendering, snapshot merge without losing stopped/error messages, and stable conversation ID across navigation in `iota-mobile/src/screens/__tests__/ControlScreen.sync.test.tsx`

### Implementation for User Story 3

- [x] T054 [US3] Capture OpenCode session IDs from JSON output and store them on conversations in `iota-bridge/src/services/opencodeStore.ts`
- [x] T055 [US3] Add continuation argument construction for follow-up prompts in `iota-bridge/src/services/opencode.ts`
- [x] T056 [US3] Implement `opencode:sync` and `opencode:snapshot` socket handling in `iota-bridge/src/services/socket.ts`
- [x] T057 [US3] Implement `opencode session list` catch-up fallback when bridge memory is stale or empty in `iota-bridge/src/services/opencode.ts`
- [ ] T058 [US3] **REPAIR**: Generate a stable mobile conversation ID per Codespace/repository (using `activeCodespace.id` or `repositoryName`) and persist it in screen-level state or SecureStore so the same conversation is resumed across Control Screen mount/unmount cycles in `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T059 [US3] **REPAIR**: On Control Screen mount and socket reconnect, always request `opencode:sync` with the stable conversation ID, then merge the snapshot with any local pending messages rather than replacing the timeline blindly in `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T060 [US3] **REPAIR**: Keep stopped/error assistant placeholders in the timeline with their final status so that navigation does not make prior attempts disappear — update snapshot merge logic in `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: User Story 3 restores active or recent OpenCode conversations after reconnect, preserves error/stopped history across navigation, and uses a stable conversation ID.

---

## Phase 6: User Story 4 – Review Actions and Approvals in Chat (Priority: P2)

**Goal**: Tool activity, file changes, and approvals are rendered as native mobile UI elements instead of raw terminal output.

**Independent Test**: Run an OpenCode task that reports tool activity, modifies files, and requests approval; verify compact status rows, mobile diff cards, and approve/deny controls work without terminal input.

### Tests for User Story 4

- [ ] T061 [P] [US4] Add bridge tests for tool activity normalization, unified patch parsing, and approval event normalization/resolution in `iota-bridge/src/services/__tests__/opencodeEvents.actions.test.ts`
- [ ] T062 [P] [US4] Add mobile tests for tool rows, diff cards, and approval controls in `iota-mobile/src/screens/__tests__/ControlScreen.actions.test.tsx`

### Implementation for User Story 4

- [x] T063 [US4] Implement file change extraction from OpenCode file modification events and unified patch blocks in `iota-bridge/src/services/opencodeEvents.ts`
- [x] T064 [US4] Implement approval request normalization and resolution mapping through `opencode:approval` in `iota-bridge/src/services/socket.ts`
- [x] T065 [US4] Render compact tool activity rows in the chat timeline in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T066 [US4] Render mobile-readable diff review cards with added and removed line styling in `iota-mobile/src/screens/ControlScreen.tsx`
- [x] T067 [US4] Render approve and deny controls and send `opencode:approval` decisions from `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: User Story 4 exposes OpenCode actions, diffs, and approvals through native chat UI controls.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, regression protection, and end-to-end validation across all stories.

- [ ] T068 Remove obsolete terminal-only Control Screen styles and dead state variables from `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T069 Remove or leave intentionally isolated `TerminalConsole` usage after confirming no Control Screen import remains in `iota-mobile/src/components/TerminalConsole.tsx`
- [ ] T070 Clean up local terminal-era diffs in `iota-bridge/src/services/socket.ts`, `iota-bridge/src/services/terminal.ts`, `iota-mobile/src/constants/xtermAssets.ts`, and `iota-mobile/src/screens/ControlScreen.tsx` so only chat-first OpenCode changes remain
- [ ] T071 Run bridge build validation from `iota-bridge/package.json` and fix any TypeScript errors in `iota-bridge/src/services/opencode.ts`
- [ ] T072 Run mobile TypeScript validation from `iota-mobile/package.json` and fix any errors in `iota-mobile/src/screens/ControlScreen.tsx`
- [ ] T073 Run focused bridge and mobile tests added for this feature and fix failures in `iota-bridge/src/services/__tests__/` and `iota-mobile/src/screens/__tests__/`
- [ ] T074 Execute all 10 scenarios in `specs/004-control-chat-opencode/quickstart.md` and record any implementation notes in `specs/004-control-chat-opencode/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (T007, T008 for new types). **Blocks all user story repair work.**
- **User Story 1 (Phase 3)**: Depends on Foundational repairs; MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundational repairs; can proceed in parallel with US1 after T009/T012 are ready.
- **User Story 3 (Phase 5)**: Depends on US1 because it restores and continues chat conversations.
- **User Story 4 (Phase 6)**: Depends on US1 because actions render inside the chat timeline; can proceed in parallel with US3.
- **Polish (Phase 7)**: Depends on all selected stories.

### User Story Dependencies

- **US1 Start Chat Session**: No story dependency after Foundational repairs; this is the MVP.
- **US2 Provision OpenCode**: No story dependency after Foundational repairs; complements US1 by enabling the missing-agent path.
- **US3 Conversation Continuity**: Requires US1 chat/session flow.
- **US4 Actions and Approvals**: Requires US1 timeline rendering.

### Critical Repair Chain

The Foundational repairs must be applied in this order because each builds on the previous:
1. **T009** (multi-phase readiness) → enables T010 (credential check) → enables T011 (reject gating)
2. **T014** (deferred placeholder + lifecycle events) → enables T015 (watchdog) → enables T016 (stderr streaming) → enables T017 (spawn failure)
3. **T018** (ensureServer gate) → enables T019 (stale cleanup) → enables T020 (run_status)
4. **T021** (stop finalization) → enables T022 (lastError tracking)

### Within Each User Story

- Write tests first and ensure they fail before implementation.
- Bridge event/runtime changes before mobile socket integration.
- Mobile state handling before visual polish.
- Each story checkpoint must pass its independent test before moving to the next priority story.

### Parallel Opportunities

- T005 and T006 can run in parallel.
- T007 and T008 can run in parallel.
- T010 can run in parallel with T012 (different files: opencodeStore.ts vs opencode.ts).
- T015 and T016 can run in parallel with T018/T019 (different repair areas).
- T029, T030, T031, T032 can run in parallel for US1 tests.
- T041, T042, T043 can run in parallel for US2 tests.
- T052 and T053 can run in parallel for US3 tests.
- T061 and T062 can run in parallel for US4 tests.
- US3 and US4 can proceed in parallel after US1 is complete.

---

## Parallel Example: Foundational Repairs

```bash
# Credential check (opencodeStore.ts) and install fallback (opencode.ts)
Task: "T010 Add hasTransientCredentials to iota-bridge/src/services/opencodeStore.ts"
Task: "T012 Add curl/bash install fallback to iota-bridge/src/services/opencode.ts"

# Watchdog (socket.ts/opencode.ts) and server gating (opencode.ts)
Task: "T015 Add first-output watchdog timer in iota-bridge/src/services/opencode.ts"
Task: "T018 Gate ensureServer() result in run() in iota-bridge/src/services/opencode.ts"
```

## Parallel Example: User Story 1

```bash
# Bridge and mobile tests
Task: "T029 [P] [US1] Bridge tests for opencode:message lifecycle in iota-bridge/src/services/__tests__/socket.opencode-message.test.ts"
Task: "T032 [P] [US1] Mobile tests for chat rendering in iota-mobile/src/screens/__tests__/ControlScreen.chat.test.tsx"
```

---

## Implementation Strategy

### MVP First (Repairs + User Story 1)

1. Complete Phase 1 setup (T005–T008).
2. Complete Phase 2 foundational repairs (T009–T022).
3. Complete Phase 3 US1 repairs (T034, T038).
4. Validate: submit a prompt → see run_status → see streaming text OR see retryable error. No `Thinking...` hang.

### Incremental Delivery

1. Foundation repairs → gated readiness, lifecycle events, watchdog, server fallback, stop finalization.
2. US1 → repaired installed OpenCode chat MVP.
3. US2 → install fallback + granular post-install readiness + no history clearing.
4. US3 → stable conversation ID, snapshot merge, error/stopped history preservation.
5. US4 → tool activity, file diffs, and approval controls (already working, just needs test coverage).
6. Polish → validation, cleanup, and quickstart execution.

### Regression Guardrails

- Do not reintroduce `TerminalConsole` into `ControlScreen.tsx`.
- Do not use `terminal:input` as the normal prompt submission path.
- Do not expose `opencode serve` directly to the mobile app; keep it behind the bridge.
- Do not persist user secrets on the Codespace VM.
- Do not leave xterm assets connected to the Control Screen chat path.
- Do not create an assistant placeholder before confirming the run process has started.
- Do not allow `Thinking...` to persist without a watchdog timeout.
- Do not clear chat history during OpenCode installation.
