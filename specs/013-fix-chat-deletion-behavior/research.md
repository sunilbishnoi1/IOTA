# Research: Chat Deletion & New Session Behavior

## 1. Empty Chat Detection Strategy

**Decision**: Check `messages.length === 0` on the `OpenCodeConversation` object in the mobile client state.

**Rationale**: Every conversation object is already available in the `conversations` state array in `ControlScreen.tsx`. The `messages` array is the canonical source of truth — a chat with zero messages is empty. No additional API or storage call is needed.

**Alternatives considered**:
- Add a dedicated `isEmpty` flag on `OpenCodeConversation` — unnecessary overhead; `messages.length` is sufficient and always available.
- Track empty chat ID separately in secureStore — only needed for persistence (see below).

## 2. Persisting Empty Chat Across Restarts (FR-009)

**Decision**: Persist the current `conversationId` in `expo-secure-store` (already done via `saveOpenCodeConversationId`). On app startup, the stored conversation ID is loaded. If that conversation has zero messages after syncing from the bridge, it is treated as the "reserved empty chat" and blocks duplicate new-chat creation.

**Rationale**: The existing `secureStoreService.getOpenCodeConversationId()` / `saveOpenCodeConversationId()` mechanism already persists the active conversation ID per workspace scope. No new storage keys are needed. The bridge also persists conversations to JSON files, so the empty chat survives both client and server restarts.

**Alternatives considered**:
- Persist a separate `emptyChatId` flag — redundant since the conversation ID is already saved and the empty check can be done on the loaded conversation.

## 3. Delete-Active-Chat → New Session Flow (FR-001)

**Decision**: In `handleDeleteConversation`, after emitting the delete, check if `targetId === conversationId`. If so, call `performResetConversation()` to initiate a new session.

**Rationale**: This keeps the logic entirely in the mobile client. The bridge already broadcasts the updated `conversations_list` after deletion. The mobile just needs to react and create a new session.

**Alternatives considered**:
- Have the bridge auto-create a new conversation when the active one is deleted — would couple bridge behavior to mobile UI concerns.
- Have the mobile wait for the `onConversationsList` event and then check if the active conversation is gone — unnecessarily complex; synchronous handling is cleaner.

## 4. New-Chat Prevention on Empty Chat (FR-003)

**Decision**: In `handleNewChatPress`, check if any conversation in `conversations[]` has `messages.length === 0`. If one exists, the action is a no-op (no visual feedback). If the empty chat has a draft, show a confirmation dialog (FR-004).

**Rationale**: Simple `O(n)` scan of the in-memory conversations array. The array is typically small (<50 items per bridge store pruning). No additional state needed.

**Alternatives considered**:
- Maintain a separate `hasEmptyChat` boolean flag in state — would need to be kept in sync with conversations, adding complexity.

## 5. Filtering Empty Chats from History Drawer (FR-008)

**Decision**: Filter `conversations` before passing to `HistoryDrawer` to exclude conversations with `messages.length === 0`. The one exception: if the current active session is the empty chat (meaning the user is in an empty chat), keep it visible so the user can see it selected.

**Rationale**: The filtering is a single `.filter()` call in the parent component. No changes to `HistoryDrawer.tsx` internals are needed.

**Alternatives considered**:
- Filter inside `HistoryDrawer` — less clean; the drawer should be a presentational component.
- Include a `showEmptyChats` prop — unnecessary complexity.

## 6. Draft Detection for New Chat Confirmation (FR-004)

**Decision**: Check the current `inputText` state in `ControlScreen.tsx`. If non-empty and the current conversation has zero messages, show an `Alert.alert` confirmation dialog asking to discard the draft before creating a new session.

**Rationale**: Draft text is currently held in local state (`inputText` in `ControlScreen.tsx`). The spec states draft text does NOT count as a message for empty-chat determination, so a chat with a draft but no sent messages is still "empty".

**Alternatives considered**:
- Persist draft to storage and check on load — over-engineering; draft is ephemeral UI state.
