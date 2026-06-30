# Implementation Plan: Codespace VM Initialization & Connection Routing

**Branch**: `002-initialize-codespace-from-repo` | **Date**: 2026-06-24 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/002-initialize-codespace-from-repo/spec.md)

**Input**: Feature specification from `/specs/002-initialize-codespace-from-repo/spec.md`

## Summary

This feature shifts command execution and workspace operations from the local dev machine to a remote GitHub Codespace VM initialized into the user's actual target repository.
The mobile app will fetch user repositories, allow the user to create a Codespace, and then dynamically connect directly to the bridge server running on the newly created Codespace VM using its port-forwarded URL (`https://<codespace-name>-3000.app.github.dev`). 

## Technical Context

**Language/Version**: TypeScript (v5.x), Node.js (v20+), React Native (Expo SDK 51+)

**Primary Dependencies**: `@octokit/rest`, `socket.io`, `socket.io-client`, `node-pty`, `expo-secure-store`

**Storage**: In-memory active sessions on the bridge; SecureStore on mobile.

**Testing**: Manual validation scenarios outlined in `quickstart.md`.

**Target Platform**: iOS 15+, Android 8+, Linux container (GitHub Codespaces)

**Project Type**: Mobile App + API Bridge Server

**Performance Goals**: WebSocket connection establishment < 5s after active status, repository search filtering latency < 100ms.

**Constraints**:
- Must connect directly to the port-forwarded Codespace URL, avoiding intermediate proxies (Principle III).
- All terminal/git operations must run in the repository workspace root (`/workspaces/<repo-name>`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Decentralized Secrets**: Passed. Secrets are sent in the WebSocket auth payload from the client and never saved on remote disk.
- **Principle III: Decoupled Micro-Bridge**: Passed. The mobile client connects directly to the Codespace VM's port-forwarded domain.
- **Principle V: Test-First/Validation**: Passed. Verification guide defined in `quickstart.md`.

## Project Structure

### Documentation (this feature)

```text
specs/002-initialize-codespace-from-repo/
├── plan.md              # This file
├── research.md          # Research findings
├── data-model.md        # Repositories & Codespace entities
├── quickstart.md        # Run and test manual steps
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code

```text
iota-bridge/src/
├── routes/
│   └── status.ts        # GET /api/repos, POST /api/codespaces, POST /api/codespaces/:name/stop
├── services/
│   ├── codespaceService.ts # listUserRepos, createCodespace, stopCodespace
│   ├── terminal.ts      # Resolve repository workspace root for PTY spawn
│   └── git.ts           # Run git commands in the resolved workspace root

iota-mobile/src/
├── screens/
│   ├── DashboardScreen.tsx # Add "+" FAB, BottomSheet repo list, create codespace
│   └── ControlScreen.tsx   # Dynamically connect socket to codespace port-forwarded URL
```

## Proposed Changes

### iota-bridge

#### [MODIFY] [codespaceService.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/codespaceService.ts)
- Implement `listUserRepos(token: string)` to fetch repositories (`octokit.rest.repos.listForAuthenticatedUser`).
- Implement `createCodespace(token: string, repo: string, branch?: string)` to provision a codespace (`octokit.rest.codespaces.createForAuthenticatedUser`).
- Implement `stopCodespace(token: string, codespaceName: string)` to stop a codespace (`octokit.rest.codespaces.stopForAuthenticatedUser`).
- Update connection URL calculation to follow the `https://<codespace-name>-3000.app.github.dev` format.

#### [MODIFY] [status.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/routes/status.ts)
- Expose `GET /api/repos` using `listUserRepos`.
- Expose `POST /api/codespaces` to trigger codespace creation.
- Expose `POST /api/codespaces/:name/stop` to stop the Codespace VM.

#### [MODIFY] [terminal.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/terminal.ts)
- Resolve the repository workspace root directory (e.g. parent directory of the running bridge or `/workspaces/<repository-name>`).
- Set `cwd` for `node-pty` spawn to this resolved path.

#### [MODIFY] [git.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/git.ts)
- Modify all Git command executions to run in the resolved repository workspace root directory.

### iota-mobile

#### [MODIFY] [DashboardScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/DashboardScreen.tsx)
- Add a Floating Action Button (FAB) `+` to the dashboard screen.
- Implement a modal/bottom-sheet listing the user's GitHub repositories with search capability.
- Call the `POST /api/codespaces` endpoint when creating a new Codespace.
- Dynamically monitor and update the state of the starting codespace.

#### [MODIFY] [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- Instead of using the static `bridgeUrl` from SecureStore, construct the connection URL dynamically using the active codespace's `connectionUrl` (e.g., `https://<codespace-name>-3000.app.github.dev`).
- Pass the token in the socket extraHeaders (or query/auth) to ensure the GitHub proxy forwards the traffic properly.

## Verification Plan

### Manual Verification
- Verify Scenario 1: Fetching and searching repositories.
- Verify Scenario 2: Provisioning a new codespace VM for a repository.
- Verify Scenario 3: Dynamic port forward socket connection and log streaming.
