# Keep-Alive & Preview Port

## Virtual Workspace Included in Keep-Alive Loop
- **Root cause:** `local-workspace` matched `status === 'active'` filter; mobile `localhost` resolves to device itself, causing `Network request failed`.
- **Fix:** Add `cs.id !== 'local-workspace'` exclusion guard in keep-alive filters.

## Generic REST Error Obscures API Failure Details
- **Root cause:** Throwing `"GitHub API failed: " + status` without response body hides quota/permission errors.
- **Fix:** Parse response body (JSON then text fallback) before throwing — include body message in error string.

## Dynamic Port Shift Breaks Client Event Listeners
- **Root cause:** Server port shifted from P1 to P2; client filtered events by port, ignored P2 updates, stuck in "starting" state.
- **Fix:** Track `originalPort` in process state and emit in status updates; update client's `selectedServer` port on match.
