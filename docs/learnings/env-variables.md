# Environment Variables Management

## URL Mismatch: EnvVarModal Uses Wrong Bridge URL

- **Root cause:** `EnvVarModal` REST calls use `bridgeUrl` (defaults to `http://localhost:3000`) while the socket connects via `activeCodespace.connectionUrl` (`https://*.app.github.dev`). `ControlScreen.tsx:804` passes the App-level `bridgeUrl` prop.
- **What the fix was:** Pass `activeCodespace.connectionUrl || bridgeUrl` to `EnvVarModal` from `ControlScreen.tsx`.
- **Key lesson:** REST API and Socket connections should use the same base URL. When a codespace connection URL is available, prefer it over App-level `bridgeUrl`.

## Shared Loading State Conflates Fetch and Save

- **Root cause:** Single `loading` conflates initial fetch, save, and delete — Add button shows spinner during initial data load.
- **What the fix was:** Split into `isFetching` (initial load) and `isSaving` (save/delete).
- **Key lesson:** Distinct async operations should use separate loading states.

## Env Var Load Errors Silently Swallowed

- **Root cause:** `loadEnv()` only `console.warn`s on error, inconsistent with save/delete which show `Alert.alert`.
- **What the fix was:** Show `Alert.alert` on fetch failure when no cache is available.
- **Key lesson:** All user-initiated data operations should provide consistent error feedback.

## Socket Env Var Updates Invisible While Modal Open

- **Root cause:** `ControlScreen.tsx` socket handler (`registerEnvVarsSocketHandlers`) only writes to `SecureStore`, never updates EnvVarModal's local state.
- **What the fix was:** `ControlScreen` maintains `envVars` state, updates it in the socket callback, and passes to `EnvVarModal` via prop. Modal syncs local state on prop change.
- **Key lesson:** Real-time socket updates must propagate to all UI consumers, including open modals.

## No Unmount Guard in EnvVarModal Async Ops

- **Root cause:** State updates fire on unmounted component if modal closes during async fetch/save/delete.
- **What the fix was:** Added `activeRef` boolean checked before every state update.
- **Key lesson:** All components with async operations should guard against state updates after unmount.

## No Retry Logic for Env Var REST Operations

- **Root cause:** `fetchWorkspaceEnv`, `setWorkspaceEnvVar`, `deleteWorkspaceEnvVar` in `envService.ts` call `fetchWithTimeout` once with no retry.
- **What the fix was:** Added `withRetry` helper (2 retries, exponential backoff) wrapping all env var REST calls.
- **Key lesson:** Network operations to remote codespace bridges should have retry logic for transient failures.
