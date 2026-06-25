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
