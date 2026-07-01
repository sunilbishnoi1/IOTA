# OpenCode Chat Control Flow

## Unclosed Stdin Pipe Blocks Go CLI
- **Root cause:** `child_process.spawn` leaves stdin open as pipe; `opencode` reads stdin until EOF before executing, hanging indefinitely.
- **Fix:** Call `child.stdin?.end()` immediately after spawning commands that don't need interactive input.

## Unix `shell: true` Duplicates Command Name
- **Root cause:** Node translates `{ shell: true }` to `/bin/sh -c 'cmd "$@"' -- cmd args` — `cmd` becomes `$1`, duplicating the subcommand.
- **Fix:** Spawn `/bin/sh` with `shell: false` using `['-c', 'exec cmd "$@"', '--', ...args]`.

## Shell Stdout Buffering Traps Pipe Output
- **Root cause:** `/bin/sh` buffers child stdout in non-interactive pipe mode, delaying small JSON events from reaching Node.
- **Fix:** Prepend `exec` to the shell command string, replacing the shell process and connecting pipes directly to the target binary.

## Watchdog Finalization Blocks Fallback Recovery
- **Root cause:** Watchdog set `finalized = true` on timeout, causing all subsequent fallback-run events to be silently ignored.
- **Fix:** Make watchdog non-blocking — stop the process without finalizing; reset timer for the direct-run fallback.

## TCP Port Probe Misses Deadlocked Daemons
- **Root cause:** Raw TCP socket connect returns `true` for any listening port, even if the daemon is hung and unresponsive.
- **Fix:** Use HTTP GET request to verify daemon responsiveness instead of raw TCP connection checks.

## `opencode run` Permission Prompt Hangs in Headless
- **Root cause:** CLI pauses for TTY approval before any output; piped stdin has no TTY, so it waits forever.
- **Fix:** Pass `--dangerously-skip-permissions` flag to bypass interactive prompts in automation contexts.

## Watchdog Cannot Kill Hanging Child — `handle` Undefined When Watchdog Fires
- **Root cause:** `handle?.stop()` inside the watchdog closure is a no-op because `handle` is still `undefined` — `opencodeRunner.run()` hasn't returned yet (the child process is hanging at `await childDone` inside the `donePromise`).
- **Fix:** Replace `handle?.stop()` with `opencodeRunner.stopActiveRun()` which directly kills `this.activeRun` and doesn't depend on the `handle` variable being assigned.
- **Files:** `iota-bridge/src/services/socket.ts:401`, `iota-bridge/src/services/opencode.ts:329`

## `onActivity` Triggered by Stderr, Clears Watchdog Prematurely
- **Root cause:** `onActivity()` (which calls `markFirstActivity` → clears watchdog → emits `streaming`) fires on ANY stdout OR stderr data. CLI progress messages on stderr prematurely clear the watchdog before actual model output on stdout arrives. If the model then never produces output, no watchdog remains to time out the run.
- **Fix:** Only call `onActivity()` on stdout data events, not stderr. Keep stderr handling for error reporting only.
- **Files:** `iota-bridge/src/services/opencode.ts:269,290`

## `checkPortReady` Treats 502/503 as "Server Ready"
- **Root cause:** `checkPortReady()` uses an HTTP GET probe and resolves `true` on ANY response status code (including 502/503/404), making `ensureServer()` report a partially-initialized server as "ready." The attached-mode child then connects and blocks silently.
- **Fix:** Only resolve `true` for 2xx status codes (`res.statusCode >= 200 && res.statusCode < 300`).
- **Files:** `iota-bridge/src/services/opencode.ts:29-30`

## `awaiting_first_output` Emitted After `streaming` — Status Rollback
- **Root cause:** `emitRunStatus({phase:'awaiting_first_output'})` at `socket.ts:488` is emitted unconditionally after `run()` returns, even if `markFirstActivity` already transitioned to `streaming`. This overwrites the store's correct `running` status back to `awaiting_first_output`.
- **Fix:** Guard with `if (!firstActivity)` before emitting `awaiting_first_output`.
- **Files:** `iota-bridge/src/services/socket.ts:488-494`

