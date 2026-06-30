# Feature Specification: Inbuilt React Native Expo Go & Web Preview Support

**Feature Branch**: `008-preview-support`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "add support for inbuilt react native expo go mobile app preview support, focus on react native expo go mobile app because i want to start using our own app IOTA to build itself using the mobile app so for that i need to preview it. while in future or now (whenever feasible) i want to add support for web preview as well as support for other types of mobile apps (flutter). also no need for auto-tear-down of ports/servers as codespaces go to sleep anyway, and no need to complicate UX by giving warnings"

## Clarifications

### Session 2026-06-28

- Q: When starting a preview, if the requested port is already occupied, how should the bridge handle the collision? → A: Automatically kill any process occupying the target port before starting the server.
- Q: When a user overrides the auto-detected preview command or port, how should these custom configuration overrides be persisted? → A: Workspace configuration file (saved on the remote VM workspace, e.g., in `.config/preview.json`, folder name needs to be figured out, maybe .iota/).
- Q: Should the console output of the running preview server process be streamed in real-time to the mobile client, or is it sufficient to display them only in the event of a crash/failure? → A: Real-time streaming via WebSockets to a collapsible log pane with a copy logs button in the preview interface.
- Q: When the mobile client disconnects, should the bridge immediately terminate the running preview server, or let it continue running? → A: Keep running in the background until the user explicitly stops it via the UI, or until the Codespace itself hibernates.
- Q: In monorepos or multi-package workspaces, how should the bridge determine the working directory (cwd) in which to execute the preview command? → A: Configurable via settings file (.config/preview.json, folder name needs to be figured out, maybe .iota/) auto-generated or updated by the AI agent, allowing multiple servers and custom execution directories.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - React Native Expo Go Native Preview (Priority: P1)

A developer using the IOTA mobile app wants to see a native preview of the React Native Expo app they are building (including IOTA itself). They navigate to the preview pane, check the preview command (defaulting to `npx expo start`), and tap "Start Preview". The remote `iota-bridge` runs the Metro server and configures the codespace Metro port (8081) as public. The mobile app renders:
- A "Open in Expo Go" button.
- A QR code representing the bundler URL.

When the developer taps the button, IOTA uses deep-linking to launch the Expo Go app installed on the same device, which loads and runs the project. The preview hot-reloads instantly when the developer commands IOTA to modify the code.

**Why this priority**: Core MVP capability. Allows mobile-first developers to build, edit, and instantly test React Native / Expo apps directly on their device using standard Expo Go sandboxing.

**Independent Test**: Trigger "Start Preview" on an Expo project, verify the QR code and button appear on-screen, tap the button, and ensure it launches Expo Go and successfully compiles/runs the app bundle.

**Acceptance Scenarios**:

1. **Given** the active project is an Expo React Native app, **When** the developer starts the preview, **Then** the remote Metro server is spawned, the port is set to public, and the client displays a QR code and deep-link button mapping to `exps://<codespace-domain>-8081.app.github.dev`.
2. **Given** the preview is active on the same mobile device, **When** the developer taps "Open in Expo Go", **Then** the Expo Go app is launched and loads the app bundle.
3. **Given** the preview is active on an external device (tablet or second phone), **When** the developer scans the displayed QR code with their camera, **Then** it prompts to open the app in Expo Go.

---

### User Story 2 - Inbuilt Web Preview (Priority: P1)

A developer is building a web application (e.g. Vite, Next.js, or HTML static site) and wants to preview changes directly inside IOTA. They select the web preview command (e.g. `npm run dev`) and tap "Start Preview". The remote bridge spawns the dev server, makes the target port (e.g. 3000, 5173) public, and streams the URL to the client. IOTA renders an embedded WebView directly within the app's interface. As the developer instructs IOTA to change files, the remote dev server hot-reloads and the inbuilt WebView instantly displays the updated web app.

**Why this priority**: Extremely high-fidelity DX. Allows the user to stay entirely inside IOTA while writing code and seeing the result side-by-side or via a simple tab switch.

**Independent Test**: Load a web project, start the preview, verify the embedded WebView renders the homepage, make a code change via the agent, and confirm that the change is instantly reflected in the WebView.

**Acceptance Scenarios**:

1. **Given** the active project is a web project, **When** the developer starts the preview, **Then** the remote dev server starts, the port is set to public, and the IOTA app displays an embedded WebView showing the homepage.
2. **Given** the inbuilt WebView is active, **When** code is modified and saved, **Then** the hot-reloading mechanism of the underlying dev server triggers and updates the WebView UI without page reload.
3. **Given** the WebView is loading or running, **When** the user wants to reload, **Then** they can tap an in-app reload button in the preview control bar.

---

