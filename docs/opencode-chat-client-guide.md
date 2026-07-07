# OpenCode Chat Client Architecture Guide

> **Date**: 2026-07-04 | **Scope**: Full analysis of IOTA mobile chat UI vs real opencode TUI/Web clients

---

## 1. How the Real opencode TUI/Web Connects

The opencode TUI and Web clients use the **`@opencode/sdk`** library (in-process). There is **zero middleware** between `opencode serve` and the UI:

```
opencode serve (port 4096)
     ↕  HTTP/SSE (direct, in-process via SDK)
SDK (@opencode/sdk — typed fetch wrapper)
     ↕  Typed event streams
TUI/Web UI (Solid.js / React)
```

The SDK is a TypeScript library that wraps `fetch()` calls — not a separate server process. The TUI finds `opencode serve` via a Unix socket or localhost URL and connects directly.

**Source reference**: `packages/tui/src/context/sdk.tsx` — uses `createOpencodeClient({ baseUrl: props.url })` then `sdk.global.event({ signal })` to get an async iterable of SSE events.

---

## 2. Event Architecture: Two Layers

### Layer 1: V2Event (new, `session.next.*` prefix)

Fine-grained lifecycle events for message creation. Source: `packages/sdk/js/src/v2/gen/types.gen.ts`.

| Event Type | Purpose | Key Fields |
|-----------|---------|------------|
| `session.next.prompted` | User sent a prompt | `sessionID` |
| `session.next.step.started` | Assistant message begins | `sessionID`, `assistantMessageID` |
| `session.next.text.started` | Text streaming starts | `sessionID`, `assistantMessageID`, `textID` |
| `session.next.text.delta` | Text chunk | `sessionID`, `textID`, `delta` |
| `session.next.text.ended` | Text complete (full text) | `sessionID`, `textID`, `text` |
| `session.next.reasoning.started` | Thinking starts | `sessionID`, `reasoningID` |
| `session.next.reasoning.delta` | Thinking chunk | `sessionID`, `reasoningID`, `delta` |
| `session.next.reasoning.ended` | Thinking complete | `sessionID`, `reasoningID`, `text` |
| `session.next.tool.input.started` | Tool parameter construction | `sessionID`, `callID`, `toolName` |
| `session.next.tool.input.delta` | Tool input streaming | `sessionID`, `callID`, `delta` |
| `session.next.tool.input.ended` | Tool params complete | `sessionID`, `callID`, `input` |
| `session.next.tool.called` | Tool execution begins | `sessionID`, `callID`, resolved params |
| `session.next.tool.progress` | Streaming progress | `sessionID`, `callID`, `content` |
| `session.next.tool.success` | Tool completed | `sessionID`, `callID`, `result`, `output` |
| `session.next.tool.failed` | Tool failed | `sessionID`, `callID`, `error` |
| `session.next.step.ended` | Step complete | `sessionID`, tokens, cost |
| `session.next.retried` | Step retry | `sessionID` |
| `session.next.step.failed` | Step failed | `sessionID`, `error` |

### Layer 2: GlobalEvent (legacy, `message.part.*` / `session.*` prefix)

Coarser events for session management. Source: `packages/tui/src/context/sync.tsx`.

| Event Type | Purpose |
|-----------|---------|
| `message.updated` | Full message updated |
| `message.removed` | Message deleted |
| `message.part.updated` | Part within a message updated |
| `message.part.delta` | Delta applied to a part field |
| `session.updated` | Session metadata changed |
| `session.status` | Session state (idle/busy/retry) |
| `permission.asked` | Permission/approval request |
| `permission.replied` | Permission response |
| `question.asked` | Clarifying question |
| `question.replied` | Question answered |
| `session.diff` | File diff available |
| `todo.updated` | Todo list item changed |

---

## 3. Data Model: Part-Based (No HTML Tags)

**Critical**: The real opencode TUI does **NOT** use `<thought>` or `<intermediate>` HTML tags. Instead, assistant messages have a typed content array:

