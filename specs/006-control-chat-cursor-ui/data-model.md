# Data Model: Control Chat Cursor UI/UX Enhancements

This document tracks all data model modifications required for the Cursor UI/UX Enhancements.

## 1. Modified Interfaces

### `OpenCodeFileChange`

We add the `createdAt` property to track exactly when a file change event is received.

```typescript
export interface OpenCodeFileChange {
  id: string;
  conversationId: string;
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: OpenCodeDiffHunk[];
  createdAt: string; // <-- NEW: ISO 8601 timestamp (e.g. "2026-06-27T12:00:00.000Z")
}
```

This interface is modified in:
- `iota-bridge/src/types/opencode.ts`
- `iota-mobile/src/types/opencode.ts`

---

## 2. UI-Only Domain Mappings (Client-Side)

### `ActivityItem`

To group events under the collapsible thinking box on the mobile client, we define a union type of all log activities:

```typescript
export type ActivityItem =
  | { type: 'tool'; activity: OpenCodeToolActivity; timestamp: string }
  | { type: 'file'; change: OpenCodeFileChange; timestamp: string }
  | { type: 'approval'; approval: OpenCodeApprovalRequest; timestamp: string };
```

### `Turn`

We group messages and their associated activities into "Turns":

```typescript
export interface Turn {
  id: string; // assistantMessage.id or a virtual ID
  userMessage?: OpenCodeMessage;
  assistantMessage?: OpenCodeMessage;
  isActiveRun: boolean;
  activities: ActivityItem[];
}
```
