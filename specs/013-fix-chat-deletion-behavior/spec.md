# Feature Specification: Fix Chat Deletion & New Session Behavior

**Feature Branch**: `013-fix-chat-deletion-behavior`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "From history drawer if user deletes the current chat, It currently switch to some existing chat. Instead we should create a new session/chat. And also think about how should it work when user create a new chat when there is already a empty chat, we should not let them create multiple empty chats."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deleting current chat creates a new session (Priority: P1)

As a user, when I delete the currently active conversation from the history drawer, I want a fresh new chat session to be created automatically, rather than being switched to an arbitrary existing conversation.

**Why this priority**: Critical (P1) because deleting the current chat is an intentional action to start fresh; switching to another existing chat is unexpected and breaks the user's mental model.

**Independent Test**: Open a conversation, open the history drawer, delete the active conversation. Verify that a brand new empty chat is displayed instead of any other existing conversation.

**Acceptance Scenarios**:

1. **Given** the user is viewing an active conversation, **When** they open the history drawer, initiate deletion of that conversation, and confirm the dialog, **Then** the deleted conversation is removed from history and a new empty chat session is immediately created and displayed.
2. **Given** there are multiple existing conversations in the history and the user deletes the active one, **When** the deletion is confirmed, **Then** the user sees a fresh empty chat rather than being switched to another existing conversation.
3. **Given** the user deletes the current (and only) conversation, **When** the deletion completes, **Then** a new empty chat session is created automatically.

---

### User Story 2 - Prevent multiple empty chats (Priority: P1)

As a user, when I tap "New Chat" while there is already an empty chat session with no messages, I want the system to either reuse that existing empty chat or do nothing, rather than creating a duplicate empty session.

**Why this priority**: Critical (P1) because allowing multiple empty chats clutters the history, confuses the user about which session is active, and wastes resources.

**Independent Test**: Tap "New Chat" once to create an empty chat. Tap "New Chat" again. Verify that no second empty chat is created — either the existing empty chat remains active or the action is a no-op.

**Acceptance Scenarios**:

1. **Given** the user has an empty chat session (no messages sent), **When** they tap "New Chat", **Then** no new session is created and the existing empty chat remains the active session.
2. **Given** the user has an empty chat but has started typing a message (draft exists), **When** they tap "New Chat", **Then** the system should present a confirmation dialog asking if they want to discard the draft before creating a new session.
3. **Given** the user has an active conversation with messages, **When** they tap "New Chat", **Then** a new empty chat session is created as expected (existing behavior preserved for non-empty chats).

---

### User Story 3 - Deleting a non-active chat from history (Priority: P2)

As a user, when I delete a conversation from the history drawer that is not the currently active one, I expect the current session to remain unchanged.

**Why this priority**: High (P2) because this is the standard expected behavior and should continue to work correctly.

**Independent Test**: Open conversation A. Open history drawer. Delete conversation B. Verify that conversation A is still the active session.

**Acceptance Scenarios**:

1. **Given** the user is viewing conversation A, **When** they delete conversation B from the history drawer, **Then** conversation A remains the active session and is unaffected.
2. **Given** the user is viewing conversation A and deletes conversation B, **When** the deletion completes, **Then** the history drawer updates to reflect the removal.

---

### Edge Cases

- What happens when the user deletes the last remaining conversation (it was the only one)?
- What happens when the user rapidly deletes multiple conversations in succession?
- What happens when the user taps "New Chat" multiple times rapidly while there is an empty chat?
- What happens if the empty chat has unsaved draft text — should it be discarded or preserved?
- What happens if the user deletes the current chat while it has unsent draft text?
- How does the system handle deletion of a conversation that is currently streaming a response?
- What happens if the user cancels the deletion confirmation dialog?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Deleting the currently active conversation from the history drawer MUST automatically create a new empty chat session and display it to the user.
- **FR-002**: Deleting a non-active conversation from the history drawer MUST NOT change the currently active session.
- **FR-003**: The system MUST NOT create a new empty chat session if an empty chat session (zero messages) already exists. The existing empty chat MUST remain the active session.
- **FR-004**: If an empty chat session has a non-empty draft (user has typed but not sent), tapping "New Chat" MUST show a confirmation prompt asking whether to discard the draft before proceeding.
- **FR-005**: The "New Chat" action MUST continue to create a new empty session when the current active session has at least one message.
- **FR-006**: Deleted conversations MUST be removed from the history drawer immediately upon deletion.
- **FR-007**: Deleting any conversation MUST display a confirmation dialog before the deletion is executed. The dialog MUST clearly state that the action is irreversible.
- **FR-008**: Empty chat sessions (zero messages) MUST NOT be displayed in the history drawer. When no visible conversations exist, the history drawer MUST show an empty list with only the "History" header.
- **FR-009**: The empty chat session state MUST be persisted to storage and survive app restarts. After restart, the system MUST load the empty chat and continue to prevent duplicate "New Chat" creation.

### Key Entities *(include if feature involves data)*

- **Conversation**: A chat session with attributes: ID, Title, Status (active/idle), Messages, Draft text, timestamps.
- **Active Session**: The conversation currently being viewed and interacted with by the user.
- **Empty Chat**: A conversation that has zero messages (no user prompts or assistant responses).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Deleting the current chat always results in a new empty chat being displayed, never an existing conversation (100% of cases).
- **SC-002**: Tapping "New Chat" when an empty chat exists never creates a duplicate session (0 duplicate empty sessions allowed).
- **SC-003**: All deletion and new-chat operations complete with UI feedback in under 500ms.

## Clarifications

### Session 2026-07-10

- Q: When the user deletes a conversation from the history drawer, should there be a confirmation dialog before the deletion executes? → A: Yes, always show a confirmation dialog before every deletion.
- Q: Should empty chats (zero messages) be visible in the history drawer? → A: No, hide empty chats from the history drawer.
- Q: Should the 'empty chat' that blocks duplicate 'New Chat' persist across app restarts? → A: Yes, persist across restarts — the empty chat is saved to storage and blocks new chat creation after restart too.
- Q: When the user taps 'New Chat' while an empty chat already exists, should there be visual feedback? → A: No visual feedback — it is a complete no-op since the user is already in an empty chat.
- Q: When the history drawer has no visible conversations (zero or only hidden empty chats), what should be displayed? → A: Just an empty list with the 'History' header, no placeholder message.

## Assumptions

- The history drawer already exists and has the delete action available (via long-press/swipe as described in spec 009).
- Conversations are stored locally; no server-side sync is required for deletion/new-chat logic.
- An "empty chat" is defined as a conversation with zero messages (no user or assistant messages).
- Draft text is stored locally in the conversation state but does not count as a "message" for the purpose of determining if a chat is empty.
- The empty chat session is persisted to storage and survives app restarts. It continues to block duplicate "New Chat" creation after restart until the user sends the first message.
