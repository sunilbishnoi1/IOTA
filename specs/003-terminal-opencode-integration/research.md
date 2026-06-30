# Research Notes: Terminal & OpenCode Integration

## Decisions

### 1. Dynamic Installation Check
- **Decision**: Use `which opencode` (Linux) or `where.exe opencode` (Windows) on the bridge server inside the status API to dynamically check if OpenCode is in the PATH.
- **Rationale**: Ensures the mobile app always receives the true status of the CLI on the VM.

### 2. NPM Package Specification
- **Decision**: Use `opencode-ai` as the global npm package name for installation, or fall back to the curl command `curl -fsSL https://opencode.ai/install | bash`.
- **Rationale**: The package name `opencode` is invalid, and the correct official package name is `opencode-ai`. Using curl installation as a fallback provides robust provisioning.

### 3. Persistent Terminal stdin Forwarding
- **Decision**: Feed subsequent inputs from the bottom text box directly to the existing `node-pty` terminal using `terminal:input` websocket events, rather than spawning new processes.
- **Rationale**: Interactive tools like Claude Code and OpenCode maintain state and prompt loops in standard input. Restarting the process on every message breaks the chat context and resets the session.

### 4. Layout Fix
- **Decision**: Change the container in `ControlScreen.tsx` from `ScrollView` to `View` with `flex: 1`.
- **Rationale**: Nesting a vertical ScrollView (`TerminalConsole`) inside another vertical ScrollView (`chatArea` in `ControlScreen`) causes the inner ScrollView to collapse to zero or minimum size, preventing vertical scrolling and hiding text.

## Alternatives Considered

- **Using NPX for every execution**: Rejected. Run times are slower, handles internet hiccups poorly, and does not support persistent terminal interactive sessions.
- **Custom endpoint for installation**: Rejected. By spawning the command as a standard terminal agent (`install-opencode`), the client automatically receives the installation output stream in the terminal window, giving the user live progress.
