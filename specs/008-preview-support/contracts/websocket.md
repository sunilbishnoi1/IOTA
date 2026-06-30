# WebSocket Contracts: Preview Protocol

This document defines the WebSocket communication events and payloads between `iota-mobile` and `iota-bridge` for managing preview servers.

---

## 1. Client to Server Events

### `preview:start`
Initiates a preview dev server process on the remote bridge.

**Payload Structure:**
```typescript
interface PreviewStartPayload {
  port: number;       // e.g. 8081 or 5173
  command: string;    // e.g. "npx expo start" or "npm run dev"
  cwd?: string;       // e.g. "." or "packages/app"
  type: 'expo-go' | 'web';
}
```

---

### `preview:stop`
Stops a running preview dev server process and sets its port back to private.

**Payload Structure:**
```typescript
interface PreviewStopPayload {
  port: number;       // e.g. 8081
}
```

---

### `preview:status_request`
Queries the status of a specific preview server.

**Payload Structure:**
```typescript
interface PreviewStatusRequestPayload {
  port: number;
}
```

---

## 2. Server to Client Events

### `preview:status`
Broadcasts current state changes or results of status requests for a preview server.

**Payload Structure:**
```typescript
interface PreviewStatusPayload {
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'crashed';
  url?: string;       // Public codespace forwarded URL, e.g. "https://my-codespace-8081.app.github.dev"
  command: string;
}
```

---

### `preview:log`
Streams real-time terminal output (stdout/stderr) from the running subprocess.

**Payload Structure:**
```typescript
interface PreviewLogPayload {
  port: number;
  text: string;       // Chunk of terminal output
}
```

---

### `preview:error`
Emitted when starting/stopping fails or when a process error occurs.

**Payload Structure:**
```typescript
interface PreviewErrorPayload {
  port: number;
  error: string;      // Error message detail
}
```
