# WebSocket Events Contract: IOTA Stream Bridge

Real-time terminal execution and logs are streamed over WebSockets (`wss://`) managed by Socket.io. The socket server listens on the forwarded Codespace port.

---

## 1. Connection & Authorization
During connection handshake, the client MUST transmit the active GitHub token and any session-injected third-party credentials.

- **Query Parameters**:
  - `token`: String - GitHub OAuth Access Token.
- **Handshake Payload (Injected Env Vars)**:
  ```json
  {
    "credentials": {
      "ANTHROPIC_API_KEY": "sk-ant-xxxxxxxxxxxxx",
      "OPENAI_API_KEY": "sk-xxxxxxxxxxxxx"
    }
  }
  ```

*Security Note*: These credentials are held strictly in the Node.js memory of the running WebSocket process, injected into the child terminal process environment variables at startup, and never written to Codespace server disk or configuration files.

---

## 2. Client-to-Server Events

### `agent:start`
Spawns a pseudo-terminal running the CLI agent with the user's prompt.

- **Payload**:
  ```json
  {
    "agent": "claude-code",
    "prompt": "Optimize the main Dockerfile for multi-stage builds and build a test container."
  }
  ```

---

### `terminal:input`
Transmits raw user input (like keystrokes or interactive selection choices) to the running pseudo-terminal.

- **Payload**:
  ```json
  {
    "input": "\n" // Enters return key
  }
  ```

---

### `agent:stop`
Kills the running coding agent execution and teardowns the pseudo-terminal process.

- **Payload**: None.

---

## 3. Server-to-Client Events

### `terminal:log`
Streams raw stdout/stderr lines from the pseudo-terminal, including ANSI formatting control sequences.

- **Payload**:
  ```json
  {
    "chunk": "\x1b[32m✔\x1b[0m Dockerfile optimized for multi-stage build."
  }
  ```

---

### `agent:status`
Broadcasting state changes of the active execution.

- **Payload**:
  ```json
  {
    "status": "running" | "idle" | "error",
    "details": "Agent is executing tests..."
  }
  ```

---

### `terminal:exit`
Emitted when the CLI agent finishes execution and the pseudo-terminal process terminates.

- **Payload**:
  ```json
  {
    "exitCode": 0,
    "completed": true
  }
  ```
