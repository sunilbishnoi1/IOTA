# IOTA — Brain

## What IOTA Is

IOTA is an open-source mobile app (React Native/Expo, Android APK) that turns a developer's phone into a remote control for AI-assisted coding inside GitHub Codespaces. A lightweight Node.js/Express/Socket.IO bridge server runs inside the Codespace VM, mediating between the mobile app and an AI coding agent (OpenCode CLI), streaming real-time agent output, tool calls, file diffs, and approval requests to the phone. The user can send natural language prompts, review streaming diffs, approve/reject tool requests, and commit/push code — all from their pocket.

## Why Build IOTA

Eliminates dependency on expensive, self-hosted cloud backends by leveraging GitHub Codespaces' free tier (60 hrs/month) for all compute — cloning, `npm install`, test execution, and AI agent operation all happen inside the Codespace. Provides a zero-trust, decentralized architecture where the mobile client connects directly to the Codespace VM without intermediary servers, and API keys live only in the phone's SecureStore (never persisted to the remote disk). Enables developers to fix bugs, review PRs, and ship features while away from their desk without carrying a laptop.

## Key Decisions

| Decision | Reasoning |
|---|---|
| **Bridge server runs inside Codespace** (not a central cloud backend) | Zero infrastructure cost; Codespace free tier (60 hrs/month) handles all compute; user's existing VM does the heavy lifting |
| **Direct connection routing** (no proxy/relay server) | Zero-trust architecture — no intermediary can intercept tokens, code, or API keys |
| **GitHub OAuth Device Code Flow** for auth | No redirect URI needed on mobile; no middleman OAuth proxy required |
| **Express + Socket.IO on a single port** (3000) | Both REST API and real-time WebSocket on same server; authenticated via GitHub token |
| **React Native + Expo** (instead of Flutter) | Faster prototyping; Expo's managed workflow simplifies APK builds; TypeScript shared between bridge and mobile |
| **Custom tab navigation** (no React Navigation) | Keeps all screen state alive across tab switches; simpler multi-workspace support |
| **Vanilla React state** (no Redux/Zustand) | Narrow, manageable state surface; avoids unnecessary dependency overhead |
| **Migration from `opencode run` → `opencode serve` (SSE)** | `run` lacks streaming deltas, multi-turn conversations, question/approval support, and abort — `serve` provides all of these |
| **SSE events relayed via Socket.IO** (not directly to mobile) | SSE is server→client only; Socket.IO provides bidirectional channel needed for approvals/questions/commands |
| **JSON file conversation persistence** (`.iota/conversations/`) | Simple, debounced, atomic file writes; no SQLite dependency on bridge; OpenCode server has its own SQLite |
| **Watchdog inactivity timeout** (30s idle, 5min with tools) | Prevents hung agent runs from blocking the conversation indefinitely |
| **API dual-path: bridge first, GitHub API fallback** | App works even without a running bridge (e.g., for codespace CRUD before bridge starts) |
| **Volatile credential injection** (never written to Codespace disk) | API keys held only in mobile SecureStore + bridge runtime memory; discarded on disconnect |
| **GitHub token as universal auth** (REST + WebSocket) | Reuses existing GitHub identity; no separate auth system to build or maintain |
| **NativeWind + dark glassmorphism theme** | Linear-inspired "Advanced Minimalist" design; Android blur fallback uses semi-transparent overlay since `backdrop-filter` is unperformant |
| **Chunked SecureStore** for values > 1024 bytes | Android SecureStore has 2048-byte limit; chat caches and codespace lists exceed this |
| **Keep-alive via PTY echo + self-ping** (every 60s) | Prevents Codespace idle shutdown (30-min timeout) during long AI agent sessions |
| **Multi-strategy font loading** (CDN → Metro → native) | Various Expo build configurations have different font loading paths; CJK fallback occurs if font fails to load over port forwarding |
| **SSE batching on mobile** (150ms queue flush + recursive setTimeout) | OpenCode streams 30+ chunks/sec; processing each synchronously freezes the React Native JS thread |
| **Throttled Markdown rendering** (500ms debounce while streaming) | `react-native-markdown-display` is heavy; parsing every delta locks up the UI thread |
| **Parent/child subtask session tracking** | Enables UI to display nested sub-agent delegation in the chat timeline |
| **Preview port management** (reserved ports, port shifting, `gh` visibility) | Mobile device cannot reach Codespace localhost; ports must be made publicly accessible via `gh codespace ports visibility` |
| **Hunk-level git staging** (not just whole files) | Users can stage/discard individual diff hunks via `git apply --cached` with patch text |
