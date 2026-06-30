# Quickstart Validation Guide: OpenCode Slash Commands

This guide provides runnable manual verification scenarios to test the slash commands implementation.

## Scenario 1: Autocomplete Suggestions Overlay

1. Launch the IOTA mobile app and connect to a Codespace VM bridge.
2. Navigate to the **Control** (Terminal) screen.
3. Tap on the chat input field.
4. Type a single `/` character.
5. **Expected Outcome**: A floating suggestions popup menu immediately overlays above the keyboard, displaying all 13 slash commands with descriptions.
6. Type `m`.
7. **Expected Outcome**: Suggestions are filtered down to `/models`.
8. Tap on `/models` in the menu list.
9. **Expected Outcome**: The chat input is auto-completed to `/models ` and the keyboard remains focused.

## Scenario 2: Help Command (`/help`)

1. Type `/help` in the chat input and tap the submit/send button.
2. **Expected Outcome**: 
   - The command execution bypasses the bridge and runs instantly.
   - A local message is appended to the chat timeline displaying a styled markdown table of all commands, usage instructions, and description cards.

## Scenario 3: Model Listing & Switching (`/models`)

1. Submit `/models` in the chat.
2. **Expected Outcome**:
   - The bridge executes `opencode models`.
   - A list of all available models is printed in a clean, scrollable monospaced code block in the chat timeline.
3. Submit `/models github-copilot/gpt-5-mini`.
4. **Expected Outcome**:
   - The bridge validates the model name, saves it as the active model, and returns a success confirmation.
   - Future runs are spawned with the `--model github-copilot/gpt-5-mini` flag.

## Scenario 4: Usage Stats (`/stats`)

1. Submit `/stats` in the chat.
2. **Expected Outcome**:
   - The bridge executes `opencode stats`.
   - The TUI overview, cost, token counts, and tool usage charts are rendered in a monospaced block.

## Scenario 5: Credentials Modal (`/connect` / `/auth`)

1. Submit `/connect` or `/auth` in the chat.
2. **Expected Outcome**:
   - A premium modal overlay pops up displaying inputs for: Anthropic API Key, OpenAI API Key, Gemini API Key, Groq API Key, and OpenRouter API Key.
3. Enter a dummy key for `GROQ_API_KEY` and click **Save**.
4. **Expected Outcome**:
   - The keys are securely written to `Expo SecureStore`.
   - An `opencode:credentials` socket event updates the active bridge session memory dynamically.
   - Tapping close/dismiss returns to chat.
