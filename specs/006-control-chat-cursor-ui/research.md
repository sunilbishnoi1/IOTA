# Research & Decisions: Control Chat Cursor UI/UX Enhancements

## 1. Sorting & Grouping Timeline Logs

### Problem
Currently, tool activities, file changes, and approvals are rendered as top-level flat list items intermixed with user and assistant messages. This makes the timeline extremely cluttered and hard to read, especially during long multi-tool runs.

### Decision
Group all activities (tools, file changes, approvals) under their respective assistant response turn.
- A "turn" corresponds to an assistant message (or the active run, if the assistant message is not yet created).
- Activities are mapped to an assistant response if their start time falls between the preceding user message's timestamp (`prevUserTime`) and the following user message's timestamp (`nextUserTime`).

### Rationale
This client-side grouping logic avoids making database schema changes in the bridge store or complex websocket payload modifications. It is self-healing upon websocket synchronization/reconnections because it relies entirely on the timestamps of the messages.

### Alternatives Considered
- **Server-Side Grouping**: Grouping activities by message ID on the bridge before sending.
  - *Why Rejected*: The bridge store does not link tool executions or file changes to a specific assistant message ID, and database schema updates would introduce high overhead and risk.
- **Client-Side Sessional Mapping**: Keeping an in-memory list of active activities and appending them to the active message.
  - *Why Rejected*: If the websocket reconnects and requests a conversation snapshot (`opencode:sync`), the local in-memory mappings would be lost. Timestamp-based mapping is stateless and fully sync-compatible.

---

## 2. File Change Timestamps

### Problem
`OpenCodeFileChange` objects currently lack a timestamp, causing the client to sort them by `change.id` (which starts with `change-`), resulting in alphabetical rather than chronological sorting.

### Decision
Add `createdAt: string` to `OpenCodeFileChange` on both client and server side. The bridge's `normalizeOpenCodePayload` will populate it using `new Date().toISOString()`.

---

## 3. Dynamic Full-Width AI Bubble Layout

### Problem
The chat bubble layout wraps markdown content (especially code blocks) inside tight bubble constraints (`maxWidth: '88%'`), causing horizontal wrapping and poor readability on mobile screens.

### Decision
Remove the traditional bubble container wrapper, borders, and background from assistant messages.
- Assistant responses will render inline, taking `width: '100%'`.
- Inside assistant messages, Markdown text will render directly, while code blocks (`code_block` and `fence`) will render as high-contrast rounded cards with full-width layout, a header showing the language, and a copy button.
- User messages will remain in a distinct styled bubble aligned to the right.
