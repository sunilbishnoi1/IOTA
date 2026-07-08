export type OpenCodeCapabilityStatus =
  | 'checking'
  | 'available'
  | 'missing'
  | 'installing'
  | 'install_failed'
  | 'installed_uninitialized'
  | 'credentials_missing'
  | 'server_unavailable'
  | 'unavailable';

export interface OpenCodeCapabilityState {
  status: OpenCodeCapabilityStatus;
  details: string;
  canSubmit: boolean;
  canInstall: boolean;
  lastCheckedAt: string;
  errorSummary?: string;
}

export type OpenCodeConversationStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'reconnecting';

export type OpenCodeMessageRole = 'user' | 'assistant' | 'system' | 'status';
export type OpenCodeMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'stopped';

export type OpenCodeRunPhase =
  | 'connecting'
  | 'session_created'
  | 'prompt_sent'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface OpenCodePromptStatusEvent {
  conversationId: string;
  requestId: string;
  phase: OpenCodeRunPhase;
  message: string;
  retryable?: boolean;
}

export interface OpenCodePart {
  id: string;
  type: 'text' | 'reasoning' | 'tool' | 'step-start' | 'step-finish' | 'file' | 'patch' | 'snapshot' | 'agent' | 'retry' | 'compaction';
  text?: string;
  delta?: string;
  tool?: string;
  callID?: string;
  state?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: string;
  error?: string;
  mime?: string;
  filename?: string;
  url?: string;
  time?: { start: string; end?: string };
  metadata?: Record<string, unknown>;
}

export interface OpenCodeMessage {
  id: string;
  conversationId: string;
  role: OpenCodeMessageRole;
  content: string;
  createdAt: string;
  status: OpenCodeMessageStatus;
  metadata?: Record<string, unknown>;
  parts?: OpenCodePart[];
}

export type OpenCodeToolKind = 'command' | 'file_read' | 'file_write' | 'search' | 'test' | 'other';
export type OpenCodeToolStatus = 'started' | 'running' | 'completed' | 'failed';

export interface OpenCodeToolActivity {
  id: string;
  conversationId: string;
  label: string;
  kind: OpenCodeToolKind;
  status: OpenCodeToolStatus;
  summary?: string;
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface OpenCodeDiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
}

export interface OpenCodeDiffHunk {
  header: string;
  lines: OpenCodeDiffLine[];
}

export interface OpenCodeFileChange {
  id: string;
  conversationId: string;
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: OpenCodeDiffHunk[];
  createdAt: string;
}

export interface OpenCodeApprovalRequest {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  resolvedAt?: string;
}

export interface OpenCodeTokenUsage {
  cost?: number;
  tokens?: Record<string, unknown>;
}

export interface OpenCodeConversation {
  id: string;
  opencodeSessionId?: string;
  title?: string;
  status: OpenCodeConversationStatus;
  messages: OpenCodeMessage[];
  tools: OpenCodeToolActivity[];
  fileChanges: OpenCodeFileChange[];
  approvals: OpenCodeApprovalRequest[];
  createdAt: string;
  updatedAt: string;
  activeRequestId?: string;
  lastRunPhase?: OpenCodeRunPhase;
  lastError?: string;
  activeModel?: string;
  tokenUsage?: OpenCodeTokenUsage;
}

export interface FilePart {
  type: 'file';
  mime: string;
  url: string;
  filename?: string;
}

export interface OpenCodeMessageRequest {
  conversationId?: string;
  sessionId?: string;
  content: string;
  parts?: FilePart[];
}

export interface OpenCodeApprovalDecision {
  conversationId: string;
  approvalId: string;
  decision: 'once' | 'always' | 'reject';
}

export interface OpenCodeSyncRequest {
  conversationId?: string;
}

export interface OpenCodeQuestionOption {
  label: string;
  description?: string;
}

export interface OpenCodeQuestionItem {
  question: string;
  header?: string;
  options?: OpenCodeQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface OpenCodeQuestionRequest {
  id: string;
  conversationId: string;
  questions: OpenCodeQuestionItem[];
  tool?: string;
  createdAt: string;
}

export interface OpenCodeStopRequest {
  conversationId: string;
}