```typescript
interface SessionMessage {
  id: string
  role: "user" | "assistant" | "shell" | "system"
  time: { created: number; completed?: number }
  content: Part[]           // Only for "assistant" role
  error?: { name: string; message: string }
}

type Part =
  | { type: "text"; id: string; text: string; time: { created: number } }
  | { type: "reasoning"; id: string; text: string; time: { start: number; end?: number } }
  | { type: "tool"; id: string; name: string; callID: string;
      state: ToolState; time: { start: number; end?: number } }

type ToolState =
  | { status: "pending" | "running"; input: Record<string, unknown> }
  | { status: "completed"; input: Record<string, unknown>; result: unknown; output?: string }
  | { status: "error"; input: Record<string, unknown>; error: string }
```

### Delta appending (from `data.tsx`):

```typescript
// For text delta:
case "session.next.text.delta":
  message.update(sessionID, (draft) => {
    const match = message.latestText(assistant(draft, assistantMessageID), textID)
    if (match) match.text += delta  // Append chunk
  })

// For reasoning delta:
case "session.next.reasoning.delta":
  message.update(sessionID, (draft) => {
    const match = message.latestReasoning(assistant(draft, assistantMessageID), reasoningID)
    if (match) match.text += delta
  })
```

---

## 4. Reasoning (Thinking) Display

### Source: `packages/tui/src/context/thinking.ts`

The `reasoningSummary()` function parses the first bold line as a title:

```typescript
export function reasoningSummary(text: string) {
  const match = text.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
  if (!match) return { title: null, body: text }
  return { title: match[1].trim(), body: text.slice(match[0].length).trimEnd() }
}
```

### Two visibility modes:

| Mode | Behavior |
|------|----------|
| `"show"` | Always expanded — full reasoning body visible |
| `"hide"` (default) | Collapsed by default — single-line header, tap to expand |

### ReasoningPart component (`session/index.tsx`):

**While streaming** (`time.end === undefined`):
- Show spinner + "Thinking: \<title\>"
- No expand/collapse toggle (auto-expanded while in progress)

**After completion** (`time.end !== undefined`):
- Header: "Thought: \<title\> · \<duration\>" in muted/warning color
- Toggle button: `[▼]` collapsed / `[▲]` expanded
- Body: Full markdown rendering of reasoning text

**Edge cases**:
- If `<title>` is null → show "Thought Process" or "Thought · 12s"
- OpenRouter's `[REDACTED]` is stripped from display
- Multiple reasoning parts in one message → each gets its own collapsible block

---

## 5. Tool Activity Display

### Source: `packages/tui/src/routes/session/index.tsx`

The `PART_MAPPING` dispatches by part type to renderers. Tool parts dispatch by tool name:

| Tool Name | Renderer | Display Pattern |
|-----------|----------|-----------------|
| `bash` / `execute` / `shell` | `Shell` | **Block**: `$ command` header + stdout/stderr terminal (collapsed >10 lines) |
| `glob` | `Glob` | **Inline**: icon + `Glob "pattern" (N files)` |
| `read` | `Read` | **Inline**: icon + `Read file.ext L1-L50` (expand for content) |
| `grep` | `Grep` | **Inline**: icon + `Grep "pattern" (N matches)` |
| `write` | `Write` | **Inline while pending**: `Write file.ext` → **Block on complete**: code preview |
| `edit` | `Edit` | **Block**: syntax-highlighted diff view (green/red lines) with file header |
| `websearch` | `WebSearch` | **Block**: search results with titles, URLs, snippets |
| `webfetch` | `WebFetch` | **Inline**: icon + URL |
| `task` | `Task` | Subagent session with child navigation |
| `apply_patch` | `ApplyPatch` | **Block**: multi-file diff with add/delete/move indicators |
| `question` | `Question` | Inline question prompt |

### Two rendering primitives:

1. **`InlineTool`**: Single-line with icon prefix + text. States:
   - Pending: spinner + label
   - Running: animated icon + label
   - Completed: checkmark icon + label (color: success green)
   - Failed: error icon + label (color: error red)

