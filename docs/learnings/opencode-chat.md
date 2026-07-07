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

## Copy Chip Instantly Dismissed on Touch
- **Root cause:** `DismissCapture` intercepted all timeline touches during the capture phase (`onStartShouldSetResponderCapture`) and immediately dismissed the copy chip before the touch event could propagate to the chip's child `TouchableOpacity`.
- **Fix:** Pass the copy chip's native tag through the copy chip context and check it inside `DismissCapture`'s capture handler, returning early without dismissing if the target matches the copy chip.
- **Files:** `iota-mobile/src/components/control/ChatTimeline.tsx` and `iota-mobile/src/components/control/ChatMessageBubble.tsx`

## Duplicate Completed Assistant Message ID Mismatch
- **Root cause:** The normalizer mapped the final `text` event to a message ID generated from `event.part.messageID` using `stableId`, which differed from the run's streaming `assistantMessageId`, creating duplicate messages.
- **Fix:** Map the completed assistant response directly to the matching `assistantMessageId`.
- **Files:** `iota-bridge/src/services/opencodeEvents.ts:194`

## Timeline Interleaving Timing Race
- **Root cause:** Calling `interleaveInlineBlocks` inside the chronological event sorting loop processed the assistant message before tools (since message `createdAt < tool.startedAt`), so it returned early when activities were empty.
- **Fix:** Move interleaving blocks to a second-pass loop over turns after the event-grouping loop is complete.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx:275-281`

## Vanishing Messages from Snapshot Updates and Missing thoughts
- **Root cause:** Messages loaded from history or database snapshot updates lacked `parsedBlocks` metadata, causing the UI to return null or fail to render inline blocks, and a non-global regex matched only the first thought.
- **Fix:** Add dynamic fallbacks to call `parseAssistantContent(content)` when metadata is missing, and reuse it inside `parseMessageThoughts` to support multiple thoughts.
- **Files:** `iota-mobile/src/components/control/ChatMessageBubble.tsx:58-70,195,223,230` and `iota-mobile/src/screens/ControlScreen.tsx:180`

## Stale worked duration and tick displayed while agent running
- **Root cause:** Heuristics in message delta handlers prematurely set the screen's `running` state to `false`, and `isLastTurn` was fragile to trailing system messages.
- **Fix:** Keep `running` true until the run actually finishes using `onRunStatus` phase transitions, and filter for type `turn` when determining the last turn.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx` and `iota-mobile/src/components/control/ChatTimeline.tsx`

## What OpenCode's --format json actually emits:

step_start/ step_finish → both **filtered out** at `opencodeEvents.ts:137

`text→ full assistant text (including reasoning, as plain text)

`tool_use → only when a tool *completes* (no intermediate states)
error

## Intermediate text dropping and thought formatting bug
- **Root cause:** Storing wrapped tags in `lastTextContent` caused cumulative text slicing offset mismatch, reasoning events lacked `<thought>` wrappers, and `<intermediate>` blocks were treated as regular text causing timeline skip.
- **Fix:** Reset `lastTextContent` on `step_start`, remove wrapped tag updates on `step_finish`, wrap reasoning in thought tags, and map `<intermediate>` to its own block type.
- **Files:** `iota-bridge/src/services/socket.ts`, `iota-mobile/src/utils/opencodeParser.ts`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/screens/ControlScreen.tsx`

## Nested tags and index wrapping bugs
- **Root cause:** Outer `<intermediate>` regex matched inner `<thought>` tags rendering raw tags, and wrapping index offset failed in `socket.ts` when reasoning delta injected `<thought>` tags not present in `currentStepText`.
- **Fix:** Update `parseAssistantContent` to parse recursively and map sub-blocks, and track step content offset in `socket.ts` to wrap only trailing text slice.
- **Files:** `iota-bridge/src/services/socket.ts`, `iota-mobile/src/utils/opencodeParser.ts`

## SSE Connection Close Event Mismatch on Server
- **Root cause:** Registering the client connection close listener on `req.on('close')` inside the `req.on('end')` callback triggered immediately on request stream end, prematurely removing SSE clients.
- **Fix:** Register the connection close listener on `res.on('close')` instead.
- **Files:** `iota-bridge/src/services/__tests__/opencode.test.ts`

## Strict OpenCode Approval Decision Types Cause Compiler Errors
- **Root cause:** Comparing the legacy `decision` field to newly supported approval strings like `'once'` or `'always'` caused TS2367 compile errors due to type non-overlap constraints.
- **Fix:** Expanded the `OpenCodeApprovalDecision` type definition in `types/opencode.ts` to include `'once' | 'always' | 'reject'`.
- **Files:** `iota-bridge/src/types/opencode.ts`

## SSE Boundary Parsing Mismatch Causes Hangups and Watchdog Timeout on Windows
- **Root cause:** Looking exclusively for `\n\n` boundary delimiters in the SSE chunk stream fails on Windows when standard HTTP/SSE line endings contain carriage returns (`\r\n\r\n`), causing the entire stream to buffer indefinitely.
- **Fix:** Update chunk data boundary checks to detect both `\n\n` and `\r\n\r\n` delimiters and process complete event blocks dynamically.
- **Files:** `iota-bridge/src/services/opencode.ts`

## Nested SSE Properties and Evolved Event Schema Cause Watchdog Timeout and UI Sync Issues
- **Root cause:** The updated OpenCode server nests event fields inside `event.properties` and uses new event types (`message.part.delta`, `message.part.updated`) instead of the legacy root-level properties, preventing the bridge from registering session listeners or forwarding deltas to the UI.
- **Fix:** Flatten `event.properties` at the SSE client parser level, and map `message.part.delta` and `message.part.updated` to legacy types (`step_start`, `step_finish`, `reasoning`, `text_delta`) inside `socket.ts`.
- **Files:** `iota-bridge/src/services/opencode.ts`, `iota-bridge/src/services/socket.ts`

