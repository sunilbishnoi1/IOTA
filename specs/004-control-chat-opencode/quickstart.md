# Quickstart: Control Chat OpenCode Validation

## Prerequisites

- Active GitHub Codespace running the IOTA bridge.
- Mobile app configured with the Codespace bridge connection URL.
- User credentials available only through the mobile secure credential flow.
- OpenCode may be installed or missing; both paths must be validated.

## Build and Static Validation

From `iota-bridge/`:

```bash
npm run build
```

From `iota-mobile/`:

```bash
npx tsc --noEmit
```

If the mobile package does not yet expose TypeScript validation, add the smallest project-appropriate validation script during implementation and document it in tasks.

## Scenario 1: OpenCode Already Installed

1. Ensure OpenCode is available in the Codespace PATH.
2. Start the bridge.
3. Open the mobile app and navigate to the Control Screen.
4. Verify the screen shows a chat timeline and bottom composer.
5. Submit: `Summarize this repository structure.`
6. Expected outcome:
   - A user message appears in the timeline.
   - OpenCode assistant text streams into a chat bubble.
   - No terminal pane, shell header, raw prompt, or terminal clear/copy controls are visible.

## Scenario 2: OpenCode Missing and Setup Flow

1. Use a Codespace where OpenCode is not installed or temporarily unavailable.
2. Open the Control Screen.
3. Verify the composer is disabled and a setup action is shown.
4. Start installation.
5. Expected outcome:
   - Setup progress appears as readable system/status rows.
   - Raw installation logs are not shown in a terminal window.
   - On success, the composer becomes enabled.
   - On failure, a retry action and concise error summary appear.

## Scenario 3: Continue an Existing Conversation

1. Submit a prompt that starts an OpenCode session.
2. Background the app or disconnect the socket temporarily.
3. Reopen the Control Screen after reconnect.
4. Expected outcome:
   - The previous conversation snapshot is restored.
   - Active running state is visible if work is still ongoing.
   - A follow-up prompt continues the same conversation.

## Scenario 4: Tool Activity and Diff Review

1. Submit a prompt that asks OpenCode to inspect or modify a small file.
2. Expected outcome:
   - Tool activity appears as compact status rows.
   - File changes appear as structured diff cards.
   - Added and removed lines are visually distinct.
   - The user does not need to inspect raw patch text in a terminal pane.

## Scenario 5: Approval Request

1. Trigger an OpenCode action requiring confirmation.
2. Verify an approval control appears with approve and deny actions.
3. Choose approve or deny.
4. Expected outcome:
   - The decision is sent through the OpenCode chat event contract.
   - The timeline records the decision.
   - The user never has to type `Y`, `N`, or other terminal input manually.

## Regression Checks

- `iota-mobile/src/screens/ControlScreen.tsx` must not render `TerminalConsole` for the OpenCode chat path.
- `iota-mobile/src/constants/xtermAssets.ts` must not be required for the Control Screen chat experience.
- `terminal:input` must not be the normal prompt submission path for the Control Screen.
- Existing Codespace teardown and connection status affordances must remain available.
## Scenario 6: Warm OpenCode Service and Session Catch-Up

1. Start the bridge with OpenCode installed.
2. Submit an initial prompt and verify the bridge captures a session identifier when OpenCode reports one.
3. Submit a follow-up prompt.
4. Expected outcome:
   - The bridge continues the prior OpenCode session rather than starting unrelated context.
   - If a warm OpenCode service is available, the bridge uses the attach path without exposing the service directly to mobile.
5. Restart or reconnect the mobile app and request a sync.
6. Expected outcome:
   - The bridge restores from its snapshot or uses OpenCode session discovery to recover the recent conversation.

## Scenario 7: No Indefinite Thinking State

1. Start a Codespace where OpenCode is installed but provider credentials are missing or invalid.
2. Open the Control Screen and attempt to submit `Hi`.
3. Expected outcome:
   - The composer is disabled with `credentials_missing`, or the submission is rejected with a visible `OPENCODE_CREDENTIALS_MISSING`/`OPENCODE_NOT_READY` message.
   - The timeline does not create an assistant bubble that remains `Thinking...` indefinitely.

4. Start a run with a mocked or real OpenCode process that emits no stdout/stderr/JSON activity.
5. Expected outcome:
   - A run status row appears within 1 second after prompt acceptance.
   - Within the configured first-output timeout, the run is finalized with `OPENCODE_FIRST_OUTPUT_TIMEOUT`.
   - The assistant placeholder is marked `error` or replaced by a concise system error.

## Scenario 8: Stop Then Resubmit

1. Submit `Hi` while OpenCode is available.
2. Press the stop button before the response completes.
3. Submit `Hi` again.
4. Expected outcome:
   - The first run shows a durable `OpenCode run stopped.` status.
   - Any assistant placeholder from the first run is finalized and remains in history as stopped/error, not removed.
   - The second prompt starts a new request for the same conversation and either streams text or produces a visible retryable error.
   - `OPENCODE_ALREADY_RUNNING` is not returned after the stop finalization has completed.

## Scenario 9: Dashboard Navigation History Preservation

1. Submit a prompt that creates a user message and assistant/run status.
2. Navigate back to the dashboard while the run is active or after stopping it.
3. Return to the Control Screen for the same Codespace.
4. Expected outcome:
   - The same stable conversation ID is used for `opencode:sync`.
   - The timeline merges the bridge snapshot and local pending state without deleting stopped/error/streaming messages.
   - The previous user prompt and final status remain visible.

## Scenario 10: Install and Initialize OpenCode End-to-End

1. Use a fresh Codespace where `opencode` is missing from PATH.
2. Open the Control Screen and start setup.
3. Expected outcome:
   - The bridge tries the npm global install path and, if needed, the official install script fallback.
   - After installation, the bridge verifies the exact `opencode` executable with the runtime PATH.
   - Capability remains non-submittable until project initialization/readiness and transient provider credentials are present.
4. Submit `Hi` after capability is `available`.
5. Expected outcome:
   - OpenCode receives the prompt through `opencode run ... --format json` or a verified attached server run.
   - The timeline shows returned assistant text or a normalized retryable error with no raw terminal UI.