2. **`BlockTool`**: Multi-line bordered block. Used for:
   - Shell output (command + stdout + stderr + exit code)
   - File diffs (line numbers, syntax highlighting, +/- coloring)
   - Search results (list of results)

### Tool output collapsing (`collapse-tool-output.ts`):

```typescript
// Shell output: max 10 lines / 5000 chars
// Generic tool output: max 3 lines / 500 chars
// Shows "…" overflow indicator + toggle
```

---

## 6. Timeline Ordering

### Message storage

Messages are stored as a prepended array (new items at front):

```typescript
message.prepend(draft, item) {
  if (messages.some(existing => existing.id === item.id)) return  // dedup
  messages.unshift(item)  // new items at index 0
}
```

### Completion tracking

```typescript
// Determine which assistant message is still pending:
const pending = createMemo(() => {
  const completed = messages().findLast(x => x.role === "assistant" && x.time.completed)?.id
  return messages().findLast(x =>
    x.role === "assistant" && !x.time.completed && (!completed || x.id > completed)
  )?.id
})
```

### Turn structure

- User messages create new turns (linked via `parentID`)
- Assistant messages point back to the user message that triggered them
- Parts within an assistant message maintain **arrival order** (interleaved: reasoning → text → tool → text → reasoning)
- Child sessions (subagents) have separate message lists with their own navigation

---

## 7. Permission/Approval Flow

### Source: `packages/tui/src/routes/session/permission.tsx`

The `PermissionPrompt` handles `permission.asked` events:

1. Receives `{ requestID, action, paths?, directory, workspace }`
2. Renders a bordered dialog overlay above the prompt input
3. Three actions:
   - **Allow once**: `POST /permission/{requestID}/reply { reply: "once" }`
   - **Allow always**: Prompts for path pattern whitelisting, then `reply: "always"`
   - **Reject**: Optional text input for feedback message, then navigates to "reject" stage
4. Context-sensitive: For `edit` permissions, shows a diff preview before approving
5. Supports keyboard nav, mouse hover, fullscreen toggle
6. **Auto-approve mode**: If `permission.mode === "auto"`, auto-replies `"once"` without showing UI

---

## 8. Question Prompt Flow

### Source: `packages/tui/src/routes/session/question.tsx`

The `QuestionPrompt` handles `question.asked` events:

```typescript
type QuestionInfo = {
  question: string       // Full question text
  header: string         // Short tab label (max 30 chars)
  options: Array<{       // Possible answers
    label: string
    description: string
  }>
  multiple?: boolean     // Allow multiple selections
  custom?: boolean       // Allow custom typed answer
}
```

**UI flow:**
1. Tab-based navigation when multiple questions are asked
2. Single-select (`multiple !== true`): Tap to answer immediately
3. Multi-select (`multiple === true`): Checkboxes with "Confirm" tab to submit
4. Custom answer: Text input field (can combine with preset options in multi-select)
5. Review: Confirm tab shows all answers before submission

**Submission**:

```typescript
void sdk.client.question.reply({
  requestID: props.request.id,
  answers: [["selected_option"], ["another_answer"]],  // answers[][] — one array per question
})
```

---

## 9. Abort/Stop

### Source: `packages/tui/src/context/sync.tsx` + `session/index.tsx`

```typescript
// Send abort:
await sdk.client.session.abort({ sessionID }).catch(() => {})

// Backend stops streaming and emits:
// session.next.step.failed { error: { name: "MessageAbortedError" } }
```

**UI after abort:**
- The aborted assistant message remains visible but shows "**· interrupted**" suffix
- The `pending` memo returns `undefined` — stop button disappears
- User can continue the conversation with a new prompt

---

## 10. Key Architectural Comparison: IOTA Current vs Real TUI

