# Implementation Plan: Control Chat OpenCode

**Branch**: `004-control-chat-opencode` | **Date**: 2026-06-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-control-chat-opencode/spec.md`

## Summary

Replace the terminal-centric Control Screen with an OpenCode-only chat control surface. The bridge will treat OpenCode as a structured agent process, stream normalized chat events to the mobile app, support setup and retry states, preserve resumable session identity, and keep credential injection transient. The mobile app will render a premium chat timeline with user messages, assistant streaming text, tool status rows, diff cards, and approval controls instead of a terminal emulator or raw log console.

The current failure mode to fix is: `/api/status` can report `available` after the binary appears in PATH, but a submitted prompt can still leave the UI on a permanent empty assistant placeholder (`Thinking...`). Planning and implementation must therefore verify the full runtime chain, not just binary presence: install, initialize/project readiness, provider credential visibility, optional server readiness, prompt spawn, first JSON/text event, completion/error, stop cleanup, and reconnect snapshot restoration.

## Technical Context

**Language/Version**: TypeScript 5.4.x for `iota-bridge`; TypeScript 5.3.x, React 18.2, React Native 0.74.5, Expo 51 for `iota-mobile`

**Primary Dependencies**: Node.js 20 bridge runtime, Express 4, Socket.IO 4.7, node-pty for isolated process spawning, socket.io-client, Expo SecureStore, Expo vector icons

**Storage**: No new persistent bridge storage; mobile keeps secrets in SecureStore; bridge keeps in-memory active session/timeline state only, while OpenCode may maintain its own session identity on the Codespace VM

**Testing**: Bridge build via `npm run build`; mobile TypeScript/Expo validation via `npx tsc --noEmit` if available; add Jest/React Native Testing Library and Supertest coverage if test harness is introduced during implementation

**Target Platform**: GitHub Codespace Linux VM for bridge execution; Android and iOS mobile app through Expo/React Native

**Project Type**: Mobile app plus lightweight API/WebSocket bridge

**Performance Goals**: Mobile chat timeline remains responsive at 60 FPS target with at least 100 timeline items; first prompt can be sent within 10 seconds when OpenCode is installed; setup result is visible within 2 seconds after completion

**Constraints**: Do not persist user secrets on the Codespace VM; communicate directly between mobile and bridge via REST/WebSocket; remove terminal UI from the Control Screen path; support reconnect without relying on a permanently visible shell session

**Scale/Scope**: One Control Screen, one OpenCode-only agent flow, one bridge agent orchestration service, structured event contract, installation/provisioning flow, session continuity, diff review, and approval controls
**Known Failure Analysis (2026-06-26)**:

- The bridge currently marks OpenCode ready from `which opencode` alone. This can be true while provider credentials, project initialization, or the OpenCode server/run path is still unusable.
- `socket.ts` creates and broadcasts an empty assistant streaming message before verifying that `ensureServer()` succeeded or that `opencode run` has produced a first event. If the child process hangs, the mobile app displays `Thinking...` indefinitely.
- `opencode.ts` ignores the boolean returned by `ensureServer()`, then uses attach mode whenever `serveProcess` is non-null. A stale or not-yet-ready server handle can route prompts to a broken attach path.
- `stderr` is accumulated but not streamed as status/errors until process close, so authentication/configuration prompts or startup failures can be invisible for minutes.
- `ControlScreen.tsx` holds timeline state only in component state. Navigating away unmounts the screen, and returning depends on bridge snapshot recovery; if the placeholder was never finalized or the conversation ID changed, visible history can disappear.
- Stop handling adds a status message but does not guarantee the pending assistant placeholder is converted to an error/complete state on the client before navigation/reconnect.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Decentralized & Transient Secret Management**: PASS. Mobile remains the source of credentials; bridge receives credentials through the active authenticated connection and injects them into agent execution without persisting them.
- **II. Mobile-First Optimization & Performance**: PASS. Terminal log rendering is removed from the Control Screen; the plan requires a virtualized chat timeline and compact structured rows.
- **III. Decoupled Micro-Bridge Architecture**: PASS. Mobile communicates directly with the Codespace bridge over existing REST/WebSocket channels; no external proxy is introduced.
- **IV. Dynamic VM Provisioning**: PASS. The bridge checks OpenCode availability and supports install/retry states without manual setup.
- **V. Test-First Implementation & Validation**: PASS WITH ACTION. Current packages expose limited test scripts; implementation tasks must include at least build/type validation and add focused tests where harnesses exist or are introduced.
- **Security & Compute Resource Limits**: PASS. Agent process execution stays isolated in the bridge process boundary, credentials are cleared when sessions complete/disconnect, and VM teardown remains available.

## Project Structure

### Documentation (this feature)

```text
specs/004-control-chat-opencode/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- opencode-chat-events.md
|-- checklists/
|   `-- requirements.md
`-- tasks.md              # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
iota-bridge/
|-- package.json
|-- src/
|   |-- index.ts
|   |-- routes/
|   |   `-- status.ts
|   |-- services/
|   |   |-- socket.ts
|   |   |-- terminal.ts
|   |   `-- git.ts
|   `-- types/

iota-mobile/
|-- package.json
|-- App.tsx
|-- src/
|   |-- components/
|   |-- constants/
|   |-- screens/
|   |   `-- ControlScreen.tsx
|   |-- services/
|   |   `-- secureStore.ts
|   |-- styles/
|   `-- types/
```

**Structure Decision**: Keep the existing mobile-plus-bridge split. The bridge owns Codespace process orchestration, OpenCode installation checks, session lifecycle, and event normalization. The mobile app owns chat presentation, composer state, diff cards, approval controls, and connection status. No new app or proxy package is introduced.

## Phase 0: Research Summary

See [research.md](research.md). Key decisions:

- Use OpenCode structured JSON execution as the primary integration model instead of rendering a terminal emulator.
- Normalize bridge output into a stable IOTA chat event contract before sending it to mobile.
- Preserve OpenCode session identity and in-memory timeline snapshots to support reconnect and continuation.
- Keep installation/provisioning as an explicit chat-native setup flow.
- Use official OpenCode installation and CLI contracts as the source of truth: install script or `npm install -g opencode-ai`, `opencode run ... --format json`, `opencode serve` on port 4096, `opencode run --attach http://localhost:4096 ...`, and `opencode session list --format json`.
- Add runtime watchdogs and preflight checks so the UI cannot remain on `Thinking...` without either receiving content/progress or a visible retryable error.

