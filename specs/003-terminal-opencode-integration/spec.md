# Feature Specification: Terminal & OpenCode Integration

**Feature Branch**: `003-terminal-opencode-integration`

**Created**: 2026-06-24

**Status**: Draft

**Input**: User description: "Fix all terminal and OpenCode integration issues in ControlScreen, ensuring text input goes to the active session rather than spawning new processes, displaying installation logs properly, and making the terminal fully scrollable."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - OpenCode Installation & Checking (Priority: P1)

As a developer, I want to see if OpenCode is installed in my active Codespace and easily install it if it is missing, so that I can use the OpenCode coding agent.

**Why this priority**: Crucial first step. The user cannot use the OpenCode agent if it is not installed, and they need a clear visual status and a quick installation command.

**Independent Test**: Connect to a Codespace without OpenCode. The app should display "OpenCode Not Installed". Click the "Install OpenCode" quick command. The terminal should spawn the installation process (`npm install -g opencode-ai`) and show live progress. Once complete, the status should update to "OpenCode Installed".

**Acceptance Scenarios**:

1. **Given** a connected Codespace VM where the `opencode` CLI binary is not available in the PATH, **When** the ControlScreen loads, **Then** the UI shows that OpenCode is not installed, and presents an "Install OpenCode" quick command shortcut.
2. **Given** the OpenCode not installed state, **When** the user taps the "Install OpenCode" quick command shortcut, **Then** a terminal session is started running the install command, and live installation logs are streamed directly to the terminal component.
3. **Given** the installation finishes successfully, **When** the terminal status is checked, **Then** the active agent status updates to indicate OpenCode is installed.

---

### User Story 2 - Persistent Session & Interactive Text Input (Priority: P1)

As a developer, I want to type messages in the bottom input box and send them to the active, running OpenCode session, rather than spawning a new process or command for every prompt.

**Why this priority**: Core interaction paradigm. To interact with an agentic CLI (like OpenCode or Claude Code), the input must feed into the standard input (stdin) of the running process, maintaining the terminal session.

**Independent Test**: Start the OpenCode session. Type "Hi" and tap send. Verify that the text goes into the stdin of the running terminal process, and no new command or header card is created above the terminal.

**Acceptance Scenarios**:

1. **Given** an active OpenCode session running in the terminal, **When** the user types text and taps send, **Then** the input is written directly to the terminal's stdin.
2. **Given** a running session, **When** the user submits input, **Then** the text goes only to the existing terminal process and no duplicate message card or title is rendered above the terminal window.

---

### User Story 3 - Fully Scrollable Terminal Console (Priority: P2)

As a developer, I want the terminal to render correctly, showing all text without hiding it, and be fully scrollable horizontally and vertically so that I can review long command outputs.

**Why this priority**: Essential readability. If text is hidden or the terminal does not scroll properly, the user cannot read compiler errors or command outputs.

**Independent Test**: Run a command that outputs several screens of text and long lines. Verify that the user can scroll up/down and left/right within the terminal console container smoothly.

**Acceptance Scenarios**:

1. **Given** a terminal console with content exceeding screen size, **When** the user scrolls vertically, **Then** the previous output scrolls into view.
2. **Given** long log lines exceeding the width of the terminal, **When** the user scrolls horizontally, **Then** the truncated text scrolls into view without distorting the layout.

---

## Edge Cases

- **Installation Failure**: If the installation command fails (e.g. network timeout), the terminal should display the error code/logs, and the status should remain "Not Installed" with the option to retry installation.
- **Connection Interruption**: If the WebSocket connection drops during a running session, the terminal state should remain buffered on the bridge server. Reconnecting should restore the active terminal buffer.
- **Multiple Agents**: Currently, only OpenCode is supported. Other agent selection options (Claude, Cline) should be hidden or disabled to focus on the OpenCode flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The bridge status API (`GET /api/status`) MUST dynamically detect if `opencode` is installed in the system PATH.
- **FR-002**: The mobile app MUST display a clear "Not Installed" status when OpenCode is missing from the Codespace.
- **FR-003**: The mobile app MUST provide an "Install OpenCode" button/shortcut that runs the installation of `opencode-ai` on the bridge server.
- **FR-004**: The mobile app MUST hide/disable the selection of other agents (Claude, Cline) for the initial scope.
- **FR-005**: The text input box in ControlScreen MUST send input directly to the active terminal process stdin using `terminal:input` socket events if a session is already active.
- **FR-006**: The ControlScreen UI MUST NOT render user message cards above the terminal window; all input and output should happen directly within the terminal display.
- **FR-007**: The TerminalConsole component MUST be fully horizontally and vertically scrollable without scroll conflicts or parent ScrollView compression.
- 
- ### Key Entities
- 
- - **Active Session**: Represents the currently running PTY process (`node-pty`) on the bridge server, persisting its output log buffer and forwarding input stream.
- 
- ## Success Criteria *(mandatory)*
- 
- ### Measurable Outcomes
- 
- - **SC-001**: Users can check the installation status of OpenCode in under 1 second after connecting.
- - **SC-002**: Installing OpenCode completes and updates status automatically when the underlying installation command finishes.
- - **SC-003**: 100% of user inputs typed into the message box are sent to the running PTY stdin rather than launching a new process.
- - **SC-004**: Long lines (up to 1000 characters) are scrollable horizontally in the terminal without word wrapping or distortion.
- 
- ## Assumptions
- 
- - We assume the Codespace environment runs on Linux, where `which opencode` is a valid way to check for CLI installation.
- - We assume `npm i -g opencode-ai` or `curl -fsSL https://opencode.ai/install | bash` is the correct installation command for OpenCode in this environment.