| Aspect | IOTA Current (bridge normalization) | Real TUI (SDK direct) | Impact |
|--------|-------------------------------------|----------------------|--------|
| **Connection** | Bridge → SSE → Socket.IO → Mobile | In-process SDK → serve | IOTA needs bridge for network topology |
| **Reasoning format** | `<thought>` HTML tags | `type: "reasoning"` Part | Tags are fragile; Part model is typed |
| **Intermediate text** | `<intermediate>` HTML tags | Interleaved Parts in content[] | Tags work but lack structure |
| **Event granularity** | Coarse: `message_delta` with `done` | Fine: `.started/.delta/.ended` per type | IOTA can't distinguish text vs reasoning at event level |
| **Tool rendering** | Generic row with metadata | 15+ specialized renderers by tool name | IOTA loses context-specific UX |
| **Thinking header** | "Thought Process" or "Thought for Xs" | Bold-title `**Title**` parsed from content | IOTA doesn't extract semantic titles |
| **User preference** | No thinking visibility toggle | 3 modes: show/hide/auto | Missing user control |
| **Abort indicator** | Clears running + appends error | "interrupted" badge on aborted message | IOTA loses partial message context |
| **Tool output truncation** | Manual ScrollView + "Show more" | Auto `collapseToolOutput()` with thresholds | Both work, TUI has standardized numbers |
| **Cost/tokens display [future]** | Not implemented | `step.ended` includes token usage | Missing in IOTA |
| **Event batching** | 100ms flush timeout | 16ms Solid.js batch window | Both batch, different thresholds |
| **Permission flow** | Inline card with 3 buttons | Overlay dialog with context actions | IOTA simpler, TUI richer |
| **Question flow** | Single question at a time | Tab-based multi-question + custom answers | IOTA simpler, TUI supports complex flows |

---

## 11. Recommended Architecture: Option B (Lightweight Pass-Through Bridge)

### Current (Option A — heavy normalization):

```
opencode serve
    ↕ SSE raw events
iota-bridge
    ├─ Parses each event type
    ├─ Wraps reasoning in <thought> tags
    ├─ Batches text deltas into message_delta
    ├─ Converts tool lifecycle to flat activity objects
    └─ Forwards 8 socket.io event types
iota-mobile
    ├─ Receives coarse events
    ├─ Parses HTML tags to separate thought/text/intermediate
    └─ Renders with generic components
```

### Recommended (Option B — lightweight pass-through):

```
opencode serve
    ↕ SSE raw events
iota-bridge
    ├─ Thin relay: forwards events as-is over Socket.IO
    ├─ Manages session lifecycle (create/abort/sync)
    ├─ Watchdog timer for inactivity
    └─ Conversation store (SQLite persistence)
iota-mobile
    ├─ Receives full V2Event types
    ├─ Implements Part-based data model (like data.tsx)
    ├─ Built-in type guards for text/reasoning/tool
    ├─ Specialized renderers per tool type
    └─ Proper thinking modes + abort indicators
```

### Why Option B wins:

1. **Event fidelity preserved** — Mobile gets `reasoning.started/delta/ended`, `tool.called/success/failed`, etc. directly
2. **No fragile HTML tag parsing** — Parts are typed objects, not regex-parsed strings
3. **Mobile code mirrors TUI** — Can reuse patterns from `data.tsx`, `thinking.ts`, etc.
4. **New serve events flow through** — Unknown event types are ignored, not broken
5. **Bridge becomes simpler** — Event normalization code (~200 lines) is replaced with a thin relay
6. **Mobile handles complexity when it matters** — Tool-specific UIs, thinking preferences, etc. belong in the UI layer

### What the bridge still does:

- Spawns/manages `opencode serve` process
- Authenticates (HTTP Basic Auth)
- Maintains SSE connection with reconnection
- Relays events over Socket.IO (with auth)
- Manages conversation store (SQLite)
- Watchdog timer
- REST endpoints for slash commands (`/models`, `/sessions`, etc.)

---

## 12. Implementation Checklist

### Bridge changes (iota-bridge)

#### `iota-bridge/src/services/opencodeEvents.ts` — REPLACE (event normalizer → thin relay)

