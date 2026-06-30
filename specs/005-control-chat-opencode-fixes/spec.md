# Feature Specification: OpenCode Integration Fixes

**Feature Branch**: `005-control-chat-opencode-fixes`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "Focus on fixing OpenCode JSON parsing failures, system messages spamming in chat timeline, missing unified file logging, missing default free model specification, warm server gating & run fallbacks, and conversation snapshot & navigation sync issues."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean and Reliable Chat Flow (Priority: P1)

As a mobile app user, I want the assistant's reply to stream and display reliably in the chat window, and I want progress states to show correctly, so that I can see the assistant's response without hitting unexpected timeouts or empty text bubbles.

**Why this priority**: Core functionality. A chat interface that fails to display the assistant's response is completely broken.

**Independent Test**: Submit a prompt to OpenCode via the chat composer, verify that the assistant's response text starts streaming within a few seconds, streams continuously, and completes successfully, showing the final message.

**Acceptance Scenarios**:

1. **Given** a user submits a prompt, **When** the assistant responds with streaming text containing nested parts, **Then** the text is rendered in real-time inside the assistant's message bubble.
2. **Given** the assistant is responding, **When** lifecycle phases like starting or finishing are reached, **Then** they are handled correctly to transition the assistant message state from "thinking" to "streaming" and finally to "complete".

---

### User Story 2 - Consolidated Run Status Reporting (Priority: P2)

As a mobile app user, I want the status/system updates during a task run to be consolidated, so that my chat history is not cluttered with multiple repetitive status bubbles.

**Why this priority**: UX quality. Spamming the timeline with 4-5 status messages per prompt makes the conversation hard to read and unprofessional.

**Independent Test**: Submit a prompt, and verify that the intermediate lifecycle stages update in a single dynamic status indicator/message rather than appending a new message for each phase.

**Acceptance Scenarios**:

1. **Given** the assistant starts executing a prompt, **When** the run transitions through different status phases, **Then** these transitions update a single, stable status row dynamically in real-time.
2. **Given** the status transitions are complete, **When** the assistant's text begins streaming, **Then** the dynamic status row is either replaced or updated to reflect the active streaming state, without leaving behind multiple persistent phase-specific bubbles in the history.

---

### User Story 3 - Native and Config-Free Model Access (Priority: P1)

As a mobile app user, I want the system to run out-of-the-box using a default free model without requiring me to configure external API credentials, so that I can use the control chat immediately.

**Why this priority**: Ease of onboarding and usage. Requiring API keys for default usage creates friction.

**Independent Test**: Start a clean Codespace, connect the mobile app, and submit a prompt. Verify that the task runs immediately using the free model, without prompt rejection or gating based on missing credentials.

**Acceptance Scenarios**:

1. **Given** the user opens the Control Screen, **When** OpenCode is installed, **Then** the interface reports that the agent is available without requiring API credentials.
2. **Given** a prompt is submitted, **When** execution begins, **Then** it uses the default credential-free model, executing successfully without requesting credentials or returning API key errors.

---

### User Story 4 - High-Availability Run Fallbacks (Priority: P1)

As a mobile app user, I want prompt execution to be robust against local warm server port conflicts or attachment failures, so that my tasks still execute successfully via direct command fallbacks.

**Why this priority**: Reliability. Spawning or attaching to a warm server is an optimization, but if it fails, the user's prompt should not hang or fail.

**Independent Test**: Block or simulate a failure on the warm server port (4096), submit a prompt, and verify that the prompt is executed successfully via direct command execution fallback.

**Acceptance Scenarios**:

1. **Given** the warm server cannot start or the port is blocked, **When** the user submits a prompt, **Then** the system automatically falls back to direct command-line run execution.
2. **Given** direct command execution fallback is triggered, **When** execution finishes, **Then** the response is displayed normally to the user.

---

### User Story 5 - Conversation History Navigation Sync (Priority: P2)

As a mobile app user, I want my active chat timeline to be preserved when navigating away to other screens and returning, so that my conversational state and placeholders are not lost.

