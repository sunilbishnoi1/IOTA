# Quickstart: OpenCode Control Chat Fixes

This guide documents validation scenarios to prove that the OpenCode control chat fixes function correctly end-to-end.

## Prerequisites
- OpenCode CLI installed in your environment.
- The `iota-bridge` dependency installation complete.

---

## Scenario 1: Streaming Output Validation
Verify that OpenCode streaming outputs (including nested JSON structures) parse and display in real-time.

1. **Setup**:
   - Start the bridge server:
     ```bash
     cd iota-bridge
     npm run dev
     ```
2. **Execute**:
   - Open the mobile application and connect to the bridge.
   - Submit the prompt: `Show a short greeting`
3. **Expected Outcome**:
   - The assistant bubble appears immediately in a "thinking" state.
   - Real-time text streams in smoothly as it is received from OpenCode.
   - The assistant bubble finishes successfully without hitting the first output timeout.

---

## Scenario 2: Consolidated Run Status & Overwrite
Verify that intermediate lifecycle events update a single status block rather than spamming the history.

1. **Execute**:
   - Submit the prompt: `Check git status`
2. **Expected Outcome**:
   - Watch the chat history during execution.
   - You should only see a single status block that updates in place (e.g. *Checking OpenCode warm server...* -> *Starting attached run...* -> *OpenCode is responding...*).
   - Once completed, only one final status bubble remains: *OpenCode run completed.*

---

## Scenario 3: Robust Warm Server Fallback
Verify that direct execution is triggered if the warm daemon connection fails.

1. **Setup**:
   - Simulate a port conflict on port `4096` by running another process on that port:
     ```bash
     # Windows PowerShell
     $listener = [System.Net.Sockets.TcpListener]4096
     $listener.Start()
     ```
2. **Execute**:
   - Submit a prompt in the chat.
3. **Expected Outcome**:
   - The bridge detects that it cannot start/attach to the warm server correctly.
   - The bridge logs a warning to `bridge.log`.
   - The bridge automatically runs the command in direct mode (`opencode run ...`).
   - The prompt execution finishes successfully and streams response to UI.
4. **Cleanup**:
   - Stop the dummy listener:
     ```bash
     $listener.Stop()
     ```

---

## Scenario 4: Unified Log File (`bridge.log`)
Verify that bridge events and CLI subprocess inputs/outputs are written to `bridge.log`.

1. **Execute**:
   - Perform any conversation action in the app.
2. **Expected Outcome**:
   - A `bridge.log` file is created at the workspace root.
   - Run `tail -f ../bridge.log` or open the file.
   - Verify it contains timestamped logs of socket connections, spawned command parameters, raw stdout/stderr streams, and process exits.
