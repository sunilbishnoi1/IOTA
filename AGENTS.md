<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/013-fix-chat-deletion-behavior/plan.md
<!-- SPECKIT END -->

------------------------------------------------
## Project Rules (Must Follow):
- never push any changes (or commit changes) to remote github repo without asking the user and gettting confirmation from user.
- If the fix for any problem/issue is not obvious or clear even after reading all the relevant code files and you are not confident about the fix. then you must first only add logs wherever needed (and not make any code changes) and then ask user to test and provide logs so that you can get better idea about the issue repeat it untill your not confident about the fix.

- Make sure to not add any unnecessary comments which are obvious or not needed as per swe standards
------------------------------------------------

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


