# Research Notes: Codespace VM Initialization & Connection Routing

This document outlines the research and decisions for initializing the Codespace VM into one of the user's actual GitHub repositories and dynamically routing connections directly to the VM.

---

## 1. Dynamic Client Connection URL Resolution

### Decision
The mobile client will dynamically resolve the WebSocket and API endpoint URL for the selected Codespace VM instead of connecting to a static local or manual bridge URL.
The port-forwarding URL format for GitHub Codespaces will be constructed as:
`https://<codespace-name>-3000.app.github.dev` (or fallback to `http://localhost:3000` for local dev/testing).

### Rationale
- **Direct Connection**: Adheres to IOTA Constitution Principle III (Decoupled Micro-Bridge Architecture), which forbids intermediate proxy servers.
- **Dynamic Routing**: Allows the mobile client to control any number of active Codespace VMs from the same dashboard by connecting to the corresponding forwarded port.
- **Port Forwarding Authentication**: Under private port visibility, the connection is authenticated by sending the user's GitHub Token via the `Authorization` header during the connection handshake.

### Alternatives Considered
- **Centralized Proxy Server**: Exposing a single gateway server that forwards traffic to active Codespaces. Rejected because it violates Principle III and introduces latency/overhead.
- **Static Bridge URL Configuration**: Requiring the user to copy/paste the Codespace port URL manually. Rejected due to poor user experience.

---

## 2. Workspace Root Directory Resolution

### Decision
The bridge server will execute PTY terminal commands and Git services in the repository root directory rather than its own subdirectory.
We will resolve this path by navigating up to the parent directory of `iota-bridge` (i.e. `path.resolve(process.cwd(), '..')`) or dynamically searching for the `.git` directory in the path hierarchy.

### Rationale
- **Execution Target**: The user's target codebase resides at the repository root `/workspaces/<repository-name>`. Running commands inside the bridge server subdirectory (`iota-bridge`) causes file operations, command tools, and Git diffs to execute in the wrong context.
- **Consistency**: Running in the root ensures git commands (`git diff`, `git add`, `git commit`) accurately reflect the workspace changes of the target repository.

### Alternatives Considered
- **Hardcoded Path**: Using a static path like `/workspaces/<repo>`. Rejected because it fails in local dev environments where the path structure is different.

---

## 3. Codespace Provisioning via GitHub API

### Decision
Implement a repository listing REST endpoint on the bridge (`GET /api/repositories`) and a creation endpoint (`POST /api/codespaces`) that uses Octokit to list repositories and provision new Codespace VMs.

### Rationale
- **Seamless Setup**: Allows the mobile app to offer a "+" button and list repositories, enabling the user to launch a VM directly from their phone.
- **API Support**: GitHub REST API supports `POST /user/codespaces` for the authenticated user, which accepts the repository name and ref.

### Alternatives Considered
- **Manual Codespace Creation**: Forcing the user to create Codespaces via github.com/codespaces. Rejected because it breaks the mobile-first workflow goal.
