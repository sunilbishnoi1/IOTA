# Feature Specification: Fix "New Chat" and Add Session Persistence

**Feature Branch**: `009-fix-new-chat-persistence`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Current Data Flow ("New Chat" is broken) ... (requirements, solution design)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an independent "New Chat" session (Priority: P1)

As a developer using IOTA, when I tap the "New Chat" button, I want a completely fresh and isolated conversation to start, so that the AI agent does not have access to my previous conversation history, environment pollution, or active session state.

**Why this priority**: Extremely critical (P1) because the current flow is broken, carrying over old session history and settings into new conversations. This is a blocker for standard development workflows.

**Independent Test**: Start a conversation, send a message referencing a topic. Tap "New Chat". Verify that starting a new message does not have any memory or state from the previous conversation.

**Acceptance Scenarios**:

1. **Given** an active conversation session with messages, **When** the user taps "New Chat", **Then** the chat interface is cleared, a fresh conversation is initialized, and sending a new message does not carry over any context or sessionId from the previous session.
2. **Given** a new chat session is started, **When** the user asks a question about the previous session's details, **Then** the agent behaves as if it is a brand new session with no knowledge of the previous conversation.

---

### User Story 2 - Switch between past conversations and persist history (Priority: P2)

As a developer, I want my IOTA conversations to survive bridge restarts and be listable/swappable, so that I can resume my work or view history without losing context.

**Why this priority**: High priority (P2) to ensure work is not lost when the bridge disconnects or restarts, and to allow the user to manage multiple parallel tasks/conversations.

**Independent Test**: Start a conversation, send a message, restart the bridge. Tap "/sessions" or open the sessions view. Verify the conversation is listed, has the correct auto-generated title, and can be loaded back with its full history.

**Acceptance Scenarios**:

1. **Given** one or more saved conversations, **When** the user executes the `/sessions` slash command (or accesses the sessions list), **Then** they see a list of all IOTA conversations, showing the auto-generated title, date/time, and message count.
2. **Given** the user is viewing the sessions list, **When** they select a past conversation, **Then** the active session switches to that conversation, loading its entire message history and restoring the correct conversation context.
3. **Given** the bridge server is restarted, **When** the mobile client reconnects, **Then** the previous conversation history is successfully loaded from disk and displayed in the chat.

---

### User Story 3 - Automatic session metadata and titles (Priority: P3)

As a developer, I want my conversations to have meaningful titles automatically generated from the first user message, so that I can easily identify them in the session list.

**Why this priority**: Medium priority (P3) to improve usability and readability of the session history.

**Independent Test**: Start a new conversation and send "Implement a new authentication route using Express". Check the list of sessions to verify a title like "Implement a new authentication route..." is generated.

**Acceptance Scenarios**:

1. **Given** a new conversation, **When** the user sends the first message, **Then** a concise title is automatically generated from the message text and saved with the conversation metadata.

---

### User Story 4 - Cache isolation on mobile device (Priority: P2)

As a mobile user, I want the local message cache on my phone to be scoped by conversation ID, so that switching conversations or starting a new chat does not display cached messages from a different conversation in the same workspace.

**Why this priority**: High priority (P2) because workspace-level caching causes UI pollution when starting or switching conversations.

**Independent Test**: Open two different conversations in the same workspace. Verify that the cache loads the specific messages for each conversation and doesn't leak or mix them.

**Acceptance Scenarios**:

1. **Given** two active conversations in the same workspace, **When** the user switches between them, **Then** the mobile UI loads only the cached messages corresponding to the active conversation ID.

---

### User Story 5 - Garbage collection of old sessions (Priority: P3)

As a system administrator/developer, I want old conversations to be automatically deleted or archived when they exceed a certain limit (by count or age), so that disk usage doesn't grow indefinitely.

**Why this priority**: Low/Medium priority (P3) to maintain clean disk usage and prevent performance degradation over time.

**Independent Test**: Configure session limit to 5. Create 6 conversations. Verify that the oldest conversation is deleted.

**Acceptance Scenarios**:

1. **Given** the conversation count exceeds the configured limit, **When** a new conversation is created, **Then** the oldest conversation is pruned from disk and memory.

### Edge Cases

- What happens when the `.iota/conversations/` directory does not exist or has permission errors?
- How does the system handle corrupt or empty conversation JSON files on startup?
- What happens if the bridge restarts while a disk write is in progress?
- What happens if the user clicks "New Chat" rapidly multiple times in succession?
- What happens if a conversation is loaded but its corresponding OpenCode CLI session has expired or been deleted?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Clicking "New Chat" MUST create a truly independent conversation, completely resetting any prior session history, active agent CLI parameters, or cached environment state.
- **FR-002**: The bridge MUST persist conversations and metadata (including ID, CLI session ID, title, status, timestamps, and messages) to JSON files under the workspace `.iota/conversations/` directory.
- **FR-003**: The `/sessions` slash command MUST list all available IOTA conversations, showing their title, message count, and status, and allowing the user to select one to switch to.
- **FR-004**: The user MUST be able to switch between past conversations, restoring their full history and the active session state.
- **FR-005**: The mobile application's local chat cache (using `SecureStore`) MUST scope cached data by conversation ID to prevent cross-conversation UI pollution.
- **FR-006**: The system MUST implement a garbage collection mechanism that automatically prunes old conversations (by count or age) to avoid unbounded disk growth.
- **FR-007**: The bridge MUST handle concurrent write operations to conversation files safely (e.g., using a write lock or atomic write pattern).
- **FR-008**: The system MUST authenticate and scope conversations per workspace to maintain security boundaries.
- **FR-009**: The system MUST automatically generate a concise title for a new conversation based on the first user message.

### Key Entities *(include if feature involves data)*

- **Conversation**: Represents a chat session. Key attributes: ID, Title, Status, Created Time, Updated Time, Message Count, and associated CLI Session ID.
- **Message**: Represents an individual user prompt or system response/agent action. Key attributes: Role (user/assistant), Content, Timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user starting a "New Chat" gets a response from the agent within 3 seconds, and the agent has no memory of the prior session.
- **SC-002**: 100% of conversations are successfully recovered and displayed in the UI after a bridge server restart.
- **SC-003**: Switching between conversations takes less than 500ms to update the mobile UI.
- **SC-004**: Stored conversation history does not grow indefinitely; the oldest sessions are successfully pruned when the limit is exceeded.

## Assumptions

- **UI for switching conversations (Option B)**: The user will switch conversations via a premium, minimal, and intuitive side drawer on mobile.
  - **Access**: Accessed by tapping a dedicated `history` icon in the right side of the header bar.
  - **Premium Drawer Layout**:
    - **Header**: Simple "History" header with a quick action to start a "New Chat" (marked by a plus `+` icon).
    - **List Sections**: Sessions are categorized chronologically (e.g., "Today", "Yesterday", "Older").
    - **Session Row**: Displays the auto-generated title, message count, and relative time (e.g. "10 mins ago"). Active session is highlighted with IOTA's primary glow color border/background tint.
    - **Interactions**: Long-press/swipe on a session row reveals a quick option to delete the conversation history.
- Conversations are local to a specific workspace; there is no expectation to sync sessions across different workspaces in the list.
- SecureStore capacity on the mobile device is sufficient to cache messages for multiple conversations (or will degrade gracefully if full).
- The user has permission to read and write to the `.iota/` directory in their workspace.
- The default limit for garbage collection of conversations is set to 50 sessions, which is reasonable for standard development projects.
