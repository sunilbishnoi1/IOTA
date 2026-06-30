# Quickstart & Verification Guide: Control Chat Cursor UI/UX Enhancements

This guide defines the scenarios to verify that the collapsible thinking boxes, dynamic response bubbles, code block copy utility, suggested prompt pills, and session resets work end-to-end.

## Prerequisites
1. Run the bridge server in one terminal:
   ```bash
   cd iota-bridge
   npm run dev
   ```
2. Start the mobile app in another terminal:
   ```bash
   cd iota-mobile
   npm run start
   ```

---

## Scenario 1: Suggested Prompt Pills
1. Open the app and navigate to the **Control Screen** for a codespace.
2. If there are existing messages, tap the **New Chat** button in the header and confirm.
3. Verify that the screen is empty and displays 4 suggested pills:
   - "Find bugs"
   - "Write tests"
   - "Explain code"
   - "Check status"
4. Tap the **"Find bugs"** pill.
5. Verify that the prompt input box is populated with "Find bugs" and focuses the keyboard.

---

## Scenario 2: Collapsible Thinking logs & Precise tool steps
1. Type a coding prompt that invokes multiple tools (e.g. "Find files and search for 'App'") and tap send.
2. Verify that a thin **Thinking** container bar immediately appears below the user message.
3. Verify the spinner spins and the text updates dynamically (e.g., "Reading package.json", "Running grep search").
4. Tap the thinking bar to expand it.
5. Verify it shows a chronological log of all individual tool runs and file explorations.
6. Once the run completes, collapse the box and verify the title summarizes the run (e.g., "Ran 3 tools").

---

## Scenario 3: Full-Width Dynamic AI Response & Padding
1. Send a short prompt (e.g., "Hi"). Verify the AI response bubble is narrow and wraps tightly.
2. Send a prompt that generates code blocks and long text (e.g., "Write a bubble sort function in typescript").
3. Verify the AI response box spans full screen width.
4. Verify code blocks do not wrap excessively and look premium.
5. Verify padding around both user message bubble and AI response is reduced.

---

## Scenario 4: Copy Code to Clipboard
1. In the bubble sort code block from Scenario 3, look for the language tag and the **Copy** button in the code block header.
2. Tap the **Copy** button.
3. Verify the text changes to "Copied!" for a few seconds.
4. Open the input text box (or any other application) and paste the clipboard content. Verify the exact code is pasted.

---

## Scenario 5: New Chat Session Reset
1. Tap the **New Chat** (refresh/plus) icon in the header.
2. Verify a confirmation dialog is displayed.
3. Click "Yes" / "Confirm".
4. Verify the chat timeline is completely cleared and transitions back to the empty state with suggested pills.
