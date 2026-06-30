# Research: Fix "New Chat" and Add Session Persistence

This document consolidates findings, architecture choices, and research decisions for implementing session persistence and fixing the "New Chat" session pollution bug.

## Decision 1: Per-Conversation JSON Persistence in `.iota/conversations/`
- **Decision**: Persist each conversation in a separate JSON file named `<conversationId>.json` inside the `.iota/conversations/` directory of the workspace.
- **Rationale**: 
  - Fits the existing file-based persistence patterns of IOTA (e.g. `.iota/preview.json`, `.iota/env.json`).
  - No new npm packages/native DB binaries are needed, keeping the bridge server lightweight and cross-platform.
  - Per-file storage avoids a single point of failure (corruption in one file does not affect other conversations).
- **Alternatives Considered**:
  - *SQLite Database*: Rejected for initial implementation as it introduces library dependencies (e.g., `sqlite3`, `better-sqlite3`) that can be complex to compile across different platforms (especially Codespaces/Devcontainers). Can be migrated later if needed.
  - *Single JSON File*: Rejected because concurrent writes could corrupt the file, and loading/writing the entire history on every message scales poorly.

## Decision 2: Atomic File Writes via Temporary File + Rename
- **Decision**: To handle concurrent writes and prevent file corruption during bridge restarts, write conversation files atomically by saving to a temp file (e.g. `<filename>.<timestamp>.tmp`) and then renaming it to the final destination.
- **Rationale**: Ensure that even if the bridge crashes mid-write, the existing file remains intact and uncorrupted.
- **Alternatives Considered**:
  - *Direct `fs.writeFileSync`*: Rejected because a crash or power cut during write results in a truncated/corrupt JSON file.

## Decision 3: Custom Sliding Drawer for Conversation History UI
- **Decision**: Build a custom history drawer in React Native using the built-in `Animated` API, sliding in from the right, with a dark frosted-glass overlay.
- **Rationale**: 
  - Fully implements the "Option B" premium UI layout specified in the spec.
  - Avoids adding complex external navigation dependencies like `@react-navigation/drawer` (which requires re-linking and extra native packages).
- **Alternatives Considered**:
  - *Native Drawer Library*: Rejected due to NFR-02 ("No new npm dependencies").

## Decision 4: Sockets-Based Synchronization for Conversation History
- **Decision**: Introduce three new socket events for real-time synchronization:
  - `opencode:new_session`: Emitted by mobile to request a clean, independent conversation with no previous session context.
  - `opencode:list_conversations`: Emitted by mobile to request the list of saved conversations.
  - `opencode:delete_conversation`: Emitted by mobile to delete a specific conversation by ID.
  - `opencode:conversations_list` (Server response): Dispatches the list of available conversations to the client.
- **Rationale**: 
  - Leverages the existing real-time WebSocket connection between mobile and bridge.
  - Ensures changes on disk or memory are instantly reflected in the mobile UI.
- **Alternatives Considered**:
  - *REST API Endpoint*: Rejected because sockets allow real-time push updates (e.g. when conversation lists change or prune events occur).
