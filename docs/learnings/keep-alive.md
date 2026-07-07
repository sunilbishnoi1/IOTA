# Keep-Alive & Preview Port

## Virtual Workspace Included in Keep-Alive Loop
- **Root cause:** `local-workspace` matched `status === 'active'` filter; mobile `localhost` resolves to device itself, causing `Network request failed`.
- **Fix:** Add `cs.id !== 'local-workspace'` exclusion guard in keep-alive filters.

## Generic REST Error Obscures API Failure Details
- **Root cause:** Throwing `"GitHub API failed: " + status` without response body hides quota/permission errors.
- **Fix:** Parse response body (JSON then text fallback) before throwing — include body message in error string.

## Dynamic Port Shift Breaks Client Event Listeners
- **Root cause:** Server port shifted from P1 to P2; client filtered events by port, ignored P2 updates, stuck in "starting" state.
- **Fix:** Track `originalPort` in process state and emit in status updates; update client's `selectedServer` port on match.

## Synchronous File I/O Blocks Event Loop Drops Socket
- **Root cause:** `opencodeStore.saveConversation()` uses `fs.writeFileSync` on every streaming delta, blocking the Node.js event loop and exceeding socket.io's 20s `pingTimeout` default.
- **Fix:** Debounce saves (30ms) for hot-path streaming methods (`appendPartDelta`, `startPart`, `endPart`, tool updates); raise server `pingTimeout` to 120s; add client `timeout: 30000`; fix watchdog bug where both branches were 50min instead of 5min/30s.

## Accumulated Delta Payload Exceeds HTTP Polling Buffer
- **Root cause:** `relayEvent` sends the **entire** raw event including `properties.part.text` (full accumulated text) on every `message.part.delta` during long reasoning streams. This grows with each delta. If the client is on HTTP long-polling transport (not yet upgraded to WebSocket, or fallback), the polling buffer exceeds socket.io's default `maxHttpBufferSize` (1MB), causing the server to silently close the connection.
- **Fix:** Trim `properties.part.text` from relayed `message.part.delta` payloads (mobile only needs `delta` + `part.id`/`part.type`, not the accumulated text); increase server `maxHttpBufferSize` to 10MB; reorder client transports to `['websocket', 'polling']` so WebSocket is tried first; log disconnect reason on server for future diagnostics.
