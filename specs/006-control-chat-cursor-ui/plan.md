# Implementation Plan: Control Chat Cursor UI/UX Enhancements

**Branch**: `[006-control-chat-cursor-ui]` | **Date**: 2026-06-27 | **Spec**: [spec.md](file:///D:/Desktop/codes/IOTA/specs/006-control-chat-cursor-ui/spec.md)

**Input**: Feature specification from `/specs/006-control-chat-cursor-ui/spec.md`

## Summary
Enhance the entire chat experience on the Control Screen to match premium AI coding agents (such as Cursor). This includes collapsible sequential thinking log boxes, dynamic full-width response containers, tighter bubble padding, copy-to-clipboard buttons on code blocks, empty-state quick action pills, header-based conversation resets with confirmation, auto-scrolling to the end on new items, and adding timestamps to file change payloads.

## Technical Context
- **Language/Version**: React Native (Expo SDK 51) / TypeScript / Node.js
- **Primary Dependencies**: `react-native-markdown-display`, `expo-clipboard`, `expo-secure-store`, `@expo/vector-icons`
- **Testing**: Jest (bridge tests), manual UI testing
- **Target Platform**: Mobile (iOS and Android)
- **Project Type**: React Native mobile app client and Node.js bridge backend

## Constitution Check
- **Decentralized Secrets (I)**: Complies. No new credentials or persistence on the bridge side.
- **Mobile-First Optimization (II)**: Complies. Rendered with optimal flatlist structure, collapsible log details, and high-performance Clipboard API.
- **Micro-Bridge Architecture (III)**: Complies. No proxy or middleman additions.
- **Test-First (V)**: Complies. Bridge parser test coverage will be run to ensure payload normalizer safety.

## Project Structure
We will modify files in both the bridge backend and the mobile client application.

### Modified Files:
- **Backend Types**: [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/types/opencode.ts)
- **Backend Parser**: [opencodeEvents.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)
- **Mobile Types**: [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/types/opencode.ts)
- **Mobile Chat UI**: [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)

---

## Proposed Changes

### 1. File Change Timestamps (Bridge & Mobile Shared Model)
Add `createdAt` timestamp to `OpenCodeFileChange` payload to ensure accurate chronological order.
- **Modify** [iota-bridge/src/types/opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/types/opencode.ts)
- **Modify** [iota-bridge/src/services/opencodeEvents.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeEvents.ts)
- **Modify** [iota-mobile/src/types/opencode.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/types/opencode.ts)

### 2. Control Screen Chat View Overhaul
- **Modify** [iota-mobile/src/screens/ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx):
  - **Turn Grouping**: Filter out separate tool, file, and approval cards from flatlist. Instead, group them dynamically under the corresponding assistant message turn (or under a virtual assistant message placeholder if a run is active).
  - **Collapsible Thinking Box**: Implement a custom collapsible React component for assistant message runs. When collapsed, display a thin bar containing the current tool status (e.g. "Reading index.js...") and a toggle icon. When expanded, render the chronological list of tool logs, file diff cards, and approval states.
  - **Premium Markdown & Code Blocks**: Custom render code blocks inside `react-native-markdown-display` to show language headers and an interactive **Copy** button.
  - **Full-Width AI Response**: Style assistant response containers without outer bubble backgrounds/borders, letting markdown stretch to the full width of the mobile viewport, while keeping user messages right-aligned in sleek bubbles.
  - **Suggested Prompt Pills**: Add horizontal/grid buttons in empty state for fast prompt initiation.
  - **New Chat Reset**: Add a "New Chat" icon button to header. Confirm via alert, then clear all lists, store, generate a new conversation ID, and synchronize.

---

## Verification Plan

### Automated Tests
- Run bridge unit tests:
  ```bash
  cd iota-bridge
  npm run test
  ```

### Manual Verification
- Follow all manual scenarios in [quickstart.md](file:///D:/Desktop/codes/IOTA/specs/006-control-chat-cursor-ui/quickstart.md) on simulator or physical device to verify:
  1. Suggested Pills
  2. Collapsible Thinking Box
  3. Dynamic AI Response Bubble width
  4. Code Copy to Clipboard
  5. Reset Conversation flow
