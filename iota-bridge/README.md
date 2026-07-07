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
- **Client Events**:
  - `opencode:message`: Submit a task prompt to OpenCode.
  - `opencode:stop`: Stop the active OpenCode run.
  - `opencode:approval`: Respond to a permission/approval request (`once`, `always`, `reject`).
  - `opencode:question_reply`: Submit answers to a clarification question.
  - `opencode:question_reject`: Dismiss/skip a clarification question.
  - `opencode:sync`: Fetch latest conversation state and session history.
  - `opencode:new_session`: Create a new conversation.
  - `opencode:list_conversations`: List all saved conversations.
  - `opencode:delete_conversation`: Delete a conversation.
  - `opencode:keepalive`: Extend Codespace keepalive duration.
  - `opencode:credentials`: Update transient API credentials.
  - `opencode:env_vars`: Update workspace environment variables.
  - `preview:start`: Start a preview/dev server.
  - `preview:stop`: Stop a preview server.
- **Server Events**:
  - `opencode:message_delta`: Streaming text delta from the active run.
  - `opencode:message`: A complete message (user, assistant, or status).
  - `opencode:tool_activity`: Tool execution event (started/completed/failed).
  - `opencode:file_change`: File change notification from a session diff.
  - `opencode:approval_request`: Permission approval request from OpenCode.
  - `opencode:question_request`: Clarification question from OpenCode.
  - `opencode:run_status`: Phase and status updates for the active run.
  - `opencode:capability`: OpenCode installation and availability status.
  - `opencode:error`: Error event with retry support.
  - `opencode:snapshot`: Full conversation snapshot after changes.
  - `opencode:conversations_list`: Updated list of all conversations.
  - `preview:log`: Preview server log output.
  - `preview:error`: Preview server error.
  - `preview:status`: Preview server lifecycle status.
  - `preview:config_response`: Preview configuration payload.
