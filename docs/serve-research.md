The comprehensive research document has been compiled covering all 8 areas. Here is the full result (in-memory — I couldn't write to disk due to plan-mode permissions, but all content is below):

---

## 1. Server Architecture

**What `opencode serve` does:** Runs a headless HTTP server exposing an OpenAPI 3.1 REST API. Same server that runs inside `opencode` TUI — the TUI is itself a client of this server. Differs from `opencode web` only in that `web` also serves a bundled SPA.

**Transport:**
- **HTTP** (REST) — all CRUD endpoints
- **SSE** — `GET /event` (instance) and `GET /global/event` (global), streams all bus events
- **WebSocket** — separate `PtyConnectApi` for remote terminal

**Auth:** HTTP Basic Auth. `OPENCODE_SERVER_PASSWORD` env var. Username defaults to `opencode` (override with `OPENCODE_SERVER_USERNAME`). Also supports `?auth_token=<base64>` query param for SSE. Source: `packages/opencode/src/server/auth.ts:9-15` and `authorization.ts:28`.

**CORS:** Default allows `http://localhost:*`, `http://127.0.0.1:*`, `oc://renderer`, `tauri://localhost`, `*.opencode.ai`. Custom origins via `--cors` flag. Source: `packages/server/src/cors.ts:11-16`.

**Persistence:** Sessions stored in SQLite via Drizzle ORM — survive server restarts.

---

## 2. Key REST Endpoints

| Endpoint | Method | Body | Returns |
|----------|--------|------|---------|
| `/session` | POST | `{ title?, parentID? }` | `Session` |
| `/session/:id/message` | POST | `{ parts: [{ type:"text", text }], agent?, model?, ... }` | `{ info: Message, parts: Part[] }` (blocking) |
| `/session/:id/prompt_async` | POST | Same body as message | `204 No Content` (async via SSE) |
| `/session/:id/message` | GET | `?limit=&before=` | `{ info, parts }[]` |
| `/session/:id/abort` | POST | none | `boolean` |
| `/session/:id/command` | POST | `{ command, arguments?, agent?, model? }` | `{ info, parts }` |
| `/session/:id/fork` | POST | `{ messageID? }` | `Session` |
| `/session/:id/permissions/:permissionID` | POST | `{ response: "once"\|"always"\|"reject", remember?: boolean }` | `boolean` (**deprecated**) |
| `/permission/:requestID/reply` | POST | `{ reply: "once"\|"always"\|"reject", message? }` | `boolean` |
| `/question/:requestID/reply` | POST | `{ answers: string[][] }` | `boolean` |
| `/question/:requestID/reject` | POST | none | `boolean` |
| `/session/:id/todo` | GET | — | `Todo[]` |
| `/session` | GET | `?scope=project&search=&limit=` | `Session[]` |
| `/global/health` | GET | — | `{ healthy: true, version: string }` |
| `/agent` | GET | — | `Agent[]` |
| `/config` | GET | — | `Config` |
| `/doc` | GET | `Accept: application/json` | OpenAPI spec JSON |
| `/event` | GET | `text/event-stream` | SSE stream |
| `/global/event` | GET | `text/event-stream` | SSE stream (wrapped in `GlobalEvent`) |

All body schemas sourced from `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` and `packages/opencode/src/session/prompt.ts:1493-1520`.

> [!NOTE]
> `/permission/:requestID/reply` and `/question/:requestID/reply` (along with `/question/:requestID/reject`) exist in the source code (in `permission.ts` and `question.ts`) as experimental HttpApi routes, but the public official docs table does not reference them. The official docs only list `POST /session/:id/permissions/:permissionID`. However, `POST /session/:id/permissions/:permissionID` is marked `deprecated: true` in the source code (`session.ts` line 162). So both exist, with the experimental ones being newer.

---

## 3. SSE Event Stream

**Wire format:** Standard `text/event-stream`. All events use `event: message` (this is from the source code `Sse.encode()` in `packages/effect/src/unstable/encoding/Sse.ts`; the official docs don't detail the SSE wire format). There are no named event types; the type discriminator is always inside JSON `data.type`. Heartbeat is `: heartbeat\n\n` every 15 seconds (not documented on the official page, source-backed only in `packages/server/src/handlers/event.ts`). First event is always `server.connected`. Source: `packages/server/src/handlers/event.ts`.

**Key event types with exact JSON shapes (from `packages/sdk/js/src/v2/gen/types.gen.ts`):**

| Event | Properties |
|-------|-----------|
| `session.next.text.delta` | `{ timestamp, sessionID, assistantMessageID, textID, delta }` |
| `session.next.reasoning.delta` | `{ timestamp, sessionID, assistantMessageID, reasoningID, delta }` |
| `session.next.tool.called` | `{ timestamp, sessionID, assistantMessageID, callID, tool, input, provider }` |
| `session.next.tool.success` | `{ timestamp, sessionID, assistantMessageID, callID, structured, content, outputPaths?, result?, provider }` |
| `session.next.tool.failed` | `{ timestamp, sessionID, assistantMessageID, callID, error, result?, provider }` |
| `session.next.step.started` | `{ timestamp, sessionID, assistantMessageID, agent, model, snapshot? }` |
| `session.next.step.ended` | `{ timestamp, sessionID, assistantMessageID, finish, cost, tokens, snapshot?, files? }` |
| `session.next.compaction.started/delta/ended` | Various compaction states with reason, text |
| `session.status` | `{ sessionID, status: { type: "idle"\|"busy"\|"retry", ... } }` |
| `session.error` | `{ sessionID?, error: { name: ProviderAuthError\|..., data: { message } } }` |
| `message.updated` | `{ sessionID, info: Message }` |
| `message.part.updated` | `{ sessionID, part: Part, time }` |
| `permission.asked` | `{ id, sessionID, permission, patterns, metadata, always, tool? }` |
| `permission.v2.asked` | `{ id, sessionID, action, resources, save?, metadata?, source? }` |
| `question.asked` | `{ id, sessionID, questions: [{ question, header, options, multiple?, custom? }], tool? }` |
| `todo.updated` | `{ sessionID, todos: [{ content, status, priority }] }` |
| `session.diff` | `{ sessionID, diff: [{ file, patch, additions, deletions, status }] }` |

**Global events** are wrapped: `{ directory, project?, workspace?, payload: BusEvent }`.

**Completion signal:** `session.status → { type: "idle" }`. All events use the same SSE connection — the connection stays open for the entire app lifecycle.

---

## 4. Permissions & Questions Flow

**Permission flow:**
1. Server sends `permission.asked` (or `permission.v2.asked`) via SSE
2. Client shows dialog → user picks `"once"` | `"always"` | `"reject"`
3. Client posts `POST /permission/:requestID/reply` with `{ reply }`

**Question flow:**
1. Server sends `question.asked` via SSE with `questions` array (each has `question`, `header`, `options: [{ label, description }]`, `multiple?`, `custom?`)
2. Client shows dialog → user selects options or types custom
3. Client posts `POST /question/:requestID/reply` with `{ answers: [["label1"], ["label2a","label2b"]] }`
4. Or `POST /question/:requestID/reject` to dismiss

**Session-level auto-approve:** Sessions have a `permission` field (`PermissionRuleset[]`) with `action: "allow" | "deny" | "ask"`. If set to `"allow"` or `"deny"`, the server won't ask.

Source: `packages/schema/src/v1/question.ts`, `packages/schema/src/v1/permission.ts`, and the respective route groups.

---

## 5. React Native / Expo Go Specifics

**SSE in Expo Go:** Three viable options:
1. **`react-native-sse`** (209K weekly, mature, XHR fallback in Expo Go) — used by existing `react-native-opencode-client`
2. **`@falcondev-oss/expo-event-source-polyfill`** (pure JS, uses `expo/fetch`, requires Expo 52+)
3. **`@dawidzada/expo-sse`** (uses `expo/fetch`, auto-reconnect with backoff, requires Expo 54+)

**Basic Auth for SSE:** Use `?auth_token=<base64>` query param when custom headers are problematic with EventSource.

**Polyfills:** `react-native-url-polyfill/auto`, `base-64`, `react-native-sse`. TextEncoder/AbortController already in modern RN.

**Reconnection:** Use heartbeat (15s interval as SSE comment) to detect stale connections. Exponential backoff: `min(1000 * 2^attempt, 30000)`.

**Discovery:** mDNS via `--mdns` flag (disabled by default, publishes `_opencode._tcp`), QR code, or manual URL entry.

**CORS:** Server defaults to `127.0.0.1` only. A literal `*` wildcard (e.g. `--cors "*"`) does NOT work because the CORS middleware checks `opts.cors.includes(input)` against the actual browser origin URL. You must pass each explicit origin URL, e.g., `--hostname 0.0.0.0 --cors http://<device-ip>:8081`.

---

## 6. Complete Implementation Sequence

```
1. Health check GET /global/health
2. Connect SSE via GET /event?auth_token=<base64>
3. Wait for server.connected event
4. POST /session → get sessionId
5. POST /session/:id/prompt_async with { parts: [{ type:"text", text }] }
6. Handle SSE events:
   - session.next.text.delta → append to text buffer
   - session.next.reasoning.delta → show thinking
   - session.next.tool.called/success/failed → show tool status
   - permission.asked → show dialog → POST /permission/:id/reply
   - question.asked → show dialog → POST /question/:id/reply
   - session.status({type:"idle"}) → response complete
7. Fork: POST /session/:id/fork with { messageID }
8. Follow-up: Same as step 5 but reuse sessionId
9. Abort: POST /session/:id/abort
10. History: GET /session/:id/message?limit=50
11. List: GET /session
```

---

## 7. Red Flags & Pitfalls

- **`POST /session/:id/permissions/:permissionID` is deprecated** — use `POST /permission/:requestID/reply` instead. Note that the experimental reply endpoints `/permission/:requestID/reply` and `/question/:requestID/reply` exist in the source code but are not listed in the public official docs table, while the deprecated endpoint is the only one listed publicly.
- **No file upload endpoint** — use `data:` URLs for mobile attachments
- **Session abort = SSE connection dies** — client must reconnect and verify session state
- **All SSE events use `event: message`** — you must parse `event.data.type`, not named event listeners. (Note: there are no named event types, and the type discriminator is `data.type`.)
- **No `retry:` field in SSE** — client MUST implement its own reconnection
- **Heartbeat is an SSE comment** (`: heartbeat\n\n`) at 15 seconds — not documented in the official page, source-backed only (`packages/server/src/handlers/event.ts`). Standard parsers handle this, but verify your library does.
- **No `Last-Event-ID` support** — reconnection may replay events; deduplicate by event ID
- **CORS blocks mobile testing** — must use `--cors` for explicit device IPs (literal `*` wildcards do not match since CORS middleware checks exact origin matches).
- **Memory with many SSE connections** — server uses bounded subscriber buffers; still potential issue with many slow clients