# Quickstart & Verification Guide: Fix "New Chat" and Add Session Persistence

This guide provides step-by-step instructions to verify that the "New Chat" isolation fix, JSON file persistence, and conversation switching/history UI operate correctly.

## 1. Prerequisites

- Make sure you are in the workspace root: `d:\Desktop\codes\IOTA`.
- OpenCode CLI must be installed and accessible globally or under `PATH` on the bridge host.
- Node.js dependencies installed for the bridge.

---

## 2. Start the Bridge and Mobile Client

### Start Bridge Server
Run the bridge development server from `iota-bridge`:
```bash
cd iota-bridge
npm run dev
```

### Start Mobile Client
Run the mobile application from `iota-mobile`:
```bash
cd iota-mobile
npm run android # or npm run ios / npx expo start
```

---

## 3. Verification Scenarios

### Scenario 1: New Chat Creation & Isolation (FR-001)
1. In the mobile app, type a prompt: `Write a hello world function in python.`
2. Let OpenCode execute. Wait for it to complete.
3. Tap the **History** icon in the header or drag the drawer open, then tap the **New Chat (+)** button.
4. Verify that the screen clears and `isSyncing` completes.
5. Send a follow-up prompt: `What was the language of the function I just asked you to write?`
6. **Expected Outcome**: The agent must reply that it does not know, or that this is a new conversation. It must not reference Python or the hello world function, showing complete session isolation.

### Scenario 2: Bridge Restart & Persisted Conversations (FR-002, FR-004)
1. Send a prompt to create a new session: `My favourite color is blue.`
2. Verify that a file exists at `.iota/conversations/<conversationId>.json` inside the workspace containing this message.
3. Stop the bridge server (Ctrl+C in terminal).
4. Restart the bridge: `npm run dev`.
5. Reconnect the mobile client.
6. **Expected Outcome**: The chat screen must successfully restore and display the message `My favourite color is blue.`, proving persistence works.

### Scenario 3: Switching Conversations via History Drawer (FR-003, FR-004)
1. Open the **History** drawer by clicking the icon.
2. Verify that both the previous python conversation and the "blue color" conversation are listed with auto-generated titles and message counts.
3. Tap the python conversation.
4. **Expected Outcome**: The active conversation ID switches, the UI loads the cached messages for the python conversation within 500ms, and the chat timeline displays the python code.

### Scenario 4: Chat Cache Isolation (FR-005)
1. Open the python conversation. Verify the messages displayed.
2. Close the app and reopen it.
3. **Expected Outcome**: The app should mount, fetch the active conversation ID, load the cached python messages from `SecureStore` (scoped by conversation ID), and display *only* those messages without mixing them with other conversations.

### Scenario 5: Garbage Collection (FR-006)
1. Set the conversation GC limit to `5` in `opencodeStore.ts` for testing.
2. Create `6` distinct conversations by repeatedly clicking "New Chat" and sending a prompt in each.
3. Check the `.iota/conversations/` directory.
4. **Expected Outcome**: Only the 5 most recently updated conversation JSON files must remain. The oldest conversation file must have been deleted from disk and memory.
