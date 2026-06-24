# IOTA Bridge Server

The IOTA Bridge Server handles workspace operations, pseudo-terminal (PTY) execution of agent processes, and Git integrations. It runs inside the workspace environment (e.g. locally or in a remote GitHub Codespace VM) and serves REST and WebSocket APIs.

## Dynamic connection & VM Routing

Instead of routing traffic through intermediate proxies, IOTA utilizes direct connection routing. 

1. **Codespace Provisioning**: When a user creates or starts a Codespace VM, it starts a dedicated instance of the bridge server on port `3000`.
2. **Direct Socket Connection**: The mobile client retrieves the codespace state and connection URL format `https://<codespace-name>-3000.app.github.dev` via the GitHub API.
3. **GitHub Proxy Authentication**: To bypass the GitHub authentication proxy for port-forwarded ports, the client includes the user's GitHub OAuth token/Personal Access Token in:
   - The HTTP request `Authorization` header (`Bearer <token>`).
   - The Socket.io connection handshake (`auth.token`, `query.token`, or `extraHeaders.Authorization`).

## Codespace VM Configuration

When running inside a GitHub Codespace VM, the bridge resolves the parent repository workspace directory:
- It checks the environment variable `CODESPACE_VSCODE_FOLDER` (set automatically in Codespaces).
- If not present, it defaults to the parent directory `..` relative to the running process (`cwd` of the bridge).
- All PTY agent spawn tasks (`node-pty`) and Git commands are executed within this resolved root directory (`/workspaces/<repo-name>`).

## API Summary

### REST Endpoints

- `GET /api/status`: Retrieve general status, active repository, and branch.
- `GET /api/repos`: Fetch authenticated user's repositories.
- `GET /api/codespaces`: List all codespaces.
- `POST /api/codespaces`: Create/provision a new codespace (expects `repo`/`repository` and `branch` in body).
- `POST /api/codespaces/:name/start`: Start/wake up a sleeping codespace.
- `POST /api/codespaces/:name/stop`: Stop/shut down a codespace VM.
- `GET /api/codespaces/:name`: Get detail status of a specific codespace.

### WebSocket Interface

Runs on `/` namespace.
- **Handshake**: Requires a valid GitHub Token.
- **Events**:
  - `agent:start`: Triggers a new terminal execution with specified agent (`claude-code`, `opencode`, `cline`).
  - `agent:stop`: Terminated the active agent process.
  - `terminal:input`: Sends user stdin/keystrokes to the terminal process.
  - `terminal:log` (Server-to-Client): Streams terminal output chunks.
  - `terminal:exit` (Server-to-Client): Emitted when the process terminates.
  - `agent:status` (Server-to-Client): Emits agent status updates (`idle`, `running`, `error`).
