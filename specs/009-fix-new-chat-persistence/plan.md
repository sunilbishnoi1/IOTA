# Implementation Plan: Fix "New Chat" and Add Session Persistence

**Branch**: `009-fix-new-chat-persistence` | **Date**: 2026-06-30 | **Spec**: [spec.md](file:///d:/Desktop/codes/IOTA/specs/009-fix-new-chat-persistence/spec.md)

## Summary
The "New Chat" feature in IOTA is currently broken because starting a new chat session leaks context from previous OpenCode CLI sessions. This implementation plan fixes this session pollution bug by ensuring that "New Chat" initiates a completely clean CLI run (without passing `--continue --session`), implements per-conversation JSON persistence under `.iota/conversations/` on the bridge, introduces a sockets-based API for conversation history synchronization and deletion, and creates a premium custom sliding History Drawer in the mobile client. It also partitions the local chat cache on mobile by conversation ID to prevent cross-session UI pollution.

## Technical Context
- **Language/Version**: TypeScript / Node.js (Bridge), TypeScript / React Native Expo (Mobile)
- **Primary Dependencies**: Socket.io, React Native, expo-secure-store
- **Storage**: JSON files on disk (`.iota/conversations/*.json`), expo-secure-store on device
- **Testing**: Jest, React Native Testing Library
- **Target Platform**: Node.js Bridge on Codespace VM, Android & iOS Mobile Client
- **Performance Goals**: Switching conversations in < 500ms, New Chat initialization in < 3s
- **Constraints**: No new npm dependencies, handle Windows atomic writes gracefully, respect Android 2048-byte SecureStore limits.

## Constitution Check
- **Principle I: Decentralized & Transient Secret Management**: PASSED. No user credentials or API keys will be persisted on the bridge disk. Only conversation metadata, prompts, and tool results are stored in `.iota/conversations/`.
- **Principle II: Mobile-First Optimization & Performance**: PASSED. The history drawer will use the React Native `Animated` API with `useNativeDriver: true` for 60 FPS rendering.
- **Principle III: Decoupled Micro-Bridge Architecture**: PASSED. Communication occurs directly between the mobile client and the bridge via WebSockets.
- **Principle V: Test-First Implementation & Validation**: PASSED. Unit and integration tests will be updated/created for the state changes and cache key scoping.

## Project Structure
### Documentation (this feature)
```text
specs/009-fix-new-chat-persistence/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── contracts/
    └── socket-api.md    # Phase 1 output
```

### Source Code (repository root)
```text
iota-bridge/
└── src/
    ├── services/
    │   ├── opencode.ts      # Modified: listSessions, runSessionsQuery, etc.
    │   ├── opencodeStore.ts # Modified: Save/load JSON from disk, prune, title gen
    │   └── socket.ts        # Modified: Add opencode:new_session, list, delete handlers
    └── types/
        └── opencode.ts      # Modified: Add title to OpenCodeConversation

iota-mobile/
└── src/
    ├── components/
    │   └── control/
    │       └── HistoryDrawer.tsx # New: Premium custom sliding history drawer
    ├── screens/
    │   └── ControlScreen.tsx     # Modified: Header history button, connect new_session
    └── services/
        ├── secureStore.ts        # Modified: Scope chat cache by conversation ID
        └── opencodeSocket.ts     # Modified: Add new session, list, delete emitters
```

## Proposed Changes

### iota-bridge

#### [MODIFY] [opencodeStore.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencodeStore.ts)
- Implement `loadConversationsFromDisk()` to scan `.iota/conversations/` and populate `conversations` Map on startup or workspace change.
- Implement atomic `saveConversation()` helper using temporary files and `fs.renameSync` with Windows compatibility fallback.
- Implement `ensureLoaded()` checking if `lastWorkspaceRoot` has changed.
- Implement `pruneOldConversations()` to enforce a 50-session limit.
- Update `addMessage()`, `setSession()`, `addTool()`, etc., to trigger `saveConversation()` and prune old sessions.
- Automatically generate conversation `title` on first user message.
- Add `deleteConversationBySessionId(sessionId)` and `deleteConversation(conversationId)` methods.

#### [MODIFY] [socket.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/socket.ts)
- Add handler for `opencode:new_session` socket event.
- Add handler for `opencode:list_conversations` socket event.
- Add handler for `opencode:delete_conversation` socket event.
- In `opencode:sync`, remove the `syncFromCliSessions` fallback for unknown conversation IDs to prevent pollution.

#### [MODIFY] [opencode.ts](file:///d:/Desktop/codes/IOTA/iota-bridge/src/services/opencode.ts)
- Update `runSessionsQuery()` to list both active CLI sessions and IOTA conversations.

### iota-mobile

#### [NEW] [HistoryDrawer.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/components/control/HistoryDrawer.tsx)
- Premium animated sliding drawer component with backdrop blur/overlay.
- Chronological grouping (Today, Yesterday, Older).
- Active item highlighting and long-press/icon to delete.

#### [MODIFY] [ControlScreen.tsx](file:///d:/Desktop/codes/IOTA/iota-mobile/src/screens/ControlScreen.tsx)
- Hook up HistoryDrawer component.
- Add history toggle icon to header bar.
- Update `performResetConversation()` to trigger `opencode:new_session`.
- Bind `getChatCache` and `saveChatCache` to depend on `conversationId` state.

#### [MODIFY] [secureStore.ts](file:///d:/Desktop/codes/IOTA/iota-mobile/src/services/secureStore.ts)
- Update `getChatCache` and `saveChatCache` to include `conversationId` in the cache key.
- Provide a migration path from `iota_chat_cache_${scope}` to the new key.

## Verification Plan

### Automated Tests
- Run bridge unit tests: `npm run test` inside `iota-bridge`.
- Run mobile unit tests: `npm run test` inside `iota-mobile`.

### Manual Verification
- Verify the end-to-end scenarios described in `quickstart.md`.
