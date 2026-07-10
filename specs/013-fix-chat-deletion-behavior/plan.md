# Implementation Plan: Fix Chat Deletion & New Session Behavior

**Branch**: `013-fix-chat-deletion-behavior` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-fix-chat-deletion-behavior/spec.md`

## Summary

Fix two user-facing bugs in chat session management: (1) deleting the current active chat switches to an arbitrary existing conversation instead of creating a fresh empty chat, and (2) tapping "New Chat" while an empty chat already exists creates a duplicate empty session. Both fixes are scoped to the mobile client (`ControlScreen.tsx`) and the bridge store (`opencodeStore.ts`/`socket.ts`).

## Technical Context

**Language/Version**: TypeScript 5.x

**Primary Dependencies**: React Native / Expo SDK 52, socket.io-client, expo-secure-store, @react-navigation/native

**Storage**: expo-secure-store (mobile conversation ID persistence), JSON files on bridge (`<workspace>/.iota/conversations/*.json`)

**Testing**: Jest 29 + @testing-library/react-native 12.7 (mobile), Jest 29 + ts-jest (bridge)

**Target Platform**: iOS 15+ / Android 12+

**Project Type**: Mobile app (React Native/Expo) + Node.js bridge server (Express/Socket.io)

**Performance Goals**: Sub-500ms deletion and new-chat operations, 60 FPS UI

**Constraints**: Local-first, offline-capable; no server-side sync; empty chat state must survive app restarts

**Scale/Scope**: Single-user mobile app with remote Codespace bridge

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| I. Decentralized & Transient Secret Management | Not affected (no secrets involved) | PASS |
| II. Mobile-First Optimization & Performance | Changes are local state updates; no heavy rendering impact | PASS |
| III. Decoupled Micro-Bridge Architecture | All chat logic changes are contained within existing client-bridge socket flow | PASS |
| IV. Dynamic VM Provisioning | Not affected | PASS |
| V. Test-First Implementation & Validation | New behavior must have corresponding tests | PASS |
| Security & Compute Resource Limits | Not affected | PASS |
| Plan-Spec-Task Discipline | Spec exists, plan being created now | PASS |

**Result**: All gates pass. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/013-fix-chat-deletion-behavior/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Not needed (purely internal state logic)
└── tasks.md             # Phase 2 output (speckit-tasks)
```

### Source Code (repository root)

```text
iota-mobile/
├── src/
│   ├── screens/
│   │   └── ControlScreen.tsx          # Chat deletion + new-chat logic
│   └── components/control/
│       └── HistoryDrawer.tsx           # Empty chat filtering in history list
├── src/services/
│   └── secureStore.ts                  # (if needed) persist empty chat ID

iota-bridge/
└── src/
    ├── services/
    │   ├── opencodeStore.ts            # deleteConversation behavior change
    │   └── socket.ts                   # delete_conversation handler adjustment
```

**Structure Decision**: Single project for mobile app with separate bridge server directory. All changes are within existing files; no new source files needed.

## Complexity Tracking

Not applicable — all gates passed.
