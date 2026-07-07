# Research: Chat UI & UX Improvements

This research covers the exact socket and event format of OpenCode and explores premium, techy, and minimal mobile UI/UX designs to implement the requested findings.

## 1. OpenCode Socket & Streaming Event Format

OpenCode communicates through Socket.io events. Based on the codebase analysis of `iota-bridge/src/services/opencodeEvents.ts` and `socket.ts`, here is the exact payload structure for streaming and complete phases:

### A. Streaming Thoughts (`opencode:message_delta`)
- When the assistant is thinking, the bridge detects `type === 'reasoning'` and wraps the text in `<thought>...</thought>` tags.
- The socket server streams these chunks as `opencode:message_delta` events:
  ```json
  {
    "conversationId": "conv-123",
    "messageId": "msg-456",
    "content": "<thought>",
    "done": false
  }
  ```
  Followed by the thoughts:
  ```json
  {
    "conversationId": "conv-123",
    "messageId": "msg-456",
    "content": "Analyzing files... ",
    "done": false
  }
  ```
  And finally the closing tag:
  ```json
  {
    "conversationId": "conv-123",
    "messageId": "msg-456",
    "content": "</thought>",
    "done": false
  }
  ```
- Any text outside these tags is streamed normally as message text.

### B. Tool Activity (`opencode:tool_activity`)
- Emitted when the assistant starts, updates, or completes a tool execution:
  ```json
  {
    "conversationId": "conv-123",
    "activity": {
      "id": "tool-789",
      "conversationId": "conv-123",
      "label": "Reading package.json",
      "kind": "file_read",
      "status": "started", // 'started' | 'running' | 'completed' | 'failed'
      "startedAt": "2026-07-02T09:18:24.000Z",
      "metadata": {
        "filePath": "package.json",
        "startLine": 1,
        "endLine": 100
      }
    }
  }
  ```
- Other kinds of tools: `command` (run CLI command), `file_write`, `search`, `test`, `other`.

### C. File Changes & Diff Reviews (`opencode:file_change`)
- Emitted when a file is modified:
  ```json
  {
    "conversationId": "conv-123",
    "change": {
      "id": "change-101",
      "conversationId": "conv-123",
      "filePath": "src/App.tsx",
      "changeType": "modified",
      "additions": 4,
      "deletions": 2,
      "hunks": [
        {
          "header": "@@ -10,6 +10,8 @@",
          "lines": [
            { "type": "context", "content": "const App = () => {" },
            { "type": "addition", "content": "  console.log('Premium UI active');" }
          ]
        }
      ]
    }
  }
  ```

---

## 2. Best Premium, Techy, Minimal UI/UX Designs

To elevate the app's visual identity, we will apply these design decisions:

### A. Structural Depth & Border Reduction (Borderless Design)
- **Problem**: Stacked containers each with `borderWidth: 1` create "card-ception" and visual noise.
- **Solution**: Strip all inner borders. Separate cards using distinct surface background colors and elevation.
  - Background surface of timeline container: `rgba(255, 255, 255, 0.02)`
  - Active tool rows background: `rgba(255, 255, 255, 0.03)`
  - Inner details card background: `rgba(0, 0, 0, 0.15)`
  - Terminal text surface: `#0a0a1a` (slightly lighter than absolute black `#030014` to add depth).

### B. Micro-interactions and Status Styling
- **Glowing Active Header**: The "Thinking..." timeline text should dynamically highlight when the spinner is active using `Theme.colors.primary.glow` and a bold weight, signaling activity.
- **Dynamic Active Tool Names**: Thread the active tool name (e.g. `Reading file.ts...` or `Running tests...`) into the timeline status dynamically during execution.
- **Thought Duration Indicator**: Display how long the AI spent on each thought block (e.g. `"Thought Process (4s)"`) to make it feel responsive and humanized.

### C. Information Density & Scrolling
- **Max-Height Bounds with Inner Scroll**: Large tool details (terminal, diff, results) or many tools inside a turn can push the response off-screen. Capping their height at `250px` - `300px` with vertical scrolls and a subtle scroll indicator resolves this.
- **Horizontal Scroll on Terminal**: Force code/stdout lines in terminals to scroll horizontally inside an overflow-hidden wrapper, resolving SE layout overflow.
