# Tasks: Migrate to OpenCode Serve over HTTP/SSE

**Input**: Design documents from `/specs/012-migrate-to-opencode-serve/`

**Prerequisites**: plan.md (required), spec.md (required)

---

## Phase 1: Setup

- [ ] T101 Run TypeScript compilation check in `iota-bridge` to confirm baseline.
- [ ] T102 Run TypeScript compilation check in `iota-mobile` to confirm baseline.

---

## Phase 2: Foundational (Backend Core Lifecycle & SSE Client)

**Purpose**: Set up `opencode serve` process management and the persistent SSE listener.

- [ ] T103 **Serve Lifecycle Setup**:
  - Update `ensureServer()` in `iota-bridge/src/services/opencode.ts` to probe `/global/health` using HTTP GET on port `4096`.
  - Spawn `opencode serve --port 4096 --hostname 127.0.0.1` if health-checks fail.
- [ ] T104 **SSE Client connection**:
  - Implement class `OpenCodeSSEClient` in `iota-bridge/src/services/opencode.ts`.
  - Connect to `http://localhost:4096/event` via Node's `http` module.
  - Implement lines/chunks buffer logic to split streams on double-newlines (`\n\n`) and extract JSON data rows.
  - Expose registration methods for session listeners: `registerSessionListener(sessionId, callback)` and `unregisterSessionListener(sessionId)`.
  - Add auto-reconnect backoff logic: `min(1000 * 2^attempt, 30000)` on connection drops.
- [ ] T105 **Payload Mapping**:
  - Update `normalizeOpenCodePayload` in `iota-bridge/src/services/opencodeEvents.ts` to map incoming server SSE schema events (`session.next.text.delta`, `session.next.reasoning.delta`, `session.next.tool.called/success/failed`, `permission.asked`, `permission.v2.asked`, `question.asked`, `session.status`) to local timeline socket payloads. Map sequential transitions (`started` -> `completed` / `failed`) for tool activities.
- [ ] T106 **Cleanup old spawned run references**:
  - Remove process-spawned `opencode run` child execution loops, runner classes, handle abstractions, and input pipe writers from `iota-bridge/src/services/opencode.ts`.

---

## Phase 3: Request Flow, Commands & Interactive Dialogs (Backend)

**Purpose**: Modify prompt submission, slash commands, and approval/question responses to execute REST calls.

- [ ] T107 **Async Prompt Execution & Watchdog**:
  - Update `opencode:message` socket listener in `iota-bridge/src/services/socket.ts`:
    - Perform `POST /session` if `opencodeSessionId` is not stored.
    - Attach session callback listener to the SSE client.
    - Call `POST /session/:sessionId/prompt_async` with prompt payload.
    - Route SSE chunks back to the client via Socket.io.
    - Implement the watchdog timer to monitor active stream chunk events (deltas, tools, or questions). If silent for 30 seconds, call `POST /session/:sessionId/abort` to cancel, and emit a failed but retryable state to allow resuming within the same session.
    - Detach session listener and complete the request once `session.status` is `idle`.
- [ ] T108 **History Synchronization**:
  - Implement `opencode:sync` socket handler (and/or on session load) in `iota-bridge/src/services/socket.ts` to execute `GET /session/:sessionId/message`.
  - Reconstruct the local bridge snapshot from server history and update the database to align conversation state.
- [ ] T109 **Abort Endpoint**:
  - Remap `opencode:stop` socket handler in `iota-bridge/src/services/socket.ts` to make REST call `POST /session/:sessionId/abort`.
- [ ] T110 **Command Overhaul**:
  - In `iota-bridge/src/services/socket.ts`, update slash commands to query API endpoints:
    - `/models` -> `GET /config/providers`
    - `/stats` -> `GET /global/health`
    - `/sessions` -> `GET /session`
    - `/sessions delete <id>` -> `DELETE /session/:id`
    - `/export <id>` -> `GET /session/:id`
    - `/compact` / `/summarize` -> `POST /session/:id/summarize`
- [ ] T111 **Approval and Question Postbacks**:
  - In `iota-bridge/src/services/socket.ts`, map `opencode:approval` events to `POST /permission/:requestID/reply` with `{ reply, remember: false }`.
  - Add socket listener `opencode:question_reply` to perform `POST /question/:requestID/reply` with `{ answers }`.
  - Add socket listener `opencode:question_reject` to perform `POST /question/:requestID/reject`.

---

## Phase 4: Frontend Integration & Interactive UI (Frontend)

**Purpose**: Update mobile screens to show question inputs, permissions options, and stream text/reasoning deltas.

- [ ] T112 **Question Socket Emitters**:
  - Update `iota-mobile/src/services/opencodeSocket.ts` to include handlers for `opencode:question_request` and emitters `emitOpenCodeQuestionReply` / `emitOpenCodeQuestionReject`.
- [ ] T113 **Clarifying Questions Bottom-Sheet Modal**:
  - Implement a dedicated bottom-sheet modal overlay inside `iota-mobile/src/screens/ControlScreen.tsx` (using standard modal components) when `question.asked` payload is received.
  - Present choices as checkbox lists for multi-select (`multiple: true`), radio button lists for single-select (`multiple: false`), and input text blocks when custom responses are enabled (`custom: true`). Block submission until choices are entered.
  - Connect submission action to `emitOpenCodeQuestionReply`, and skip/cancel action to `emitOpenCodeQuestionReject`.
- [ ] T114 **Stream Integration**:
  - Update timeline handlers in `ControlScreen.tsx` to handle standard delta streams and map reasoning updates directly into thinking containers. Remove stdin and console execution simulation loops.

---

## Phase 5: Verification & Tests

- [ ] T115 Write backend tests in `iota-bridge/src/services/__tests__/opencode.test.ts` verifying SSE client streams parsing and listener callbacks.
- [ ] T116 Write backend tests in `iota-bridge/src/services/__tests__/socket.test.ts` verifying prompt submissions and command API queries.
- [ ] T117 Write frontend tests in `iota-mobile/tests/screens/ControlScreen.test.tsx` verifying questions selection card modal state and emitters.
