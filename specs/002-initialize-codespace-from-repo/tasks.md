# Tasks: Initialize Codespace VM from GitHub Repo

**Input**: Design documents from `/specs/002-initialize-codespace-from-repo/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only include them if explicitly requested. For this feature, manual validation scenarios defined in `quickstart.md` will be used for verification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Exact file paths are provided in descriptions.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify dev environment and check that the monorepo dev servers are ready for modifications.

- [x] T001 Verify active dev servers and clean workspace state before implementing modifications

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, model updates, and connection utility methods that MUST be completed before user stories.

**⚠️ CRITICAL**: All tasks in this phase must be completed before starting any user story implementations.

- [x] T002 [P] Update shared TypeScript interface for `CodespaceVM` and add `GitHubRepository` interface in `iota-bridge/src/types/index.ts` and `iota-mobile/src/types/index.ts`
- [x] T003 Update Codespace connection URL calculation helper to construct dynamic port URL format in `iota-bridge/src/services/codespaceService.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Repository Listing & Selection (Priority: P1)

**Goal**: Fetch user's actual GitHub repositories and display them on the mobile client for selection.

**Independent Test**: Tap the "+" FAB button on the dashboard, see your actual repositories list, and filter it via search input.

### Implementation for User Story 1

- [x] T004 [P] [US1] Implement `listUserRepos` using Octokit client inside `iota-bridge/src/services/codespaceService.ts`
- [x] T005 [P] [US1] Expose REST endpoint `GET /api/repos` in `iota-bridge/src/routes/status.ts`
- [x] T006 [P] [US1] Create a searchable list component for repositories in `iota-mobile/src/components/RepositoryList.tsx`
- [x] T007 [US1] Build a Floating Action Button (FAB) and BottomSheet/Modal container on the Dashboard screen to display the repository list in `iota-mobile/src/screens/DashboardScreen.tsx`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Provisioning Codespace VM (Priority: P1)

**Goal**: Request codespace provisioning for the selected repository and poll its booting state.

**Independent Test**: Select a repository, tap "Create Codespace", and verify the starting card appears on the dashboard.

### Implementation for User Story 2

- [x] T008 [P] [US2] Implement `createCodespace` and `stopCodespace` using Octokit inside `iota-bridge/src/services/codespaceService.ts`
- [x] T009 [P] [US2] Expose REST endpoints `POST /api/codespaces` and `POST /api/codespaces/:name/stop` in `iota-bridge/src/routes/status.ts`
- [x] T010 [US2] Wire up repository selection to codespace creation API call and render the starting/polling card on the Dashboard in `iota-mobile/src/screens/DashboardScreen.tsx`

**Checkpoint**: User Stories 1 and 2 are fully integrated and functional.

---

## Phase 5: User Story 3 - Dynamic Connection & Remote Execution (Priority: P1)

**Goal**: Connect to the active codespace VM directly and run terminal commands and git actions inside the remote repository workspace.

**Independent Test**: Select an active codespace, open Mission Control, verify WebSocket connects directly to the port-forwarded VM URL, and run commands.

### Implementation for User Story 3

- [x] T011 [P] [US3] Configure `terminalManager.spawn` to use the parent repository workspace directory as `cwd` in `iota-bridge/src/services/terminal.ts`
- [x] T012 [P] [US3] Update all exec-based Git operations to run inside the parent repository workspace root directory in `iota-bridge/src/services/git.ts`
- [x] T013 [US3] Update socket server connection handshake parsing and authentication headers configuration in `iota-bridge/src/services/socket.ts`
- [x] T014 [US3] Update socket initiation and API request targets to use the dynamic `activeCodespace.connectionUrl` in `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: All user stories are fully completed and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: System optimization, documentation, and final validation.

- [x] T015 Document dynamic routing and codespace VM configuration in `iota-bridge/README.md`
- [x] T016 Clean up unused variables and console log expressions across all modified files
- [x] T017 Run manual end-to-end validation scenarios defined in `specs/002-initialize-codespace-from-repo/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - blocks all user stories.
- **User Stories (Phases 3+)**: All depend on Foundational completion.
  - User Stories can run in sequence: US1 (P1) → US2 (P1) → US3 (P1).
- **Polish (Phase 6)**: Depends on completion of all stories.

### Parallel Opportunities

- Shared model type updates (T002) and calculator helper (T003) can be developed in parallel.
- API listing methods (T004, T005) and frontend components (T006) for US1 can run in parallel.
- Bridge VM management endpoints (T008, T009) and client-side Dashboard updates (T010) for US2 can run in parallel.
- Bridge workspace resolution updates (T011, T012) and client socket routing (T014) for US3 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Developer A implements Octokit repository listing on the bridge:
Task: "Implement listUserRepos using Octokit client inside iota-bridge/src/services/codespaceService.ts"

# Developer B builds repository search/list components in React Native:
Task: "Create a searchable list component for repositories in iota-mobile/src/components/RepositoryList.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Repository Listing & Selection)
4. Complete Phase 4: User Story 2 (Provisioning Codespace VM)
5. **STOP & VALIDATE**: Verify that creating a codespace via GitHub API displays a starting/provisioning card.

### Dynamic Routing Integration

1. Complete Phase 5: User Story 3 (Dynamic Socket Connection & Workspace Routing)
2. **STOP & VALIDATE**: Run manual tests using `quickstart.md`.
