# Preview Flow

## Socket Listener Accumulation on Reconnect
- **Root cause:** Anonymous arrow functions passed to `socket.on()` cannot be removed by `socket.off('event')` — listeners accumulate across reconnects, firing duplicates (80+ log lines per response).
- **Fix:** Store named handler references; return a cleanup function from registration helpers that calls `socket.off('event', ref)`.

## Expo Go Link Fails via `canOpenURL` Check
- **Root cause:** `Linking.canOpenURL('exps://...')` returns `false` on iOS unless the scheme is whitelisted in `LSApplicationQueriesSchemes`; the code had a "bypass" comment but still performed the check.
- **Fix:** Call `Linking.openURL` directly inside try/catch (bypass `canOpenURL`), and add `exp`/`exps` to `ios.infoPlist.LSApplicationQueriesSchemes` in `app.json`.

## REST API Config Call Has No Retry
- **Root cause:** `fetchPreviewConfig()` failed silently with no retry; if bridge was cold-starting, `loadingConfig` stayed `true` forever.
- **Fix:** Replace single REST call with recursive retry loop (3 retries, 2s interval) using an `active` flag for unmount guard.

## Auto-Detection Does Not Persist Config
- **Root cause:** `detectServers()` finds servers correctly but never writes to `.iota/preview.json`.
- **Fix:** By design — Brain (AI Agent) writes the config file; Brawn (Bridge) reads it. `detectServers()` is a fallback when no file exists.

## Socket Client Log Verbosity Spams Console
- **Root cause:** Every `opencode:*` event was logged with full `JSON.stringify(payload)`, including high-frequency events like `run_status` and `message_delta`.
- **Fix:** Log only minimum identifying fields (e.g. `payload?.phase`); for streaming events, log only at terminal state (`done === true`).

## Port 3000 Shift Applied Inconsistently Across Channels
- **Root cause:** WebSocket config handler shifted port 3000→3001, but REST API endpoint did not — client got conflicting ports, stuck in "Starting Dev Server..." forever.
- **Fix:** Apply the port-3000 shift in both REST and WebSocket config handlers; client updates `selectedServer` if the current port is no longer in the refreshed list.

## Port 8081 (Metro) Killed on Preview Start
- **Root cause:** `killProcessOnPort(8081)` killed the running Expo/Metro bundler serving `iota-mobile` itself, crashing the app.
- **Fix:** Add `8081` to `reservedPorts` array; shift preview to `8082` when port conflicts with a reserved port.

## Missing `--port` Flag in Preview Command
- **Root cause:** Regex port replacement is no-op when the command string lacks a `--port` flag; shifted port was never used.
- **Fix:** Append correct port flag for known command prefixes (`--port` for expo, `-p` for next, `--port` for vite) when none exists.

## Null Socket Passed to Extracted Screen Component
- **Root cause:** `PreviewScreen` received `socket={null}` because the socket is created inside `ControlScreen`; handlers silently exited at `if (!socket) return`.
- **Fix:** Expose `onSocketChange` callback from `ControlScreen`; store per-workspace sockets in parent component state.

## Stale State When Switching Local Folders
- **Root cause:** All local workspaces share `id='local-workspace'` — React reused components without remounting when folder changed.
- **Fix:** Key components with both `csId` and `repositoryName` to force fresh mount on folder switch.

## Expo Bundle URL Uses Localhost Inside Codespace
- **Root cause:** Metro generates bundle URLs using `localhost` inside a codespace; mobile device cannot reach container loopback.
- **Fix:** Inject `EXPO_PACKAGER_PROXY_URL` and `REACT_NATIVE_PACKAGER_HOSTNAME` pointing to the public forwarded port URL when spawning Expo inside codespaces.

## Codespace Port Visibility Commands Crash Preview Startup
- **Root cause:** `setPortVisibility()` throws a fatal error if the `gh` CLI is missing or fails in a Codespace, crashing the entire preview startup before spawning the dev server.
- **Fix:** add features block to `devcontainer.json` to install `gh` CLI.

## Stale Configuration Setup State
- **Root cause:** PreviewScreen remained mounted across tab switches and lacked file watching, causing `isPlaceholder: true` setups to remain stale after configurations were updated on disk.
- **Fix:** Implemented an `fs.watch` file watcher in the bridge to broadcast updated configurations, and added a client-side reload on `isVisible` tab activation.