## OpenCode Server Port Readiness Check Times Out on Windows
- **Root cause:** Initializing the OpenCode daemon and loading configurations can take more than 3 seconds on Windows or under heavy CPU load, causing the probe check to time out early.
- **Fix:** Increased the `checkPortReady` timeout parameter from `3000` to `10000` milliseconds to give the server sufficient startup time.
- **Files:** `iota-bridge/src/services/opencode.ts`

## Watchdog Timeout During Tool Execution from Unmapped SSE Event Types
- **Root cause:** Long-running tool executions and subagent runs do not stream text deltas, and their `message.part.updated` tool start/complete events were ignored/returned early, triggering the 30-second inactivity watchdog.
- **Fix:** Map `message.part.updated` events with `part.type === 'tool'` to legacy tool event types to track active tool calls, and extend the inactivity timeout to 5 minutes while tools are running.
- **Files:** `iota-bridge/src/services/socket.ts`

## Final Response Misinterpreted and Timestamps Lost on Sync
- **Root cause:** Checking `index === parsedBlocks.length - 1` misclassified the final response when there were trailing thoughts/whitespace, and history sync mapped messages to content string without preserving parsed block metadata or timestamps.
- **Fix:** Locate the last non-empty text/intermediate block as the final response index, and synthesize timestamps on the client and during sync using activity/part sequences.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-bridge/src/services/opencode.ts`
## Vanishing User and Assistant Messages due to Missing Parts
- **Root cause:** User messages, system updates, and synced history messages lack part lists, which resulted in an empty `displayContent` rendering as `null` in the new part-based `ChatMessageBubble.tsx`.
- **Fix:** Added a fallback to `message.content` when `displayContent` is empty, and synthesized a dummy text part for assistant timeline items with no parts.
- **Files:** `iota-mobile/src/components/control/ChatMessageBubble.tsx`

## Empty/Collapsed Thinking Box on Expansion
- **Root cause:** The timeline thinking box used a nested `ScrollView` which collapsed to a height of 0 within the `FlatList` container, and the client-side `parts` state was cleared/not synchronized when a conversation snapshot was loaded from cache/history.
- **Fix:** Replaced the nested `ScrollView` with a standard `View` to allow the container to auto-size dynamically, and extracted and merged parts from conversation messages during snapshot updates and message receptions.
- **Files:** `iota-mobile/src/components/control/ChatTimeline.tsx` and `iota-mobile/src/screens/ControlScreen.tsx`

## SSE `parts` Not Passed to ChatMessageBubble → Invisible Text
- **Root cause:** After migrating to `opencode serve` (SSE), the bridge relays events via `opencode:sse_event` which updates `parts[]` state, but `ChatTimeline.tsx` never passed `parts` to `ChatMessageBubble`, and `onMessageDelta` (which populated `message.content`) was never emitted in the new flow.
- **Fix:** Pass `allParts` from `ControlScreen` → `ChatTimeline` → filter by `messageID` → `ChatMessageBubble`. Also sync `message.content` from text parts via a `useEffect` for backward compat.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`

## Watchdog Timeout and Missing tool stats during tool execution
- **Root cause:** The new SSE schema uses `message.part.updated` tool events which were not mapped in the bridge's `onJson` watchdog tracker or `handleStoreEvent` database handler, leaving the watchdog timeout at 30 seconds and failing to persist tool status to disk.
- **Fix:** Added mapping for `message.part.updated` tool events to add/remove IDs in `activeTools` (extending the timeout to 5 minutes) and call `addTool`/`updateToolStatus` for persistence.
- **Files:** `iota-bridge/src/services/socket.ts`

## Unified SSE Timeline Rendering and Tool Card Formatting
- **Root cause:** Stale isTimelineItem branching and missing case for 'text' parts cut off intermediate explanations and duplicated reasoning thoughts, while unmapped modern tool names (like run_command, view_file) defaulted to generic parameter displays.
- **Fix:** Partitioned parts chronologically by locating the last tool call to separate working parts and final responses, added 'text' part support in timeline, unified ChatMessageBubble rendering, and mapped modern tool names/parameters in ToolActivityCard.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/components/control/ToolActivityCard.tsx`

## Chat UI Duplicate Messages, ID Mismatches, and Wiped Tool Parts
- **Root cause:** User messages duplicated due to mismatched temporary IDs in merger, parts disappeared during assistant ID transition to server UUID, and tool parts were not persisted in the database messages causing them to be wiped on snapshot sync.
- **Fix:** Added content-based deduplication in merger, mapped parts to the new message ID when the assistant ID updates, and saved tool parts directly into `message.parts` on the bridge.
- **Files:** `iota-bridge/src/services/opencodeStore.ts`, `iota-bridge/src/services/socket.ts`, `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`

## Chat UI Rendering Performance and Message Vanishing
- **Root cause:** Separating messages and parts states triggered double-rendering on every delta update, and a custom React.memo compared only parts length rather than content, causing rendering lags and stale stream text.
- **Fix:** Nested the parts array directly within message objects, removed parts state and its sync useEffect, and updated the memo comparator to deeply compare part contents.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`, `iota-mobile/src/types/opencode.ts`

## Inactivity Timeout During Active Run and Assistant ID Transition Disappearances
- **Root cause:** The bridge watchdog timer missed modern tool events due to nested `properties.part` payloads and lacked busy status awareness, leading to premature 30-second inactivity timeouts.
- **Fix:** Correctly parsed properties-nested parts on the bridge, and extended the watchdog timeout to 5 minutes when session status is `busy`.
- **Files:** `iota-bridge/src/services/socket.ts`

