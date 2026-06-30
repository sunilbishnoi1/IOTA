# Feature Specification: Control Chat Cursor UI/UX Enhancements

**Feature Branch**: `[006-control-chat-cursor-ui]`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "We need to enhance the entire chat experience, to make it feel like the ui of premium coding agents like cursor. it should be organized, clean, uncluttered. after users prompt/message sent add a permanent thin thinking box and add a collapse/hide/unhide icon, default it should be hidden and the thinking text should change based on whatever is going on like name of the tool call like 'read x', 'web search y' etc. and if user clicks to open that box it should show all the sequencial steps happened before ai gave its final response, and all the inbetween thinking text etc.. and make sure everything get collapsed in it. and below it should be just the final response by the AI. currently it just says running tool and a loading spinner that never stops, we should replace it with the exact what tool call happened and exact which file/foldered it explored/read, ran cmds etc. and loading spinner for tool call should not be permanent. let ai response box take full width of the mobile screen, it should be dynamically adjustable if the response is the a single half line then the box width should reduce to fix the single line but for more than one line response it should be wider most times response is very long (as it is currently thin). adjust/reduce the padding around the text boxes for user message as well for ai response."

## Clarifications

### Session 2026-06-27

- Q: When starting a new chat, should there be a confirmation prompt? → A: Yes, prompt the user with a confirmation dialog before resetting.
- Q: What suggested prompt pills should be shown by default in the empty chat state? → A: Standard developer task suggestions: "Find bugs", "Write tests", "Explain code", "Check status".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Collapsible Sequential Thinking logs (Priority: P1)

As a developer using the mobile coding assistant, I want to see a clean, uncluttered view of the AI's execution steps (tool calls, file explorations, command runs) collapsed under a single permanent thinking box, so that I can see the high-level progress immediately without scrolling through a long wall of status messages, but still access the detailed log history whenever I need to debug.

**Why this priority**: High. This prevents timeline clutter from multiple tool executions and replaces a generic permanent spinner with precise step feedback.

**Independent Test**: Can be tested by sending a prompt that triggers multiple tools (e.g. read file, search web). The user sees a single thin thinking box displaying the active tool. Tapping the box reveals the full historical checklist of executed steps.

**Acceptance Scenarios**:

1. **Given** a user message has been sent, **When** the AI is executing tools, **Then** the interface displays a single thin horizontal "Thinking" bar with a collapse/expand icon, a non-permanent spinner, and the name of the active tool (e.g., "Reading file X").
2. **Given** a sequence of tools has finished executing, **When** the final response is received, **Then** the thinking bar remains visible, the loading spinner stops, and it defaults to a collapsed state showing a summary (e.g., "Ran 4 tools").
3. **Given** the thinking bar is collapsed, **When** the user taps the toggle icon, **Then** the box expands to display the full, chronological list of tool calls (with exact names and target files), file diffs, and intermediate output logs.

---

### User Story 2 - Full-Width Dynamic AI Response Box (Priority: P1)

As a developer reading AI code responses on a mobile screen, I want the AI response container to adapt dynamically to the length of the response and take up the maximum screen width for long messages, so that text does not wrap excessively and code blocks are highly readable.

**Why this priority**: High. Enhances visual comfort and readability of code on mobile viewport boundaries.

**Independent Test**: Send a short message (e.g., "Hi") and verify the response bubble is small and compact. Send a long response with code and verify it stretches to full width.

**Acceptance Scenarios**:

1. **Given** the assistant sends a short, single-line response, **When** rendered on screen, **Then** the response bubble's width shrinks to fit the content length.
2. **Given** the assistant sends a long or multi-line response containing text and code blocks, **When** rendered on screen, **Then** the response container spans the full width of the mobile viewport.
3. **Given** any message is rendered, **When** padding around the user bubble and AI response box is calculated, **Then** it uses tight, minimized padding compared to the previous design.

---

### User Story 3 - Interactive Code Block Utilities (Priority: P2)

As a developer, I want code blocks to have a dark, high-contrast background and a quick "Copy" utility button, so that I can easily copy snippets of code to my clipboard or external apps.

**Why this priority**: Medium-High. Simplifies the common action of extracting code from chat responses.

**Independent Test**: Tap the copy button on an AI code block and paste it into another application to verify.

**Acceptance Scenarios**:

1. **Given** an AI response contains a code block, **When** displayed on screen, **Then** the code block renders with a distinct high-contrast slate background and displays a "Copy" button/icon in its top-right corner.
2. **Given** the copy button is visible, **When** the user taps the copy button, **Then** the code content is copied to the device's clipboard and a temporary "Copied!" feedback state is shown.

