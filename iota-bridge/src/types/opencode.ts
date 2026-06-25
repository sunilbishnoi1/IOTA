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
  lastCheckedAt: string;
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
  opencodeSessionId?: string;
  status: OpenCodeConversationStatus;
  messages: OpenCodeMessage[];
  tools: OpenCodeToolActivity[];
  fileChanges: OpenCodeFileChange[];
  approvals: OpenCodeApprovalRequest[];
  createdAt: string;
  updatedAt: string;
  activeRequestId?: string;
}

export interface OpenCodeMessageRequest {
  conversationId?: string;
  sessionId?: string;
  content: string;
}

export interface OpenCodeApprovalDecision {
  conversationId: string;
  approvalId: string;
  decision: 'approve' | 'deny';
}

export interface OpenCodeSyncRequest {
  conversationId?: string;
}

export interface OpenCodeStopRequest {
  conversationId: string;
}

export type NormalizedOpenCodeEvent =
  | { type: 'message_delta'; conversationId: string; messageId: string; content: string; done: boolean }
  | { type: 'message'; conversationId: string; message: OpenCodeMessage }
  | { type: 'tool_activity'; conversationId: string; activity: OpenCodeToolActivity }
  | { type: 'file_change'; conversationId: string; change: OpenCodeFileChange }
  | { type: 'approval_request'; conversationId: string; approval: OpenCodeApprovalRequest }
  | { type: 'session'; conversationId: string; sessionId: string }
  | { type: 'error'; conversationId?: string; code: string; message: string; retryable: boolean };
