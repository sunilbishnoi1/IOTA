# Data Model: Terminal & OpenCode Integration

## Entities

### WorkspaceStatus
Represents the status information returned by the bridge `/api/status` endpoint and rendered in the mobile client's dashboard and control screen status bar.

| Field | Type | Description |
|---|---|---|
| `status` | `'online'` \| `'offline'` | Connection status of the bridge |
| `repository` | `string` | The GitHub repository name (e.g. `sunilbishnoi1/IOTA`) |
| `branch` | `string` | The current active Git branch of the workspace |
| `activeAgent` | `'opencode'` | The active agent name (hardcoded to `'opencode'` for now) |
| `agentInstalled` | `boolean` | Dynamically checks if `opencode` CLI is installed on the VM |

### ActiveSession (Terminal Session)
Represents a running pseudo-terminal (PTY) session spawned by `node-pty` on the bridge server.

| Field | Type | Description |
|---|---|---|
| `ptyProcess` | `pty.IPty` | The raw PTY handle spawned by the system shell |
| `logBuffer` | `string[]` | Rollback log cache containing up to 2000 lines |

### TerminalInputPayload
Payload sent by the mobile client via WebSocket `terminal:input` events.

| Field | Type | Description |
|---|---|---|
| `input` | `string` | Raw keystroke or prompt string with a trailing newline |

### AgentStartPayload
Payload sent by the mobile client via WebSocket `agent:start` events to start a session.

| Field | Type | Description |
|---|---|---|
| `agent` | `'opencode'` \| `'install-opencode'` | Name of the agent/process to spawn |
| `prompt` | `string` | Optional initial prompt to write to the stdin |
