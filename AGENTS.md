<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/008-preview-support/plan.md
<!-- SPECKIT END -->

## Learning-Based Error Prevention (`docs/learnings/`)

**Before fixing any issue:** First read all files in `docs/learnings/` to avoid repeating past mistakes.

**When to write:** After resolving a bug/issue (especially one that took multiple attempts).

**What to write:** Root cause (1 sentence) + Fix (1 sentence) — max 3 lines per entry.

**Where to write:** Append to the existing relevant `docs/learnings/*.md` file. Create a new file only if the issue is unrelated to all existing topics.

## Node.js Subprocess Spawning Guidelines

When spawning child processes (`child_process.spawn`) in Node.js that must execute globally installed CLI tools or command wrappers with custom environment `PATH` configurations, follow this pattern:

* **Windows (`win32`)**: Set `shell: true` to support `.cmd`/`.bat` wrappers.
* **Unix/Linux**: Run `/bin/sh` directly with `shell: false` using a manual command-line argument expansion to ensure both custom `env.PATH` resolution is respected and subcommand duplication is prevented:
  ```typescript
  const env = { ...process.env, PATH: customPath };
  const child = process.platform === 'win32'
    ? spawn(command, args, { cwd, env, shell: true })
    : spawn('/bin/sh', ['-c', `${command} "$@"`, '--', ...args], { cwd, env, shell: false });
  ```

## TypeScript Compilation Check
Always run TS/TSX error/compilation checks in the codebase after any code changes (especially inside `iota-mobile` or `iota-bridge`) to ensure no compilation or typescript errors are introduced.

## Workspace Preview Configuration (`.iota/preview.json`)

When asked to configure or generate preview settings for the workspace, inspect the project's codebase to detect the framework (e.g. React Native/Expo, Vite, Next.js, Flutter Web, static HTML). Then, create or update `.iota/preview.json` at the root of the workspace.

The file MUST adhere to this format:
```json
{
  "servers": [
    {
      "name": "Expo Go App", // User-friendly name
      "cwd": "iota-mobile", // Working directory path relative to workspace root (defaults to ".")
      "command": "npx expo start", // Command to start the server
      "port": 8081, // Target port number
      "type": "expo-go" // 'expo-go' | 'web'
    }
  ]
}
```

### Auto-Detection Heuristics:
1. **Expo / React Native**: Check if `package.json` contains `"expo"` dependency. Command: `"npx expo start"`, Port: `8081`, Type: `"expo-go"`.
2. **Web (Vite, Next.js, React, Vue, Svelte, etc.)**: Check for package dependencies or config files. Use the package dev command (e.g. `"npm run dev"` or `"next dev"`), detect the default port (e.g. `3000`, `5173`), Type: `"web"`.
3. **Flutter Web**: Check for `pubspec.yaml`. Command: `"flutter run -d web-server --web-port 8080 --web-hostname 0.0.0.0"`, Port: `8080`, Type: `"web"`.