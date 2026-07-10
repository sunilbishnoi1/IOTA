# Data Model: Chat Deletion & New Session Behavior

## Entities

### Conversation (`OpenCodeConversation`)

Existing type in `iota-mobile/src/types/opencode.ts` and `iota-bridge/src/types/opencode.ts`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique conversation identifier |
| `opencodeSessionId` | `string \| undefined` | Associated OpenCode session ID |
| `title` | `string \| undefined` | Auto-generated title from first user message |
| `status` | `'idle' \| 'starting' \| 'running' \| 'awaiting_approval' \| 'completed' \| 'stopped' \| 'failed' \| 'reconnecting'` | Current conversation status |
| `messages` | `OpenCodeMessage[]` | Array of messages (empty = empty chat) |
| `tools` | `OpenCodeToolActivity[]` | Active tool activities |
| `fileChanges` | `OpenCodeFileChange[]` | Pending file changes |
| `approvals` | `OpenCodeApprovalRequest[]` | Pending approval requests |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |
| `activeRequestId` | `string \| undefined` | Active request ID |
| `lastRunPhase` | `string \| undefined` | Last run phase |
| `lastError` | `string \| undefined` | Last error message |
| `activeModel` | `string \| undefined` | Active model name |
| `activeVariant` | `string \| undefined` | Active model variant |
| `tokenUsage` | `object \| undefined` | Token usage stats |

### Active Session (runtime state)

Not a stored entity — the active session is tracked via `conversationId` state in `ControlScreen.tsx`.

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `conversationId` | `string \| undefined` | `useState` in ControlScreen | ID of the currently active conversation |
| `inputText` | `string` | `useState` in ControlScreen | Current draft text in input bar |

### Empty Chat (derived concept)

A `Conversation` where `messages.length === 0`. No dedicated entity needed.

## Validation Rules

| Rule | Condition | Action |
|------|-----------|--------|
| **R1** | Deleting active conversation (`targetId === conversationId`) | After delete, call `performResetConversation()` to create new empty chat |
| **R2** | Deleting non-active conversation (`targetId !== conversationId`) | No change to active session |
| **R3** | "New Chat" pressed + any conversation has `messages.length === 0` | No-op (stay in current empty chat) |
| **R4** | "New Chat" pressed + empty chat exists + `inputText` is non-empty | Show confirmation dialog to discard draft before creating new session |
| **R5** | "New Chat" pressed + current conversation has messages | Create new empty chat (existing behavior) |
| **R6** | Rendering history drawer | Filter out conversations where `messages.length === 0` (unless it's the active session) |
| **R7** | App restart | Load persisted conversationId; if it points to an empty chat, treat it as the reserved empty chat |

## State Transitions

```
[User deletes active chat]
  ┌─────────────────────────────────────────────────────┐
  │ handleDeleteConversation(targetId)                  │
  │   ├─ emitOpenCodeDeleteConversation({targetId})     │
  │   ├─ if targetId === conversationId                 │
  │   │   └─ performResetConversation()                 │
  │   └─ (else: nothing)                                │
  └─────────────────────────────────────────────────────┘

[User taps New Chat]
  ┌─────────────────────────────────────────────────────┐
  │ handleNewChatPress()                                │
  │   ├─ conversations.some(c => c.messages.length === 0)│
  │   │  YES:                                            │
  │   │   ├─ inputText !== '' → show discard dialog     │
  │   │   │  └─ Discard → performResetConversation()    │
  │   │   │  └─ Cancel  → do nothing                    │
  │   │   └─ inputText === '' → no-op                   │
  │   │  NO:                                            │
  │   │   └─ performResetConversation() (existing)      │
  └─────────────────────────────────────────────────────┘
```
