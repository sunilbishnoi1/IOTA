# Research: Control Chat OpenCode

## Decision: Use OpenCode structured JSON execution for the Control Screen

**Rationale**: The feature requires removing the terminal window entirely. The repository documentation states that OpenCode can run in a non-interactive JSON mode and emit structured events for text deltas, tool calls, file modifications, and authorization requests. This lets the bridge translate OpenCode output into mobile-native chat events rather than sending ANSI terminal output to the app.

**Alternatives considered**:

- Keep the existing PTY terminal and restyle it. Rejected because the specification explicitly removes the terminal window and terminal-only behavior.
- Render terminal logs in chat bubbles. Rejected because raw shell output does not provide reliable diff, status, or approval UI semantics.
- Launch a new OpenCode process per prompt with no session continuity. Rejected because reconnect and continuation are core requirements.

## Decision: Normalize all OpenCode output into an IOTA chat event contract

**Rationale**: The mobile UI should not depend directly on every OpenCode output shape. The bridge can parse known JSON events, map them to stable event types, and emit fallback status/error events for unknown payloads. This keeps the mobile screen simple and protects it from malformed or unexpected output.

**Alternatives considered**:

- Forward raw OpenCode JSON directly to mobile. Rejected because it couples the app UI to agent internals and makes graceful fallback harder.
- Parse everything on mobile. Rejected because bridge-side parsing can maintain session state, handle reconnect snapshots, and avoid shipping terminal/process details to the UI layer.

## Decision: Keep OpenCode as the only visible agent in this feature

**Rationale**: The user requested focus on integrating OpenCode properly and removing unnecessary or wrong terminal-oriented changes. Hiding other agents avoids UX ambiguity and keeps implementation scoped to one reliable agent contract.

**Alternatives considered**:

- Preserve the previous agent selector with disabled options. Rejected for the initial feature because it adds visual clutter and suggests unsupported flows.
- Build a generic multi-agent abstraction now. Rejected because it would slow the OpenCode-focused repair and increase test surface.

## Decision: Treat installation as a chat-native setup flow

**Rationale**: The constitution requires dynamic VM provisioning and the spec requires no terminal exposure. Installation status, progress, success, failure, and retry should appear as setup/system timeline items and capability state, not as raw install logs in a terminal pane.

**Alternatives considered**:

- Display installation logs in the existing terminal console. Rejected because it violates the terminal removal requirement.
- Hide all installation details behind a spinner. Rejected because users need meaningful progress and actionable failures.

## Decision: Preserve session continuity with session IDs and timeline snapshots

**Rationale**: Mobile networks are unstable. The bridge should keep the active conversation identity, known timeline events, and running state in memory, and use OpenCode's session continuation support where available. On reconnect, the mobile app can request or receive a snapshot before continuing.

**Alternatives considered**:

- Mobile-only state. Rejected because the app can be backgrounded or killed while work continues in the Codespace.
- Durable bridge database. Rejected for this feature because no new persistent storage is required and credentials must remain transient.

## Decision: Remove terminal-specific mobile assets from the Control Screen path

**Rationale**: `TerminalConsole`, `xtermAssets`, and terminal input semantics are no longer appropriate for the target experience. Any retained terminal implementation should be unreachable from the Control Screen unless a later feature restores it intentionally.

**Alternatives considered**:

- Keep terminal assets as a hidden fallback. Rejected for this feature because it increases the chance of old behavior leaking back into the primary UI.
## Decision: Prefer a warm OpenCode server when available, with direct JSON run as fallback

**Rationale**: The OpenCode integration document calls out `opencode serve --port 4096` plus `opencode run --attach http://localhost:4096` to avoid cold boot overhead. The implementation should attempt to maintain this warm local OpenCode service inside the Codespace bridge boundary for chat runs, while retaining `opencode run --format json` as a simpler fallback when serve/attach is unavailable.

**Alternatives considered**:

- Always use cold `opencode run --format json`. Accepted only as fallback because it is simpler but can make every prompt pay startup cost.
- Expose the OpenCode server directly to mobile. Rejected because IOTA must keep the mobile-to-bridge architecture and avoid adding a second client-facing service.

## Decision: Use OpenCode session listing for reconnect catch-up when local snapshots are insufficient

**Rationale**: The OpenCode integration document explicitly recommends `opencode session list` or server state logs to catch up after mobile reconnect. The bridge should first return its in-memory timeline snapshot, then use OpenCode session discovery as a recovery path for known sessions or recent active sessions.

**Alternatives considered**:

- Only keep in-memory bridge snapshots. Rejected because bridge restarts or missed mobile events could lose recoverable context even if OpenCode still knows the session.

## Decision: Treat `opencode` binary presence as insufficient readiness

