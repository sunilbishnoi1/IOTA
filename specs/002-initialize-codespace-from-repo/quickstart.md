# Quickstart & Verification Guide: Codespace VM Initialization

This guide explains how to verify repository listing, provisioning, and dynamic URL socket routing.

---

## 1. Setup

### Step A: Run the Bridge Server
1. Navigate to the bridge directory:
   ```bash
   cd iota-bridge
   npm run dev
   ```

### Step B: Run the Mobile Client
1. Navigate to the mobile app directory:
   ```bash
   cd iota-mobile
   npm run start
   ```

---

## 2. Verification Scenarios

### Scenario 1: Fetching & Searching Repositories
1. Authenticate with GitHub on the mobile app.
2. Tap the "+" FAB button on the dashboard.
3. **Verify**: A bottom sheet or screen appears containing your actual GitHub repositories.
4. Type in the search box to filter the list.

### Scenario 2: Provisioning a New Codespace
1. In the repository list, tap on a repository (e.g. `sunilbishnoi1/IOTA`).
2. Tap "Create Codespace".
3. **Verify**: The repository list sheet closes, and a new Codespace card appears on the dashboard in the `starting`/`provisioning` state.
4. **Verify**: Once the Codespace is provisioned, the status changes to `active` (or `sleeping` depending on response).

### Scenario 3: Dynamic Port Forward Socket Connection
1. Tap on the newly created active codespace card.
2. **Verify**: The client resolves the dynamic address `https://<codespace-name>-3000.app.github.dev` and connects the WebSocket.
3. Submit a command in the terminal prompt.
4. **Verify**: Logs stream back in real-time.
