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
  lastCheckedAt?: string;
  errorSummary?: string;
}

export type OpenCodeConversationStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'awaiting_first_output'
  | 'awaiting_approval'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'reconnecting';

export type OpenCodeMessageRole = 'user' | 'assistant' | 'system' | 'status';
export type OpenCodeMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'stopped';

export type OpenCodeRunPhase =
  | 'preflight'
  | 'server_start'
  | 'direct_run'
  | 'attached_run'
  | 'spawned'
  | 'awaiting_first_output'
  | 'streaming'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface OpenCodeRunStatusEvent {
  conversationId: string;
  requestId: string;
  phase: OpenCodeRunPhase;
  message: string;
  retryable?: boolean;
}

export interface OpenCodeMessage {
  id: string;
  conversationId: string;
  role: OpenCodeMessageRole;
  content: string;
  createdAt: string;
  status: OpenCodeMessageStatus;
  metadata?: Record<string, unknown>;
}

export interface OpenCodeToolActivity {
  id: string;
  conversationId: string;
  label: string;
  kind: 'command' | 'file_read' | 'file_write' | 'search' | 'test' | 'other';
  status: 'started' | 'running' | 'completed' | 'failed';
  summary?: string;
  startedAt: string;
  completedAt?: string;
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

export interface OpenCodeConversation {
  id: string;
  sessionId?: string;
  opencodeSessionId?: string;
  status: OpenCodeConversationStatus;
  messages: OpenCodeMessage[];
  tools?: OpenCodeToolActivity[];
  fileChanges?: OpenCodeFileChange[];
  approvals?: OpenCodeApprovalRequest[];
  activeRequestId?: string;
  lastRunPhase?: OpenCodeRunPhase;
  lastError?: string;
}

export interface OpenCodeTimelineState {
  conversationId?: string;
  sessionId?: string;
  messages: OpenCodeMessage[];
  tools: OpenCodeToolActivity[];
  fileChanges: OpenCodeFileChange[];
  approvals: OpenCodeApprovalRequest[];
  running: boolean;
}