## Timeline Ordering Clock Skew
- **Root cause:** Client-server clock skew sorted new user messages out-of-order, and mixing message-index comparisons with approval-timestamp comparisons created cyclic preference loops violating strict weak ordering in V8 sort, corrupting the timeline array and hiding the thinking box.
- **Fix:** Assigned stable, monotonic sequence sortIndexes to both messages and approvals to guarantee a cycle-free stable sort order.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## Attempted and Reverted Solutions for the Thinking/Working Box Missing Issue
- **Attempts:**
  1. *syncConversationHistory time parsing adjustment:* Attempted to inspect if `part.time` was an object and parse `part.time.start` to avoid a Date parsing `RangeError: Invalid time value` crash on synchronization. (Reverted in `iota-bridge/src/services/opencode.ts`).
  2. *mergeIncomingMessage Assistant ID transition:* Attempted to transition any last assistant message to the new incoming server ID during merges, irrespective of ID format. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
  3. *Consecutive Assistant Messages Merging:* Attempted to merge consecutive assistant messages' content and parts inside the first pass of `groupedTimelineItems` to prevent them from overwriting each other, hoping this would preserve early tool activity parts. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
  4. *Deduplication of Messages/Approvals:* Attempted to filter/deduplicate messages and approvals by their IDs prior to grouping to resolve duplicate FlatList key warnings generated when concurrent cache and synchronization cycles ran. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
- **Outcome:** All four changes were reverted as they did not resolve the core thinking/working box missing issue on reload, or introduced other regressions.

## Thinking/Working Box Missing on First Reload
- **Root cause:** The bridge threw `Invalid time value` when parsing a part's `time` object as a date, causing sync to fail, while a race condition in `ControlScreen.tsx` allowed a late-resolving cache load to overwrite snapshot messages.
- **Fix:** Extracted date strings from `part.time` objects in `syncConversationHistory`, and updated the cache effect to load only if the messages state is currently empty.
- **Files:** `iota-bridge/src/services/opencode.ts`, `iota-mobile/src/screens/ControlScreen.tsx`

## Thinking/Working Box and Scrambled Ordering UI/UX Fix
- **Root cause:** The local SecureStore chat caching discarded the parts list metadata during serialization (causing missing thinking boxes), and client-server clock skew combined with a destructive push-to-end ID merger scrambled message sequence.
- **Fix:** Removed local SecureStore chat caching (authoritative server database handles sync), prevented re-sorting by date, and performed assistant ID replacement in-place.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`

## Unified Timeline and Ordering Preservation Fix
- **Root cause:** `deduplicateUserMessages` sorted/partitioned user messages to the end; `mergeMessages` overwritten parts-rich snapshots with empty-parts local state; `mergeIncomingMessage` pushed user UUID updates to the end instead of in-place; and `hasDetail` restricted detail expansion for reload tool names.
- **Fix:** Filtered duplicates in-place, merged metadata/parts safely without overwriting snapshots, mapped `local-` and `user-` message IDs to UUIDs in-place, routed all `reasoning` and `tool` parts to `workingParts`, and set `hasDetail` to true.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`, `iota-mobile/src/components/control/ToolActivityCard.tsx`

## Chat UI Scrambling and Empty Accordion Details on Reload
- **Root cause:** `SecureStore` caching stripped `parts` from messages, racing with server snapshots to overwrite data. During active runs, `mergeIncomingMessage` pushed ID-transitioned messages to the array end and `deduplicateUserMessages` re-sorted by mismatched client/server timestamps.
- **Fix:** Removed local `SecureStore` chat caching completely to make the SSE snapshot authoritative, updated `mergeIncomingMessage` and `deduplicateUserMessages` to replace/deduplicate in-place without altering array index order, and fixed bridge ISO string timestamps to epoch ms.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`, `iota-bridge/src/services/opencode.ts`




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

## Copy Chip Instantly Dismissed on Touch
- **Root cause:** `DismissCapture` intercepted all timeline touches during the capture phase (`onStartShouldSetResponderCapture`) and immediately dismissed the copy chip before the touch event could propagate to the chip's child `TouchableOpacity`.
- **Fix:** Pass the copy chip's native tag through the copy chip context and check it inside `DismissCapture`'s capture handler, returning early without dismissing if the target matches the copy chip.
- **Files:** `iota-mobile/src/components/control/ChatTimeline.tsx` and `iota-mobile/src/components/control/ChatMessageBubble.tsx`

## Duplicate Completed Assistant Message ID Mismatch
- **Root cause:** The normalizer mapped the final `text` event to a message ID generated from `event.part.messageID` using `stableId`, which differed from the run's streaming `assistantMessageId`, creating duplicate messages.
- **Fix:** Map the completed assistant response directly to the matching `assistantMessageId`.
- **Files:** `iota-bridge/src/services/opencodeEvents.ts:194`

## Timeline Interleaving Timing Race
- **Root cause:** Calling `interleaveInlineBlocks` inside the chronological event sorting loop processed the assistant message before tools (since message `createdAt < tool.startedAt`), so it returned early when activities were empty.
- **Fix:** Move interleaving blocks to a second-pass loop over turns after the event-grouping loop is complete.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx:275-281`

## Vanishing Messages from Snapshot Updates and Missing thoughts
- **Root cause:** Messages loaded from history or database snapshot updates lacked `parsedBlocks` metadata, causing the UI to return null or fail to render inline blocks, and a non-global regex matched only the first thought.
- **Fix:** Add dynamic fallbacks to call `parseAssistantContent(content)` when metadata is missing, and reuse it inside `parseMessageThoughts` to support multiple thoughts.
- **Files:** `iota-mobile/src/components/control/ChatMessageBubble.tsx:58-70,195,223,230` and `iota-mobile/src/screens/ControlScreen.tsx:180`

## Stale worked duration and tick displayed while agent running
- **Root cause:** Heuristics in message delta handlers prematurely set the screen's `running` state to `false`, and `isLastTurn` was fragile to trailing system messages.
- **Fix:** Keep `running` true until the run actually finishes using `onRunStatus` phase transitions, and filter for type `turn` when determining the last turn.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx` and `iota-mobile/src/components/control/ChatTimeline.tsx`

## What OpenCode's --format json actually emits:

step_start/ step_finish → both **filtered out** at `opencodeEvents.ts:137

