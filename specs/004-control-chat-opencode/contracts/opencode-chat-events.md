# Contract: OpenCode Chat Events

This contract defines the stable bridge-to-mobile and mobile-to-bridge interaction surface for the chat-first OpenCode Control Screen. Event payloads are logical contracts for implementation and tests; exact internal OpenCode event shapes are normalized by the bridge.

## REST Capability Check

### `GET /api/status`

Returns the bridge and OpenCode capability state used before enabling the composer.

**Response fields**:

- `agentInstalled`: boolean indicating whether OpenCode is available
- `agentName`: expected to be `opencode` for this feature
- `repositoryName`: optional repository display name
- `branchName`: optional branch display name
- `status`: optional `checking | missing | installing | install_failed | installed_uninitialized | credentials_missing | server_unavailable | available | unavailable`
- `details`: optional user-facing status details

**Rules**:

- The mobile app must treat non-JSON or failed responses as unavailable/missing.
- Secrets must not be returned by this endpoint.

## Socket Events: Mobile to Bridge

### `opencode:install`

Starts OpenCode installation if it is missing or retryable.

**Payload**:

```json
{}
```

**Rules**:

- Ignored or rejected while an installation is already running.
- Emits capability/setup events as progress changes.

### `opencode:message`

Submits a user prompt to the current or new OpenCode conversation.

**Payload**:

```json
{
  "conversationId": "optional-iota-conversation-id",
  "sessionId": "optional-opencode-session-id",
  "content": "Fix the checkout padding"
}
```

**Rules**:

- `content` must be non-empty after trimming.
- If `sessionId` exists, the bridge continues that OpenCode session.
- The bridge must reject submission with `OPENCODE_NOT_READY` when binary, initialization, credentials, or runtime preflight is not ready.
- The bridge must emit a run-start/status event within 1 second of accepting a prompt and must emit first activity or `OPENCODE_FIRST_OUTPUT_TIMEOUT` within the configured watchdog window.
- If no session exists, the bridge starts a new OpenCode conversation.
- Rejected while another request is running for the same conversation unless the current state allows continuation.

### `opencode:approval`

Resolves a pending approval request.

**Payload**:

```json
{
  "conversationId": "iota-conversation-id",
  "approvalId": "approval-id",
  "decision": "approve"
}
```

**Rules**:

- `decision` is `approve` or `deny`.
- Rejected if no matching pending approval exists.

### `opencode:sync`

Requests the latest known conversation snapshot after reconnect.

**Payload**:

```json
{
  "conversationId": "optional-iota-conversation-id"
}
```

**Rules**:

- If a matching active conversation exists, the bridge emits `opencode:snapshot`.
- If no conversation exists, the bridge emits an empty ready state.

### `opencode:stop`

Stops the active OpenCode request or conversation run.

**Payload**:

```json
{
  "conversationId": "iota-conversation-id"
}
```

**Rules**:

- Clears active run state but does not persist credentials.
- Finalizes any streaming assistant placeholder as stopped/error before another prompt is accepted.
- Emits a terminal-free status update.

## Socket Events: Bridge to Mobile

### `opencode:capability`

Reports OpenCode availability/setup state.

```json
{
  "status": "available",
  "details": "OpenCode is ready",
  "canSubmit": true,
  "canInstall": false
}
```

### `opencode:snapshot`

Restores known conversation state.

```json
{
  "conversation": {
    "id": "conversation-id",
    "sessionId": "opencode-session-id",
    "status": "running",
    "messages": []
  }
}
```

### `opencode:run_status`

Reports lifecycle progress before assistant text exists.

```json
{
  "conversationId": "conversation-id",
  "requestId": "request-id",
  "phase": "awaiting_first_output",
  "message": "OpenCode started. Waiting for first response...",
  "retryable": false
}
```

**Rules**:

