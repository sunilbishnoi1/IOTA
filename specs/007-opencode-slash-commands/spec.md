# Feature Specification: OpenCode Slash Commands

**Feature Branch**: `007-opencode-slash-commands`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "/speckit-specify lets implement support for all the slash cmds that opencode provides like /models, /review, /skills etc and many more. properly do websearch, researach, utilize the locally installed existing opencode in terminal to understand and list down what all slash cmds does opencode have. How those can be implemented in our system. test whether it is going to work in our case. we need to make sure everything gets integrated to our UI smoothly while keeping clean, minimal, premium ux. and since codefile ControlScreen.tsx already became too long, we need to write this feature into a new file and import it into this ControlScreen.tsx"

## Clarifications

### Session 2026-06-28

- Q: Which additional built-in TUI slash commands from OpenCode should we support in the spec, and how should they behave? → A: Option C - Support the complete list: /help, /connect, /init, /compact, /undo, /redo, /sessions, /models, /export, /exit, /stats, /skills, /review.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Interactive Slash Command Interception (Priority: P1)

As a developer using the IOTA mobile app, I want to type slash commands like `/help`, `/models`, `/stats`, `/review`, `/skills`, `/sessions` directly into the chat input, so that I can quickly inspect and control the agent state without needing to write full natural language instructions.

**Why this priority**: Core value of the user request. Allows instant execution of local agent control actions directly from the chat prompt.

**Independent Test**: Can be tested by typing `/help` in the chat input and submitting. The chat timeline should immediately output a formatted help card showing all supported commands and their descriptions locally, without spawning an LLM request.

**Acceptance Scenarios**:

1. **Given** the chat input is focused, **When** the user types `/help` and presses submit, **Then** a local assistant message is immediately appended containing a formatted list of all slash commands.
2. **Given** the chat input is focused, **When** the user types `/invalidcommand` and presses submit, **Then** a local system/error message is appended advising the user of the invalid command.

---

### User Story 2 - Real-Time Autocomplete Suggestion UI (Priority: P2)

As a developer typing a command, I want to see a premium, floating suggestion menu appear as soon as I type `/`, which filters matching commands as I type, so that I don't have to memorize the commands and can select them with a single tap.

**Why this priority**: Enhances the user experience significantly, making the chat interface feel extremely responsive, premium, and alive.

**Independent Test**: Can be tested by focusing the input and typing `/`. The suggestion menu should render smoothly above the keyboard. Typing `m` should filter the list to `/models`. Tapping `/models` should auto-complete the input value.

**Acceptance Scenarios**:

1. **Given** the chat input is empty, **When** the user types `/`, **Then** the suggestion list overlay appears above the keyboard with all available slash commands.
2. **Given** the suggestion list is visible, **When** the user continues typing `/st`, **Then** the list is filtered to show only `/stats`.
3. **Given** the suggestion list is visible, **When** the user taps the `/stats` row, **Then** the input text is updated to `/stats ` and the suggestion list is closed.

---

### User Story 3 - Model Management and Switching (Priority: P2)

As a developer using IOTA, I want to type `/models` to see all available LLM models on the bridge, and type `/models <model-name>` to switch the active model, so that I can configure the brain of the agent dynamically.

**Why this priority**: Essential for model customization without modifying bridge source code.

**Independent Test**: Can be tested by running `/models`. It should query the bridge, return the list of models, and render them. Running `/models github-copilot/gpt-5-mini` should update the active model, and the subsequent user prompts should be spawned with the `--model github-copilot/gpt-5-mini` CLI parameter.

**Acceptance Scenarios**:

1. **Given** the active session is idle, **When** the user submits `/models`, **Then** a list of all models returned by `opencode models` is printed in a clean code block.
2. **Given** the active session, **When** the user submits `/models github-copilot/gpt-5-mini`, **Then** a confirmation message is displayed, and future runs are spawned with the new model model.

---

### User Story 4 - Workspace Code Review & Statistics (Priority: P3)

As a developer, I want to execute `/review` to trigger a code audit of my current local changes, and `/stats` to view token usage, cost, and tool execution history from the local database.

**Why this priority**: Provides premium developer tools for evaluating workspace state and usage statistics.

