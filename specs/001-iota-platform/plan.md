# Implementation Plan: IOTA Mobile Client & Cloud Agent Control

**Branch**: `001-iota-platform` | **Date**: 2026-06-24 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/001-iota-platform/spec.md)

**Input**: Feature specification from `/specs/001-iota-platform/spec.md`

## Summary

IOTA is a remote control platform that turns a developer's phone into a command center for AI-driven coding. It leverages the developer's free tier of GitHub Codespaces (60 hours/month) to run heavy open-source CLI coding agents (like Claude Code, opencode, Cline) directly on an isolated Linux VM in the cloud. 

The technical approach implements a React Native client (built with TypeScript & Expo) communicating via secure WebSockets and REST APIs with a lightweight bridge server deployed on the Codespace. Security is decentralized: user credentials (GitHub OAuth token, Anthropic/OpenAI API keys) are saved in secure device storage (`Expo SecureStore`) and only injected dynamically into the Codespace process environment during active WebSocket sessions.

## Technical Context

**Language/Version**: TypeScript (v5.x), React Native (Expo SDK 51+), Node.js (v20+)

**Primary Dependencies**: 
- *Mobile Client*: `expo`, `react-native`, `expo-secure-store` (credential vault), `expo-router` or `react-navigation` (screens routing), `socket.io-client` (real-time stream), `react-native-webview` (shader canvas rendering), `nativewind` (styling)
- *Bridge Server*: `express` (REST routes), `socket.io` (WS transport), `dotenv` (env loading), `@octokit/rest` (GitHub client), `node-pty` (pseudo-terminal for spawning agents)

**Storage**: 
- *Mobile*: Local secure keychain (`expo-secure-store`) for API keys and tokens.
- *Bridge*: Local in-memory dictionary for active session states (never written to disk).

**Testing**: 
- *Mobile*: Jest + React Native Testing Library
- *Bridge*: Jest + Supertest (REST testing)

**Target Platform**: iOS 15+, Android 8+, Linux container (GitHub Codespaces)

**Project Type**: Mobile App + API Bridge Server

**Performance Goals**: 
- WebSocket transport latency < 100ms
- UI responsiveness 60 FPS (including WebGL shader view)
- Log streaming latency < 200ms

**Constraints**:
- Zero-retention of credentials on Codespace disk.
- Minimal battery and data usage on mobile devices.
- Adherence to GitHub Codespaces port forwarding & token scope boundaries.

**Scale/Scope**: ~4 core screens (Login/Landing, Dashboard, Terminal, Pre-flight Diff)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Core Principles**: N/A - Constitution template detected with default placeholders. No custom rules violated.
- **Architectural Match**: High. The project is separated into a clean client (`iota-mobile`) and a decoupled VM bridge server (`iota-bridge`).

## Project Structure

### Documentation (this feature)

```text
specs/001-iota-platform/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contract definitions)
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
iota-bridge/             # Node.js pseudo-terminal & WebSocket bridge server
├── src/
│   ├── index.ts         # Server entry point
│   ├── routes/          # REST endpoints (status, check-agent)
│   ├── services/        # CLI agent runner, Git controller, Codespaces API
│   └── types/
├── package.json
└── tsconfig.json

iota-mobile/             # Expo React Native App
├── App.tsx              # App main wrapper
├── app.json             # Expo project configuration
├── src/
│   ├── components/      # UI elements: Bento cards, Terminal console, Diff viewer
│   ├── screens/         # Login, Dashboard, Control, Ship screens
│   ├── services/        # secureStore.ts, socketService.ts, oauth.ts
│   └── styles/          # nativewind configuration, tailwind.config.js
└── package.json
```

**Structure Decision**: Multi-project layout. Decoupled mobile client (`iota-mobile`) and bridge backend (`iota-bridge`) to allow independent deployment and lightweight execution on Codespaces.

## Complexity Tracking

*No violations.*