### User Story 3 - Flutter Web and Custom URL Mobile Previews (Priority: P2)

A developer wants to preview a Flutter app. Since native Flutter debug runs cannot be dynamically sideloaded into an existing app runtime, the developer configures Flutter to run in web mode (`flutter run -d web` on port 8080). The system starts the dev server and forwards port 8080 as public. The IOTA app renders the Flutter Web app inside the inbuilt WebView. For projects that have specific custom app scheme players, the developer can also type in custom URL schemes (like `customapp://`) to deep link manually.

**Why this priority**: Provides a standard fallback for other cross-platform frameworks (Flutter, etc.) and native architectures, utilizing web technology to provide in-app preview experiences.

**Independent Test**: Start a Flutter preview in web mode, confirm the bridge hosts the Flutter Web app, and check that the inbuilt WebView loads the Flutter UI.

**Acceptance Scenarios**:

1. **Given** a Flutter project, **When** the developer starts the preview in Web mode, **Then** the bridge spawns the Flutter Web server, makes the port public, and the client WebView loads the app.
2. **Given** any generic project, **When** a custom preview script is configured, **Then** the bridge runs it, and the client displays the generated public URL for browser or WebView preview.

---

### Edge Cases

- **Expo Go Not Installed**: If the developer taps "Open in Expo Go" but the app is not installed, the OS will fail to open the URL. The app should catch this failure and display a modal with download links for iOS/Android stores.
- **Port Collision**: If the target port (e.g., 8081 or 3000) is already occupied, the bridge must automatically terminate the existing process bound to that port before starting the preview server.
- **Codespace Hibernation / Network Drop**: If the Codespace VM goes to sleep or connection drops, the preview will stop working. The app must detect the socket disconnection, stop the preview UI state, and offer a simple "Reconnect & Restart Dev Server" button.
- **Process Terminated Unexpectedly**: If the background dev server crashes due to a syntax error or runtime panic, the bridge must notify the client via a socket event, changing the status to "crashed" and showing the detailed, live-streamed log output in the terminal/log pane.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support spawning remote preview/dev server commands (`expo start`, `npm run dev`, etc.) as background processes on the remote codespace bridge using Node.js child-process spawning rules (Windows vs Unix compatibility).
- **FR-002**: The bridge MUST automatically toggle the target port's visibility to `public` (using the `gh codespace` CLI/API or equivalent configuration) to allow the physical mobile device to fetch assets without authentication issues.
- **FR-003**: The mobile client MUST display a QR code of the public preview URL for easy scanning on secondary devices.
- **FR-004**: The mobile client MUST support a deep-linking action to launch Expo Go (`exps://` or `exp://`) when previewing Expo applications.
- **FR-005**: The mobile client MUST render an inbuilt WebView (`react-native-webview`) for standard web and web-mode mobile applications.
- **FR-006**: The bridge MUST track running preview processes and support terminating them when the preview session is stopped by the user. It MUST NOT terminate processes on WebSocket disconnection, allowing the server to persist in the background until the Codespace hibernates or the user explicitly stops it.
- **FR-007**: The system MUST support declarative preview server configurations in `.specify/preview.json` (auto-detected and managed by the AI agent, or manually updated by the user), defining the execution directory `cwd`, launch `command`, target `port`, and `type` (e.g., web, expo-go).
- **FR-008**: The bridge MUST stream stdout and stderr from the spawned preview server subprocess to the mobile client in real-time via WebSocket events.
- **FR-009**: The mobile client MUST display a collapsible, scrollable terminal/log pane within the preview interface to show the streamed console output.

### Key Entities

- **Preview Process**: Tracks a spawned background CLI process (command, PID, status: starting/running/stopped/crashed, target port).
- **Preview Configuration**: Contains the launch script command, target port, and preview type (Web vs Expo Deep Link). Custom configuration overrides are persisted in the workspace configuration file at `.specify/preview.json`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Launching a preview starts the remote process and generates the public URL within 5 seconds.
- **SC-002**: Tapping the "Open in Expo Go" button triggers the app switch to Expo Go in under 1 second.
- **SC-003**: Changes to code files are compiled and hot-reloaded in the web preview WebView or Expo Go within 3 seconds of file save.
- **SC-004**: The preview server processes are successfully killed on the bridge within 1 second of the user explicitly stopping the preview.

## Assumptions

- The project workspace runs inside a GitHub Codespace where the `gh` command-line utility is authenticated and available to modify port visibility.
- The user's mobile device is connected to the internet and has access to public GitHub Codespaces domains.
- The user has Expo Go installed on their mobile device if they intend to run React Native native previews.
- Custom security rules or corporate VPNs on the developer's phone do not block WebSocket connections to codespaces or raw asset fetches from public codespace URLs.