- Must be emitted after an accepted prompt before the UI shows an indefinite assistant placeholder.
- Must be emitted for preflight, server fallback, direct run fallback, first-output timeout, stop, and finalization phases.
- The mobile app renders this as a status row, not raw terminal output.
### `opencode:message_delta`

Streams assistant text.

```json
{
  "conversationId": "conversation-id",
  "messageId": "assistant-message-id",
  "content": "partial text",
  "done": false
}
```

### `opencode:message`

Adds or finalizes a timeline message.

```json
{
  "conversationId": "conversation-id",
  "message": {
    "id": "message-id",
    "role": "assistant",
    "content": "Done.",
    "status": "complete"
  }
}
```

### `opencode:tool_activity`

Adds or updates a compact tool activity row.

```json
{
  "conversationId": "conversation-id",
  "activity": {
    "id": "activity-id",
    "kind": "test",
    "label": "Running tests",
    "status": "running"
  }
}
```

### `opencode:file_change`

Adds a file diff review card.

```json
{
  "conversationId": "conversation-id",
  "change": {
    "id": "change-id",
    "filePath": "iota-mobile/src/screens/ControlScreen.tsx",
    "changeType": "modified",
    "additions": 12,
    "deletions": 4,
    "hunks": []
  }
}
```

### `opencode:approval_request`

Shows approval controls.

```json
{
  "conversationId": "conversation-id",
  "approval": {
    "id": "approval-id",
    "title": "Run command",
    "description": "OpenCode wants to run the validation command.",
    "riskLevel": "medium",
    "status": "pending"
  }
}
```

### `opencode:error`

Reports a recoverable or terminal-free failure.

```json
{
  "conversationId": "optional-conversation-id",
  "code": "OPENCODE_START_FAILED",
  "message": "OpenCode could not start. Try again after checking setup.",
  "retryable": true
}
```

## Required Error Codes

- `OPENCODE_NOT_READY`: Submission rejected because capability/preflight is not ready.
- `OPENCODE_CREDENTIALS_MISSING`: No supported transient provider key was supplied over the active socket.
- `OPENCODE_INSTALL_FAILED`: Installation failed after all configured install methods.
- `OPENCODE_SERVER_UNAVAILABLE`: `opencode serve` or attach mode failed and direct run fallback also failed.
- `OPENCODE_START_FAILED`: The OpenCode child process could not be spawned.
- `OPENCODE_FIRST_OUTPUT_TIMEOUT`: The process started but emitted no stdout/stderr/JSON activity before the watchdog timeout.
- `OPENCODE_RUN_FAILED`: The process exited non-zero after producing a visible error/status.
- `OPENCODE_STOPPED`: The user stopped the current run and the assistant placeholder was finalized.
## Compatibility Notes

- Existing `terminal:log`, `terminal:input`, and terminal emulator rendering are legacy for the Control Screen and must not be used by the new chat UI.
- The bridge may keep internal process execution helpers, but mobile receives only this normalized contract for OpenCode chat behavior.
## OpenCode Runtime Mapping Requirements

The bridge implementation must normalize the OpenCode integration modes documented in `docs/opencode-integration,md` into the event contract above.

- New chat runs use `opencode run <prompt> --format json`.
- When the warm daemon is available, runs may attach through `opencode run --attach http://localhost:4096 <prompt> --format json` after starting `opencode serve --port 4096` inside the Codespace.
- Follow-up prompts include the known OpenCode session identifier using OpenCode continuation flags.
- Reconnect sync may use `opencode session list` or server state logs to recover recent sessions when the in-memory bridge snapshot is insufficient.
- OpenCode `text_delta` payloads map to `opencode:message_delta`.
- OpenCode `tool_start` payloads map to `opencode:tool_activity`.
- OpenCode file modification or unified patch payloads map to `opencode:file_change`.
- OpenCode authorization or confirmation payloads map to `opencode:approval_request` and are resolved through `opencode:approval`.

