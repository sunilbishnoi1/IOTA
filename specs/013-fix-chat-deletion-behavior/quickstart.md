# Quickstart: Chat Deletion & New Session Behavior

## Prerequisites

- Mobile app running on iOS/Android emulator or device
- Bridge server connected (or offline mode available)
- At least 2 existing conversations in history drawer

## Setup

```bash
# Ensure dependencies are installed
cd iota-mobile && npm install
cd ../iota-bridge && npm install
```

## Validation Scenarios

### Scenario 1: Deleting active chat creates new session (FR-001)

1. Open an existing conversation A
2. Open history drawer
3. Long-press or tap delete icon on conversation A
4. Confirm deletion dialog
5. **Expected**: Conversation A is removed from history; a brand new empty chat is displayed with no messages
6. **Expected**: The history drawer shows the update (no conversation A visible)

### Scenario 2: Deleting non-active chat does nothing (FR-002)

1. Open conversation A
2. Open history drawer
3. Delete conversation B (different from A)
4. **Expected**: Conversation A remains the active session with its messages intact
5. **Expected**: History drawer refreshes, conversation B is removed

### Scenario 3: No duplicate empty chats (FR-003)

1. Tap "New Chat" — an empty chat is created
2. Tap "New Chat" again while still viewing the empty chat
3. **Expected**: Nothing happens — still viewing the same empty chat, no second empty chat in history

### Scenario 4: Empty chat with draft confirms discard (FR-004)

1. Tap "New Chat" to create an empty chat
2. Type some text in the input bar (but don't send)
3. Tap "New Chat" again
4. **Expected**: A confirmation dialog appears: "Discard draft and create new session?"
5. Tap "Discard" → messages and draft are cleared, new empty chat session shown
6. Tap "Cancel" → dialog dismissed, back to original empty chat with draft intact

### Scenario 5: New Chat works normally for non-empty chats (FR-005)

1. Open a conversation with messages
2. Tap "New Chat"
3. **Expected**: A new empty chat is created and displayed (existing behavior unchanged)

### Scenario 6: Deleted conversation removed from history (FR-006)

1. Open history drawer
2. Delete any conversation
3. **Expected**: The conversation disappears from the list immediately

### Scenario 7: Confirmation dialog before deletion (FR-007)

1. Open history drawer
2. Tap delete on any conversation
3. **Expected**: A confirmation dialog appears with "Delete" and "Cancel" options

### Scenario 8: Empty chats hidden from history (FR-008)

1. Tap "New Chat" to create an empty chat
2. Open history drawer
3. **Expected**: The empty chat is NOT shown in the history list
4. **Expected**: If no other conversations exist, history shows only the "History" header with an empty list

### Scenario 9: Persistence across restart (FR-009)

1. Create an empty chat (tap "New Chat")
2. Close the app completely
3. Reopen the app
4. **Expected**: The same empty chat is loaded (no new empty chat created)
5. Tap "New Chat" again
6. **Expected**: No-op — still on the same empty chat

## Running Tests

```bash
# Mobile tests
cd iota-mobile && npm test

# Bridge tests
cd iota-bridge && npm test
```

## Contracts

No external API contracts for this feature. See [data-model.md](./data-model.md) for internal state transitions and validation rules.