**Current (what it does):** ~524 lines. `normalizeOpenCodePayload()` maps raw SSE events to 10 custom IOTA event types (e.g. `session`, `run_status`, `message_delta`, `message`, `tool_activity`, `file_change`, `approval_request`, `question_request`, `error`, `todo_updated`). All event fidelity (reasoning vs text, tool lifecycle) is lost in normalization.

**Target (what it should do):** ~50-100 lines. A thin relay module with two functions:
- `classifyEvent(raw: object): { type: "v2"|"global", eventType: string, payload: object }` — detect event layer and type
- `relayEvent(socket: Socket, raw: object): void` — emit the raw typed event on a single Socket.IO channel (`opencode:sse_event`) or (optionally) emit type-specific events

**Key differences:**
- No `normalizeOpenCodePayload()` — removed entirely
- No `extractText()`, `mapToolKind()`, `extractMetadata()` helpers — removed
- Output is raw typed JSON, not transformed IOTA custom events

**Rationale:** Mobile needs access to granular event types (`.started/.delta/.ended`), typed parts (text/reasoning/tool), and tool metadata (name, input, result). The current normalizer throws all this away.

---

#### `iota-bridge/src/services/opencode.ts` — MODIFY (SSE client)

**File:** ~1392 lines, `OpenCodeSSEClient` class

**Current behavior:**
- `start()`: Establishes a raw connection to the SSE stream at `OPENCODE_PORT` (4096) with basic auth credentials, processes chunk buffers using boundaries (`\n\n` or `\r\n\r\n`), flattens `properties` envelopes, and dispatches to registered session listeners.
- `executePrompt()`: Registers a session listener and triggers `POST /session/{id}/prompt_async`.

**Changes needed:**
- [ ] Add `onEvent: (type: string, payload: object) => void` callback (or equivalent typed callback) to standard dispatchers
- [ ] Ensure V2 session subscriptions are explicitly handled if `opencode serve v2` requires subscribing to a session's stream after creation

---

#### `iota-bridge/src/services/socket.ts` — MODIFY (Socket.IO server wiring)

**File:** ~1086 lines, inline Socket.IO connection event handlers

**Current behavior:**
- Registers connection listeners inline inside `io.on('connection')`.
- Creates `onJson` callback containing ALL event normalization and HTML tag injection logic (~200 lines inline).
- Maps `message.part.updated` and `message.part.delta` events and injects `<thought>`/`</thought>` tags into message deltas.
- Emits 10 custom Socket.IO event types.

**Changes needed:**
- [ ] Replace the inline `onJson` normalization and tag-wrapping blocks with a call to `relayEvent(socket, rawEvent)`
- [ ] Add Socket.IO event emission for the relayed raw events:
  - **Option B1 (single channel)**: Emit all raw events on `opencode:sse_event` with a `{ type: string, payload: object }` envelope. Simpler bridge, mobile does all routing. (Recommended)
- [ ] Keep all existing socket event handlers that deal with session lifecycle (message, stop, approval reply, question reply, sync, etc.)
- [ ] Keep watchdog timer logic (30s idle, 300s during tool execution)
- [ ] Keep conversation store persistence calls

---

#### `iota-bridge/src/services/opencodeStore.ts` — MODIFY (conversation persistence)

**File:** ~424 lines, `OpenCodeStore` class

**Current behavior:**
- In-memory + JSON file storage of conversations
- `appendAssistantDelta()`: Appends text delta directly to assistant message content string
- `addTool()`: Appends tool activity to flat array
- `addFileChange()`, `addApproval()`: Store flat typed arrays

**Changes needed:**
- [ ] `appendAssistantDelta()` → replace with part-based append: find part by `partID`, append `delta` to part's content
- [ ] `addTool()` → store full tool state (`pending/running/completed/error` + input + result + output)
- [ ] Add methods for part lifecycle: `startPart(type, id)`, `appendPartDelta(partID, delta)`, `endPart(partID)`
- [ ] `finishRequest()` → handle completed token usage info from `step.ended` event
- [ ] `getSnapshot()` → return Part-based message content instead of flat text+tool arrays

---

#### `iota-bridge/src/routes/status.ts` — LIKELY UNCHANGED

