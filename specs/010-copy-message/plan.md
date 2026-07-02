# Implementation Plan: Copy Message Functionality

**Branch**: `010-copy-message` | **Date**: 2026-07-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `spec.md`

## Summary

Add the ability to copy all message types (user, assistant, system/status) via a **unified long-press → copy chip** interaction pattern. Long-press on any message bubble shows a small "Copy" chip; tapping it copies the full message markdown source to clipboard. Code blocks within assistant responses retain their existing tap-to-copy button (unchanged). The feature lives primarily in `ChatMessageBubble.tsx` and uses the existing `expo-clipboard` dependency.

## Technical Context

- **Mobile Client**: React Native (Expo SDK 51), TypeScript
- **Primary file to change**: `iota-mobile/src/components/control/ChatMessageBubble.tsx`
- **Clipboard**: `expo-clipboard` — already imported and used in `CopyableCodeBlock` within the same file
- **Icons**: `@expo/vector-icons/MaterialIcons` — already imported
- **Styling**: StyleSheet with Theme references — no Tailwind

## Implementation Tasks

### Task 1: Create `useCopyToClipboard` hook (shared utility)

**File**: `iota-mobile/src/components/control/ControlScreenConstants.tsx` (or a new utility)

Extract a reusable React hook that encapsulates the copy-to-clipboard pattern:

```typescript
function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetMs);
  }, [resetMs]);

  return { copied, copy };
}
```

**Why**: All message types use the identical copy pattern (set clipboard, show "Copied!" for 2 seconds). The existing `CopyableCodeBlock` already duplicates this logic inline — this hook consolidates it.

### Task 2: Add unified long-press copy chip to all message types

**File**: `iota-mobile/src/components/control/ChatMessageBubble.tsx`

**Changes**:
1. Import `Pressable` from React Native.
2. Wrap each message container (user bubble, assistant container, system bubble) with `Pressable`.
3. On `onLongPress`, toggle a local `showCopy` state.
4. When `showCopy` is true, render a small "Copy" chip above the bubble.
5. The chip uses the `useCopyToClipboard` hook.
6. After tapping copy (or the 2s "Copied!" state expires), auto-dismiss the chip.
7. Long-pressing a different message dismisses any currently visible chip on another message.

**Layout approach**:
- Copy chip is a small inline pill positioned above the message bubble.
- Alignment: right-aligned for user bubbles (`alignSelf: 'flex-end'`), centered for system bubbles, left-aligned for assistant messages.
- The chip contains a `content-copy` icon + "Copy" text (or `check` icon + "Copied!" after copy).

**Interaction with code blocks**:
- Assistant messages rendered via Markdown may contain `CopyableCodeBlock` components (code blocks with their own tap-to-copy button).
- These two interactions coexist: code block uses **tap** (onPress), message copy uses **long-press** (onLongPress) on the outer container. React Native's gesture system distinguishes them.
- If user long-presses on a code block area, BOTH the message copy chip appears AND the code block retains its copy button — no functional conflict since copy only happens on explicit tap of whichever control.

### Task 3: Copy chip dismissal behavior

**File**: `iota-mobile/src/components/control/ChatMessageBubble.tsx`

- The chip auto-dismisses after the "Copied!" 2s timeout completes.
- If the user long-presses a different message while a chip is visible on another, the first chip is dismissed (single `activeChipId` state).
- Tapping anywhere else on the screen (not on the chip) does NOT dismiss the chip — it only goes away after copy+timeout or when another message is long-pressed.

### Task 5: Layout & styling refinement

**File**: `iota-mobile/src/components/control/ChatMessageBubble.tsx`

Add any necessary StyleSheet entries:
- Copy button chip style (user/system)
- Copy button icon style (assistant)
- Container adjustments to accommodate the copy UI without layout shift
- Ensure copy button doesn't interfere with scrolling or tap targets

### Task 6: TypeScript check and tests

- Run `npm run typecheck` in `iota-mobile/` to verify no type errors.
- Verify existing tests still pass: `npm test`.
- No new tests required unless a shared hook is extracted (then add a simple test for the hook).

## Architecture Diagram

```
┌─────────────────────────────────────┐
│          ChatTimeline               │
│  ┌───────────────────────────────┐  │
│  │        Turn Container         │  │
│  │                              │  │
│  │  ┌─ [Copy] ─────────────────┐ │  │
│  │  │  User Bubble             │ │  │
│  │  │  (long press → chip)     │ │  │
│  │  └──────────────────────────┘ │  │
│  │                              │  │
│  │  ┌─ [Copy] ─────────────────┐ │  │
│  │  │  Assistant Container     │ │  │
│  │  │  ┌──────────────────┐    │ │  │
│  │  │  │ Markdown content │    │ │  │
│  │  │  │ ┌──────────────┐ │    │ │  │
│  │  │  │ │ Code block   │ │    │ │  │
│  │  │  │ │ [Copy] (tap) │ │    │ │  │
│  │  │  │ └──────────────┘ │    │ │  │
│  │  │  └──────────────────┘    │ │  │
│  │  └──────────────────────────┘ │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

Key: [Copy] chip = appears on long-press (all message types)
      [Copy] button inside code block = always visible, tap to copy (existing)
```

## File Changes Summary

| File | Change |
|---|---|
 | `src/components/control/ChatMessageBubble.tsx` | Add unified long-press → copy chip for user, assistant, system messages; code block copy buttons unchanged |
| `src/components/control/ControlScreenConstants.tsx` | Add `useCopyToClipboard` hook |

## Testing

- Run `npm run typecheck` (tsc --noEmit)
- Run `npm test` (Jest)
- Manual verification: long-press user message → copy chip appears above → tap → clipboard has markdown source → "Copied!" for 2s → chip auto-dismisses
- Manual verification: long-press assistant response → copy chip appears (left-aligned) → tap → clipboard has full markdown source → "Copied!" for 2s → dismisses
- Manual verification: long-press system/status message → copy chip appears (centered) → same behavior
- Manual verification: code block tap-to-copy still works independently (existing behavior, no regression)
- Manual verification: long-press during streaming → copy chip appears → tap → copies partial content received so far
- Manual verification: long-press message A, then long-press message B → chip on A dismisses, chip on B appears

## Resolved Design Decisions

1. **AI response copy mechanism**: Long-press + copy chip (same as user messages), not a dedicated button.
2. **What gets copied**: Markdown source (`message.content` string), not rendered plain text.
3. **Streaming behavior**: Copy allowed during streaming — copies partial content.
4. **Code block coexistence**: Code blocks keep existing tap-to-copy; message-level copy uses long-press. No conflict (press vs long-press).
5. **Copy chip dismissal**: Auto-dismisses after "Copied!" timeout; long-pressing another message dismisses current chip.
