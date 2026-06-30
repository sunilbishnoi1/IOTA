# Tasks: IOTA Mobile Client & Cloud Agent Control

**Input**: Design documents from `/specs/001-iota-platform/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only include them if explicitly requested. For this feature, manual validation scenarios defined in `quickstart.md` will be used for verification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Exact file paths are provided in descriptions.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and workspace monorepo layout.

- [x] T001 Initialize the monorepo root structure and project configuration files at the repository root
- [x] T002 [P] Configure global ESLint and Prettier formatting styles in `.eslintrc.js` and `.prettierrc`
- [x] T003 [P] Initialize the `iota-mobile` React Native Expo app with standard dependencies in `iota-mobile/package.json`
- [x] T004 [P] Initialize the `iota-bridge` Node.js express/ws bridge server with TypeScript config in `iota-bridge/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core communication and utility structures that must be complete before UI or story work begins.

**⚠️ CRITICAL**: All tasks in this phase must be completed before starting any user story implementations.

- [x] T005 [P] Configure global Tailwind CSS and branding tokens in `iota-mobile/tailwind.config.js` and theme specifications in `iota-mobile/src/styles/theme.ts`
- [x] T006 [P] Implement the Expo SecureStore client credentials service in `iota-mobile/src/services/secureStore.ts`
- [x] T007 [P] Implement the GitHub API octokit client helper in `iota-bridge/src/services/github.ts`
- [x] T008 [P] Initialize the Pseudo-terminal (PTY) spawn manager inside `iota-bridge/src/services/terminal.ts`
- [x] T009 Implement the WebSocket routing and connect/disconnect events infrastructure in `iota-bridge/src/services/socket.ts`
- [x] T010 Create shared TypeScript interfaces and models for WebSocket payloads in `iota-mobile/src/types/index.ts` and `iota-bridge/src/types/index.ts`

---

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Developer Setup and Authentication (Priority: P1) 🎯 MVP

**Goal**: Establish native GitHub Device Flow login client-side, dynamic background canvas rendering, and server token authorization.

**Independent Test**: Run client, click Login, get Device Flow alphanumeric code, verify redirect, input on GitHub, and verify transition to the dashboard.

### Implementation for User Story 1

- [x] T011 [P] [US1] Create the GitHub Device Authorization Flow helper class in `iota-mobile/src/services/oauth.ts`
- [x] T012 [P] [US1] Build the full-screen WebGL Shader mesh gradient using WebView wrapper in `iota-mobile/src/components/ShaderGradient.tsx`
- [x] T013 [US1] Build the Landing & Login Screen component featuring the shader background in `iota-mobile/src/screens/LoginScreen.tsx`
- [x] T014 [US1] Add the GitHub Token bearer authentication middleware to secure REST endpoints in `iota-bridge/src/middleware/auth.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Container Matrix Dashboard (Priority: P1)

**Goal**: Display active/sleeping containers, free compute hour limits, and trigger container wake-ups.

**Independent Test**: Load Dashboard, verify free hours (12/60 hrs) header, view container lists, click power toggle on a sleeping container, and verify starting state.

### Implementation for User Story 2

- [x] T015 [P] [US2] Implement Codespaces retrieval, start, and status check service routines in `iota-bridge/src/services/codespaceService.ts`
- [x] T016 [P] [US2] Expose the status API routes and wake-up actions in `iota-bridge/src/routes/status.ts`
- [x] T017 [P] [US2] Create the Bento Card component for displaying container tiles in `iota-mobile/src/components/BentoCard.tsx`
- [x] T018 [US2] Build the Dashboard Screen component displaying the limits header in `iota-mobile/src/screens/DashboardScreen.tsx`
- [x] T019 [US2] Implement the floating bottom navigation tab bar in `iota-mobile/src/components/Navigation.tsx`

**Checkpoint**: User Stories 1 and 2 are fully integrated and functional.

---

## Phase 5: User Story 3 - Interactive Agent Terminal (Priority: P1)

**Goal**: Input natural language developer prompt commands, stream pseudo-terminal console output in real-time, and teardown active VM.

**Independent Test**: Enter Control terminal, input prompt, verify agent stdout/stderr logs stream back, navigate away, and return to find logs catching up.

### Implementation for User Story 3

- [x] T020 [P] [US3] Create shell execution loop using node-pty inside `iota-bridge/src/services/terminal.ts`
- [x] T021 [P] [US3] Integrate log streaming and input piping events `agent:start`, `agent:stop`, and `terminal:input` inside `iota-bridge/src/services/socket.ts`
- [x] T022 [P] [US3] Implement the monospaced Terminal Console display component in `iota-mobile/src/components/TerminalConsole.tsx`
- [x] T023 [US3] Build the interactive Workspace & Control Terminal screen including prompt submit text fields in `iota-mobile/src/screens/ControlScreen.tsx`

**Checkpoint**: User Stories 1, 2, and 3 are fully integrated and functional.

---

## Phase 6: User Story 4 - Pre-Flight Diff Review & Code Shipping (Priority: P2)

**Goal**: Retrieve uncommitted git modifications, display color-coded hunk diffs, configure active env vars, and commit/push branch.

**Independent Test**: Open Ship view, review file list, inspect modified lines hunk view, tap "Approve & Push", and confirm commit is on GitHub.

### Implementation for User Story 4

- [x] T024 [P] [US4] Implement git diff extractor, staging, committing, and pushing logic in `iota-bridge/src/services/git.ts`
- [x] T025 [P] [US4] Create diff and commit HTTP routes in `iota-bridge/src/routes/git.ts`
- [x] T026 [P] [US4] Build the line-by-line Hunk Diff Viewer component (+ green, - red) in `iota-mobile/src/components/DiffViewer.tsx`
- [x] T027 [US4] Build the Pre-Flight / Ship Screen component featuring targets, configuration, and commit trigger in `iota-mobile/src/screens/ShipScreen.tsx`

**Checkpoint**: All user stories are fully completed and testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: System optimization, documentation, and final validation.

- [ ] T028 Optimize local memory usage of WebGL canvas animations and clean up unused assets in `iota-mobile/src/components/ShaderGradient.tsx`
- [ ] T029 Complete end-to-end verification checklist using scenarios defined in `specs/001-iota-platform/quickstart.md`
- [ ] T030 Add complete README documentation for installing, running, and configuring both `iota-bridge/README.md` and `iota-mobile/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - blocks all user stories.
- **User Stories (Phases 3+)**: All depend on Foundational completion.
  - User Stories can run in sequence: US1 (P1) → US2 (P1) → US3 (P1) → US4 (P2).
