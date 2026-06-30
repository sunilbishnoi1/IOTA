# Research: OpenCode Control Chat Fixes

This document details the research findings and design choices made to resolve the six OpenCode control chat flow issues.

## 1. JSON Payload Normalization

### Decision
Update `normalizeOpenCodePayload` in `opencodeEvents.ts` to check inside the nested `part` object (e.g. `part.text`, `part.content`) when root-level properties are missing or undefined. Also, explicitly handle `step_start` and `step_finish` to return empty events `[]`.

### Rationale
OpenCode streams newline-delimited JSON where text chunks are nested inside a `part` object (e.g., `{"type":"text","part":{"text":"Hi! How can I help you today?"}}`). Extracting them from `part` prevents empty bubbles. Returning `[]` for `step_start` and `step_finish` prevents them from falling through to the status message fallback, eliminating timeline clutter.

### Alternatives Considered
- Parsing raw CLI text outputs: Rejected because JSON streaming is more structured, robust, and handles tool/file-change events natively.

---

## 2. Consolidated Run Status Updates

### Decision
Use a single stable message ID (`run-${status.requestId}`) for intermediate execution lifecycle updates on both the bridge (`socket.ts`) and mobile client (`ControlScreen.tsx`).

### Rationale
Assigning different IDs per phase creates a new persistent message for each transition, cluttering the timeline. A stable ID overwrites the previous status in the store/client state, keeping exactly one active status message per prompt.

### Alternatives Considered
- Filtering status messages completely on the client: Rejected because real-time status indication improves user experience during long-running tasks.

---

## 3. Native File Logging

### Decision
Implement a native logger service (`logger.ts`) in the bridge using Node.js filesystem write stream to write server events and subprocess outputs to `bridge.log`.

### Rationale
The previous shell redirect wrapper (`node -e ... > bridge.log`) does not capture bridge trace output natively and fails in non-bash/Windows environments. A native logger ensures all events and stdout/stderr are captured correctly.

### Alternatives Considered
- Third-party log libraries (Winston/Pino): Rejected to keep the bridge lightweight and avoid unnecessary dependencies.

---

## 4. Default Free Model Specification

### Decision
Pass `--model opencode/deepseek-v4-flash-free` during `opencode run` spawning. Remove key configuration requirements from capability checks.

### Rationale
Allows out-of-the-box execution without credentials. The model is free and does not require keys.

### Alternatives Considered
- None. This is the optimal path for credential-free setup.

---

## 5. Warm Server Fallback

### Decision
Introduce transparent fallback in `opencode.ts`: if the attach-mode process exits with non-zero code or error without producing JSON output, launch a direct run command execution instead.

### Rationale
Guarantees high-availability. If port 4096 is blocked or attachment fails, the task still succeeds.

### Alternatives Considered
- Prompting user to restart warm server: Rejected because it interrupts the chat flow.

---

## 6. Conversation Snapshot & Navigation Sync

### Decision
De-duplicate conversation snapshot messages on client remount using the stable status ID and clean merging.

### Rationale
Synchronizing stable message IDs ensures that returning to the Control Screen perfectly restores the timeline state without duplication or jumps.

### Alternatives Considered
- Persisting state in client global store: Storing it on the bridge is more reliable as it survives app restarts and network reconnects.
