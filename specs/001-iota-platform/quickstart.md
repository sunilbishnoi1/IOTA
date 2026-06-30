# Quickstart & Verification Guide: IOTA Platform

This guide outlines the environment setup and manual verification workflows to test and prove the IOTA platform functionalities end-to-end.

---

## 1. Prerequisites

### Local Mobile Environment
- Node.js (v20+) and npm/yarn installed.
- Expo Go app installed on an iOS/Android device, or an iOS Simulator/Android Emulator running locally.
- Git access with active GitHub credentials.

### Remote Codespace environment
- A GitHub Codespace container active.
- Access to the internet for the bridge server to query the GitHub API.

---

## 2. Setup Commands

### Step A: Start the Bridge Server (inside Codespace)
1. Navigate to the bridge directory:
   ```bash
   cd iota-bridge
   npm install
   ```
2. Set up environment config variables in `.env` if needed:
   ```bash
   PORT=4000
   ```
3. Boot the server:
   ```bash
   npm run dev
   ```
   *Expected outcome*: Terminal logs indicate the bridge is listening on port 4000 and waiting for WebSocket handshakes.
4. Expose the port in Codespace and set port visibility to Private (standard port forwarding).

### Step B: Start the Mobile Client (locally)
1. Navigate to the mobile app directory:
   ```bash
   cd iota-mobile
   npm install
   ```
2. Start the Expo packager:
   ```bash
   npx expo start
   ```
3. Scan the QR code with your mobile camera (iOS) or Expo Go app (Android) to load the application.

---

## 3. End-to-End Verification Scenarios

### Scenario 1: GitHub Device Flow Login
1. Launch the mobile app.
2. Tap "Authenticate via GitHub".
3. **Verify**: A 10-character alphanumeric code appears on the mobile screen.
4. Open the displayed URL (`github.com/login/device`) on a browser and enter the code.
5. Grant permissions and click authorize.
6. **Verify**: The mobile app instantly transitions from the login view to the repository matrix dashboard, displaying your user avatar and name.

---

### Scenario 2: Container Matrix Dashboard & Wake Up
1. On the dashboard, locate a container marked "sleeping".
2. Tap the power toggle button on the card.
3. **Verify**: The card transitions to a spinning starting state.
4. **Verify**: Once the codespace resumes, the card transitions to "Active" showing green status indicators and active git details.

---

### Scenario 3: Real-Time terminal Log Streaming
1. Tap on the active container to enter the Terminal Control View.
2. Input a coding prompt: `Create a simple hello-world.txt file in the root directory.` and tap submit.
3. **Verify**: The terminal outputs raw stream logs from the CLI agent execution.
4. Navigate back to the Dashboard, then click on the terminal session again.
5. **Verify**: The logs are retrieved from the cache and catch up to show current agent progress.

---

### Scenario 4: Diff Review & Ship
1. Once the agent task finishes, navigate to the "Ship" screen.
2. **Verify**: `hello-world.txt` is listed in the changed files section.
3. Tap on the file to view the line diff.
4. **Verify**: The addition line `+ Hello World!` is displayed in green text.
5. Tap "Approve & Push to Main".
6. **Verify**: The action button transitions to a spinning loader, and then resolves to "Pushed Successfully".
7. Verify on GitHub that the commit is active in the repository history.