`text→ full assistant text (including reasoning, as plain text)

`tool_use → only when a tool *completes* (no intermediate states)
error

## Intermediate text dropping and thought formatting bug
- **Root cause:** Storing wrapped tags in `lastTextContent` caused cumulative text slicing offset mismatch, reasoning events lacked `<thought>` wrappers, and `<intermediate>` blocks were treated as regular text causing timeline skip.
- **Fix:** Reset `lastTextContent` on `step_start`, remove wrapped tag updates on `step_finish`, wrap reasoning in thought tags, and map `<intermediate>` to its own block type.
- **Files:** `iota-bridge/src/services/socket.ts`, `iota-mobile/src/utils/opencodeParser.ts`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/screens/ControlScreen.tsx`

## Nested tags and index wrapping bugs
- **Root cause:** Outer `<intermediate>` regex matched inner `<thought>` tags rendering raw tags, and wrapping index offset failed in `socket.ts` when reasoning delta injected `<thought>` tags not present in `currentStepText`.
- **Fix:** Update `parseAssistantContent` to parse recursively and map sub-blocks, and track step content offset in `socket.ts` to wrap only trailing text slice.
- **Files:** `iota-bridge/src/services/socket.ts`, `iota-mobile/src/utils/opencodeParser.ts`

## SSE Connection Close Event Mismatch on Server
- **Root cause:** Registering the client connection close listener on `req.on('close')` inside the `req.on('end')` callback triggered immediately on request stream end, prematurely removing SSE clients.
- **Fix:** Register the connection close listener on `res.on('close')` instead.
- **Files:** `iota-bridge/src/services/__tests__/opencode.test.ts`

## Strict OpenCode Approval Decision Types Cause Compiler Errors
- **Root cause:** Comparing the legacy `decision` field to newly supported approval strings like `'once'` or `'always'` caused TS2367 compile errors due to type non-overlap constraints.
- **Fix:** Expanded the `OpenCodeApprovalDecision` type definition in `types/opencode.ts` to include `'once' | 'always' | 'reject'`.
- **Files:** `iota-bridge/src/types/opencode.ts`

## SSE Boundary Parsing Mismatch Causes Hangups and Watchdog Timeout on Windows
- **Root cause:** Looking exclusively for `\n\n` boundary delimiters in the SSE chunk stream fails on Windows when standard HTTP/SSE line endings contain carriage returns (`\r\n\r\n`), causing the entire stream to buffer indefinitely.
- **Fix:** Update chunk data boundary checks to detect both `\n\n` and `\r\n\r\n` delimiters and process complete event blocks dynamically.
- **Files:** `iota-bridge/src/services/opencode.ts`

## Nested SSE Properties and Evolved Event Schema Cause Watchdog Timeout and UI Sync Issues
- **Root cause:** The updated OpenCode server nests event fields inside `event.properties` and uses new event types (`message.part.delta`, `message.part.updated`) instead of the legacy root-level properties, preventing the bridge from registering session listeners or forwarding deltas to the UI.
- **Fix:** Flatten `event.properties` at the SSE client parser level, and map `message.part.delta` and `message.part.updated` to legacy types (`step_start`, `step_finish`, `reasoning`, `text_delta`) inside `socket.ts`.
- **Files:** `iota-bridge/src/services/opencode.ts`, `iota-bridge/src/services/socket.ts`

## OpenCode Server Port Readiness Check Times Out on Windows
- **Root cause:** Initializing the OpenCode daemon and loading configurations can take more than 3 seconds on Windows or under heavy CPU load, causing the probe check to time out early.
- **Fix:** Increased the `checkPortReady` timeout parameter from `3000` to `10000` milliseconds to give the server sufficient startup time.
- **Files:** `iota-bridge/src/services/opencode.ts`

## Watchdog Timeout During Tool Execution from Unmapped SSE Event Types
- **Root cause:** Long-running tool executions and subagent runs do not stream text deltas, and their `message.part.updated` tool start/complete events were ignored/returned early, triggering the 30-second inactivity watchdog.
- **Fix:** Map `message.part.updated` events with `part.type === 'tool'` to legacy tool event types to track active tool calls, and extend the inactivity timeout to 5 minutes while tools are running.
- **Files:** `iota-bridge/src/services/socket.ts`

## Final Response Misinterpreted and Timestamps Lost on Sync
- **Root cause:** Checking `index === parsedBlocks.length - 1` misclassified the final response when there were trailing thoughts/whitespace, and history sync mapped messages to content string without preserving parsed block metadata or timestamps.
- **Fix:** Locate the last non-empty text/intermediate block as the final response index, and synthesize timestamps on the client and during sync using activity/part sequences.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-bridge/src/services/opencode.ts`
## Vanishing User and Assistant Messages due to Missing Parts
- **Root cause:** User messages, system updates, and synced history messages lack part lists, which resulted in an empty `displayContent` rendering as `null` in the new part-based `ChatMessageBubble.tsx`.
- **Fix:** Added a fallback to `message.content` when `displayContent` is empty, and synthesized a dummy text part for assistant timeline items with no parts.
- **Files:** `iota-mobile/src/components/control/ChatMessageBubble.tsx`

## Empty/Collapsed Thinking Box on Expansion
- **Root cause:** The timeline thinking box used a nested `ScrollView` which collapsed to a height of 0 within the `FlatList` container, and the client-side `parts` state was cleared/not synchronized when a conversation snapshot was loaded from cache/history.
- **Fix:** Replaced the nested `ScrollView` with a standard `View` to allow the container to auto-size dynamically, and extracted and merged parts from conversation messages during snapshot updates and message receptions.
- **Files:** `iota-mobile/src/components/control/ChatTimeline.tsx` and `iota-mobile/src/screens/ControlScreen.tsx`

