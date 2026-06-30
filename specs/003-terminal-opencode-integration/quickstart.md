# Quickstart Validation Guide: Terminal & OpenCode Integration

This guide details runnable verification scenarios to validate that the OpenCode installation check, persistent session input, and scrollable terminal rendering work correctly.

## Prerequisites
1. Remote Codespace running on Linux (or local development machine).
2. Mobile application running (or Expo emulator).

## Verification Scenarios

### Scenario 1: Clean Connection & OpenCode Status Check
1. Start the IOTA bridge server:
   ```bash
   cd iota-bridge
   npm run dev
   ```
2. Start the mobile client:
   ```bash
   cd iota-mobile
   npm run start
   ```
3. Navigate to **Control Screen** (Mission Control) for a connected active codespace.
4. Verify that:
   - The status bar displays either "OpenCode Installed" or "OpenCode Not Installed".
   - The select active agent buttons row is hidden.
   - If OpenCode is not installed, the shortcut list displays "Install OpenCode".

### Scenario 2: Installing OpenCode via Terminal
1. Under the "Not Installed" state, tap the **Install OpenCode** button in the shortcuts bar (or the central screen button).
2. Verify that:
   - The terminal console opens.
   - Live installation logs of `npm install -g opencode-ai` (or curl installation) stream into the terminal console.
   - Once the installation finishes with exit code `0`, the status banner automatically updates to indicate OpenCode is now installed.

### Scenario 3: Persistent Terminal Input & Session
1. With OpenCode installed, type a message (e.g. `Hi`) in the bottom text box and tap Send.
2. Verify that:
   - An interactive terminal session starts.
   - The first prompt is written to the terminal stdin.
   - No user message card is displayed above the terminal.
3. Type a follow-up message (e.g. `list files`) and tap Send.
4. Verify that:
   - The input is fed directly into the existing terminal stdin.
   - No new process is spawned.
   - The output of the agent displays interactively.

### Scenario 4: Full Terminal Scrollability
1. Run a command in the terminal that outputs many lines and wide tables (e.g. `git log` or `npm list`).
2. Verify that:
   - You can scroll vertically to see previous commands and outcomes.
   - Long lines can be scrolled horizontally without truncation or distortion.
