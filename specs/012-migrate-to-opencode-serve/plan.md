# Implementation Plan: Migrate to OpenCode Serve over HTTP/SSE

**Branch**: `012-migrate-to-opencode-serve` | **Date**: 2026-07-03 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/012-migrate-to-opencode-serve/spec.md)

---

## Technical Context

**Language/Version**: TypeScript (Node.js backend, React Native/Expo mobile app)

**Primary Dependencies**: `express`, `socket.io`, `socket.io-client`, standard Node `http`/`https` modules (no extra SSE library required)

---

## Proposed Changes

### Spec Part 1: Core Serve Lifecycle & SSE Client (Backend)

This part focuses on establishing a healthy long-lived `opencode serve` process and building the SSE client stream listener.

#### 1. [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- **Serve Daemon Startup**:
  - Keep and refine `ensureServer()`. Probes `http://127.0.0.1:4096/global/health` using HTTP GET.
  - If unresponsive or returns non-2xx status, kill any process on port `4096` using `killProcessOnPort` and spawn `opencode serve --port 4096 --hostname 127.0.0.1`.
- **SSE Client Implementation**:
  - Create a new class `OpenCodeSSEClient` that handles a single persistent TCP/HTTP request to `http://localhost:4096/event`.
  - Parse Server-Sent Events (listening to line chunks matching `data: { ... }` and splitting on double-newlines `\n\n`).
  - Route messages to registered listeners based on `sessionID`.
  - Maintain an automatic retry system: reconnection loops with exponential backoff on disconnects (`min(1000 * 2^attempt, 30000)`).
- **Cleanup runner**:
  - Remove the spawned `opencode run` child-process loop.
  - Delete `OpenCodeRunHandle`, `writeInput`, and related CLI args helpers.

#### 2. [opencodeEvents.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)
- Update `normalizeOpenCodePayload` to translate new server SSE event schemas into IOTA socket-normalized events:
  - `session.next.text.delta` -> `{ type: 'message_delta', content, done: false }`
  - `session.next.reasoning.delta` -> `{ type: 'message_delta', content, done: false }` (wrapped in `<thought>` tags so the frontend parser isolates it cleanly).
  - `session.next.tool.called` -> `{ type: 'tool_activity', activity: { status: 'started', ... } }`
  - `session.next.tool.success` -> `{ type: 'tool_activity', activity: { status: 'completed', output, ... } }`
  - `session.next.tool.failed` -> `{ type: 'tool_activity', activity: { status: 'failed', error, ... } }`
  - `permission.asked` / `permission.v2.asked` -> `{ type: 'approval_request', approval: { status: 'pending', ... } }`
  - `question.asked` -> `{ type: 'question_request', question: { ... } }`
  - `session.status` (if `status.type === 'idle'`) -> Trigger completion handler.

#### 3. [status.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/routes/status.ts)
- Ensure capability checks call the updated `opencodeRunner.checkCapability()` and handle health-check indicators.

---

### Spec Part 2: Request Flow, Commands & Interactive Dialogs (Backend)

This part handles message routing, slash commands, and posting replies to questions and permission approvals.

#### 1. [socket.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- **Initialize Sessions**:
  - When `opencode:message` is triggered, check if the conversation has an `opencodeSessionId`.
  - If missing, perform an HTTP POST request to `http://localhost:4096/session` to obtain a new session and update the local database.
- **Asynchronous Prompting & Watchdog**:
  - Register a listener callback in the SSE client for this session ID.
  - Perform HTTP POST to `http://localhost:4096/session/:sessionId/prompt_async` passing the user content.
  - Establish a watchdog timer of 30 seconds that is re-initialized/reset on every incoming SSE chunk (text/reasoning delta, tool event, or question event).
  - If no SSE activity occurs for 30 seconds while running, call `POST /session/:sessionId/abort` to cancel the execution and mark the conversation status as failed/retryable, permitting the user to retry within the same active session.
  - Upon receiving the `session.status` idle event, remove the listener callback and close the request.
- **History Synchronization**:
  - In the `opencode:sync` socket handler (or when loading active session details), perform an HTTP GET request to `http://localhost:4096/session/:sessionId/message` to fetch history.
  - Reconstruct the local bridge snap and synchronise with the SQLite database to align messages, status states, and timelines.
- **Command Overhaul**:
  - `/models` -> Query `GET http://localhost:4096/config/providers` and list options.
  - `/stats` -> Query `GET http://localhost:4096/global/health` and display.
  - `/sessions` -> Query `GET http://localhost:4096/session` to list active sessions.
  - `/sessions delete <id>` -> Request `DELETE http://localhost:4096/session/:id`.
  - `/export <id>` -> Request `GET http://localhost:4096/session/:id`.
  - `/compact` or `/summarize` -> Request `POST http://localhost:4096/session/:id/summarize`.
- **Interactive Postbacks**:
  - Handle `opencode:approval`: Send `POST http://localhost:4096/permission/:requestID/reply` with `{ reply, remember: false }`.
  - Add socket listener `opencode:question_reply`: Send `POST http://localhost:4096/question/:requestID/reply` with `{ answers }`.
  - Add socket listener `opencode:question_reject`: Send `POST http://localhost:4096/question/:requestID/reject`.

#### 2. [opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts)
- Add storage helpers to associate active requests and keep track of session metadata in SQLite/memory.

---

### Spec Part 3: Mobile UI & SSE-backed Chat Integration (Frontend)

This part implements interactive user controls on the mobile app for handling clarification questions, permissions approvals, and real-time streaming displays.

#### 1. [opencodeSocket.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/opencodeSocket.ts)
- Add socket register methods for:
  - `opencode:question_request` (relays active questions).
  - `opencode:question_reply` (submits user selections/text answers).
  - `opencode:question_reject` (dismisses current question).

#### 2. [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- **Clarifying Questions Modal Overlay**:
  - Maintain a state variable `pendingQuestion` mapping the question schema elements.
  - Render a dedicated bottom-sheet modal overlay on the chat screen when `pendingQuestion` is set.
  - Render checkbox selection lists for multi-select (`multiple: true`), radio selection lists for single-select (`multiple: false`), and input text blocks when custom replies are enabled (`custom: true`).
  - Block modal submission until a selection is clicked or text is entered.
  - Clicking "Submit Answer" calls `emitOpenCodeQuestionReply` and clears state.
  - Clicking "Skip" or "Cancel" calls `emitOpenCodeQuestionReject` and clears state.
- **Interactive Approvals UI**:
  - Display tool permissions cards inline on the timeline.
  - Connect actions ("Allow Once", "Always", "Reject") directly to `emitOpenCodeApproval` socket events.
- **Delta Streams Integration**:
  - Ensure reasoning updates from the SSE reasoning block render cleanly in the dynamic accordion.
  - Strip stdin inputs or terminal inputs references.

---

## Verification Plan

### Automated Tests
1. **SSE Parser Verification**:
   - Write tests in `opencode.test.ts` to mock the `/event` streaming chunks and verify event extraction and deduplication logic.
2. **REST Request Assertions**:
   - Write tests in `socket.test.ts` to check that prompt submission and slash commands invoke appropriate REST routes.
3. **Frontend Dialog Validation**:
   - Test `ControlScreen.tsx` modal controls, checking option selections submit accurate payloads.

### Manual Verification
1. Launch both bridge and app.
2. Verify sessions persist on reload.
3. Test a file edit task and approve permission; verify completion.
4. Test a question-clarification flow and verify answer submission resumes run.
