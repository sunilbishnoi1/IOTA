# Research Notes: OpenCode Slash Commands Integration

This document outlines the design decisions, rationales, and alternatives considered for implementing OpenCode TUI slash commands in the IOTA mobile app and bridge.

## Research Findings & Decisions

### 1. Slash Command Interception and Routing

- **Decision**: Commands starting with `/` are checked on the client first. If they are local-only (`/help`, `/connect`, `/undo`, `/redo`), they are processed instantly by client handlers. Otherwise, they are sent as standard chat messages starting with `/` to the bridge via WebSocket, where they are parsed and handled.
- **Rationale**: Local commands should respond instantaneously (< 100ms) without hitting the bridge. Bridge-mediated commands should be run using standard Node.js process spawning or file queries.
- **Alternatives Considered**: Handling all commands on the bridge. Rejected because `/connect` requires showing client-side modal overlays which the bridge cannot trigger directly.

### 2. Autocomplete Suggestions Overlay

- **Decision**: Render a floating absolute overlay above the text input inside `ControlScreen` using a React Native `FlatList`. Suggestions are triggered when the input starts with `/` and is filtered as typing continues.
- **Rationale**: Floating overlay gives a premium IDE-like auto-completion experience without taking up screen real estate.
- **Alternatives Considered**: In-line text autocomplete. Rejected because it is hard to navigate on small mobile screens.

### 3. Model Management (`/models` & `/models <model>`)

- **Decision**: 
  - `/models` executes `opencode models` directly on the bridge and streams the list of available models back to the client inside a monospaced block.
  - `/models <model-name>` updates the active model parameter in the bridge's conversation store. Subsequents runs will use `--model <model-name>` instead of the hardcoded default.
- **Rationale**: Allows users to see and select models dynamically. Running the direct CLI command `opencode models` takes less than 500ms, bypasses the LLM execution pipeline, and requires zero network roundtrips outside the bridge-to-client link.
- **Alternatives Considered**: Hardcoded list on the client. Rejected because the available models can change dynamically on the bridge's shell environment.

### 4. Workspace Code Review (`/review`)

- **Decision**: Intercept `/review` and spawn a standard `opencode run` with the prompt: `"Review all staged and unstaged changes in this repository and audit for code quality, bugs, and style consistency."`
- **Rationale**: Translates the slash command into a standard prompt for the agent to execute on the workspace, reusing the existing streaming mechanism.

### 5. Custom Skills Listing (`/skills`)

- **Decision**: Read the subdirectories under `.agents/skills` using `fs.readdir` on the bridge and format them into a clean markdown list.
- **Rationale**: Fast, lightweight, and requires no external process spawn.
- **Alternatives Considered**: Spawning a shell to list files. Rejected as it is slower and less secure.

### 6. Workspace Session List (`/sessions`)

- **Decision**: Run `opencode session list --format json` on the bridge, parse the JSON array, and return a clean markdown table showing the active sessions.
- **Rationale**: Parsing JSON is far more robust than splitting command line tables which can vary in spacing.
- **Alternatives Considered**: Return raw text output. Rejected as raw CLI table has double spacing which looks ugly and overflows small mobile screens.

### 7. Workspace Session Deletion (`/sessions delete <id>`)

- **Decision**: Run `opencode session delete <sessionID>` and return a confirmation message.
- **Rationale**: Direct CLI execution.

### 8. Workspace Keep-Alive & Init (`/init`)

- **Decision**: Running `/init` executes `.specify/extensions/agent-context/scripts/powershell/update-agent-context.ps1` (or bash equivalent on Linux) on the bridge to keep the `AGENTS.md` file updated and in sync with the active SpecKit plan.
- **Rationale**: Ensures the bridge workspace context is initialized and ready for development.

### 9. Chat Undo/Redo (`/undo` & `/redo`)

- **Decision**: Perform local state rollback by removing the last user/assistant message pair from the messages array. Keep a history stack of undone pairs to allow `/redo` restoration.
- **Rationale**: Client-side state changes are instant and highly responsive.