- **Polish (Phase 7)**: Depends on completion of all stories.

### Parallel Opportunities

- All Setup tasks marked `[P]` (T002, T003, T004) can run in parallel.
- Foundational components marked `[P]` (T005, T006, T007, T008) can run in parallel.
- Independent models, helpers, and cards within User Story phases (e.g., T011, T012; T015, T016, T017; T020, T021, T022) can run in parallel.

---

## Parallel Example: User Story 2

```bash
# Developer A builds status API endpoints on the bridge:
Task: "Expose the status API routes and wake-up actions in iota-bridge/src/routes/status.ts"

# Developer B builds Bento Card presentation components in React Native:
Task: "Create the Bento Card component for displaying container tiles in iota-mobile/src/components/BentoCard.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 to 3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (blocks user journeys)
3. Complete Phase 3: User Story 1 (Auth & Launch)
4. Complete Phase 4: User Story 2 (Matrix Dashboard)
5. Complete Phase 5: User Story 3 (Interactive Agent terminal)
6. **STOP & VALIDATE**: Test complete execution loop (login -> list repo -> run remote agent).

### Incremental Delivery

1. Setup + Foundation: Infrastructure active.
2. User Story 1 (Auth): Authentication works.
3. User Story 2 (Dashboard): Container listing and wakeup works.
4. User Story 3 (Terminal): Prompt execution streams logs.
5. User Story 4 (Ship): Git diff and code committing pushes changes to GitHub.

---

## Phase 8: Convergence

- [ ] T031 Implement cleanup of injected environment credentials from memory/process env upon WebSocket disconnect or agent completion in `iota-bridge/src/services/socket.ts` per Constitution Principle I / prd: Section 5.2 (partial)
- [ ] T032 Implement repository listing REST endpoint and client FAB flow to provision a new Codespace from a list of user repositories in `iota-bridge/src/services/codespaceService.ts` and `iota-mobile/src/screens/DashboardScreen.tsx` per FR-002 / prd: Section 4.2 (missing)
- [ ] T033 Implement VM teardown/stop API endpoint and wire up the "TEAR DOWN VM" button in the Control screen in `iota-bridge/src/routes/status.ts` and `iota-mobile/src/screens/ControlScreen.tsx` per FR-003 / prd: Section 4.3 (partial)
- [ ] T034 Implement tracking of environment changes and the "Revert / Try Again" action flow to discard unstaged/staged git changes in `iota-bridge/src/services/git.ts` and `iota-mobile/src/screens/ShipScreen.tsx` per FR-005 / FR-006 / prd: Section 4.4 (missing)
- [ ] T035 Implement semi-transparent dark surface overlay Android fallback style for glassmorphic backdrop blurs in `iota-mobile/src/components/Navigation.tsx` and custom card components per Constitution Principle II / prd: Section 3.2 (missing)
- [ ] T036 Load Inter and Geist Mono fonts asynchronously via `expo-font` in `iota-mobile/App.tsx` and apply tight letter spacing adjustments per prd: Section 3.1 (missing)
