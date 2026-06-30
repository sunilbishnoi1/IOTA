# Feature Specification: Control Chat OpenCode

**Feature Branch**: `004-control-chat-opencode`

**Created**: 2026-06-25

**Status**: Draft

**Input**: User description: "Fix and change the Control Screen functionality and UI to remove the terminal window fully and make it more like a chat interface like GitHub Copilot or Antigravity. Focus only on integrating OpenCode properly. Remove unnecessary or wrong terminal-oriented changes in the bridge socket service, bridge terminal service, xterm assets, and ControlScreen. Use the OpenCode integration documentation as the source for the correct interaction model."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start an OpenCode Chat Session (Priority: P1)

As a developer using IOTA on mobile, I want to start an OpenCode conversation from a clean chat screen, so that I can describe coding tasks without interacting with a terminal window.

**Why this priority**: This is the core experience. The Control Screen must become an agent chat interface, not a remote shell viewer.

**Independent Test**: Connect to a Codespace, open the Control Screen, submit a task, and verify that the screen shows a user message and a streaming OpenCode assistant response without displaying any terminal frame, prompt, shell header, or raw terminal log panel.

**Acceptance Scenarios**:

1. **Given** the mobile app is connected to a Codespace, **When** the user opens the Control Screen, **Then** the primary content area presents a chat timeline and composer with OpenCode as the only active agent.
2. **Given** OpenCode is available, **When** the user submits a coding request, **Then** the request appears as a user message and the OpenCode response streams into an assistant message in the same conversation.
3. **Given** an OpenCode response is streaming, **When** the response includes progress or action updates, **Then** those updates appear as concise chat-native status rows rather than raw shell output.

---

### User Story 2 - Provision OpenCode Without Terminal Exposure (Priority: P1)

As a developer, I want IOTA to detect and install OpenCode when needed, so that setup does not require manual terminal commands.

**Why this priority**: The app cannot assume OpenCode is present in every Codespace, and provisioning must remain mobile-friendly.

**Independent Test**: Connect to a Codespace without OpenCode, verify the Control Screen shows a focused setup state, trigger installation, and verify progress, success, failure, and retry states are visible without showing a terminal window.

**Acceptance Scenarios**:

1. **Given** OpenCode is missing, **When** the Control Screen loads, **Then** the composer is disabled and a clear OpenCode setup action is displayed.
2. **Given** OpenCode installation is in progress, **When** progress events are received, **Then** the user sees readable setup progress in the chat surface without shell decoration or terminal controls.
3. **Given** installation succeeds, **When** the app refreshes capability state, **Then** the composer becomes available and the setup state is replaced by the normal chat state.
4. **Given** installation fails, **When** the failure is shown, **Then** the user can retry and can read a concise error summary.

---

### User Story 3 - Preserve Conversation Continuity (Priority: P2)

As a developer, I want my OpenCode conversation to continue after app backgrounding or a temporary connection drop, so that long-running coding tasks do not lose context.

**Why this priority**: Mobile connections are unstable, and coding-agent sessions often outlive a single foreground app session.

**Independent Test**: Start an OpenCode task, disconnect or background the mobile app, reconnect, and verify that the chat timeline restores the active session state and continues receiving updates.

**Acceptance Scenarios**:

1. **Given** an OpenCode session is active, **When** the mobile socket reconnects, **Then** the app restores the current chat timeline and active running state.
2. **Given** an earlier OpenCode session exists, **When** the user returns to the Control Screen, **Then** the app can continue the same conversation rather than starting an unrelated one.
3. **Given** no restorable session exists, **When** the user opens the Control Screen, **Then** the app starts from a clean empty chat state.

---

### User Story 4 - Review Actions and Approvals in Chat (Priority: P2)

As a developer, I want OpenCode tool activity, file changes, and approval requests to appear as native mobile UI elements, so that I can understand and control agent actions without reading terminal output.

**Why this priority**: A premium mobile coding-agent experience needs scannable progress, readable diffs, and explicit approval controls.

**Independent Test**: Run a task that triggers file changes and an approval request. Verify tool activity appears as compact status items, file changes appear as reviewable diff cards, and approvals appear as clear approve/deny controls.

**Acceptance Scenarios**:

1. **Given** OpenCode starts a tool action, **When** the action is reported, **Then** the chat timeline shows a compact, descriptive status item.
2. **Given** OpenCode modifies files, **When** changes are available for review, **Then** the UI presents them as readable mobile diff cards with added and removed lines visually distinguished.
3. **Given** OpenCode requires user confirmation, **When** an approval request is active, **Then** the user can approve or deny from a native control without typing into a terminal.

