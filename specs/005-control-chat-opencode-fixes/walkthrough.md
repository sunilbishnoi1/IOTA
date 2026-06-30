# Walkthrough: OpenCode Control Chat Fixes

This document records the verification results, execution traces, and details of the completed OpenCode control chat flow fixes.

## Completed Tasks & Features

### 1. Cleaner and Reliable Chat Flow (US1)
- Extracted and normalized nested message delta payloads from `part` object fields (e.g. `part.text` or `part.content`).
- Filtered out `step_start` and `step_finish` events by mapping them to return empty event lists `[]`, avoiding timeline pollution.

### 2. Consolidated Run Status Updates (US2)
- Unified the status message ID to a stable `run-${status.requestId}` format.
- This ensures that intermediate lifecycle updates (e.g. `server_start`, `attached_run`/`direct_run`, `streaming`, `completed`, `failed`) overwrite the previous phase's status bubble in-place instead of spawning new status messages.

### 3. Native & Config-Free Model Access (US3)
- Configured `--model opencode/deepseek-v4-flash-free` as the default model inside `opencode.ts`.
- Removed API key validation gating from capability checks in both `opencode.ts` and `socket.ts`, enabling instant out-of-the-box usage.

### 4. Warm Server Fallback (US4)
- Spawns attached run first if the warm server check passes.
- Automatically falls back to direct run mode (`opencode run` without `--attach`) if the attached run process errors or exits with a non-zero code and has produced zero JSON outputs.
- Stale warm server instances are cleared, and active process tracking (`stop()` and `stopActiveRun()`) updates dynamically to handle the fallback process.

### 5. Conversation History & Navigation Sync (US5)
- Ensured `ControlScreen.tsx` awaits loading the stored conversation ID from `secureStoreService` before initiating the websocket connection or emitting the `opencode:sync` event.
- Refined the message merging logic `mergeMessages` to de-duplicate messages by ID and correctly prefer local/streaming updates or longer contents when merging with server-side snapshots.

### 6. Unified Diagnostics and Operations Log (US6)
- Created the native `logger.ts` service writing logs to `bridge.log` in the workspace root.
- Piped all `opencode` child process stdout and stderr outputs to `bridge.log`.
- Logged all key socket connection events, disconnect events, status changes, errors, and fallback events.

---

## Verification Results

### Automated Tests
Ran `npm test` inside `iota-bridge` to verify all 10 tests across the suite (including event normalization and codespace check reachability) pass successfully:

```text
PASS src/services/__tests__/opencodeEvents.test.ts
PASS src/services/__tests__/codespaceService.test.ts

Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        3.699 s, estimated 4 s
Ran all test suites.
```

### Build Verification
Ran `npm run build` inside `iota-bridge` to confirm compilation completes with zero type errors:

```text
> iota-bridge@1.0.0 build
> tsc
```

---

## Log Output Example (Simulated Fallback Event)
Below is a sample sequence from `bridge.log` showing the fallback trigger working transparently:

```text
[2026-06-26T22:15:00.123Z] [INFO] Socket client connected: socket-12345
[2026-06-26T22:15:05.456Z] [INFO] [Socket] Received prompt from socket socket-12345: "Check git status"
[2026-06-26T22:15:05.457Z] [INFO] [Socket] Starting request req-789 for conversation opencode-default
[2026-06-26T22:15:05.458Z] [INFO] [Socket] Run status transition: conversationId=opencode-default, phase=preflight, message="OpenCode preflight passed. Starting run..."
[2026-06-26T22:15:05.670Z] [INFO] [OpenCodeRunner] Spawning process (attempt 1): opencode run --model opencode/deepseek-v4-flash-free --attach http://localhost:4096 "Check git status" --format json
[2026-06-26T22:15:05.800Z] [ERROR] [OpenCode stderr] Error: Cannot connect to OpenCode daemon at http://localhost:4096 (Connection refused)
[2026-06-26T22:15:05.850Z] [INFO] [OpenCodeRunner] Process (attempt 1) closed with exitCode=1
[2026-06-26T22:15:05.851Z] [ERROR] [OpenCodeRunner] Attached run failed with exitCode=1, spawnError=undefined and 0 JSON outputs. Triggering fallback to direct run.
[2026-06-26T22:15:05.852Z] [INFO] [Socket] Run status transition: conversationId=opencode-default, phase=direct_run, message="Warm server attachment failed. Falling back to direct execution..."
[2026-06-26T22:15:05.853Z] [INFO] [OpenCodeRunner] Spawning process (attempt 2): opencode run --model opencode/deepseek-v4-flash-free "Check git status" --format json
[2026-06-26T22:15:06.120Z] [INFO] [OpenCode stdout] {"type":"message_delta","content":"On branch main..."}
[2026-06-26T22:15:06.500Z] [INFO] [OpenCodeRunner] Process (attempt 2) closed with exitCode=0
[2026-06-26T22:15:06.501Z] [INFO] [Socket] Request req-789 completed successfully
[2026-06-26T22:15:06.502Z] [INFO] [Socket] Run status transition: conversationId=opencode-default, phase=completed, message="OpenCode run completed."
```
