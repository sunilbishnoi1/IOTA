# Implementation Plan: Terminal & OpenCode Integration

**Branch**: `003-terminal-opencode-integration` | **Date**: 2026-06-24 | **Spec**: [spec.md](file:///D:/Desktop/codes/IOTA/specs/003-terminal-opencode-integration/spec.md)

## Summary

Fix all terminal and OpenCode integration issues in ControlScreen, ensuring text input goes to the active session rather than spawning new processes, displaying installation logs properly, and making the terminal fully scrollable.

## Technical Context

**Language/Version**: TypeScript 5.4, Node.js 20, React Native / Expo
**Primary Dependencies**: `node-pty`, `socket.io-client`, `express`
**Storage**: N/A
**Testing**: Jest
**Target Platform**: Linux (Codespace VM) / Android & iOS (Mobile App)
**Project Type**: Mobile App + API Bridge

## Constitution Check

- **Decentralized & Transient Secret Management**: Kept. Secrets are not stored on bridge VM.
- **Mobile-First Optimization**: Scroll performance improved. Outer scrollview layout bug resolved.
- **Decoupled Micro-Bridge**: Kept. Communication direct via WebSockets.
- **Dynamic VM Provisioning**: Kept. Support for dynamic check and automatic installation of opencode.
- **Test-First Implementation**: Verification plan defined.

## Proposed Changes

### iota-bridge (Backend Service)

#### [MODIFY] [status.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/routes/status.ts)
- Dynamically verify if the `opencode` CLI is available in the system PATH.
- Return current branch and repository dynamically.

#### [MODIFY] [git.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/git.ts)
- Export `getRepoPath`.
- Add and export `getBranch`.

#### [MODIFY] [terminal.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/terminal.ts)
- Support spawning `install-opencode` running `npm install -g opencode-ai` with curl fallback.
- Support spawning `opencode` directly.
- Feed first prompt to stdin.

---

### iota-mobile (Mobile Application)

#### [MODIFY] [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- Hide agent selector.
- Dynamically handle "Install OpenCode".
- Route prompts to terminal:input when running.
- Restructure container to fix nesting ScrollViews.

#### [MODIFY] [TerminalConsole.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/TerminalConsole.tsx)
- Maximize layout heights for proper scrollability.

## Verification Plan

### Automated Tests
- Validate bridge builds and runs cleanly.

### Manual Verification
- Test installation flow and interactive typing.
