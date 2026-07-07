# Feature Specification: Chat UI & UX Improvements

**Feature Branch**: `011-chat-ui-improvements`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Implement chat UI and UX findings 1, 6, 5, 4, 40, 34, 29, 22, 20, 19, 18, 17, 16, 11, 10, 3, 2 from chat-control-screen-review.md"

## Clarifications

### Session 2026-07-02
- Q: What should be the header text and collapse behavior for inline thoughts and the completed thinking box? → A: Inline thoughts must show "Thought for <duration>   >" and be collapsed by default. After the final response, the completed thinking box header must say "Worked for <duration>" instead of "Ran N tools".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inline Thoughts and Intermediate Text (Priority: P1)
As a user interacting with the AI, I want to see the AI's thoughts and intermediate text directly interleaved with the tools it runs in the timeline, so I can understand the progression of the AI's logic step-by-step.
**Why this priority**: Highly critical for understanding the agent's multi-step execution. Currently, multiple thought blocks are discarded and intermediate text leaks inappropriately.
**Independent Test**: Trigger a command that causes the AI to think, run a tool, think again, and run another tool. Verify that thoughts and intermediate text are shown in sequence within the timeline.
**Acceptance Scenarios**:
1. **Given** a response turn where the AI runs tools, **When** the AI emits `<thought>` blocks or intermediate text, **Then** these must be rendered in order in the timeline interleaved with the tool cards as collapsible items.
2. **Given** a turn where NO tools are executed, **When** thoughts are returned, **Then** the UI must fall back to showing a single collapsible thought process accordion inside the final message bubble.

### User Story 2 - Clean, Borderless UI Hierarchy (Priority: P1)
As a mobile user, I want a clean, spacious interface without nested bordered boxes ("card-ception"), so I can read content clearly on a small screen.
**Why this priority**: Crucial for visual aesthetics. Current design looks cluttered due to multiple layers of borders.
**Independent Test**: Expand a turn container that has multiple tools and check that the inner elements do not have redundant borders.
**Acceptance Scenarios**:
1. **Given** an expanded tool timeline, **When** viewing the turn thinking box, tool rows, tool detail cards, and diff cards, **Then** these inner cards must not have borders, utilizing only background surface colors for distinction.
2. **Given** an assistant message bubble, **When** it is short, **Then** it must not have a border, ensuring consistent visual treatment with full-width bubbles.

### User Story 3 - Resilient Input Submission (Priority: P1)
As a user, I want to prevent double-tap submissions so that I do not accidentally trigger duplicate messages.
**Why this priority**: Critical functional fix. Double-tapping the send button currently emits duplicate commands.
**Independent Test**: Tap the send button rapidly twice in succession and verify only one message is sent.
**Acceptance Scenarios**:
1. **Given** the chat screen, **When** I tap the send button, **Then** a submission guard immediately disables subsequent send actions until the state updates.

### User Story 4 - Collapsible/Scrollable Tool Previews & Monospace Text wrapping (Priority: P2)
As a user with a small screen device (e.g. iPhone SE), I want log text and terminal output to wrap or scroll horizontally, and tool details to have a maximum height limit, so that they do not overflow off-screen or clutter the view.
**Why this priority**: Improves readability on small viewports and prevents unbounded scroll areas when there are large outputs.
**Independent Test**: Trigger a command tool execution that generates long lines of stdout/stderr and verify that the output scrollable area is bounded in height and permits horizontal scrolling without breaking the layout.
**Acceptance Scenarios**:
1. **Given** an expanded tool's stdout, **When** lines are wider than the container, **Then** the container wraps them in a horizontal scroll view and hides overflow.
2. **Given** tool detail content (terminal, search results, reasoning text), **When** it exceeds 300px in height, **Then** it is capped at that height and can be scrolled internally, with an option to expand further.

---

### Edge Cases
- **Thought Parsing during Streaming**: Ensure partial or unclosed `<thought>` tags are parsed correctly as they are streaming in, and do not cause parsing failures or layout jumps.
- **Interrupted Stream**: If a stream is interrupted or the network goes down, ensure the state is cleaned up and duplicate submissions remain blocked/guarded properly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: **Thought & Text Extraction**: System MUST extract all thoughts (defined by `<thought>...</thought>` tags) and intermediate text blocks (text outside tags that occurs between tool runs) from the assistant's message content.
- **FR-002**: **Inline Rendering with Tools**: If any tools are executed in a turn, the system MUST render extracted thoughts and intermediate text blocks in the timeline interleaved with the tool cards as collapsible items. The thought blocks MUST be collapsed by default, and their header MUST show `"Thought for <duration>   >"` (using dynamic duration format, e.g. `1m10s` or `15s`).
- **FR-003**: **Collapsed Card Simplicity**: When tool cards are collapsed, the system MUST NOT display any detailed code snippets, file previews, or terminal output. They MUST only render a concise summary label (e.g., 'Read XYZ.tsx #L1-100', 'Ran abcde', etc.) and an expand chevron.
- **FR-004**: **No-Tool Fallback**: If NO tools are executed in a turn, the system MUST fall back to rendering the thoughts inside a collapsible accordion within the main assistant message bubble.
- **FR-005**: **Active Status Label**: The system MUST dynamically update the "Thought Process" or timeline header to show the current active tool's label or run status text (e.g. "Reading file.ts...", "Running npm test...") rather than showing a static "Thinking..." label.
- **FR-006**: **Border Stripping**: System MUST remove borders from the timeline thinking container, tool status rows, tool detail cards, diff cards, assistant short bubbles, and thought accordion text containers, using subtle background shifts for visual hierarchy.
- **FR-007**: **Double-tap Guard**: The input component MUST implement a synchronous submission guard (using a mutable ref or immediate synchronous block) that prevents double-tap emissions of message prompts.
- **FR-008**: **Terminal Scrolling & Bounded Content**:
  - The terminal container MUST wrap stdout/stderr in a horizontal ScrollView and apply `overflow: 'hidden'` to prevent overflowing small screens.
  - The tool detail content and timeline turn thinking content MUST be capped at a maximum height (e.g., 300px) with internal vertical scrolling.
- **FR-009**: **Thinking Section Persistence**: The timeline thinking section MUST NOT auto-hide when tools finish; it MUST remain visible in a collapsed state by default. After the final response, the header of the completed thinking box MUST show `"Worked for <duration>"` (where duration is the elapsed time of the turn's execution, e.g., `10m` or `45s`) instead of `"Ran N tools"`.
- **FR-010**: **Active Thinking Indicator**: The thinking header text "Thinking..." MUST use a glowing/primary color weight when the activity spinner is active, rather than a flat secondary color.
- **FR-011**: **Padding Optimization**: Redundant inner padding MUST be reduced in the expanded tool detail view to maximize screen space for text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of turns containing tool executions display their thoughts inline in the timeline rather than leaking them into the response message bubble.
- **SC-002**: 100% of double-tap attempts on the send button result in exactly one message being sent to the socket.
- **SC-003**: On iPhone SE (320px viewport), terminal outputs are readable, scrollable horizontally, and have zero off-screen layout overflows.
- **SC-004**: Max depth of nested bordered boxes in the timeline is reduced to 1 (only the main timeline turn container can have a subtle background/border if needed, others are borderless).

## Assumptions

- We assume the markdown parser and rendering library can handle parsed content correctly without formatting issues.
- We assume that the server emits all standard tool activity and file change events via socket with proper metadata matching the schema.
