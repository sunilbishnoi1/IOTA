export type OpenCodeCapabilityStatus =
  | 'checking'
  | 'available'
  | 'missing'
  | 'installing'
  | 'install_failed'
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
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'reconnecting';

export type OpenCodeMessageRole = 'user' | 'assistant' | 'system' | 'status';
export type OpenCodeMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

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
