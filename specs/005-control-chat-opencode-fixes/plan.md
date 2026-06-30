# Implementation Plan: OpenCode Control Chat Fixes

**Branch**: `005-control-chat-opencode-fixes` | **Date**: 2026-06-26 | **Spec**: [spec.md](file:///D:/Desktop/codes/IOTA/specs/005-control-chat-opencode-fixes/spec.md)

## Summary

This feature resolves six issues in the OpenCode chat control flow: parsing nested JSON outputs, consolidating run status updates to avoid timeline spam, adding a native unified logger (`bridge.log`), specifying a free default model without requiring credentials, handling port conflicts and connection/attach failures with robust run fallbacks, and maintaining stable state synchronization across client screen navigation.

## Technical Context

**Language/Version**: TypeScript / Node.js 20, React Native / Expo (TS)
**Primary Dependencies**: Express, socket.io, socket.io-client, child_process
**Storage**: In-memory (bridge `opencodeStore`), secure local storage (mobile `secureStoreService`)
**Testing**: Jest
**Target Platform**: Codespaces VM (headless Node.js), iOS / Android (React Native)
**Project Type**: mobile-app + backend-bridge
**Performance Goals**: Smooth 60 FPS mobile rendering, low-latency UI updates for streaming, instant recovery on navigation remount.
**Constraints**: Zero secret persistence on VM disk. Direct P2P connection via WebSockets.
**Scale/Scope**: 1 screen (ControlScreen), 2 bridge services (opencode.ts, socket.ts)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Decentralized & Transient Secret Management**: Passed. The change does not store any credentials on VM disk. We are specifying a default free model (`opencode/deepseek-v4-flash-free`) that requires no API keys, eliminating key propagation concerns.
- **Principle II: Mobile-First Optimization & Performance**: Passed. Merging and de-duplicating statuses to a single message per request prevents FlatList clogging and rendering overhead on the JS thread.
- **Principle III: Decoupled Micro-Bridge Architecture**: Passed. Maintained.
- **Principle IV: Dynamic VM Provisioning**: Passed. Availability check remains automated.
- **Principle V: Test-First Implementation & Validation**: Passed. We will add unit tests for `opencodeEvents` normalization.

## Project Structure

### Documentation (this feature)

```text
specs/005-control-chat-opencode-fixes/
├── plan.md              # This file
├── research.md          # Research findings
├── data-model.md        # Snapshot/message data model details
├── quickstart.md        # Run scenarios to validate fixes
├── contracts/           # Contracts (updates or references to opencode-chat-events)
└── tasks.md             # Task list
```

### Source Code (repository root)

```text
iota-bridge/
└── src/
    ├── services/
    │   ├── logger.ts         # [NEW] Native logger service
    │   ├── opencode.ts       # [MODIFY] Build args with default model, run fallback
    │   ├── opencodeEvents.ts # [MODIFY] Normalize nested payloads, filter step_* events
    │   └── socket.ts         # [MODIFY] Overwrite status messages by requestId, use logger
    └── index.ts              # [MODIFY] Initialize logger on startup

iota-mobile/
└── src/
    └── screens/
        └── ControlScreen.tsx # [MODIFY] Overwrite status by requestId, merge correctly on remount
```

**Structure Decision**: Option 3 (Mobile + API) since this repo is structured with `iota-bridge` and `iota-mobile` directories. We are modifying existing files in both components.

## Proposed Changes

### Bridge Logger Service

We will implement a simple Node.js file stream logger in `iota-bridge/src/services/logger.ts` to log bridge server events and child process stdout/stderr into `bridge.log`.

#### [NEW] [logger.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/logger.ts)
- `initLogger()` to open a write stream to `bridge.log` in the workspace root.
- `logInfo(msg, meta)`, `logError(msg, meta)` to log to console and append to `bridge.log`.

#### [MODIFY] [index.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/index.ts)
- Initialize the logger on bridge startup.

### OpenCode Command Runner & Fallback

#### [MODIFY] [opencode.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- Update `buildRunArgs` to pass `--model opencode/deepseek-v4-flash-free`.
- Implement robust retry/fallback in `run()`: if warm server run fails (exits with non-zero code or error) without any JSON output, fallback to direct run mode transparently.
- Log command spawn details, exit statuses, stdout, and stderr chunks via `logger`.

### Payload Normalization

#### [MODIFY] [opencodeEvents.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)
- Inspect nested `part` fields (`part.text`, `part.content`, etc.) in `normalizeOpenCodePayload` to correctly extract text and deltas.
- Explicitly map `step_start` and `step_finish` to return empty events `[]` to prevent them from falling through to the fallback type, avoiding spam.

### Stable Status IDs & Navigation Sync

#### [MODIFY] [socket.ts](file:///D:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- Update `emitRunStatus` to assign `id: \`run-\${status.requestId}\`` instead of a phase-specific unique ID. This will overwrite previous phases in the store.
- Log socket connections/disconnects and run phases via `logger`.

#### [MODIFY] [ControlScreen.tsx](file:///D:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- Update `createRunStatusMessage` to assign `id: \`run-\${status.requestId}\``. This will match the bridge status ID and overwrite on client-side state.
- Ensure snapshot recovery on `onSnapshot` de-duplicates and restores the active run state cleanly on component remount.

## Verification Plan

### Automated Tests
- Run `npm test` in `iota-bridge` to verify existing and new unit tests for `normalizeOpenCodePayload`.

### Manual Verification
- Start the bridge server and connect the mobile client.
- Submit a prompt to OpenCode, verify real-time streaming text renders correctly in the chat screen.
- Verify only one status bubble ("OpenCode run completed.") is shown per prompt in the history.
- Check that the `bridge.log` file is created in the workspace root and logs are appended correctly.
- Simulate port conflict (by blocking port 4096 or running another app on it) and verify prompt execution falls back to direct run mode.
- Navigate away to Dashboard during active run and return, verifying conversational state is correctly preserved and synced.
