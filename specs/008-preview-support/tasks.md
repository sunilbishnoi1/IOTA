# Tasks: Inbuilt React Native Expo Go & Web Preview Support

**Input**: Design documents from `/specs/008-preview-support/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/websocket.md

**Tests**: Tests are required per the specification and implementation plan (Jest tests for both bridge and client).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Bridge Backend**: `iota-bridge/src/`, `iota-bridge/tests/`
- **Mobile Client**: `iota-mobile/src/`, `iota-mobile/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic configurations

- [ ] T001 Create project configuration file at .iota/preview.json defining default servers for Expo and web previews

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Create type definitions for the preview config and dynamic process states in iota-bridge/src/types/preview.ts
- [ ] T003 Implement the preview subprocess and port visibility management engine in iota-bridge/src/services/previewService.ts
- [ ] T004 Integrate preview WebSocket events (`preview:start`, `preview:stop`, `preview:status_request`) in iota-bridge/src/services/socket.ts
- [ ] T005 [P] Create unit and integration tests for the backend preview service in iota-bridge/tests/services/preview.test.ts
- [ ] T006 [P] Implement client-side WebSocket communication layer for preview actions and event listeners in iota-mobile/src/services/preview.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - React Native Expo Go Native Preview (Priority: P1) 🎯 MVP

**Goal**: Enable native previews of React Native Expo apps via Expo Go using QR codes and deep links.

**Independent Test**: Trigger "Start Preview" on an Expo project, verify the QR code and deep-link button appear, tap the button to launch Expo Go, and see Metro live logs in the terminal.

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create scrollable, performance-optimized terminal log component using FlatList in iota-mobile/src/components/control/PreviewTerminal.tsx
- [ ] T008 [P] [US1] Create QR code and deep-link launcher button component in iota-mobile/src/components/control/PreviewExpoGo.tsx
- [ ] T009 [US1] Create main preview panel container component in iota-mobile/src/components/control/PreviewPanel.tsx
- [ ] T010 [US1] Modify ControlScreen to toggle between chat timeline and PreviewPanel in iota-mobile/src/screens/ControlScreen.tsx
- [ ] T011 [US1] Implement mobile client tests for PreviewPanel and subcomponents in iota-mobile/tests/screens/PreviewScreen.test.tsx

**Checkpoint**: User Story 1 (Expo Go Native Preview) is fully functional and testable independently

---

## Phase 4: User Story 2 - Inbuilt Web Preview (Priority: P1)

**Goal**: Render web application previews inside an embedded WebView.

**Independent Test**: Load a web project configuration, start the preview, and verify the embedded WebView renders the homepage.

### Implementation for User Story 2

- [ ] T012 [P] [US2] Create embedded WebView renderer and navigation bar component in iota-mobile/src/components/control/PreviewWebView.tsx
- [ ] T013 [US2] Update PreviewPanel to render PreviewWebView for web types in iota-mobile/src/components/control/PreviewPanel.tsx
- [ ] T014 [US2] Add web preview and navigation actions tests in iota-mobile/tests/screens/PreviewScreen.test.tsx

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Flutter Web and Custom URL Mobile Previews (Priority: P2)

**Goal**: Provide fallback support for Flutter Web and custom deep links.

**Independent Test**: Start Flutter Web preview and verify it loads in the client WebView.

### Implementation for User Story 3

- [ ] T015 [US3] Enhance bridge preview subprocess manager to handle Flutter Web execution modes in iota-bridge/src/services/previewService.ts
- [ ] T016 [US3] Enhance PreviewPanel to support custom URL scheme deep linking fallback in iota-mobile/src/components/control/PreviewPanel.tsx

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T017 Handle missing Expo Go application errors and show download modal in iota-mobile/src/components/control/PreviewExpoGo.tsx
- [ ] T018 Handle WebSocket disconnection and recovery with reconnect option in iota-mobile/src/components/control/PreviewPanel.tsx
- [ ] T019 Run complete TypeScript compilation/error checks using npm run typecheck in both iota-mobile/ and iota-bridge/
- [ ] T020 Run and verify all Jest tests pass in iota-bridge/ and iota-mobile/

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1 - MVP) is the primary target and blocks secondary features.
  - User Story 2 (P1) is independent of US1 but requires the foundation.
  - User Story 3 (P2) builds on the WebView components from US2.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### Within Each User Story

- UI components can be developed in parallel before integration.
- Integrating components with the parent screen depends on the individual component completion.
- Unit and integration tests verify the component functionality.

### Parallel Opportunities

- Foundational test file creation (`T005`) and service communication layer (`T006`) can be written in parallel.
- US1 UI subcomponents `PreviewTerminal` (`T007`) and `PreviewExpoGo` (`T008`) can be implemented in parallel.
- Web WebView UI component `PreviewWebView` (`T012`) can be created in parallel with US1 work.

---

## Parallel Example: User Story 1

```bash
# Implement components independently:
Task: "Create scrollable, performance-optimized terminal log component using FlatList in iota-mobile/src/components/control/PreviewTerminal.tsx"
Task: "Create QR code and deep-link launcher button component in iota-mobile/src/components/control/PreviewExpoGo.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently on device/emulator
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently (MVP!)
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Apply polish and compile verification checks.