## Tool Activity Keys Nested Under `event.part`
- **Root cause:** Properties like `tool`, `name`, `label` were inside `event.part` not at root, so normalizer returned `undefined`.
- **Fix:** Create a `getVal` helper that checks both root and `event.part` levels for each key.

## Timeline Renderer Property Name Mismatch
- **Root cause:** `groupedTimelineItems` mapped tool/file/approval under `data`, but renderers expected `activity`/`change`/`approval`.
- **Fix:** Align mapped property names in `groupedTimelineItems` with the consuming component interfaces.

## `expo-av` Version Incompatible with Expo SDK 51
- **Root cause:** Installing `expo-av@16.0.8` in Expo SDK 51 caused `Cannot read property 'prototype' of undefined` at bundle time.
- **Fix:** Run `npx expo install --fix` to downgrade `expo-av` to the SDK-compatible version (`~14.0.7`).

## OpenCode Session Sync Spinner Hang on Empty History
- **Root cause:** Client `onSnapshot` handler exited early on null/undefined conversation payload without setting `isSyncing` to false.
- **Fix:** Update `onSnapshot` client callback to set `isSyncing = false` when conversation is falsy.

## Chat Input Bar Height Stuck After Send
- **Root cause:** The `inputHeight` state is not reset when `inputPrompt` is cleared programmatically.
- **Fix:** Add a `useEffect` in `ControlScreen.tsx` that resets `inputHeight` to its default value `44` when `inputPrompt` is empty.

## OpenCode Conversation Type Mismatch Between Bridge and Mobile
- **Root cause:** `OpenCodeConversation` in mobile types was missing `createdAt` and `updatedAt` properties, causing compile errors in the History UI.
- **Fix:** Added optional `createdAt` and `updatedAt` properties to the mobile `OpenCodeConversation` interface and updated date helpers to handle undefined values.

## New Session Request Reuses Last Active Conversation
- **Root cause:** `getOrCreateConversation` was falling back to the last active conversation ID when `undefined` was passed for a new chat session.
- **Fix:** Added a `forceNew` flag to `getOrCreateConversation` and passed `true` in `opencode:new_session` socket listener to guarantee fresh session creation.

## Sync IOTA Conversation Titles with OpenCode CLI Session Titles
- **Root cause:** First line fallback title generator is useful immediately, but OpenCode CLI generates better semantic session titles later.
- **Fix:** Added `syncConversationTitlesWithCli` mapping matching `opencodeSessionId` to the CLI's session list, and called it on command completion and when loading the history list.

## Codespace: Concurrent `ensureServer` Race → SIGKILL Death Spiral
- **Root cause:** Concurrent `run()` calls enter `ensureServer()` without mutual exclusion. A stale `serveProcess` close handler (missing PID check) nullifies the active process reference, causing the next run to treat the healthy process as "orphaned" and kill it with `SIGKILL` (leaving behind stale lock files). Note: Duplicate startup logs were a formatting side-effect of stdout redirection to the log file and not double initialization.
- **Fix:** Add promise-based mutual exclusion to `ensureServer()`. Add PID identity check to close/error handlers in `opencode.ts`. Use SIGTERM before SIGKILL for graceful shutdown.

## Stale Server Daemon Escapes Cleanup
- **Root cause:** `clearStaleServer()` killed only the process group leader using raw `serveProcess.kill()` without process group termination or `SIGKILL` escalation.
- **Fix:** Update `clearStaleServer()` to be `async` and use `killProcess()` for process-group cleanup, followed by `killProcessOnPort()` to release the port.

## User Stop Triggers Fallback Unconditionally
- **Root cause:** When a user stops a run, `jsonCount` is `0`, which unconditionally triggers fallback to direct run, spawning a background task and leaking locks/processes.
- **Fix:** Track explicitly stopped request IDs in `userStoppedRequests` and check the set before triggering the fallback.
