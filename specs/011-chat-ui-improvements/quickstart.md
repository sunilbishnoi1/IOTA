# Quickstart Guide: Chat UI & UX Verification

This guide outlines the steps to run and verify the Chat UI/UX improvements.

## Prerequisites & Run Commands

To launch the IOTA system locally:

1. **Start the Bridge Server**:
   ```bash
   cd iota-bridge
   npm install
   npm run dev
   ```
2. **Start the Mobile Application**:
   ```bash
   cd iota-mobile
   npm install
   npx expo start --android
   ```

---

## Verification Scenarios

### Scenario 1: Interleaved Timeline & Dynamic Status
1. Connect the mobile client to the Codespace bridge.
2. Submit a request that requires thinking and tool use (e.g., `"Search for files containing 'Theme' and edit one"`).
3. **Verify**:
   - The thinking header changes dynamically to reflect the current action (e.g., `Reading theme.ts...`, `Searching...`).
   - The spinner header uses a glowing primary color and a bold weight during execution.
   - Thought blocks and intermediate text are rendered inline in the timeline container interleaved with the tool cards as collapsible elements.
   - Expanding a thought shows the full process, with a duration label (e.g., `"Thought Process (3s)"`).
   - The final answer bubble renders *only* the final assistant message response.

### Scenario 2: Clean borderless style & scroll heights
1. Expand a turn containing tool detail cards and terminal panels.
2. **Verify**:
   - The cards are borderless (`borderWidth: 0`), using background color shifts for separation.
   - Large terminal streams or stdout boxes are capped at `max-height: 250px` - `300px` with internal scroll bars.
   - High-density outputs scroll horizontally (no SE layout overflow).
   - Turn activities list is capped at `max-height: 300px` with internal scrolling to prevent page-stretching when running 20+ tools.

### Scenario 3: Double-Tap Guard
1. Type a message in the input text area.
2. Double-tap the send button rapidly.
3. **Verify**:
   - Only a single message bubble is created in the timeline, and the server receives exactly one prompt execution trigger.