Health check endpoint. Only modify if new session state needs to be exposed.

---

### Mobile changes (iota-mobile) — major rewrite of chat state layer

#### `iota-mobile/src/types/opencode.ts` — ADD NEW TYPES

**File:** ~143 lines

**Changes needed:**
- [ ] Add the following V2Event, GlobalEvent, Part, and ToolState models. (Note: `NormalizedOpenCodeEvent` is defined in `iota-bridge/src/types/opencode.ts` at L175).

```typescript
// --- V2Event types (from opencode SDK types.gen.ts) ---
type V2Event = {
  id: string
  type: string
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID?: string
    [key: string]: any
  }
}

// --- GlobalEvent wrapper ---
type GlobalEvent = {
  directory: string
  project?: string
  workspace?: string
  payload: V2Event
}

// --- Part data model (12 types) ---
type Part =
  | { type: "text"; id: string; sessionID: string; messageID: string; text: string; time?: { start: number; end?: number } }
  | { type: "reasoning"; id: string; sessionID: string; messageID: string; text: string; time: { start: number; end?: number } }
  | { type: "tool"; id: string; sessionID: string; messageID: string; callID: string; tool: string; state: ToolState }
  | { type: "subtask"; id: string; sessionID: string; messageID: string; prompt: string; description: string; agent: string }
  | { type: "file"; id: string; sessionID: string; messageID: string; mime: string; filename?: string; url: string }
  | { type: "step-start"; id: string; sessionID: string; messageID: string; snapshot?: string }
  | { type: "step-finish"; id: string; sessionID: string; messageID: string; reason: string; cost: number; tokens: object }
  | { type: "snapshot"; id: string; sessionID: string; messageID: string; snapshot: string }
  | { type: "patch"; id: string; sessionID: string; messageID: string; hash: string; files: string[] }
  | { type: "agent"; id: string; sessionID: string; messageID: string; name: string }
  | { type: "retry"; id: string; sessionID: string; messageID: string; attempt: number; error: object }
  | { type: "compaction"; id: string; sessionID: string; messageID: string; auto: boolean }

type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string; metadata: object; time: { start: number; end: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }

// --- Message model ---
type Message = {
  id: string
  sessionID: string
  role: "user" | "assistant" | "system"
  time: { created: number; completed?: number }
  error?: object
  parentID?: string
  modelID?: string
  providerID?: string
}

// --- Thinking modes ---
type ThinkingMode = "show" | "hide"
```

---

#### `iota-mobile/src/services/opencodeSocket.ts` — MODIFY (socket event routing)

**File:** ~139 lines

**Changes needed:**
- [ ] Add handler for new relay channel:
  ```typescript
  socket.on("opencode:sse_event", (event: GlobalEvent) => {
    handleGlobalEvent(event)
  })
  ```
- [ ] Implement `handleGlobalEvent()`: extracts `payload` and dispatches by event type to Part-based store mutations
- [ ] Keep existing emit functions: `emitOpenCodeMessage()`, `emitOpenCodeStop()`, `emitOpenCodeApproval()`, etc.

---

#### `iota-mobile/src/utils/opencodeParser.ts` — REPLACE (HTML parser → Part renderer)

**File:** ~74 lines

**Changes needed:**
- [ ] Replace regex-based HTML tag parser with functions that work on the Part model:
  - `getReasoningSummary(text: string): { title: string | null; body: string }` — parses first bold line `**Title**` as reasoning header
  - `formatDuration(ms: number): string` — formats elapsed milliseconds (e.g. "12s", "1m 30s")
- [ ] Remove `parseAssistantContent()` from this file (handled in component UI layer)

---

#### `iota-mobile/src/screens/ControlScreen.tsx` — MAJOR REWRITE (state management)

**File:** ~1232 lines