### Edge Cases

- If OpenCode emits malformed or unrecognized event data, the user sees a concise fallback message and the session remains recoverable.
- If the Codespace connection drops while a task is running, the active task remains visible as reconnecting and restores when the bridge is reachable again.
- If installation or agent startup is already running, duplicate start/install actions are blocked and the current progress remains visible.
- If a response is long, the chat timeline remains smooth to scroll and keeps the composer usable.
- If OpenCode is not installed and installation cannot start, the app shows a retryable setup error instead of enabling the composer.
- If a legacy terminal-oriented code path is still present, it must not be reachable from the Control Screen user experience.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Control Screen MUST remove the raw terminal window from the primary user experience, including terminal chrome, shell labels, monospaced terminal panes, and terminal clear/copy controls.
- **FR-002**: The Control Screen MUST present a chat-style timeline with distinct user messages, OpenCode assistant messages, progress/status items, diff review cards, and approval prompts.
- **FR-003**: The Control Screen MUST expose OpenCode as the only selectable or visible agent for this feature scope.
- **FR-004**: Users MUST be able to submit a new OpenCode task from a bottom composer when connected and when OpenCode is available.
- **FR-005**: Users MUST be able to continue an active OpenCode conversation from the same composer without starting an unrelated session.
- **FR-006**: The system MUST detect whether OpenCode is available in the active Codespace before enabling the chat composer.
- **FR-007**: The system MUST provide an OpenCode setup flow when OpenCode is missing, including progress, success, failure, and retry states.
- **FR-008**: OpenCode text output MUST be rendered as assistant chat content rather than as raw process logs.
- **FR-009**: OpenCode tool activity MUST be rendered as concise, readable status elements in the chat timeline.
- **FR-010**: OpenCode file-change information MUST be rendered as mobile-readable diff review elements rather than raw patch text.
- **FR-011**: OpenCode approval requests MUST be surfaced as explicit approve and deny controls.
- **FR-012**: The system MUST preserve enough session state for the user to recover an active or recent OpenCode conversation after a mobile reconnect.
- **FR-013**: The system MUST prevent duplicate task starts or duplicate installation attempts while a prior operation is still running.
- **FR-014**: The system MUST remove or disable obsolete terminal-only behavior from the Control Screen path so that user prompts are not sent as blind terminal keystrokes.
- **FR-015**: The system MUST keep user secrets transient and must not persist injected credentials on the remote machine.
- **FR-016**: The chat timeline MUST remain responsive while displaying long conversations, tool activity, and file-change reviews.

### Key Entities

- **OpenCode Capability State**: Represents whether the active Codespace can run OpenCode, including checking, available, missing, installing, failed, and retryable states.
- **OpenCode Conversation**: Represents a developer's ongoing interaction thread with OpenCode, including user requests, assistant responses, status events, file changes, approvals, and continuation identity.
- **Chat Message**: Represents visible timeline content from the user, OpenCode, or the system.
- **Tool Activity**: Represents a reported OpenCode action such as running a command, inspecting files, or applying changes.
- **File Change Review**: Represents a set of file edits displayed for mobile review.
- **Approval Request**: Represents an OpenCode action that requires the user's explicit approve or deny decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Control Screen task submissions display in a chat timeline without showing a terminal window or shell prompt.
- **SC-002**: Users can submit their first OpenCode task within 10 seconds after opening the Control Screen when OpenCode is already available and the bridge is connected.
- **SC-003**: Users can identify OpenCode setup success or failure within 2 seconds of the final setup result being available.
- **SC-004**: After a temporary disconnect, users can return to an active or recent OpenCode conversation without losing visible context in at least 95% of reconnect attempts under normal network recovery.
- **SC-005**: Long conversations of at least 100 timeline items remain scrollable while keeping message entry responsive.
- **SC-006**: Approval requests can be completed with one explicit approve or deny action and require no typed terminal input.
- **SC-007**: File changes from OpenCode are reviewable as structured mobile UI elements, with additions and deletions visually distinguishable for every changed file shown.

## Assumptions

- OpenCode is the only agent in scope for this feature; other agents remain hidden or disabled until a later feature explicitly reintroduces them.
- A chat-native experience is preferred over preserving the previous terminal emulator behavior.
- Existing mobile-held credential handling remains the source of truth for secrets.
- Codespace-side work may continue during temporary mobile disconnects.
- The existing terminal-oriented changes are not treated as authoritative if they conflict with the chat-first OpenCode experience.