**Independent Test**: Can be tested by typing `/stats`. The output should render the styled ascii overview tables generated by the `opencode stats` CLI command.

**Acceptance Scenarios**:

1. **Given** a workspace with modified files, **When** the user submits `/review`, **Then** an `opencode run` process is triggered with a prompt asking the model to review the unstaged and staged code changes in the workspace.
2. **Given** any state, **When** the user submits `/stats`, **Then** the formatting card with cost, tokens, and tool usage is returned.

---

### Edge Cases

- **Empty or Offline Bridge**: If the client is disconnected from the socket, typing slash commands that query the CLI (like `/models`, `/stats`, `/review`) should fail gracefully, showing a clear warning banner or alert.
- **Cli Execution Timeout**: If the `opencode models` or `opencode stats` command hangs on the bridge, a 15-second watchdog should abort the execution and return a timeout message to avoid locking the UI.
- **Model Switching Verification**: If the user provides a model name that doesn't exist, the bridge should validate or print a warning, but still allow it in case it's a newly added custom provider.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST intercept any chat submission starting with a `/` character before transmitting it to the LLM agent session.
- **FR-002**: The mobile client MUST display a floating popover/overlay suggestion menu when the user's input text starts with `/`.
- **FR-003**: The autocomplete suggestion menu MUST filter matching commands in real-time as the user types characters after `/`.
- **FR-004**: Tapping a command in the autocomplete menu MUST update the chat input text and focus it.
- **FR-005**: The system MUST implement `/help` to show local usage instructions and list all commands.
- **FR-006**: The system MUST support `/models` to query `opencode models` from the bridge, and `/models <model-name>` to switch the active model on subsequent executions.
- **FR-007**: The system MUST support `/stats` to query `opencode stats` from the bridge and render the output in a clean, monospaced formatted block.
- **FR-008**: The system MUST support `/review` which triggers an `opencode run` prompt specifically tailored to audit the workspace changes.
- **FR-009**: The system MUST support `/skills` to list the custom agent skills present in the project.
- **FR-010**: The system MUST support `/sessions` to query `opencode session list` and return a table of active and historical CLI sessions, and `/sessions delete <session-id>` to delete a session.
- **FR-011**: All client-side slash command state, suggestion UI, filtering, and component elements MUST be written in a new file `iota-mobile/src/components/control/ControlSlashCommands.tsx` and imported into `ControlScreen.tsx` to prevent bloated file size.
- **FR-012**: The system MUST support `/connect` (or `/auth`) to open the transient credentials configuration view in the app.
- **FR-013**: The system MUST support `/init` to trigger the bridge workspace initialization and update the `AGENTS.md` file.
- **FR-014**: The system MUST support `/compact` (or `/summarize`) to request the agent to summarize the conversation session.
- **FR-015**: The system MUST support `/undo` to roll back the last chat state (removing the last user and assistant message pair) and `/redo` to restore a rolled-back state.
- **FR-016**: The system MUST support `/export` to save the active conversation log as a markdown document.
- **FR-018**: The system MUST support `/exit` (or `/quit`, `/q`) to stop the active run and close/exit the control session.

### Key Entities

- **SlashCommand**: Represents a command available in the chat input.
  - `command`: The string identifier (e.g. `"/models"`)
  - `description`: User-facing description of what the command does
  - `usage`: Example usage (e.g. `"/models [model-name]"`)
  - `clientOnly`: Boolean indicating if it's resolved entirely on the mobile client (e.g. `/clear`, `/help`, `/undo`, `/redo`)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The autocomplete suggestion menu renders and filters with zero noticeable delay (input latency < 16ms, hitting 60 FPS).
- **SC-002**: The code footprint added to `ControlScreen.tsx` for importing this feature is under 80 lines of code, maintaining clean component separation.
- **SC-003**: Executing local slash commands (like `/help`, `/clear`, `/undo`, `/redo`) takes less than 100ms as they bypass the WebSocket round-trip to CLI execution entirely.

## Assumptions

- The workspace has the `opencode` CLI executable available in the shell path.
- The WebSocket bridge is active and responds to custom event calls.
- The `node-pty` / shell spawn mechanisms can support running these secondary command queries alongside active agent runs.
