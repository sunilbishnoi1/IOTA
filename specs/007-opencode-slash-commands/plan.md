# Implementation Plan: OpenCode Slash Commands

**Branch**: `007-opencode-slash-commands` | **Date**: 2026-06-28 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/007-opencode-slash-commands/spec.md)

## Summary

Implement support for all 13 core OpenCode slash commands. The mobile app will intercept and handle client-only commands (like `/help`, `/connect`, `/undo`, `/redo`) locally, and forward other commands (like `/models`, `/stats`, `/skills`, `/sessions`, `/init`, `/compact`, `/review`, `/exit`) to the bridge. We will implement a premium floating autocomplete overlay in React Native to assist typing slash commands, and a transient credentials setup modal overlay for API keys. 

## Technical Context

**Language/Version**: React Native (Expo SDK 50+, TypeScript), Node.js (TypeScript)

**Primary Dependencies**: `expo-secure-store`, `@expo/vector-icons`, `socket.io-client`

**Storage**: Expo SecureStore (client credentials), bridge-side memory for active sessions

**Testing**: Jest for client hooks and bridge socket handlers

**Target Platform**: iOS, Android, Node.js

**Project Type**: Mobile app (React Native/Expo) + Node.js Bridge

**Performance Goals**: Latency < 16ms (60 FPS) for autocomplete suggestions overlay, local command resolution < 100ms

**Constraints**: Bypassing bridge roundtrip for client-only commands; no persistent key storage on bridge disk

**Scale/Scope**: 1 new mobile component/hook file `ControlSlashCommands.tsx`, 1 bridge service extension, 1 bridge socket handler update

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Decentralized & Transient Secret Management** | PASS | Credentials will remain in Expo SecureStore and dynamically updated on the bridge socket session memory (never written to disk on bridge). |
| **II. Mobile-First Optimization & Performance** | PASS | Floating autocomplete overlay will use light, high-performance rendering (60 FPS). |
| **III. Decoupled Micro-Bridge Architecture** | PASS | Bridge communication will stay directly on WebSockets with no intermediate proxy. |
| **IV. Dynamic VM Provisioning** | PASS | Command verification will auto-detect local `opencode` CLI or run install script. |
| **V. Test-First Implementation & Validation** | PASS | Will write unit tests for client-side command parsing and bridge-side command execution. |

## Project Structure

### Documentation (this feature)

```text
specs/007-opencode-slash-commands/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
iota-mobile/
└── src/
    ├── screens/
    │   └── ControlScreen.tsx           # [MODIFY] Import and mount slash commands overlay/handlers
    ├── components/
    │   └── control/
    │       └── ControlSlashCommands.tsx    # [NEW] Contains autocomplete overlay, credentials modal, and slash command logic hook
    ├── services/
    │   └── opencodeSocket.ts           # [MODIFY] Add update credentials emitter
    └── types/
        └── opencode.ts                 # [MODIFY] Update conversation type to support activeModel

iota-bridge/
└── src/
    ├── services/
    │   ├── socket.ts                   # [MODIFY] Add slash command parser, credentials update, and command execute routes
    │   └── opencode.ts                 # [MODIFY] Add activeModel support to buildRunArgs, and custom runners for stats/models/sessions/skills
    └── types/
        └── opencode.ts                 # [MODIFY] Add activeModel to conversation interface
```

**Structure Decision**: Decoupled Mobile + API. Shared WebSocket protocol handles passing run requests and receiving stdout/stderr.

## Complexity Tracking

*No violations detected. No complexity tracking needed.*
