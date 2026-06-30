# Tasks: Terminal & OpenCode Integration

**Input**: Design documents from `/specs/003-terminal-opencode-integration/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Export git utilities in iota-bridge/src/services/git.ts to support dynamic branch/repo status checks

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Implement dynamic opencode installation checking and git repo/branch info in iota-bridge/src/routes/status.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - OpenCode Installation & Checking (Priority: P1) 🎯 MVP

**Goal**: Check if OpenCode is installed on the bridge VM, display the status to the user, and support installing it from the Control Screen with terminal streaming.

**Independent Test**: Connect to a Codespace VM where `opencode` is not installed. Verify the UI displays "OpenCode Not Installed" and includes an "Install OpenCode" shortcut. Tapping the shortcut spawns the `npm install -g opencode-ai` process and streams live installation output. After success, status updates to "OpenCode Installed".

### Implementation for User Story 1

- [x] T003 [P] [US1] Support install-opencode command execution in iota-bridge/src/services/terminal.ts
- [x] T004 [US1] Implement OpenCode installation check and UI options/shortcuts in iota-mobile/src/screens/ControlScreen.tsx

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Persistent Session & Interactive Text Input (Priority: P1)

**Goal**: Route user prompt messages directly to the active terminal process stdin using `terminal:input` socket events if running, rather than spawning new processes. Remove text message cards above the terminal.

**Independent Test**: Connect to the codespace terminal. Type "Hi" and verify that it feeds into the stdin of the running terminal PTY process. Verify that subsequent typed inputs also go directly to the same session without spawning new processes, and that no user message cards appear above the terminal.

### Implementation for User Story 2

- [x] T005 [P] [US2] Update iota-bridge/src/services/terminal.ts to run opencode command and feed initial prompts to stdin
- [x] T006 [US2] Update iota-mobile/src/screens/ControlScreen.tsx to send text inputs to active terminal PTY stdin via socket and hide message cards above terminal

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Fully Scrollable Terminal Console (Priority: P2)

**Goal**: Redesign the mobile client screen container layout to use a non-scrollable flex: 1 View instead of a ScrollView. Maximize TerminalConsole layout heights to support full vertical and horizontal scrollability without parent scroll conflicts or layout collapses.

**Independent Test**: Run a command in the terminal that outputs many lines and wide content. Verify that the terminal console remains fully visible and allows scrolling vertically and horizontally smoothly.

### Implementation for User Story 3

- [x] T007 [US3] Redesign container layout in iota-mobile/src/screens/ControlScreen.tsx to use flex: 1 View instead of ScrollView
- [x] T008 [P] [US3] Maximize layout dimensions of TerminalConsole in iota-mobile/src/components/TerminalConsole.tsx

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T009 Run quickstart.md validation to verify all scenarios work end-to-end
- [ ] T010 Perform code cleanup and verification of console styling

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1): Can start after Phase 2 completes
  - User Story 2 (P2): Can start after Phase 2 completes, can integrate with US1
  - User Story 3 (P3): Can start after Phase 2 completes, can integrate with US1/US2
- **Polish (Final Phase)**: Depends on all user stories being complete

### Parallel Opportunities

- T003 (US1) and T005 (US2) can be worked on in parallel in the backend bridge code.
- T008 (US3) can be worked on in parallel with mobile UI tasks.

---

## Parallel Example: User Story 1

```bash
# Work on backend bridge installation support:
Task: "Support install-opencode command execution in iota-bridge/src/services/terminal.ts"

# Work on mobile UI status checks:
Task: "Implement OpenCode installation check and UI options/shortcuts in iota-mobile/src/screens/ControlScreen.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational -> Foundation ready
2. Add User Story 1 -> Test independently -> Deploy/Demo (MVP!)
3. Add User Story 2 -> Test independently -> Deploy/Demo
4. Add User Story 3 -> Test independently -> Deploy/Demo
5. Each story adds value without breaking previous stories