## SSE `parts` Not Passed to ChatMessageBubble → Invisible Text
- **Root cause:** After migrating to `opencode serve` (SSE), the bridge relays events via `opencode:sse_event` which updates `parts[]` state, but `ChatTimeline.tsx` never passed `parts` to `ChatMessageBubble`, and `onMessageDelta` (which populated `message.content`) was never emitted in the new flow.
- **Fix:** Pass `allParts` from `ControlScreen` → `ChatTimeline` → filter by `messageID` → `ChatMessageBubble`. Also sync `message.content` from text parts via a `useEffect` for backward compat.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`

## Watchdog Timeout and Missing tool stats during tool execution
- **Root cause:** The new SSE schema uses `message.part.updated` tool events which were not mapped in the bridge's `onJson` watchdog tracker or `handleStoreEvent` database handler, leaving the watchdog timeout at 30 seconds and failing to persist tool status to disk.
- **Fix:** Added mapping for `message.part.updated` tool events to add/remove IDs in `activeTools` (extending the timeout to 5 minutes) and call `addTool`/`updateToolStatus` for persistence.
- **Files:** `iota-bridge/src/services/socket.ts`

## Unified SSE Timeline Rendering and Tool Card Formatting
- **Root cause:** Stale isTimelineItem branching and missing case for 'text' parts cut off intermediate explanations and duplicated reasoning thoughts, while unmapped modern tool names (like run_command, view_file) defaulted to generic parameter displays.
- **Fix:** Partitioned parts chronologically by locating the last tool call to separate working parts and final responses, added 'text' part support in timeline, unified ChatMessageBubble rendering, and mapped modern tool names/parameters in ToolActivityCard.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/components/control/ToolActivityCard.tsx`

## Chat UI Duplicate Messages, ID Mismatches, and Wiped Tool Parts
- **Root cause:** User messages duplicated due to mismatched temporary IDs in merger, parts disappeared during assistant ID transition to server UUID, and tool parts were not persisted in the database messages causing them to be wiped on snapshot sync.
- **Fix:** Added content-based deduplication in merger, mapped parts to the new message ID when the assistant ID updates, and saved tool parts directly into `message.parts` on the bridge.
- **Files:** `iota-bridge/src/services/opencodeStore.ts`, `iota-bridge/src/services/socket.ts`, `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`

## Chat UI Rendering Performance and Message Vanishing
- **Root cause:** Separating messages and parts states triggered double-rendering on every delta update, and a custom React.memo compared only parts length rather than content, causing rendering lags and stale stream text.
- **Fix:** Nested the parts array directly within message objects, removed parts state and its sync useEffect, and updated the memo comparator to deeply compare part contents.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ChatMessageBubble.tsx`, `iota-mobile/src/components/control/ChatTimeline.tsx`, `iota-mobile/src/types/opencode.ts`

## Inactivity Timeout During Active Run and Assistant ID Transition Disappearances
- **Root cause:** The bridge watchdog timer missed modern tool events due to nested `properties.part` payloads and lacked busy status awareness, leading to premature 30-second inactivity timeouts.
- **Fix:** Correctly parsed properties-nested parts on the bridge, and extended the watchdog timeout to 5 minutes when session status is `busy`.
- **Files:** `iota-bridge/src/services/socket.ts`

## Timeline Ordering Clock Skew
- **Root cause:** Client-server clock skew sorted new user messages out-of-order, and mixing message-index comparisons with approval-timestamp comparisons created cyclic preference loops violating strict weak ordering in V8 sort, corrupting the timeline array and hiding the thinking box.
- **Fix:** Assigned stable, monotonic sequence sortIndexes to both messages and approvals to guarantee a cycle-free stable sort order.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## Attempted and Reverted Solutions for the Thinking/Working Box Missing Issue
- **Attempts:**
  1. *syncConversationHistory time parsing adjustment:* Attempted to inspect if `part.time` was an object and parse `part.time.start` to avoid a Date parsing `RangeError: Invalid time value` crash on synchronization. (Reverted in `iota-bridge/src/services/opencode.ts`).
  2. *mergeIncomingMessage Assistant ID transition:* Attempted to transition any last assistant message to the new incoming server ID during merges, irrespective of ID format. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
  3. *Consecutive Assistant Messages Merging:* Attempted to merge consecutive assistant messages' content and parts inside the first pass of `groupedTimelineItems` to prevent them from overwriting each other, hoping this would preserve early tool activity parts. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
  4. *Deduplication of Messages/Approvals:* Attempted to filter/deduplicate messages and approvals by their IDs prior to grouping to resolve duplicate FlatList key warnings generated when concurrent cache and synchronization cycles ran. (Reverted in `iota-mobile/src/screens/ControlScreen.tsx`).
- **Outcome:** All four changes were reverted as they did not resolve the core thinking/working box missing issue on reload, or introduced other regressions.

## Thinking/Working Box Missing on First Reload
- **Root cause:** The bridge threw `Invalid time value` when parsing a part's `time` object as a date, causing sync to fail, while a race condition in `ControlScreen.tsx` allowed a late-resolving cache load to overwrite snapshot messages.
- **Fix:** Extracted date strings from `part.time` objects in `syncConversationHistory`, and updated the cache effect to load only if the messages state is currently empty.
- **Files:** `iota-bridge/src/services/opencode.ts`, `iota-mobile/src/screens/ControlScreen.tsx`

## Thinking/Working Box and Scrambled Ordering UI/UX Fix
- **Root cause:** The local SecureStore chat caching discarded the parts list metadata during serialization (causing missing thinking boxes), and client-server clock skew combined with a destructive push-to-end ID merger scrambled message sequence.
- **Fix:** Removed local SecureStore chat caching (authoritative server database handles sync), prevented re-sorting by date, and performed assistant ID replacement in-place.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`

