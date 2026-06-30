<!--
SYNC IMPACT REPORT
- Version change: N/A -> 1.0.0
- List of modified principles:
  - Initial ratification of IOTA core principles (I-V).
- Added sections:
  - Security & Compute Resource Limits (Section 2)
  - Development Workflow & Quality Gates (Section 3)
- Removed sections:
  - None.
- Templates requiring updates:
  - None (templates are generic and do not contain project-specific principle text).
- Follow-up TODOs:
  - None.
-->

# IOTA Platform Constitution

## Core Principles

### I. Decentralized & Transient Secret Management
All user secrets (such as GitHub OAuth tokens and LLM API keys) MUST be stored exclusively on the mobile device (`Expo SecureStore`). The remote Codespace bridge server MUST NOT write secrets to persistent storage. Instead, the mobile client MUST inject these secrets dynamically into the environment variables of active terminal/agent processes.
*Rationale*: Ensures user privacy, prevents credential leaks, and maintains zero retention of keys on the remote Codespace VM disk.

### II. Mobile-First Optimization & Performance
The mobile application (React Native/Expo) MUST target 60 FPS rendering. Large terminal logs MUST use a virtualized flat list structure to prevent JS thread blockage. Backdrop blurs MUST use native `BlurView` on iOS and degrade gracefully to a semi-transparent, high-opacity dark overlay on Android to ensure smooth rendering on both platforms.
*Rationale*: Delivers a premium, high-fidelity experience without causing memory overflow, performance lag, or excessive battery drain on mobile devices.

### III. Decoupled Micro-Bridge Architecture
The application MUST be separated into a mobile client and a lightweight Node.js/TypeScript bridge server. Communication between them MUST happen directly via secure WebSockets (`wss://`) and REST APIs using GitHub's port-forwarding mechanism. There MUST be no intermediate proxy server handling code, telemetry, or credentials.
*Rationale*: Guarantees direct connection, minimal latency, and zero middleman overhead or security compromise.

### IV. Dynamic VM Provisioning
The remote bridge server MUST dynamically inspect the Codespace VM environment for the target CLI agent (e.g. OpenCode, Claude Code, Cline). If the agent is missing, the bridge server MUST install it automatically in the background. The mobile app MUST NOT require manual setup steps on the remote VM.
*Rationale*: Ensures a seamless zero-configuration setup for developers, enabling them to control the platform directly from their phone.

### V. Test-First Implementation & Validation
No feature implementation code is considered complete without automated tests. The mobile client code MUST be tested using Jest and React Native Testing Library. The bridge server API code MUST be tested using Jest and Supertest. All core scenarios (e.g. login flow, log streaming, diff review) MUST have corresponding integration verification.
*Rationale*: Guarantees code correctness, prevents regression bugs across platform versions, and ensures reliable functionality in the field.

## Security & Compute Resource Limits
- **Compute Hour Monitoring**: The mobile dashboard MUST check and display remaining GitHub Codespace free hours. If hours are fully depleted, it MUST block VM startup and show a clear error modal.
- **Process Isolation**: Spawning of agent commands MUST use a pseudo-terminal (`node-pty`) on the bridge server to isolate runtimes.
- **Automatic Session Teardown**: The bridge server MUST clear all injected environment credentials as soon as the active WebSocket session disconnects or the agent job completes.

## Development Workflow & Quality Gates
- **Plan-Spec-Task Discipline**: Any change to code or architecture MUST start with a spec and plan in the `specs/` directory, following the Spec Kit process.
- **PR and Commit Standards**: Commits and pull requests MUST follow semantic commit messages (e.g. `feat: ...`, `fix: ...`, `docs: ...`). All commits affecting the constitution or key architectures MUST reference the relevant principles.
- **Automatic Linting**: Pre-commit hooks or CI checks MUST run ESLint and Prettier to enforce consistent styling before code is merged.

## Governance
The IOTA Constitution represents the source of truth for all project design and implementation constraints. Any amendment to the Constitution requires a version bump (Major for backward incompatible changes, Minor for new rules, Patch for corrections) and updating all dependent templates in `.specify/templates/`.
All PRs/reviews must verify compliance. Complexity must be justified. Use [AGENTS.md](file:///d:/Desktop/codes/IOTA/AGENTS.md) as the runtime entry point for agent instructions.

**Version**: 1.0.0 | **Ratified**: 2026-06-24 | **Last Amended**: 2026-06-24
