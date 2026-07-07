# Component Contracts: Chat UI & UX Improvements

This document lists the modified TypeScript component interfaces.

## 1. ChatMessageBubble Component

Component responsible for rendering user messages, system messages, and final assistant message bubbles (or accordion fallback).

### File: `iota-mobile/src/components/control/ChatMessageBubble.tsx`

```typescript
export interface ChatMessageBubbleProps {
  message: OpenCodeMessage;
  expandedThoughts: Record<string, boolean>;
  onToggleThought: (turnId: string) => void;
  // Set to true when this bubble is rendered inside a timeline turn that contains tools.
  // When true, the bubble renders ONLY the final response block (thoughts/intermediate text
  // are rendered inline in the timeline instead). When false/undefined, falls back to the
  // collapsible thought accordion inside the bubble (no-tools case).
  isTimelineItem?: boolean;
}
```

---

## 2. ToolActivityRow Component

Component responsible for rendering a collapsed/expanded summary of a single tool execution.

### File: `iota-mobile/src/components/control/ToolActivityCard.tsx`

```typescript
export interface ToolActivityRowProps {
  activity: OpenCodeToolActivity;
  isTurnActive?: boolean;
  isExpanded: boolean;
  onToggle: (toolId: string) => void;
}
```

---

## 3. ChatTimeline Component

Timeline manager to render the vertical stream of conversation turns.

### File: `iota-mobile/src/components/control/ChatTimeline.tsx`

```typescript
export interface ChatTimelineProps {
  groupedTimelineItems: GroupedItem[];
  running: boolean;
  runStatusText: string | null;
  isSyncing: boolean;
  expandedTurns: Record<string, boolean>;
  onToggleTurn: (turnId: string) => void;
  expandedTools: Record<string, boolean>;
  onToggleTool: (toolId: string) => void;
  expandedThoughts: Record<string, boolean>;
  onToggleThought: (turnId: string) => void;
  conversationId: string | undefined;
  socket: Socket | null;
  onPillPress: (text: string) => void;
  showScrollToBottom: boolean;
  inputHeight: number;
  isRecording: boolean;
  flatListRef: React.RefObject<FlatList<GroupedItem>>;
  onScroll: (event: any) => void;
  onContentSizeChange: (w: number, h: number) => void;
  onScrollToBottom: () => void;
}
```
