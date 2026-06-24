import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

function getWorkspaceRoot(): string {
  if (process.env.CODESPACE_VSCODE_FOLDER) {
    return process.env.CODESPACE_VSCODE_FOLDER;
  }
  return path.resolve(process.cwd(), '..');
}

const execAsync = (cmd: string) => {
  return promisify(exec)(cmd, { cwd: getWorkspaceRoot() });
};

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ChangedFile {
  file: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface GitDiffResponse {
  changedFiles: ChangedFile[];
}

/**
 * Parses raw git diff text into structured JSON hunks.
 */
export function parseGitDiff(diffText: string): GitDiffResponse {
  const changedFiles: ChangedFile[] = [];
  const lines = diffText.split(/\r?\n/);
  
  let currentFile: ChangedFile | null = null;
  let currentHunk: DiffHunk | null = null;
  
  for (const line of lines) {
    if (line.startsWith('diff --git a/')) {
      // Parse file path. Git diff format: diff --git a/path b/path
      // We can use a regex to capture the paths accurately
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        const filePath = match[2];
        currentFile = {
          file: filePath,
          additions: 0,
          deletions: 0,
          hunks: []
        };
        changedFiles.push(currentFile);
        currentHunk = null;
      }
    } else if (line.startsWith('@@ ') && currentFile) {
      // Hunk header e.g. @@ -42,9 +42,12 @@
      currentHunk = {
        header: line.trim(),
        lines: []
      };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'addition',
          content: line
        });
        currentFile!.additions++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'deletion',
          content: line
        });
        currentFile!.deletions++;
      } else if (line.startsWith(' ') || line === '') {
        const content = line.startsWith(' ') ? line.substring(1) : line;
        currentHunk.lines.push({
          type: 'context',
          content
        });
      } else if (line.startsWith('\\')) {
        // Ignore "\ No newline at end of file"
      }
    }
  }
  
  return { changedFiles };
}

/**
 * Fetches the current uncommitted git diff of the repository workspace.
 */
export async function getGitDiff(): Promise<GitDiffResponse> {
  try {
    // Run git diff HEAD to get both staged and unstaged uncommitted changes.
    const { stdout } = await execAsync('git diff HEAD');
    return parseGitDiff(stdout);
  } catch (error: any) {
    // If git diff returns a non-zero exit code due to no commits yet (e.g. empty repo),
    // or if git diff is successful but output is empty, we handle it.
    if (error.message && error.message.includes("bad revision 'HEAD'")) {
      // No initial commit yet. Try git diff relative to empty tree or just return empty.
      try {
        const { stdout } = await execAsync('git diff --cached');
        return parseGitDiff(stdout);
      } catch (innerErr) {
        return { changedFiles: [] };
      }
    }
    console.error('Failed to run git diff:', error);
    throw new Error(`Git diff failed: ${error.message}`);
  }
}

/**
 * Extracts owner/repository from the local git remote URL.
 */
async function getRepoPath(): Promise<string> {
  try {
    const { stdout } = await execAsync('git remote get-url origin');
    const url = stdout.trim();
    const match = url.match(/(?:github\.com[:/])([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    console.warn('Could not read git remote origin url:', e);
  }
  return process.env.GITHUB_REPOSITORY || 'sunilbishnoi1/IOTA';
}

/**
 * Stages, commits, and pushes uncommitted changes to the remote repository branch.
 */
export async function commitAndPush(token: string, message: string): Promise<{ commitHash: string }> {
  try {
    // 1. Get current branch name
    let branch = '';
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD');
      branch = stdout.trim();
    } catch (branchErr: any) {
      throw new Error(`Failed to determine current branch: ${branchErr.message}`);
    }

    if (!branch || branch === 'HEAD') {
      throw new Error('Detached HEAD state. Cannot push changes.');
    }

    // 2. Stage all modifications and additions
    await execAsync('git add -A');

    // 3. Commit changes
    try {
      // Properly escape the commit message to prevent shell injection issues
      const escapedMsg = message.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${escapedMsg}"`);
    } catch (commitErr: any) {
      // If there was nothing to commit, return the current HEAD
      if (commitErr.stdout && (commitErr.stdout.includes('nothing to commit') || commitErr.stdout.includes('no changes added to commit'))) {
        const { stdout: headStdout } = await execAsync('git rev-parse HEAD');
        return { commitHash: headStdout.trim() };
      }
      throw new Error(`Git commit failed: ${commitErr.message}`);
    }

    // 4. Get the resulting commit hash
    const { stdout: hashStdout } = await execAsync('git rev-parse HEAD');
    const commitHash = hashStdout.trim();

    // 5. Push to remote tracking branch using the authenticated GitHub Token.
    // This avoids writing credentials to local git configurations.
    const repoPath = await getRepoPath();
    const pushUrl = `https://x-access-token:${token}@github.com/${repoPath}.git`;
    
    try {
      await execAsync(`git push "${pushUrl}" ${branch}`);
    } catch (pushErr: any) {
      throw new Error(`Git push failed: ${pushErr.message}`);
    }

    return { commitHash };
  } catch (error: any) {
    console.error('Failed in commitAndPush:', error);
    throw error;
  }
}