## Next.js Turbopack Workspace Root Inference Failure
- **Root cause:** In containerized environments like Codespaces, Turbopack's workspace root auto-inference incorrectly identifies subdirectories (like `/src/app`) as the project directory, failing to resolve `next/package.json`.
- **Fix:** Set `turbopack.root` to `path.resolve(__dirname)` (or `process.cwd()`) in `next.config.js`, or run `next dev` with `--no-turbo` to bypass Turbopack's root detection.

## Python Flask Command Not Found on Preview Startup
- **Root cause:** Spawned flask commands fail with `flask: not found` if the virtual environment is not activated or `flask` is not in the system `PATH`.
- **Fix:** Use `python -m flask run` instead of `flask run`, or point to the virtual environment binary (`.venv/bin/flask`).

## Icon Fonts Render as CJK Characters in Expo Go Over Port Forwarding
- **Root cause 1 (Metro URL unreachable):** `Font.loadAsync` with a `require()` asset uses `Asset.fromModule()` which generates a Metro-served URL (`http://127.0.0.1:8081/...`). Over Codespaces port forwarding, the phone cannot reach localhost. `expo-font`'s internal Asset download fails, the font is never registered, and PUA codepoints fallback to system font → CJK.
- **Root cause 2 (processFontFamily scoping mismatch):** In Expo Go, `processFontFamily('material')` returns `'ExpoFont-{sessionId}-material'` (via `StyleSheet.setStyleAttributePreprocessor`), but `FontLoaderModule.loadAsync` in the npm `expo-font` has `prefix = ""`, registering the Typeface as `'{sessionId}-material'` without the `ExpoFont-` prefix. The native `ReactFontManager` lookup fails to match, falling back to system font. The actual Expo Go APK may override `prefix = "ExpoFont-"` which would resolve this — but the npm version does not.
- **Fix 1 (download reliability):** Use `ExpoAsset.downloadAsync(url, null, type)` native module directly to download font from CDN URLs (jsdelivr, unpkg, GitHub raw). This bypasses Metro's `Asset.fromModule()` URL resolution entirely.
- **Fix 2 (name mismatch):** After CDN download, register the font TWICE: (a) via `Font.loadAsync({ material: { uri: localUri } })` which sets `loaded['material'] = true` and registers under the scoped name, and (b) via `ExpoFontLoader.loadAsync(processFontFamily('material'), localUri)` to ensure the font is also registered under the exact name that React Native's style preprocessor will look up.

## Duplicate Metro Instance Corrupts Cache During Self-Preview
- **Root cause:** Previewing an Expo Go app that is the same project already serving the host app starts a second `npx expo start` on a shifted port (8082). Two Metro instances for the same project share `.expo/` and cache files, corrupting each other's state — the host Metro then serves a corrupted bundle, crashing Expo Go on next launch.
- **Fix:** In `startPreview()`, check if Metro (port 8081) is already running for expo-go type previews; if so, skip spawning and reuse the existing instance via the same URL.
## Codespaces Port Forwarding Domain Resolution Error
- **Root cause:** getLocalBridgeUrlFromBundle extracted the host from the Metro bundle URL and naively appended :3000. For Github Codespaces (e.g. https://name-8082.app.github.dev), this resulted in an invalid URL https://name-8082.app.github.dev:3000 which caused a 404/network error when fetching preview configurations.
- **Fix:** Added logic to detect .app.github.dev domains and replace the port segment in the subdomain (e.g. -8082.app.github.dev to -3000.app.github.dev) instead of appending a port suffix.

## FetchPreviewConfig Uses bridgeUrl Instead of Codespace ConnectionUrl
- **Root cause:** PreviewScreen's `fetchPreviewConfig()` HTTP calls used the raw `bridgeUrl` prop instead of `activeCodespace.connectionUrl`. In the dev build, `bridgeUrl` is `http://localhost:3000` while the codespace bridge is at the forwarded domain (`.app.github.dev`), causing 404s.
- **Fix:** Replace `bridgeUrl` with `activeCodespace.connectionUrl || bridgeUrl` in both the initial load effect and the visibility-change HTTP fallback in PreviewScreen.

## App Update Shows Current Version as Available
- **Root cause:** `Constants.expoConfig` can be `null` on Android (Expo SDK 51 known bug), causing `getCurrentAppVersion()` fallback to `'0.0.0'` and making `compareVersions('0.6.1', '0.0.0')` > 0, falsely showing update.
- **Fix:** Added `getCurrentAppVersion()` helper that falls back to `Constants.nativeAppVersion` before `'0.0.0'`, since native versionName is reliably set during build.