## Unified Timeline and Ordering Preservation Fix
- **Root cause:** `deduplicateUserMessages` sorted/partitioned user messages to the end; `mergeMessages` overwritten parts-rich snapshots with empty-parts local state; `mergeIncomingMessage` pushed user UUID updates to the end instead of in-place; and `hasDetail` restricted detail expansion for reload tool names.
- **Fix:** Filtered duplicates in-place, merged metadata/parts safely without overwriting snapshots, mapped `local-` and `user-` message IDs to UUIDs in-place, routed all `reasoning` and `tool` parts to `workingParts`, and set `hasDetail` to true.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`, `iota-mobile/src/components/control/ToolActivityCard.tsx`

## Chat UI Scrambling and Empty Accordion Details on Reload
- **Root cause:** `SecureStore` caching stripped `parts` from messages, racing with server snapshots to overwrite data. During active runs, `mergeIncomingMessage` pushed ID-transitioned messages to the array end and `deduplicateUserMessages` re-sorted by mismatched client/server timestamps.
- **Fix:** Removed local `SecureStore` chat caching completely to make the SSE snapshot authoritative, updated `mergeIncomingMessage` and `deduplicateUserMessages` to replace/deduplicate in-place without altering array index order, and fixed bridge ISO string timestamps to epoch ms.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`, `iota-mobile/src/components/control/ControlScreenConstants.tsx`, `iota-bridge/src/services/opencode.ts`

Root cause: `message.updated` and `session.updated` events from SSE overwrite the local UI state with server snapshots that may lack in-flight streaming parts, causing the UI to temporarily reset.
Fix: Implemented `mergeParts` to merge server snapshot parts with local parts by ID, favoring completed parts or parts with longer text to preserve streaming progress.

## Duplicate Empty Dummy Messages on Server UUID Transition
- **Root cause:** `mergeIncomingMessage` strictly matched local active streams using the `assistant-` prefix, failing to transition the ID when the server changed UUIDs a second time, thus spawning empty dummy duplicates.
- **Fix:** Switched to a backwards traversal (`findLastIndex`) that looks for any `status === 'streaming'` or `'pending'` assistant message to safely transition the ID in-place.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## Streaming Text Chunks Missing (Dumped at End)
- **Root cause:** The updated \opencode serve\ schema emits streaming text deltas as \message.part.delta\, but \handleGlobalEvent\ in the mobile client lacked a handler for this event type, returning null and ignoring chunks.
- **Fix:** Added a handler for \message.part.delta\ in \handleGlobalEvent\ to map the delta payload to the \part_delta\ UI mutation, restoring real-time streaming updates.
- **Files:** \iota-mobile/src/services/opencodeSocket.ts\


## Chat UI Freezes During Fast Streaming
- **Root cause:** The \onSSEEvent\ socket handler in \ControlScreen.tsx\ processed every incoming chunk synchronously, triggering a state update (\setMessages\) for every delta. With 30+ chunks per second, this completely flooded the React Native JS thread, freezing the UI.
- **Fix:** Introduced a queue (\sseQueue\) and a batching mechanism via \setInterval\ in the \onSSEEvent\ handler. This buffers chunks and flushes them every 150ms. Since React 18 automatically batches state updates within event loop callbacks (like \setInterval\), this reduced state updates from 30+/sec to 6/sec, completely fixing the UI hang.
- **Files:** \iota-mobile/src/screens/ControlScreen.tsx\


## UI Thread Freeze from Markdown Parsing During Streaming
- **Root cause:** Even after batching the state updates, the \eact-native-markdown-display\ library is too synchronous and heavy to re-render large text blocks multiple times per second. This caused the JS thread to lock up completely while the AI was generating long responses.
- **Fix:** Introduced a \ThrottledMarkdown\ wrapper component around the Markdown elements that enforces a 500ms debounce interval ONLY when \isStreaming\ is true. This drops the heavy AST parsing frequency down to 2 FPS, keeping the UI fully interactive and scrollable without sacrificing formatting.
- **Files:** \iota-mobile/src/components/control/ChatMessageBubble.tsx\


## UI Thread Freeze from Array Coping and Object Reallocation
- **Root cause:** The SSE batch processor was executing \setMessages\ inside a loop, causing O(N*M) array reallocations for a single batch. Also, the \groupedTimelineItems\ hook was generating completely new \GroupedItem\ object instances on every run, which broke the \FlatList\ PureComponent shallow equality check and forced all historical messages to re-render constantly.
- **Fix:** Refactored the batch processor to compute the final \
extMsgs\ array and execute \setMessages\ only once per batch. Refactored \groupedTimelineItems\ to use a \turnCacheRef\ Map to cache \GroupedItem\ instances using a revision hash, guaranteeing identical object references for unmodified messages to skip re-renders.
- **Files:** \iota-mobile/src/screens/ControlScreen.tsx\


## UI Freeze from Redundant Auto-scrolling and Lack of Backpressure
- **Root cause:** The chat screen had two competing scroll-to-bottom listeners: a \useEffect\ tracking timeline length and a \handleContentSizeChange\ layout listener. Calling \scrollToEnd({ animated: true })\ 6 times a second on every chunk triggered multiple React Native scroll animations that fought each other and saturated the JS thread. Additionally, the SSE queue processing used a fixed \setInterval(150ms)\ without backpressure, which piled up React render cycles if a render took longer than 150ms.
- **Fix:** Removed the redundant \useEffect\. In \handleContentSizeChange\, \animated\ is set conditionally to \!running\ so the list instantly tracks the bottom during active streaming without heavy animations. Replaced the \setInterval\ queue processor with a recursive \setTimeout\ that yields to the React asynchronous flush queue, providing native backpressure.
- **Files:** \iota-mobile/src/screens/ControlScreen.tsx\