**Rationale**: The reported issue shows `/api/status` eventually returning `available` while submitted messages still remain stuck at `Thinking...`. The right readiness gate must include binary detection, PATH consistency, workspace/project initialization, transient provider credentials, process spawn success, and first output within a watchdog window. The official OpenCode CLI supports non-interactive runs with `opencode run`, JSON output via `--format json`, served mode via `opencode serve`, attach mode via `--attach`, and session recovery via `opencode session list --format json`; IOTA must verify these phases instead of assuming `which opencode` is enough.

**Alternatives considered**:

- Keep `/api/status` as the only readiness gate. Rejected because it cannot see socket-injected provider credentials and cannot prove prompt execution works.
- Let the UI wait indefinitely for OpenCode output. Rejected because it creates the observed stuck `Thinking...` failure.

## Decision: Add first-output watchdog and visible lifecycle status

**Rationale**: A spawned OpenCode process can hang before producing JSON due to provider auth, project setup, server attach failure, or CLI startup. The bridge must emit a start/status event immediately after accepting a prompt and then either stream first activity or emit a retryable timeout error. This guarantees the mobile UI always transitions out of placeholder-only state.

**Alternatives considered**:

- Wait until process close before surfacing errors. Rejected because startup/auth hangs may not close promptly.
- Show raw stderr in the chat. Rejected because the Control Screen contract requires normalized terminal-free events.

## Decision: Gate warm server attach and fall back to direct run

**Rationale**: The current implementation can use attach mode whenever `serveProcess` is non-null, even if the port is stale or readiness failed. Attach should be used only after a successful port probe. If `opencode serve` cannot be proven ready, the bridge should use direct `opencode run <prompt> --format json` for that prompt.

**Alternatives considered**:

- Always use `opencode serve`. Rejected because server startup is an optimization, not a prerequisite for a working chat.
- Never use `opencode serve`. Rejected because warm server mode remains useful once reliable.

## Decision: Preserve timeline state independently of screen mount lifetime

**Rationale**: The Control Screen currently keeps messages in component state, so navigating away can hide pending placeholders unless bridge snapshot recovery is perfect. A stable conversation ID per Codespace/repository plus snapshot merge on remount/reconnect prevents history loss and preserves stopped/error attempts.

**Alternatives considered**:

- Reset chat on every Control Screen mount. Rejected because conversation continuity is a P2 requirement and contradicts the observed history-loss bug.
- Persist all chat data permanently on the bridge. Rejected for now because the feature scope allows in-memory bridge state and mobile-side lightweight identity persistence without storing secrets.

## Decision: Bypass OpenCode interactive auth via environment variable injection

**Rationale**: After fresh install, OpenCode has no configured providers and `opencode run` will fail with a "no providers configured" error. OpenCode supports three authentication paths: (1) interactive `opencode auth login` or `/connect` in the TUI, which writes credentials to `~/.local/share/opencode/auth.json`; (2) environment variables like `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc., which OpenCode auto-detects at startup; (3) explicit `opencode.json` config with `{env:VAR_NAME}` references. IOTA's bridge already injects mobile-held API keys into the `opencode run` child process as environment variables via `opencodeStore.getCredentials(socketId)` → `process.env` merge in `opencode.ts`. This means **no interactive auth setup is needed** and `auth.json` is never required as long as mobile credentials are present.

**Key findings**:

- `AGENTS.md` / `/init` is entirely optional — OpenCode works without it. The readiness check must NOT gate on its presence.
- `opencode run ... --format json` does NOT trigger any interactive setup prompt — it either works (if env vars are present) or fails with a provider error on stderr.
- The bridge must check that at least one supported provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`) is present in the socket's transient credentials before reporting `available`.
- If credentials are missing, the bridge should report `credentials_missing` and the mobile UI should prompt the user to configure API keys in the Settings/Login screen — not render an OpenCode-specific auth flow.

**Alternatives considered**:

- Run `opencode auth login` programmatically from the bridge. Rejected because it is interactive (TUI-based) and would require terminal rendering that the feature explicitly removes.
- Pre-populate `auth.json` on the Codespace from mobile credentials. Rejected because it would persist secrets on the VM, violating the constitution's transient secret management principle.
- Show a special "OpenCode provider setup" screen in the mobile chat UI. Rejected because environment variable injection already handles this transparently; the mobile app's existing API key management screen is sufficient.

## External References Checked

- OpenCode documentation home: https://opencode.ai/docs/
- OpenCode CLI documentation: https://opencode.ai/docs/cli/
- OpenCode server documentation: https://opencode.ai/docs/server/
- OpenCode sessions documentation: https://opencode.ai/docs/session/
- OpenCode providers documentation: https://opencode.ai/docs/providers/
- OpenCode auth credential storage: `~/.local/share/opencode/auth.json` (plain text, auto-created by `opencode auth login`)
- Supported environment variables for auto-detection: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`
