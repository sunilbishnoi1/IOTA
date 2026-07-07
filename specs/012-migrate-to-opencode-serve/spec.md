# Feature Specification: Migrate to OpenCode Serve over HTTP/SSE

**Feature Branch**: `012-migrate-to-opencode-serve`

**Created**: 2026-07-03

**Status**: Draft

**Input**: User description: "We need to change our complete backend (and frontend) to remove everything related to the 'opencode run' functionality and move to 'opencode serve' functionality over http keeping nothing related to the opencode run, we need to rebuild everything. Divide this into three parts as spec: 2 related to the backend, and 1 related to the frontend."

---

## Clarifications

### Session 2026-07-03
- Q: How should IOTA synchronize conversation history with the `opencode serve` database? → A: On session load/sync, fetch history using `GET /session/:id/message` from the `opencode serve` server and rebuild the local conversation snapshot to ensure perfect alignment.
- Q: How should the backend map the multi-stage `opencode serve` tool events (`called`, `success`, `failed`) to the Socket.io client? → A: Stream tool events sequentially: emit a `started` tool activity on `called`, transition status to `completed` on `success`, and to `failed` on `failed`, updating the mobile timeline step-by-step.
- Q: How should the mobile app render the interactive choices for `question.asked` payload? → A: Display a dedicated bottom-sheet modal overlay on the chat screen, rendering checkbox lists for multi-select, radio button lists for single-select, and custom text inputs when text replies are enabled.
- Q: With no process output to monitor, how should the backend watchdog detect a hanging generation? → A: Reset an inactivity watchdog timer on every text/reasoning delta, tool, or question event received from the SSE stream. If the server remains silent for 30 seconds during an active run, trigger `POST /session/:id/abort` to cancel the request and mark the conversation as failed/retryable, allowing the user to resume and retry within the same active session.

### Question asked vs Permissions asked
- `permission.asked` (and `permission.v2.asked`) ask the user to allow/deny tool executions.
- `question.asked` asks the user to select multiple options, single options, or enter custom text responses.
- Both must be fully interactive on the React Native mobile screen, with response choices transmitted back via backend REST API routes.

---

## User Scenarios & Testing

### User Story 1 - Real-time Streaming & Progress (Part 1 & Part 3)
As a developer using IOTA on a mobile device, I want my chat responses to stream character-by-character (including thinking process and tool execution statuses) in real-time, so I can see progress immediately.
- **Independent Test**: Start a new chat, prompt the agent with a multi-step coding task, and verify character-by-character delta streaming of thoughts and assistant text.
- **Acceptance Scenarios**:
  1. **Given** a prompt, **When** the backend client submits it via `prompt_async`, **Then** the local SSE listener maps incoming `session.next.text.delta` and `session.next.reasoning.delta` chunks to socket.io events.
  2. **Given** active tool runs, **When** tool progress events stream (`session.next.tool.called/success/failed`), **Then** the UI timeline updates dynamically with tool execution states.

### User Story 2 - Interactive Prompts (Questions & Permissions) (Part 2 & Part 3)
As a user, I want the agent to request permission to run commands or edit files, and ask clarification questions when instructions are ambiguous, so that I maintain control over execution.
- **Independent Test**: Run a task requiring file modification. Tap "Allow Once" on the mobile permission dialog and verify it succeeds. Run a task with an interactive question block and submit an option.
- **Acceptance Scenarios**:
  1. **Given** a permission check `permission.v2.asked` via SSE, **When** I click "Allow Once" on the dialog, **Then** the frontend posts a reply via `POST /permission/:id/reply`.
  2. **Given** a question `question.asked` via SSE, **When** I fill out the modal form options and submit, **Then** the frontend posts a reply via `POST /question/:id/reply`.

### User Story 3 - Robust Session Management & Control (Part 2)
As a developer, I want to list previous CLI sessions, delete sessions I no longer need, and abort runs that are taking too long, so that I can manage workspace resources cleanly.
- **Independent Test**: Trigger a long-running prompt. Tap the "Stop" button. Verify the generation stops immediately and the session remains responsive.
- **Acceptance Scenarios**:
  1. **Given** an active execution, **When** I trigger abort, **Then** the backend posts `POST /session/:id/abort` and terminates the stream.
  2. **Given** `/sessions` slash command, **When** submitted, **Then** the bridge queries `GET /session` and outputs a clean markdown table of sessions.

