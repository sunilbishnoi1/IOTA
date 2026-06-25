import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

function getWorkspaceRoot(): string {
  if (process.env.CODESPACE_VSCODE_FOLDER) {
    return process.env.CODESPACE_VSCODE_FOLDER;
  }
  return path.resolve(process.cwd(), '..');
}

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync('git', args, {
    cwd: getWorkspaceRoot(),
    maxBuffer: 20 * 1024 * 1024,
  });
}

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
  staged?: boolean;
  workingTreeStatus?: string;
  indexStatus?: string;
}

export interface GitDiffResponse {
  changedFiles: ChangedFile[];
}

interface GitStatusEntry {
  file: string;
  indexStatus: string;
  workingTreeStatus: string;
  staged: boolean;
}

export function parseGitDiff(diffText: string): GitDiffResponse {
  const changedFiles: ChangedFile[] = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile: ChangedFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git a/')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        currentFile = {
          file: match[2],
          additions: 0,
          deletions: 0,
          hunks: [],
        };
        changedFiles.push(currentFile);
        currentHunk = null;
      }
    } else if (line.startsWith('+++ ') && currentFile) {
      const nextPath = line.replace(/^\+\+\+\s+b\//, '').trim();
      if (nextPath && nextPath !== '/dev/null') currentFile.file = nextPath;
    } else if (line.startsWith('@@ ') && currentFile) {
      currentHunk = { header: line.trim(), lines: [] };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk && currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'addition', content: line.substring(1) });
        currentFile.additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'deletion', content: line.substring(1) });
        currentFile.deletions++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'context', content: line.startsWith(' ') ? line.substring(1) : line });
      }
    }
  }

  return { changedFiles };
}

function parseStatusPorcelain(output: string): GitStatusEntry[] {
  const records = output.split('\0').filter(Boolean);
  const entries: GitStatusEntry[] = [];

  for (let index = 0; index < records.length; index++) {
    const entry = records[index];
    const indexStatus = entry[0] || ' ';
    const workingTreeStatus = entry[1] || ' ';
    const file = entry.slice(3);

    entries.push({
      file,
      indexStatus,
      workingTreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
    });

    if (indexStatus === 'R' || indexStatus === 'C') index += 1;
  }

  return entries;
}

async function getFileDiff(file: string): Promise<ChangedFile> {
  try {
    const { stdout } = await git(['diff', 'HEAD', '--', file]);
    const parsed = parseGitDiff(stdout).changedFiles[0];
    if (parsed) return parsed;
  } catch (error: any) {
    if (!String(error?.message || '').includes('bad revision')) throw error;
  }

  try {
    const { stdout } = await git(['diff', '--no-index', '--', '/dev/null', file]);
    const parsed = parseGitDiff(stdout).changedFiles[0];
    if (parsed) return { ...parsed, file };
  } catch (error: any) {
    const parsed = parseGitDiff(error.stdout || '').changedFiles[0];
    if (parsed) return { ...parsed, file };
  }

  return { file, additions: 0, deletions: 0, hunks: [] };
}

export async function getGitDiff(): Promise<GitDiffResponse> {
  try {
    const { stdout } = await git(['status', '--porcelain=v1', '-z']);
    const statusEntries = parseStatusPorcelain(stdout);
    const files = await Promise.all(statusEntries.map(async (entry) => ({
      ...(await getFileDiff(entry.file)),
      file: entry.file,
      staged: entry.staged,
      workingTreeStatus: entry.workingTreeStatus,
      indexStatus: entry.indexStatus,
    })));
    return { changedFiles: files };
  } catch (error: any) {
    console.error('Failed to read git changes:', error);
    throw new Error(`Git diff failed: ${error.message}`);
  }
}

export async function stageFiles(files: string[]): Promise<GitDiffResponse> {
  const normalized = files.map((file) => file.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error('At least one file must be selected for staging.');
  await git(['add', '--', ...normalized]);
  return await getGitDiff();
}

export async function unstageFiles(files: string[]): Promise<GitDiffResponse> {
  const normalized = files.map((file) => file.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error('At least one file must be selected for unstaging.');
  try {
    await git(['restore', '--staged', '--', ...normalized]);
  } catch (error: any) {
    if (String(error?.message || '').includes('unknown switch')) {
      await git(['reset', 'HEAD', '--', ...normalized]);
    } else {
      throw error;
    }
  }
  return await getGitDiff();
}

export async function getRepoPath(): Promise<string> {
  try {
    const { stdout } = await git(['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    const match = url.match(/(?:github\.com[:/])([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch (e) {
    console.warn('Could not read git remote origin url:', e);
  }
  return process.env.GITHUB_REPOSITORY || 'sunilbishnoi1/IOTA';
}

export async function getBranch(): Promise<string> {
  try {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  } catch (error: any) {
    console.warn('Could not read current git branch:', error);
    return 'main';
  }
}

async function hasStagedChanges(): Promise<boolean> {
  try {
    await git(['diff', '--cached', '--quiet']);
    return false;
  } catch (error: any) {
    return error.code === 1;
  }
}

export async function commitAndPush(token: string, message: string): Promise<{ commitHash: string }> {
  try {
    const branch = await getBranch();
    if (!branch || branch === 'HEAD') throw new Error('Detached HEAD state. Cannot push changes.');
    if (!(await hasStagedChanges())) throw new Error('No staged changes to commit. Stage at least one file first.');

    await git(['commit', '-m', message]);

    const { stdout: hashStdout } = await git(['rev-parse', 'HEAD']);
    const commitHash = hashStdout.trim();

    const repoPath = await getRepoPath();
    const pushUrl = `https://x-access-token:${token}@github.com/${repoPath}.git`;
    await git(['push', pushUrl, branch]);

    return { commitHash };
  } catch (error: any) {
    console.error('Failed in commitAndPush:', error);
    throw error;
  }
}
