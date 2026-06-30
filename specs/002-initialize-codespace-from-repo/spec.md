# Feature Specification: Initialize Codespace VM from GitHub Repo

**Feature Branch**: `002-initialize-codespace-from-repo`

**Created**: 2026-06-24

**Status**: Draft

**Input**: User description: "currently it is running through the local ioto-bridge server instead of actually initializing the codespace vm into one of the users actual github repo (instead of local repos). So i want to first implement this before other remaining tasks from d:\Desktop\codes\IOTA\specs\001-iota-platform\tasks.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repository Listing & Selection (Priority: P1)

An authenticated developer opens the IOTA mobile app and decides to start a new work environment. On the Container Matrix dashboard, they click the Floating Action Button (FAB) labeled "+". The app displays a list of their actual GitHub repositories fetched in real-time. The developer can search through their repositories, select a target repository, and see its default branch.

**Why this priority**: Core gateway scenario to enable working on actual user repositories.
**Independent Test**: Click the "+" button, search for a real repository (e.g. `sunilbishnoi1/IOTA`), select it, and see it highlighted.

**Acceptance Scenarios**:
1. **Given** the user is authenticated, **When** they tap the "+" FAB button on the dashboard, **Then** a list of their GitHub repositories is retrieved and displayed.
2. **Given** the repository list is visible, **When** the developer types in the search bar, **Then** the list is filtered to match the query.

---

### User Story 2 - Provisioning Codespace VM (Priority: P1)

The developer selects a repository from the list and taps "Create Codespace". The app requests the bridge server (acting as an orchestrator) to create a new Codespace on GitHub. The dashboard shows a new container card with a loading spinner, transitioning through `provisioning` -> `starting` -> `active`.

**Why this priority**: Required to initialize a real VM in the cloud for the selected codebase.
**Independent Test**: Choose a repository, tap "Create Codespace", and verify a new codespace is successfully provisioned and listed on the dashboard.

**Acceptance Scenarios**:
1. **Given** a selected repository, **When** the developer taps "Create Codespace", **Then** the application triggers the GitHub Codespaces creation API.
2. **Given** a codespace creation request is successful, **When** the status is polled, **Then** the dashboard card updates to show the provisioning status in real-time.

---

### User Story 3 - Dynamic Connection & Remote Execution (Priority: P1)

Once the Codespace VM status becomes "active", the developer taps the container card. The mobile app dynamically constructs the port-forwarded URL of the codespace (e.g. `https://<codespace-name>-3000.app.github.dev`) and initiates the WebSocket connection directly to the bridge server running on that VM. All subsequent terminal logs, agent prompt commands, and git diff/commit actions are performed inside the Codespace VM's workspace (`/workspaces/<repo-name>`).

**Why this priority**: Ensures commands and git operations run on the remote VM where the codebase resides, rather than on the local development machine.
**Independent Test**: Select an active codespace, type a command in the terminal prompt, submit it, and verify that the logs stream from the remote Codespace VM and execute in the context of the repository's workspace.

**Acceptance Scenarios**:
1. **Given** an active codespace is selected, **When** the terminal screen loads, **Then** the mobile client connects directly to the port-forwarded URL of that Codespace VM.
2. **Given** a terminal command is submitted, **When** the agent starts, **Then** the process is executed with the current working directory set to `/workspaces/<repository-name>`.

---

### Edge Cases

- **Rate Limits and Creation Errors**: If the user has reached the maximum allowed active Codespaces on their GitHub account, the creation API will fail. The app must display a clear error message explaining the limit.
- **Connection Interruption / DNS Propagation Delay**: When a new Codespace is first created, its DNS name might take a few seconds to resolve. The mobile client must implement a retry connection strategy.
- **Bridge Startup on Custom Repositories**: If the user provisions a codespace on a repository that doesn't pre-install the bridge server, the connection will fail. The system must support automatic installation/startup via a global devcontainer feature or a fallback setup script.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST fetch and list the user's actual GitHub repositories using the GitHub API.
- **FR-002**: The system MUST allow the user to trigger the creation of a new GitHub Codespace for any selected repository.
- **FR-003**: The mobile client MUST dynamically resolve the bridge server URL based on the active codespace's name (e.g. `https://<codespace-name>-3000.app.github.dev`).
- **FR-004**: The system MUST establish socket connections directly to the port-forwarded address of the active Codespace VM.
- **FR-005**: The bridge server MUST execute terminal commands and git operations inside the repository workspace path (`/workspaces/<repository-name>`) on the remote VM.

### Key Entities

- **GitHub Repository**: A remote repository on GitHub owned by or accessible to the user.
- **Codespace VM**: The virtual machine container provisioned by GitHub, running the bridge server and housing the repository workspace.
- **Dynamic Connection**: The WebSockets/REST channel established directly between the mobile client and the port-forwarded interface of the Codespace.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The list of repositories is retrieved and rendered on the mobile device in under 3 seconds under normal network conditions.
- **SC-002**: The application can successfully provision and transition a codespace from draft to starting state in under 8 seconds.
- **SC-003**: 100% of terminal commands are executed within the target repository workspace `/workspaces/<repo-name>` instead of the local server environment.

## Assumptions

- The user has a GitHub account with active Codespace benefits.
- The user's OAuth token has sufficient scopes (`codespace`, `repo`) to list, create, and manage codespaces.
- The Codespace VM configuration exposes port 3000 to public or allows access with authenticating headers.
