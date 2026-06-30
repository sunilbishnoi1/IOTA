# Data Model: Control Chat OpenCode

## OpenCodeCapabilityState

Represents whether the active Codespace can run OpenCode.

**Fields**:

- `status`: `checking | missing | installing | install_failed | installed_uninitialized | credentials_missing | server_unavailable | available | unavailable`
- `details`: Short user-facing status text
- `canSubmit`: Whether the composer should accept task prompts
- `canInstall`: Whether the setup action should be shown
- `lastCheckedAt`: Timestamp of the latest capability check
- `errorSummary`: Optional concise failure summary

**Validation Rules**:

- `canSubmit` is true only when `status` is `available`, the bridge socket is connected, required transient provider credentials are present, and the last runtime preflight passed.
- `canInstall` is true only when `status` is `missing` or `install_failed`.
- Duplicate install actions are blocked while `status` is `installing`.

**State Transitions**:

- `checking` -> `available`
- `checking` -> `missing`
- `missing` -> `installing`
- `installing` -> `available`
- `installing` -> `install_failed`
- `install_failed` -> `installing`
- `available` -> `credentials_missing` when the socket lacks a supported provider key
- `available` -> `server_unavailable` only when direct run fallback also fails
- `installed_uninitialized` -> `available` after project initialization/preflight succeeds
- any state -> `unavailable` when bridge connectivity prevents capability checks

## OpenCodeConversation

Represents one ongoing chat thread between the user and OpenCode.

**Fields**:

- `id`: IOTA conversation identifier
- `opencodeSessionId`: Optional OpenCode session identifier when known
- `status`: `idle | starting | running | awaiting_first_output | awaiting_approval | completed | stopped | failed | reconnecting`
- `messages`: Ordered list of `ChatMessage` records
- `createdAt`: Creation timestamp
- `updatedAt`: Last event timestamp
- `activeRequestId`: Optional current request identifier
- `lastRunPhase`: Optional diagnostic phase, e.g. `preflight`, `server_start`, `spawned`, `awaiting_first_output`, `streaming`, `finalizing`
- `lastError`: Optional concise retryable error for the latest failed run

**Validation Rules**:

- Only one active request may be running per conversation.
- New user prompts continue the active conversation when `opencodeSessionId` exists.
- A reconnect snapshot must preserve ordering of all known messages and events.

**State Transitions**:

- `idle` -> `starting` after prompt submission
- `starting` -> `awaiting_first_output` after process spawn
- `awaiting_first_output` -> `running` after first JSON/text/status event
- `running` -> `awaiting_approval` when OpenCode requests confirmation
- `awaiting_approval` -> `running` after approve or deny response
- `running` -> `completed` when OpenCode finishes successfully
- `running` -> `stopped` when the user stops the run
- `starting` or `awaiting_first_output` -> `failed` when preflight/spawn/watchdog fails
- `running` -> `failed` on unrecoverable agent failure
- any active state -> `reconnecting` while socket connection is lost
- `reconnecting` -> previous active state after snapshot restore

## ChatMessage

Represents visible timeline content.

**Fields**:

- `id`: Stable message identifier
- `conversationId`: Parent conversation identifier
- `role`: `user | assistant | system | status`
- `content`: Main text content, if applicable
- `createdAt`: Timestamp
- `status`: `pending | streaming | complete | error`
- `metadata`: Optional structured metadata for status rows, diff cards, or approval cards

**Validation Rules**:

- User messages must contain non-empty text.
- Assistant streaming messages may receive multiple text deltas before becoming complete.
- Empty assistant placeholders must be finalized as `complete`, `stopped`, or `error`; they must not remain visible as indefinite `Thinking...` after timeout, stop, navigation, reconnect, or process exit.
- System/status messages must be concise and actionable.

## ToolActivity

Represents a reported OpenCode action.

**Fields**:

- `id`: Stable activity identifier
- `conversationId`: Parent conversation identifier
- `label`: Short user-facing action label
- `kind`: `command | file_read | file_write | search | test | other`
- `status`: `started | running | completed | failed`
- `summary`: Optional details suitable for a compact status row
- `startedAt`: Timestamp
- `completedAt`: Optional timestamp

**Validation Rules**:

- Tool activity labels must be short enough for mobile timeline rows.
- Failed activities include a concise failure summary.

## FileChangeReview

Represents code changes that should be shown as mobile diff cards.

**Fields**:

- `id`: Stable review identifier
- `conversationId`: Parent conversation identifier
- `filePath`: Repository-relative path
- `changeType`: `added | modified | deleted | renamed`
- `additions`: Count of added lines
- `deletions`: Count of removed lines
- `hunks`: Ordered list of diff hunks

**Validation Rules**:

- File paths must be repository-relative.
- Added and removed lines must be visually distinguishable in the UI.
- Very large diffs may be summarized with progressive disclosure instead of rendering every line immediately.

## ApprovalRequest

Represents a user decision required by OpenCode.

**Fields**:

- `id`: Stable approval identifier
- `conversationId`: Parent conversation identifier
- `title`: Short action title
- `description`: User-facing explanation
- `riskLevel`: `low | medium | high`
- `status`: `pending | approved | denied | expired`
- `createdAt`: Timestamp
- `resolvedAt`: Optional timestamp

**Validation Rules**:

- Pending approvals must present exactly two primary decisions: approve and deny.
- Composer submission is disabled or clearly secondary while an approval is pending.
- Approval resolution must be reflected in the chat timeline.
## OpenCodeRunLifecycle

Represents one bridge-managed invocation of OpenCode for a user prompt.

**Fields**:

- `requestId`: Stable request identifier linked to the conversation.
- `conversationId`: Parent conversation identifier.
- `promptMessageId`: User message ID.
- `assistantMessageId`: Assistant message ID once created.
- `phase`: `preflight | server_start | direct_run | attached_run | awaiting_first_output | streaming | finalizing | completed | failed | stopped`.
- `startedAt`: Timestamp.
- `firstActivityAt`: Optional timestamp of first stdout, stderr, JSON event, or normalized progress.
- `finishedAt`: Optional timestamp.
- `exitCode`: Optional process exit code.
- `errorSummary`: Optional sanitized failure text.

**Validation Rules**:

- A run must emit a start/status event within 1 second of accepted submission.
- A run must emit first activity or a retryable watchdog error within the configured first-output timeout.
- Stop must finalize the active run and the assistant message before the next prompt is accepted.