---

### User Story 4 - Suggested Quick-Action Prompt Pills (Priority: P2)

As a developer opening a new chat session, I want to see suggested quick-action pills in the empty chat state, so that I can initiate common tasks (like scanning the codebase or checking for bugs) with a single tap.

**Why this priority**: Medium. Improves engagement and ease-of-use when starting tasks.

**Independent Test**: Tap a suggested pill on an empty screen and verify the prompt is loaded into the input box and executed.

**Acceptance Scenarios**:

1. **Given** the chat timeline is empty, **When** the screen is loaded, **Then** the system displays a set of prompt suggestion pills ("Find bugs", "Write tests", "Explain code", "Check status").
2. **Given** the suggestion pills are displayed, **When** the user taps a pill, **Then** the prompt text is loaded into the input text box.

---

### User Story 5 - New Chat Session Reset (Priority: P2)

As a developer, I want to be able to reset my chat history and start a new session quickly from the header, so that I can switch contexts without long conversation lags or having to manually navigate away.

**Why this priority**: Medium. Crucial for clean session management.

**Independent Test**: Tap the "New Chat" button in the header and verify all message history and tools are cleared.

**Acceptance Scenarios**:

1. **Given** an active chat session with history, **When** the user taps the "New Chat" action button in the header, **Then** the system displays a confirmation dialog asking if they are sure they want to start a new chat.
2. **Given** the confirmation dialog is displayed, **When** the user confirms the action, **Then** the timeline is cleared and the view transitions back to the empty chat state.

---

### Edge Cases

- **No Tools Executed**: If the assistant answers directly without calling any tools, the permanent thinking box should not appear for that specific message.
- **Connection Disruption during Tool Execution**: If the websocket disconnects while a tool is in progress, the active tool spinner should stop and change to a failed/error state.
- **Very Long Tool Logs**: If tool logs are extremely long, the expanded thinking box should render them using scrollable virtualized components to prevent rendering lag.
- **Rapid Tool Status Updates**: If multiple tool status events arrive in short succession, the thinking header should update smoothly without causing UI stuttering.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST render a single, collapsible "Thinking" container block immediately following a user's prompt when tool executions or thinking states occur.
- **FR-002**: The Thinking container MUST display a collapse/expand toggle button, defaulting to a collapsed state.
- **FR-003**: The header of the Thinking container MUST dynamically display the active tool activity description (e.g. "Running web search...", "Reading package.json...") during execution.
- **FR-004**: Once execution completes, the Thinking header MUST display a summarized count of actions (e.g., "Ran 4 tools").
- **FR-005**: When the Thinking container is expanded, the system MUST show a chronological list of all sequential tool activities, target files/folders, commands executed, and file diffs.
- **FR-006**: The execution loading indicator (spinner) MUST only run while a tool activity is active (`status === 'started' || status === 'running'`) and MUST terminate when the tool activity finishes or fails.
- **FR-007**: AI responses MUST take up the full screen width of the mobile viewport, bypassing typical message bubble margin constraints.
- **FR-008**: The width of the AI response container MUST dynamically shrink to fit single-line responses and expand to full-width for multi-line or code-containing responses.
- **FR-009**: Padding around both user message bubbles and AI response views MUST be reduced by at least 30% compared to the original design to maximize reading space.
- **FR-010**: System MUST render a copy-to-clipboard button on all Markdown code block boxes in assistant messages.
- **FR-011**: System MUST show a modern empty state layout containing suggested quick-action prompt pills ("Find bugs", "Write tests", "Explain code", "Check status") when there are no messages in the active conversation.
- **FR-012**: System MUST render a "New Chat" icon button in the header that resets the active conversation's timeline after prompting the user with a confirmation dialog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can access the expanded tool list in exactly 1 tap.
- **SC-002**: Message timeline vertical scrolling is reduced by up to 80% during active multi-tool executions because logs are collapsed by default.
- **SC-003**: Horizontal code block line wrapping on a standard mobile screen is reduced by at least 15% due to the full-width layout.
- **SC-004**: Clearing a chat session executes in less than 200 milliseconds.

## Assumptions

- **A-001**: The socket backend streams detailed tool activities (`OpenCodeToolActivity`) and file changes (`OpenCodeFileChange`) that can be grouped by message/request ID.
- **A-002**: Mobile devices have Clipboard API support enabled.
- **A-003**: The device display is optimized for high-contrast dark themes.