**Why this priority**: Usability. Navigating between screens should not reset or clear current chat status or messages.

**Independent Test**: Submit a prompt that takes time to stream, navigate to another screen (e.g. Dashboard), navigate back, and verify the timeline is restored in the same state, including any active streaming messages or placeholders.

**Acceptance Scenarios**:

1. **Given** an active or pending chat run, **When** the user navigates away from the Control Screen and returns, **Then** the conversation history is fully restored from the latest bridge snapshot.
2. **Given** the restored history snapshot, **When** there are duplicate messages or pending placeholders, **Then** they are correctly merged or updated without displaying duplicate messages.

---

### User Story 6 - Unified Diagnostics and Operations Log (Priority: P3)

As an operator or debugger, I want all system events and execution outputs to be logged to a single, unified file, so that I can diagnose run hangs, socket connection drops, or CLI failures.

**Why this priority**: Maintainability. Having logs scattered or failing to capture stdout/stderr makes debugging headless environments extremely difficult.

**Independent Test**: Verify that after initiating app connection and running tasks, a unified log file exists in the workspace and contains timestamps, connection events, process status phases, and process outputs.

**Acceptance Scenarios**:

1. **Given** the bridge is running, **When** socket events, execution phases, or child process output (stdout/stderr) occur, **Then** these events are appended to the unified log file in the workspace directory.

### Edge Cases

- **Malformed Payload Handling**: If the agent CLI outputs malformed or unrecognized event data (e.g. unexpected nesting, missing fields), the user sees a concise fallback message and the session remains recoverable.
- **Network Drops**: If the connection drops during execution, the active task remains visible as reconnecting and recovers when the bridge is reachable again, without leaving permanent "thinking" placeholders.
- **Fallback Failure**: If the warm server fails and the direct command execution fallback also fails, a clear, actionable error message is shown to the user instead of hanging.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST parse nested agent text output format correctly and map it to streaming chat message deltas.
- **FR-002**: The system MUST handle agent lifecycle events (such as starting, text emission, and completion) to transition message states accurately.
- **FR-003**: The system MUST consolidate intermediate lifecycle run status messages using a single stable identifier per run to avoid spamming the conversation history.
- **FR-004**: The system MUST write all bridge-level events, socket connection changes, and spawned agent process output (both stdout and stderr) to a unified log file (`bridge.log`) in the workspace.
- **FR-005**: The system MUST run agent prompts using a default free model that requires no external API keys or credentials.
- **FR-006**: The system MUST NOT gate agent availability or prompt submission on the presence of API keys or credentials.
- **FR-007**: The system MUST perform a port probe/liveness check before attempting to attach to a warm agent server, and fall back to direct execution if the server is unreachable or port probe fails.
- **FR-008**: The system MUST synchronize and preserve the exact conversation timeline state, including pending/active runs, across screen navigation and socket reconnection.
- **FR-009**: The mobile app MUST de-duplicate messages and merge snapshot state correctly on remount.

### Key Entities

- **Unified Log File**: The `bridge.log` file stored in the workspace directory, capturing all bridge execution traces and agent subprocess stdout/stderr.
- **Stable Run Status**: A transient or single-identity message structure that represents the current phase of prompt execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid agent JSON text outputs are correctly parsed and rendered as streaming text bubbles in the chat.
- **SC-002**: No more than 1 persistent status/system message remains in the chat timeline per submitted prompt after the prompt run is finalized.
- **SC-003**: A single `bridge.log` file is successfully created in the workspace, capturing both bridge-level socket/status traces and 100% of agent CLI stdout/stderr.
- **SC-004**: 100% of prompts execute successfully without requiring API keys or credentials.
- **SC-005**: When the warm daemon port (4096) is unavailable, 100% of prompts successfully fall back to direct command run execution.
- **SC-006**: 100% of conversation messages and active placeholder states are preserved when navigating away from the chat screen and returning.

## Assumptions

- The default model is always available without credentials.
- The warm daemon runs on port 4096.
- The workspace directory is writeable for writing the `bridge.log` file.
