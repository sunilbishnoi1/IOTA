# Data Model: Chat UI & UX Improvements

This document defines the interface and data model extensions required to implement the chat timeline interleaving and visual changes.

## 1. Parsed assistant content structure

We introduce a structure to represent parsed segments of the assistant message:

```typescript
export interface ParsedBlock {
  type: 'thought' | 'text';
  content: string;
  isFinished: boolean;
  startedAt?: string;   // ISO timestamp when first chunk arrived
  completedAt?: string; // ISO timestamp when block finished (e.g. tag closed)
}
```

## 2. Message metadata extension

We extend `OpenCodeMessage`'s metadata dictionary with the parsed blocks. This ensures that timestamps are preserved across message streams and updates:

```typescript
export interface OpenCodeMessage {
  // Existing fields...
  metadata?: {
    phase?: string;
    requestId?: string;
    retryable?: boolean;
    parsedBlocks?: ParsedBlock[]; // Preserves block discovery and state
  };
}
```

## 3. Timeline interleaving structure

When rendering the turn timeline, tool activities, file changes, approvals, and inline blocks are normalized into `InterleavedItem` structures and sorted by timestamp:

```typescript
export type InterleavedItem =
  | { type: 'tool'; activity: OpenCodeToolActivity; timestamp: string }
  | { type: 'file'; change: OpenCodeFileChange; timestamp: string }
  | { type: 'approval'; approval: OpenCodeApprovalRequest; timestamp: string }
  | { type: 'thought_block'; block: ParsedBlock; index: number; timestamp: string }
  | { type: 'intermediate_text'; block: ParsedBlock; index: number; timestamp: string };
```

This guarantees chronological ordering during render regardless of how many thoughts or tools are spawned in a turn.