**Changes needed:**
- [ ] **Replace `deltaBufferRef` with Part-delta appending:** Update message state directly when receiving deltas (Solid-like batching).
- [ ] **Timeline group derivation:** Derive `groupedTimelineItems` groups directly from `Message[]` and `Part[]` objects (rather than sorting across separate state arrays).
- [ ] **handleSubmitPrompt() / handleStopOpenCode()**: Use Socket.IO relays as before, but ensure abort events are cleanly mapped to state without discarding partial contexts.
- [ ] **Sync merge logic**: Merge message arrays and their child parts based on message IDs and part IDs on `opencode:sync` snapshot updates.

---

#### `iota-mobile/src/components/control/ControlScreenConstants.tsx` — UPDATE TYPES

**File:** ~197 lines

**Changes needed:**
- [ ] Update `ChatTurn` and `GroupedItem` to reference new `Message` and `Part` models.
- [ ] Align properties in `mergeMessages` (replaces legacy `mergeAndDeduplicate`) and `mergeById`.

---

#### `iota-mobile/src/components/control/ChatTimeline.tsx` — MODIFY (timeline rendering)

**File:** ~558 lines

**Changes needed:**
- [ ] Update timeline mapping to render message parts inline.
- [ ] Pass `thinkingMode` ("show"/"hide") to `ChatMessageBubble` components.

---

#### `iota-mobile/src/components/control/ChatMessageBubble.tsx` — MODIFY (message rendering)

**File:** ~501 lines

**Changes needed:**
- [ ] Replace tag-based thought accordion with `ReasoningBlock` rendering that parses title headers and durations from parts.
- [ ] Implement toggle behaviors for show/hide options.
- [ ] Add an "Interrupted" badge for messages with aborted errors.

---

#### `iota-mobile/src/components/control/ToolActivityCard.tsx` — MAJOR REWRITE (tool renderers)

**File:** ~675 lines

**Changes needed:**
- [ ] Implement specialized tool renderers mapping to part structures for:
  - `bash`/`execute`/`shell` (ShellRenderer)
  - `list` (ListRenderer)
  - `read` (ReadRenderer)
  - `write` (WriteRenderer)
  - `edit` (EditRenderer)
  - `glob`/`grep` (SearchRenderer)
  - `websearch`/`webfetch` (Search/FetchRenderer)
  - `apply_patch` (embedded inside Edit/Patch views)
- [ ] Remove `FileChangeCard` (reassigned to tool renderers).

---

#### `iota-mobile/src/components/control/QuestionDialog.tsx` — MODIFY (question tab UI)

**File:** ~392 lines

**Current behavior:** Already supports multi-question arrays and custom text inputs.

**Changes needed:**
- [ ] Add tab-based navigation tab-bar at the top of the sheet when multiple questions are asked.
- [ ] Add a confirmation "Review" step before multi-question replies are submitted.

---

#### `iota-mobile/src/components/control/ChatInputBar.tsx` — MODIFY (add toggles)

**File:** ~362 lines

**Changes needed:**
- [ ] Add thinking mode toggle cycle button (cycling between `show` and `hide`).

---

#### `iota-mobile/src/components/control/ControlSlashCommands.tsx` — LIKELY UNCHANGED

**File:** ~630 lines

---

#### `iota-mobile/src/components/control/HistoryDrawer.tsx` — LIKELY UNCHANGED

**File:** ~382 lines

---

### Source References

| Code | File in opencode repo |
|------|----------------------|
| SSE connection + SDK setup | `packages/tui/src/context/sdk.tsx` |
| V2Event data layer | `packages/tui/src/context/data.tsx` |
| Legacy GlobalEvent sync | `packages/tui/src/context/sync.tsx` |
| All type definitions | `packages/sdk/js/src/v2/gen/types.gen.ts` |
| Thinking/reasoning parser | `packages/tui/src/context/thinking.ts` |
| Chat UI renderer | `packages/tui/src/routes/session/index.tsx` |
| Question prompt | `packages/tui/src/routes/session/question.tsx` |
| Permission prompt | `packages/tui/src/routes/session/permission.tsx` |
| Tool output collapsing | `packages/tui/src/util/collapse-tool-output.ts` |
| Tool display helpers | `packages/tui/src/util/tool-display.ts` |