## Phase 1: Design Summary

See [data-model.md](data-model.md) and [contracts/opencode-chat-events.md](contracts/opencode-chat-events.md).

Design outputs define:

- OpenCode capability and setup states
- Conversation, message, tool activity, file change, and approval entities
- Socket events and REST capability checks used by the Control Screen
- Validation scenarios in [quickstart.md](quickstart.md)

## Post-Design Constitution Check

- **Secret storage** remains compliant: no new persistent bridge secret store is planned.
- **Performance** remains compliant: raw terminal rendering is removed from the Control Screen and replaced with structured, bounded timeline items.
- **Architecture** remains compliant: direct mobile-to-bridge communication is preserved.
- **Dynamic provisioning** remains compliant: OpenCode setup is first-class in the plan.
- **Testing** requires follow-through during tasks: add or run available build/type/test validation before implementation is considered complete.

## Complexity Tracking

No constitution violations require justification.
## OpenCode Integration Detail

Implementation tasks must carry forward all behaviors from `docs/opencode-integration,md`:

- Use `opencode run "<prompt>" --format json` as the structured non-terminal execution path.
- Prefer a warm Codespace-local daemon using `opencode serve --port 4096` and `opencode run --attach http://localhost:4096 --format json` where available.
- Capture and store OpenCode session identifiers from JSON output and pass continuation metadata for follow-up prompts.
- Use `opencode session list` or equivalent OpenCode server state recovery during reconnect if the bridge snapshot is missing or stale.
- Map text deltas, tool starts, file changes, and authorization requests into the stable `opencode:*` socket event contract.
- Keep raw terminal/log events out of the Control Screen UI even if the bridge internally uses process spawning helpers.

## Required Repair Plan

1. **Capability must prove runtime readiness**
   - Replace binary-only readiness with a capability object that distinguishes `missing`, `installed_uninitialized`, `credentials_missing`, `server_unavailable`, and `available`.
   - Validate `opencode --version`, workspace root, `AGENTS.md`/project initialization readiness, and at least one provider credential from transient socket/mobile state before enabling submit.
   - Keep `/api/status` useful for unauthenticated-by-socket reachability, but do not let it alone enable prompt submission if socket credentials have not been injected.

2. **Installation must use official fallbacks**
   - Try 
pm install -g opencode-ai when npm is usable; if OpenCode is still missing, fall back to `curl -fsSL https://opencode.ai/install | bash`.
   - After install, re-probe the actual `opencode` executable with the same PATH that prompt runs will use.
   - Emit structured setup progress and final capability through `opencode:capability`; never clear chat history during install.

3. **Prompt runs must have explicit lifecycle events**
   - Do not create a permanent visible assistant placeholder until the run process has started successfully.
   - Emit `opencode:run_started` or a status message immediately after spawn, then require first stdout/stderr/JSON activity within a short watchdog window, for example 20 seconds.
   - If no first activity arrives, kill the run, mark the assistant message `error`, finish the request, and emit a retryable error explaining which phase failed.
   - Stream sanitized stderr as status/error events when it indicates configuration/auth/startup failure instead of waiting for process close.

4. **Server attach must be gated**
   - `ensureServer()` must return a durable readiness result. Attach mode is allowed only when the port probe passes after spawning.
   - If serve cannot start or port 4096 is not listening, fall back to direct `opencode run ... --format json` for that prompt instead of using a stale `serveProcess`.
   - Track and clear stale server handles on close/error and before each attach run.

5. **Conversation history must be stable across navigation**
   - Generate one stable mobile conversation ID per Codespace/repository and persist it in screen-level/app-level state or SecureStore.
   - On Control Screen mount and socket reconnect, always request `opencode:sync` with that ID, then merge the snapshot with any local pending messages rather than replacing the timeline blindly.
   - Keep stopped/error assistant placeholders in the timeline with final status so navigation does not make prior attempts disappear.

6. **Tests and validation are mandatory**
   - Add bridge tests for capability states, install fallback, server fallback, first-output timeout, stop finalization, JSON parsing, and snapshot recovery.
   - Add mobile tests for submit lifecycle, snapshot merge, navigation remount history preservation, install progress without history clearing, and stop finalization.
   - Validate against a real Codespace with OpenCode missing, then installed, then a prompt that returns text.



