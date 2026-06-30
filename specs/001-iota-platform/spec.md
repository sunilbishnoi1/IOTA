# Feature Specification: IOTA Mobile Client & Cloud Agent Control

**Feature Branch**: `001-iota-platform`

**Created**: 2026-06-24

**Status**: Draft

**Input**: User description: "lets create a prd.md for iota platform. we need to pretty much stick to the UI designs in the UI folder it currently has design in html but we need to take this UI as inspiration and replicate it for our react native app with some fixes whereever required. cross-platform framework: React Native (TypeScript / Expo). communication: WebSocket/REST API Server on Codespace. authentication: GitHub Device Flow. agent provisioning: Dynamic Installation in Codespace. credential handling: Store on Mobile + Inject dynamically."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Setup and Authentication (Priority: P1)

A developer downloads and launches the IOTA app on their mobile device. They are greeted by an ultra-premium dark landing screen with a dynamic background. They tap "Authenticate via GitHub". The app displays a short, readable activation code on-screen and redirects the developer to the GitHub login portal. Once they authorize the app and return, they are successfully logged in and directed to the dashboard.

**Why this priority**: Gateway capability. Secure identity establishment is required before interacting with GitHub repositories or Codespaces.

**Independent Test**: Can launch the app from a clean slate, click the button to trigger the device code request, complete authorization on GitHub, and verify that the app transitions to the dashboard screen.

**Acceptance Scenarios**:

1. **Given** the app is not authenticated, **When** the developer taps the GitHub Authentication button, **Then** a secure device-flow code is displayed and the user is directed to the login URL.
2. **Given** a user has authorized the code on GitHub, **When** the app polls or receives the access token, **Then** the local session is initialized and the app displays the container dashboard.

---

### User Story 2 - Container Matrix Dashboard (Priority: P1)

An authenticated developer opens the app to manage their dev environments. The dashboard lists all configured repository containers, their current status (Active vs. Sleeping), and details on the developer's remaining GitHub Codespace free hours. The developer can tap a button to wake up a sleeping environment, which initiates container startup in the cloud.

**Why this priority**: Essential to select and prepare the environment before triggering code changes.

**Independent Test**: Load the dashboard, see the container list, click the power button on a sleeping container, and verify that its state updates to "active".

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded, **When** the codespace status is retrieved, **Then** the remaining free compute hours (e.g., "12 / 60 hrs free") are visible at the top.
2. **Given** a container in the list is sleeping, **When** the developer clicks the power icon, **Then** the app sends a wakeup request and displays a transition state indicating the VM is booting.

---

### User Story 3 - Interactive Agent Terminal (Priority: P1)

The developer navigates into an active environment's workspace. They select the target repository branch, then type a natural language instruction (e.g., "Fix styling on the primary submit button"). Upon submission, the app displays a live-streaming, monospaced terminal output showing the remote agent's commands, actions, and current thinking, giving the developer complete visibility into the remote workspace.

**Why this priority**: Core value of the platform. Allows hands-free execution of code instructions on a remote server.

**Independent Test**: Submit a development command from the prompt input and check that logs stream back in real-time.

**Acceptance Scenarios**:

1. **Given** an active codespace session, **When** the developer enters a prompt and submits it, **Then** the command is processed by the remote agent and output logs stream to the terminal console.
2. **Given** a running command, **When** the developer navigates away and returns, **Then** the terminal reconnects and streams the remaining logs.

---

### User Story 4 - Pre-Flight Diff Review & Code Shipping (Priority: P2)

The remote agent has completed the requested task. The app notifies the developer, who opens the "Ship" screen to review the changes. The developer views a high-fidelity visual code diff displaying added and deleted lines. They can verify target environments, inspect configuration modifications, and click a single confirmation button to commit and push the work to GitHub.

**Why this priority**: Essential to finalize and commit the edits safely without needing a computer.

**Independent Test**: Review the list of modified files, inspect the hunk diff view, click "Approve & Push", and confirm the branch is pushed to GitHub.

**Acceptance Scenarios**:

1. **Given** modified files in the codespace, **When** the developer views the Ship screen, **Then** a visual list of altered files is presented with color-coded diff hunks (+ green, - red).
2. **Given** a reviewed diff, **When** the developer taps the "Approve & Push" button, **Then** the app triggers the git commit/push flow on the remote codespace, showing a success state when completed.

---

### Edge Cases

- **Compute Hour Depletion**: If the user's free GitHub Codespace hours are fully depleted, the app must show a descriptive modal explaining the limit and block VM startup.
- **Connection Interruption**: If the network connection drops during a long-running agent command, the app should automatically attempt reconnection. When reconnected, it must catch up on the logs since the disconnect.
- **Credential Safety**: If a session ends, any injected credentials (such as external LLM API keys) must be instantly wiped from the remote Codespace VM's memory and environment.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support authenticating the user via the GitHub Device Flow protocol directly on the mobile app.
- **FR-002**: The system MUST display a container dashboard showing a list of repositories, active/sleeping status, and remaining monthly free hours.
- **FR-003**: The system MUST allow users to trigger container power-on (wake up) and power-off (tear down) cycles.
- **FR-004**: The system MUST support a terminal interface that streams real-time logs from remote command executions.
- **FR-005**: The system MUST display side-by-side or line-by-line diff views highlighting additions and deletions in modified files.
- **FR-006**: The system MUST support committing changes with a message and pushing the branch back to GitHub.
- **FR-007**: The system MUST support secure mobile-side credential storage (keys never saved to the remote disk, only injected to environment memory during active runs).
- **FR-008**: The system MUST dynamically verify and install missing CLI coding agents on the remote codespace workspace.

### Key Entities

- **User Session**: Contains authentication credentials, token details, and compute budget limits.
- **Codespace Container**: Represents the remote virtual machine executing the tasks, containing repository information, branch, and status.
- **Agent Job**: Represents a specific execution sequence initiated by a user prompt, tracking log streams, process IDs, and generated file changes.
- **File Diff**: Represents the modifications made to a specific file, highlighting added and removed sections.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can authenticate and access the dashboard in under 15 seconds from launching the application.
- **SC-002**: Container wakeup requests should connect and start streaming logs in under 10 seconds.
- **SC-003**: Network reconnection takes under 2 seconds to recover active log streams.
- **SC-004**: 100% of LLM API keys are deleted from the remote VM's process environment once the active agent job completes.

## Assumptions

- Users have a GitHub account eligible for free Codespace hours.
- The mobile device maintains a reasonably stable internet connection for WebSocket communication.
- The remote codespace can expose a port for WebSocket/REST API access using GitHub's port-forwarding mechanism.
- The local device has secure hardware-backed storage capabilities (e.g., SecureStore/Keychain) for saving keys.
