# Codespace Bridge Reachability

## Bridge Stuck on "Starting Bridge..." Intermittently
- **Root cause:** GitHub Codespace port-forwarding tunnels are lazy-initialized and can remain dormant/unpropagated until a browser or VS Code desktop session connects to the codespace, causing direct client pings to port 3000 to fail or redirect.
- **Fix:** Prompt the user to open the codespace in their browser to wake up the port-forwarding daemon, and handle authentication/CORS redirections gracefully during reachability checks.