---

## Requirements

### Functional Requirements

#### Core Server Lifecycle (Part 1 - Backend)
- **FR-101**: **Serve Daemon**: `ensureServer()` MUST spawn `opencode serve --port 4096 --hostname 127.0.0.1` and verify ready state using `/global/health` check with 2xx HTTP response status.
- **FR-102**: **SSE Client Connection**: Backend MUST maintain a single, persistent HTTP SSE connection to `http://localhost:4096/event`.
- **FR-103**: **Deduplication & Backoff**: SSE listener MUST handle automatic reconnections with exponential backoff `min(1000 * 2^attempt, 30000)` and deduplicate event payloads using their event IDs.
- **FR-104**: **Listener Registry**: Expose an event routing registry Map inside `OpenCodeSSEClient` matching active `sessionID`s to socket-emitter callbacks.

#### HTTP API Integration & Commands (Part 2 - Backend)
- **FR-201**: **Prompt Async Submission**: Prompts MUST be sent via `POST /session/:id/prompt_async`.
- **FR-202**: **Abort Run**: Cancellation MUST be triggered via `POST /session/:id/abort`.
- **FR-203**: **Slash Command Remapping**:
  - `/models` remapped to `GET /config/providers` (extracting and formatting available models).
  - `/stats` remapped to `/global/health` or other diagnostics.
  - `/sessions` remapped to `GET /session` (list sessions).
  - `/sessions delete <id>` remapped to `DELETE /session/:id`.
  - `/export <id>` remapped to `GET /session/:id`.
  - `/compact` or `/summarize` remapped to `POST /session/:id/summarize`.
- **FR-204**: **Approval & Question Postbacks**:
  - Decisions from socket `opencode:approval` MUST call `POST /permission/:requestID/reply` with `{ reply: decision, remember: false }`.
  - Replies from socket `opencode:question_reply` MUST call `POST /question/:requestID/reply` with `{ answers }`.
  - Rejections from socket `opencode:question_reject` MUST call `POST /question/:requestID/reject`.
- **FR-205**: **History Synchronization**: On session load or sync, the backend MUST call `GET /session/:id/message` to fetch history from the server and synchronize the local bridge's in-memory/JSON store.
- **FR-206**: **Tool Execution Stages**: The backend MUST map the granular tool lifecycle SSE events (`session.next.tool.called`, `session.next.tool.success`, `session.next.tool.failed`) to transition tool activity status sequentially (`started` -> `completed` / `failed`) and stream these status changes to the client.
- **FR-207**: **SSE Watchdog Timeout & Session Retry**: The watchdog MUST monitor active SSE stream connection events. If no deltas, tool, or question events are received within 30 seconds of starting or while active, the backend MUST call `POST /session/:id/abort` to cancel the request, and mark the conversation as failed but retryable, permitting the user to retry the execution within the same session.

#### Mobile UI & Interactive Elements (Part 3 - Frontend)
- **FR-301**: **Question Bottom-Sheet Modal**: The mobile app MUST render a dedicated bottom-sheet modal overlay when `question.asked` is active, presenting options as checkbox lists for multi-select (`multiple: true`), radio button lists for single-select (`multiple: false`), and custom text inputs when text answers are enabled (`custom: true`). It MUST block submission until a valid input is selected or entered.
- **FR-302**: **Interactive Approvals Buttons**: The approval card buttons MUST emit clean socket approval signals mapped directly to the REST postback parameters.
- **FR-303**: **Stream Separation**: The timeline and message components MUST map reasoning deltas (`session.next.reasoning.delta`) and text deltas (`session.next.text.delta`) into their respective UI sub-blocks dynamically.
- **FR-304**: **Pipes Clean-up**: Zero dependencies on stdin write-backs (`y\n` / `n\n` text emissions) or child-process spawn outputs in frontend components.

---

## Success Criteria

- **SC-101**: 100% removal of `opencode run` subcommand spawns from backend and frontend files.
- **SC-102**: 100% of tool executions, questions, and message streaming events are successfully parsed and routed via the long-lived HTTP SSE connection.
- **SC-103**: Multiple turn chat sessions persist and resume correctly using the server-side SQLite session storage.
- **SC-104**: Reconnecting after network failures recovers standard status states without hanging spinners.
