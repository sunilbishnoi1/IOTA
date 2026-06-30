# Research Notes: IOTA Platform Architecture & Feasibility

This document consolidates findings and architectural decisions for the IOTA platform, addressing key technical challenges in rendering, pseudo-terminals, security, and authentication.

---

## 1. WebGL Shader Rendering on Mobile

### Decision
Render the fluid mesh noise shader within a full-screen `react-native-webview` loading a local static WebGL canvas HTML file.

### Rationale
- **100% Visual Fidelity**: Allows direct replication of the WebGL fragment shader code from the design mockups (`shader-gradient.md`) without translating GLSL code and noise algorithms to React Native WebGL wrappers.
- **Main Thread Performance**: WebViews run rendering loops on a separate browser thread, preventing the intensive noise-generation calculations (Simplex noise and trigonometry functions) from blocking the React Native JavaScript or UI main threads.
- **Cross-Platform Consistency**: iOS WebKit and Android Chromium WebGL implementations are mature and handle standard canvas context creation and animation loops identically.

### Alternatives Considered
- **`expo-gl` / Native WebGL**: Requires rewriting the shader compilation logic and manually managing vertex buffers in JavaScript. This increases complexity and has a higher risk of platform-specific driver bugs.
- **Static/SVG Gradients**: Lacks the fluid, moving, and interactive noise dynamics of the WebGL canvas, failing the premium design requirements.

---

## 2. Interactive pseudo-terminal (PTY) Spawning on Codespace VM

### Decision
Utilize the native `node-pty` library on the bridge server (`iota-bridge`) to spawn the terminal shell and coding agents (Claude Code, opencode, etc.) as sub-processes.

### Rationale
- **TTY Interactivity**: Coding agents and command-line developer tools expect a live terminal context. If run via standard sub-process spawn, they detect the lack of a TTY and disable interactive features (colors, autocomplete, multi-select menus, inline prompts).
- **Control Sequences**: `node-pty` captures raw terminal control sequences (ANSI escape codes, cursor positioning, colors) and handles standard input (`stdin`) writing, which is forwarded back to the mobile socket stream verbatim.

### Alternatives Considered
- **Node.js `child_process.spawn`**: Rejected because it cannot mock a TTY, causing interactive CLIs to hang, exit, or fail to render menus correctly.
- **SSH Command Injection**: Spawning agents via standard SSH execution is slow, requires handling authentication keys on the client, and does not capture stream updates with minimal latency.

---

## 3. GitHub Device Flow Authentication

### Decision
Implement GitHub OAuth via the Device Authorization Grant flow directly on the mobile app.

### Rationale
- **No Proxy Server Needed**: Device flow enables the client-side app to request a device code, show it on the UI, and direct the user to authorize via GitHub's device activation portal. Once authorized, the app polls GitHub to receive the token directly.
- **Decentralized Security**: No client secret needs to be compiled into the mobile application binary or hosted on a central backend, preventing reverse-engineering key leaks.

### Alternatives Considered
- **OAuth Authorization Code Flow with redirect**: Requires setting up a proxy backend server to handle the redirect URI and securely exchange the auth code for a token (due to client secret secrecy), adding operational costs and security liabilities.

---

## 4. WebSocket Communication Security & Port Forwarding

### Decision
Expose the bridge server over the Codespace forwarded port. Authenticate all incoming WebSocket connections by validating the client-supplied GitHub OAuth token against the GitHub API.

### Rationale
- **Zero Configuration**: GitHub Codespaces provides automatic port forwarding. Secure connections (`wss`) are handled transparently by the Codespace proxy.
- **Access Control**: Since forwarded ports can be queried by anyone if set to public (or requires cookies if private), the bridge server will validate the `Authorization: Bearer <GitHub_Token>` header or socket connection query. The bridge queries the GitHub API (`https://api.github.com/user`) to verify that the token belongs to the Codespace owner before initiating pseudo-terminal processes.

### Alternatives Considered
- **Direct SSH Tunneling**: Requires generating SSH keypairs, uploading the public key to GitHub, and managing a native SSH client library on React Native. This is prone to library configuration issues and increases mobile app footprint.
