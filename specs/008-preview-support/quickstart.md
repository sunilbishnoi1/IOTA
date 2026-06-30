# Quickstart Validation Guide: Preview Support

This guide outlines runnable scenarios and tests to validate the implementation of Expo Go and Web previews in IOTA.

---

## Prerequisites

- Active GitHub Codespace running the workspace.
- The `gh` CLI installed and authenticated inside the Codespace (default on standard Codespaces).
- Physical mobile device running Expo Go app (for native Expo Go preview validation).

---

## 1. Automated Tests

Run the following test commands inside the respective project directories to verify code compliance.

### Backend (`iota-bridge`)
```bash
cd iota-bridge
npm run test -- tests/services/preview.test.ts
```

### Frontend (`iota-mobile`)
```bash
cd iota-mobile
npm run test -- tests/screens/PreviewScreen.test.tsx
```

---

## 2. Manual End-to-End Scenarios

### Scenario A: Expo Go Native Preview

1. Create a dummy preview config in the workspace root at `.iota/preview.json`:
   ```json
   {
     "servers": [
       {
         "name": "Expo Go App",
         "cwd": "iota-mobile",
         "command": "npx expo start",
         "port": 8081,
         "type": "expo-go"
       }
     ]
   }
   ```
2. Open the IOTA mobile app, connect to the running bridge, and navigate to the **Control** -> **Preview** pane.
3. Select "Expo Go App" from the list and tap **Start Preview**.
4. **Expected Outcome (Bridge)**:
   - Metro server spawns inside the `iota-mobile` directory.
   - Command `gh codespace ports visibility 8081:public` executes successfully.
5. **Expected Outcome (Mobile Client)**:
   - WebSocket receives `preview:status` with `running` and `url` mapping to `exps://<codespace-domain>-8081.app.github.dev`.
   - The UI updates to render a QR code and a button "Open in Expo Go".
   - Tapping "Open in Expo Go" launches Expo Go and loads the bundle.
   - Live logs are visible in the collapsible terminal.

---

### Scenario B: Web Application Preview

1. Add a web server to `.iota/preview.json`:
   ```json
   {
     "servers": [
       {
         "name": "IOTA Bridge Web API Docs",
         "cwd": "iota-bridge",
         "command": "npm run dev",
         "port": 3000,
         "type": "web"
       }
     ]
   }
   ```
2. In the IOTA app, select "IOTA Bridge Web API Docs" and tap **Start Preview**.
3. **Expected Outcome (Bridge)**:
   - Node process spawns.
   - Port 3000 set to `public`.
4. **Expected Outcome (Mobile Client)**:
   - UI renders an embedded `WebView` pointing to the public codespace URL for port 3000.
   - Reload button refreshes the WebView.
   - Collapse button hides/shows the log panel.
