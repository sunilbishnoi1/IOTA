# Feature Specification: Copy Message Functionality

**Feature Branch**: `010-copy-message`

**Created**: 2026-07-01

**Status**: Draft

**Input**: User description: "implement copy message functionality for user message / user prompt as well as the AI response. Long press on user message should show copy. Design copy for AI response as well."

## User Stories

### User Story 1 - Copy User Message via Long Press (Priority: P1)

A developer in the chat view wants to reuse or share their own prompt. They long-press on their user message bubble, and a "Copy" option appears (e.g., as a context menu, tooltip, or inline button). Tapping it copies the exact user message text to the clipboard, and a brief visual feedback confirms the action.

**Acceptance Scenarios**:
1. **Given** a user message bubble is displayed, **When** the user long-presses it, **Then** a copy action is shown (inline button or context menu).
2. **Given** the copy action is visible, **When** the user taps copy, **Then** the message text is copied to clipboard and a confirmation toast/animation is shown.
3. **Given** the content was just copied, **When** 2 seconds elapse, **Then** the visual feedback resets to the default state.

### User Story 2 - Copy AI Response via Long Press (Priority: P1)

A developer wants to copy the AI assistant's response. They long-press anywhere on the assistant response area, and a "Copy message" chip appears. Tapping it copies the full response text to the clipboard with visual feedback.

**Acceptance Scenarios**:
1. **Given** an AI response is displayed, **When** the user long-presses on the response area (outside any code block), **Then** a "Copy message" chip appears.
2. **Given** the copy chip is visible, **When** the user taps it, **Then** the entire response text is copied to clipboard and shows "Copied!" for 2 seconds.
3. **Given** copying completed, **Then** the copied text is the complete markdown source of the response.
4. **Given** a code block within the response, **When** the user taps its existing copy button, **Then** only the code block is copied (existing behavior, unchanged).

### User Story 3 - Copy System/Status Messages (Priority: P2)

A developer wants to copy a status or system message. They long-press on the message bubble and a "Copy" option appears, identical to the user message interaction.

**Acceptance Scenarios**:
1. **Given** a system/status message is displayed, **When** the user long-presses it, **Then** a copy action is shown.
2. **Given** the copy action is tapped, **Then** the message text is copied to clipboard with confirmation feedback.

## Design Decisions

### Unified Long-Press Pattern (All Message Types)
- All message types (user, assistant, system/status) use the same interaction: **long-press → copy chip appears**.
- The copy chip is a small inline pill/button that appears above/beside the message bubble after a long press.
- No always-visible copy buttons — keeps the UI clean and consistent.

### What Gets Copied (Based on Long-Press Target)
- **Long-press on message bubble background** (non-code-block area) → copies the full message text content.
- **Code blocks within assistant responses** already have their own copy button (tap-based, always visible) that copies only the code block — this existing behavior is unchanged.
- For assistant messages rendered via Markdown, the `onLongPress` is set on the outer container. If a user long-presses on a code block area, the full-message copy chip still appears (non-exclusive), but the code block's own tap-to-copy button is the faster path for copying just that code block.
- System/status messages: long-press copies the full message text.

### Copy Chip Behavior
- On long press, a small inline "Copy" chip appears above the bubble (right-aligned for user messages, centered for system messages, left-aligned for assistant).
- The chip contains a copy icon + "Copy" label.
- After tapping the chip, the text is copied to clipboard and the chip shows "Copied!" with a checkmark icon for 2 seconds, then auto-dismisses.
- No external context menu library needed — keep it lightweight with inline state.

### Content Copied
- The raw `message.content` string (markdown source) is copied to clipboard — not rendered/stripped text.
- For code blocks, the existing `CopyableCodeBlock` copies only the code snippet (unchanged behavior).

### Streaming Behavior
- Copy is available even while the assistant message is still streaming (`status === 'streaming'`).
- The copied content is whatever has been received so far (partial response).
- No special disabled/grayed state for streaming messages.

### Visual Feedback
- Use `expo-clipboard` (already in dependencies) for clipboard access.
- Use local `useState` with `setTimeout` to reset the copied state after 2 seconds.
- Consistent iconography: `content-copy` → `check` (MaterialIcons, already in use across the app).

### Shared Component
- Extract a reusable `CopyButton` mini-component or `useCopyable` hook to avoid duplication.
- The copy-able wrapper pattern: state (`copied`), copy handler, timeout reset, inline UI.

## Technical Context

**Dependencies**: `expo-clipboard@~6.0.3` (already installed), `@expo/vector-icons` (already in use).

**Target Files**:
- `iota-mobile/src/components/control/ChatMessageBubble.tsx` — primary changes for both user & assistant copy
- `iota-mobile/src/components/control/ChatTimeline.tsx` — may need minor prop passthrough
- `iota-mobile/src/components/control/ControlScreenConstants.tsx` — if extracted as a shared utility

**No new dependencies required.**

## Clarifications

### Session 2026-07-01
- Q: Where should the copy button be placed for AI assistant responses? → A: Use long-press with copy chip (consistent with user messages), not an always-visible dedicated button.
- Q: How to handle "what to copy" based on where the user long-presses? → A: Long-press on message background copies full text; code blocks retain their existing tap-to-copy button (unchanged). Both can coexist without conflict since one uses tap and the other uses long-press.
- Q: Should the clipboard receive rendered plain text or markdown source? → A: Markdown source (`message.content` string as-is).
- Q: Should copy be disabled while assistant message is still streaming? → A: Allow copy during streaming — copy the partial content received so far.
