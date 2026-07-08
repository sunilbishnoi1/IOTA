// Shared Types & Interfaces for IOTA

export interface UserSession {
  githubToken: string;
  username: string;
  avatarUrl: string;
  apiKeys: Record<string, string>;
}

export type CodespaceStatus = 'sleeping' | 'starting' | 'active' | 'stopping';

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  description: string;
  defaultBranch: string;
}

export interface CodespaceVM {
  id: string;
  repositoryName: string;
  branchName: string;
  status: CodespaceStatus;
  freeHoursRemaining: number;
  connectionUrl: string;
  rawState?: string;
}

export type TerminalStatus = 'idle' | 'running' | 'disconnected';

export interface TerminalSessionState {
  sessionId: string;
  processId: number;
  status: TerminalStatus;
  logBuffer: string;
}

export interface DiffHunkLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  file: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  staged?: boolean;
  workingTreeStatus?: string;
  indexStatus?: string;
}

// WebSocket Payloads

export interface HandshakeCredentials {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

export interface HandshakePayload {
  credentials: HandshakeCredentials;
}

export interface AgentStartPayload {
  agent: 'claude-code' | 'opencode' | 'cline';
  prompt: string;
}

export interface TerminalInputPayload {
  input: string;
}

export interface TerminalLogPayload {
  chunk: string;
}

export type AgentStatusType = 'running' | 'idle' | 'error';

export interface AgentStatusPayload {
  status: AgentStatusType;
  details: string;
}

export interface TerminalExitPayload {
  exitCode: number;
  completed: boolean;
}

// Update Types

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  published_at: string;
  assets: GitHubReleaseAsset[];
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  remoteVersion: string | null;
  release: GitHubRelease | null;
  error: string | null;
}

export type UpdateState = 
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; release: GitHubRelease }
  | { status: 'up_to_date'; currentVersion: string }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; fileUri: string; release: GitHubRelease }
  | { status: 'installing' }
  | { status: 'error'; message: string };