## Empty Thinking Box and Missing Completed Assistant Messages
- **Root cause:** The bridge updated memory state msgId but failed to update the ID properties on database conversation messages in-place, causing subsequent delta writes to be discarded. Additionally, the client-side sessionId state was undefined, causing it to filter out active streams.
- **Fix:** Synchronized database message IDs with the server UUID in sseListener when step started/message updated occurred, and auto-synced the primary sessionId on the client during event processing.
- **Files:** iota-bridge/src/services/socket.ts, iota-mobile/src/screens/ControlScreen.tsx

## Subagent Message Overwrites Main Agent Session ID
- **Root cause:** Concurrent assistant messages (like a subagent streaming while a main agent is running) caused their temporary IDs to collide when resolving ID fallbacks in the frontend and backend, resulting in subagent text polluting the main agent's timeline and an empty subagent thinking box.
- **Fix:** Update fallback message ID lookup loops in both \ControlScreen.tsx\ (frontend) and \socket.ts\ (backend) to explicitly require \m.sessionId === eventSessionId\ / \incoming.sessionId\.
## Assistant Message Lost After Completion
- **Root cause:** Providers streaming via SSE only emitted \message.part.delta\ without a preceding \started\ event. The backend's \opencodeStore.appendPartDelta\ ignored deltas for non-existent parts, causing it to lose the entire text. Upon run completion, the backend emitted a snapshot that overwrote the frontend's valid streaming state with an empty parts list, wiping out the final message.
- **Fix:** Updated \appendPartDelta\ to lazily create the \OpenCodePart\ if it does not exist, using the \partType\ parsed from the SSE delta event payload.

Root cause: OpenCode backend emitted message.part.updated without full text for completion, causing socket setPartText to overwrite in-memory text with empty string. Also, reasoning blocks were not included in workingParts, causing thinking box to disappear. Fix: Conditionally setPartText only if part.text is string in socket handler, and include reasoning blocks in workingParts partitioning.

## Subtask View Empty — Bridge Parent Metadata Injected at Top Level, Mobile Reads from properties

- **Root cause:** Bridge `socket.ts:714-718` injects `parentSessionID`/`parentCallID` at the top level of `rawEvent`, but `handleGlobalEvent` in `opencodeSocket.ts:179-180` reads them from `payload.properties`. Child-session events fell through to `handleGlobalEventInner` as normal events, never populating the subtask session store.
## Streaming Text Chunks Missing (Dumped at End)
- **Root cause:** The updated `opencode serve` schema emits streaming text deltas as `message.part.delta`, but `handleGlobalEvent` in the mobile client lacked a handler for this event type, returning null and ignoring chunks.
- **Fix:** Added a handler for `message.part.delta` in `handleGlobalEvent` to map the delta payload to the `part_delta` UI mutation, restoring real-time streaming updates.
- **Files:** `iota-mobile/src/services/opencodeSocket.ts`

## Chat UI Freezes During Fast Streaming
- **Root cause:** The `onSSEEvent` socket handler in `ControlScreen.tsx` processed every incoming chunk synchronously, triggering a state update (`setMessages`) for every delta. With 30+ chunks per second, this completely flooded the React Native JS thread, freezing the UI.
- **Fix:** Introduced a queue (`sseQueue`) and a batching mechanism via `setTimeout` in the `onSSEEvent` handler. This buffers chunks and flushes them every 150ms, reducing state updates from 30+/sec to 6/sec, completely fixing the UI hang.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## UI Thread Freeze from Markdown Parsing During Streaming
- **Root cause:** Even after batching the state updates, the `react-native-markdown-display` library is too synchronous and heavy to re-render large text blocks multiple times per second. This caused the JS thread to lock up completely while the AI was generating long responses.
- **Fix:** Introduced a `ThrottledMarkdown` wrapper component around the Markdown elements that enforces a 500ms debounce interval ONLY when `isStreaming` is true. This drops the heavy AST parsing frequency down to 2 FPS, keeping the UI fully interactive and scrollable without sacrificing formatting.
- **Files:** `iota-mobile/src/components/control/ChatMessageBubble.tsx`

## UI Thread Freeze from Array Copying and Object Reallocation
- **Root cause:** The SSE batch processor was executing `setMessages` inside a loop, causing O(N*M) array reallocations for a single batch. Also, the `groupedTimelineItems` hook was generating completely new `GroupedItem` object instances on every run, which broke the `FlatList` PureComponent shallow equality check and forced all historical messages to re-render constantly.
- **Fix:** Refactored the batch processor to compute the final `nextMsgs` array and execute `setMessages` only once per batch. Refactored `groupedTimelineItems` to use a `turnCacheRef` Map to cache `GroupedItem` instances using a revision hash, guaranteeing identical object references for unmodified messages to skip re-renders.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## UI Freeze from Redundant Auto-scrolling and Lack of Backpressure
- **Root cause:** The chat screen had two competing scroll-to-bottom listeners: a `useEffect` tracking timeline length and a `handleContentSizeChange` layout listener. Calling `scrollToEnd({ animated: true })` 6 times a second on every chunk triggered multiple React Native scroll animations that fought each other and saturated the JS thread. Additionally, the SSE queue processing used a fixed `setTimeout(150ms)` without backpressure, which piled up React render cycles if a render took longer than 150ms.
- **Fix:** Removed the redundant `useEffect`. In `handleContentSizeChange`, `animated` is set conditionally to `!running` so the list instantly tracks the bottom during active streaming without heavy animations. Replaced the `setTimeout` queue processor with a recursive `setTimeout` that yields to the React asynchronous flush queue, providing native backpressure.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx`

## Empty Thinking Box and Missing Completed Assistant Messages
- **Root cause:** The bridge updated memory state msgId but failed to update the ID properties on database conversation messages in-place, causing subsequent delta writes to be discarded. Additionally, the client-side sessionId state was undefined, causing it to filter out active streams.
- **Fix:** Synchronized database message IDs with the server UUID in sseListener when step started/message updated occurred, and auto-synced the primary sessionId on the client during event processing.
- **Files:** iota-bridge/src/services/socket.ts, iota-mobile/src/screens/ControlScreen.tsx

## Subagent Message Overwrites Main Agent Session ID
- **Root cause:** Concurrent assistant messages (like a subagent streaming while a main agent is running) caused their temporary IDs to collide when resolving ID fallbacks in the frontend and backend, resulting in subagent text polluting the main agent's timeline and an empty subagent thinking box.
- **Fix:** Update fallback message ID lookup loops in both `ControlScreen.tsx` (frontend) and `socket.ts` (backend) to explicitly require `m.sessionId === eventSessionId` / `incoming.sessionId`.

## Assistant Message Lost After Completion
- **Root cause:** Providers streaming via SSE only emitted `message.part.delta` without a preceding `started` event. The backend's `opencodeStore.appendPartDelta` ignored deltas for non-existent parts, causing it to lose the entire text. Upon run completion, the backend emitted a snapshot that overwrote the frontend's valid streaming state with an empty parts list, wiping out the final message.
- **Fix:** Updated `appendPartDelta` to lazily create the `OpenCodePart` if it does not exist, using the `partType` parsed from the SSE delta event payload.

## Subtask "View details" Button Do Nothing / Subtask View Empty
- **Root cause:** V2 payload puts `toolName` and `id` under `properties.part`, but mobile expected `properties.tool` and `properties.callID`. This caused mobile to skip subtask initialization (so the button did nothing). Furthermore, `opencodeStore` merged child session events into the parent without saving `sessionID`, breaking historical hydration.
- **Fix:** Added V2 field normalization (`part.toolName` -> `props.tool`, `part.id` -> `props.callID`) in the bridge `socket.ts`. Added `sessionID` tagging in `opencodeStore.startPart` to separate child session messages. Updated mobile's `onSnapshot` to group child parts by `sessionID` and construct synthetic child messages for historical subtasks.
- **Files:** `iota-bridge/src/services/socket.ts`, `iota-bridge/src/services/opencodeStore.ts`, `iota-mobile/src/screens/ControlScreen.tsx`

### Subtask View Data Mapping (V2 Event Schema Issue)
- **Root cause:** The bridge and mobile app failed to recognize subtask tool calls in flight because the SDK upgraded its payload format, emitting `message.part.updated` instead of `session.next.tool.called`, and buggy UI array comparisons caused completed subtasks to reset to 'running' visually.
- **Fix:** Upgraded bridge tracking and client parsing to explicitly extract payloads from V2 `message.part.updated` tool events, and refactored the UI state assignment in `ControlScreen.tsx` to preserve terminal status values.

### Subtask Rendering & Lazy Message Initialization
- **Root cause:** Subtask details displayed empty content during execution because no assistant message was pre-allocated to hold streaming text/reasoning parts, and `updateMessageParts` discarded events where the target ID was missing.
- **Fix:** Modified `updateMessageParts` to lazily create assistant messages on the fly when missing, and delegated text/reasoning rendering inside `SubtaskView.tsx` to the main `ChatMessageBubble` to enable rich Markdown and thought accordions.

### Subtask Prompts, Completions, and Timeline Rendering Cache
- **Root cause:** Subtask prompt inputs and completion statuses failed to update because the frontend did not replicate parent task tool updates (which occur in `part_updated` and `tool_updated` on the main channel) to `subtaskSessions`. Also, the timeline cached turns using only `finalParts` (ignoring tool statuses).
- **Fix:** Synchronized subtask sessions during main-channel `part_updated` and `tool_updated` actions when the tool is `task`, mapped running status in snapshot, and updated the `partsRev` cache key to hash all `assistantParts`.

## SubtaskView Accordion, History Sync, and Streaming Hydration Failures
- **Root cause:** Bridge history sync discarded child session messages; mobile snapshot parser checked only `part.tool === 'task'` and ignored `subtask` type parts; and live streaming child events lacked `messageId` causing them to be discarded.
- **Fix:** Updated bridge sync to recursively fetch child session messages and inject top-level sessionID/messageID; modified mobile snapshot parser to support both tool/toolName and parse subtask parts; and added a fallback `synthetic-${mutation.callID}` messageId for streaming child events.
- **Files:** `iota-bridge/src/services/opencode.ts`, `iota-mobile/src/screens/ControlScreen.tsx`

## SubtaskView Empty Working Accordion and Missing Final Assistant Message (MsgId Mismatch)
- **Root cause:** `updateMessageParts` fallback in `ControlScreen.tsx:117` checks `!messageId.startsWith('assistant-')` — child session SSE events carry `inner.messageId` (parent `assistant-*` UUID), causing the fallback to be skipped, so parts create orphan messages instead of populating the synthetic message. Snapshot reconstruction (`ControlScreen.tsx:720-726`) also silently drops child parts missing `sessionID` metadata.
- **Fix:** Bypass `inner.messageId` in `subtask_event` handler (`ControlScreen.tsx:1154`) and always use `\`synthetic-${mutation.callID}\`` as the target messageId. Ensure `sessionID` is consistently tagged on ALL child part types (text, reasoning, tool) at creation time in both `handleStoreEvent` and `opencodeStore.addToolPart`.
- **Files:** `iota-mobile/src/screens/ControlScreen.tsx:1154,117-118`, `iota-mobile/src/screens/ControlScreen.tsx:720-726`

### Subtask Streaming and Rendering Issues
Root Cause: Subtask views skipped rendering streaming text because updateMessageParts fell back incorrectly for synthetic IDs, snapshot grouping dropped parts lacking sessionID, message_updated improperly renamed synthetic IDs, and subtask idle statuses mistakenly stopped the main session.
Fix: Fixed ControlScreen.tsx to handle synthetic IDs cleanly, group snapshot parts by callID fallbacks, ignore UUID renames for subtask messages, and isolate main session run state from subtask idle events.

