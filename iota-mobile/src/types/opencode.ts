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
  | 'awaiting_approval'
  | 'awaiting_question'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'reconnecting';

export type OpenCodeMessageRole = 'user' | 'assistant' | 'system' | 'status';
export type OpenCodeMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'stopped';

export interface OpenCodeMessage {
  id: string;
  conversationId: string;
  role: OpenCodeMessageRole;
  content: string;
  createdAt: string;
  status: OpenCodeMessageStatus;
  metadata?: Record<string, unknown>;
  parts?: Part[];
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

export interface OpenCodeApprovalResource {
  action: string;
  paths?: string[];
  description?: string;
}

export interface OpenCodeApprovalRequest {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'expired';
  resources?: OpenCodeApprovalResource[];
  createdAt: string;
  resolvedAt?: string;
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

export interface OpenCodeConversation {
  id: string;
  sessionId?: string;
  opencodeSessionId?: string;
  title?: string;
  status: OpenCodeConversationStatus;
  messages: OpenCodeMessage[];
  tools?: OpenCodeToolActivity[];
  fileChanges?: OpenCodeFileChange[];
  approvals?: OpenCodeApprovalRequest[];
  activeRequestId?: string;
  lastError?: string;
  activeModel?: string;
  activeVariant?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModelVariant {
  id: string;
  description: string;
}

export interface ModelInfo {
  providerID: string;
  modelID: string;
  name: string;
  variants: ModelVariant[];
}

export interface AvailableModels {
  models: ModelInfo[];
  activeModel?: string;
  activeVariant?: string;
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

// ── V2Event types (from opencode SDK types.gen.ts) ──────────────────────

export type V2Event = {
  id: string
  type: string
  properties: {
    timestamp: number
    sessionID: string
    assistantMessageID?: string
    [key: string]: any
  }
}

// ── GlobalEvent wrapper ─────────────────────────────────────────────────

export type GlobalEvent = {
  directory: string
  project?: string
  workspace?: string
  payload: V2Event
}

// ── Tool state (discriminated union) ────────────────────────────────────

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string; metadata: object; time: { start: number; end: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }

// ── Part data model (12 types) ──────────────────────────────────────────

export type Part =
  | { type: "text"; id: string; sessionID: string; messageID: string; text: string; time?: { start: number; end?: number } }
  | { type: "reasoning"; id: string; sessionID: string; messageID: string; text: string; time: { start: number; end?: number } }
  | { type: "tool"; id: string; sessionID: string; messageID: string; callID: string; tool: string; state: ToolState }
  | { type: "subtask"; id: string; sessionID: string; messageID: string; callID: string; childSessionID?: string; prompt: string; description: string; agent: string; status: 'pending' | 'running' | 'completed' | 'failed' }
  | { type: "file"; id: string; sessionID: string; messageID: string; mime: string; filename?: string; url: string }
  | { type: "step-start"; id: string; sessionID: string; messageID: string; snapshot?: string }
  | { type: "step-finish"; id: string; sessionID: string; messageID: string; reason: string; cost: number; tokens: object }
  | { type: "snapshot"; id: string; sessionID: string; messageID: string; snapshot: string }
  | { type: "patch"; id: string; sessionID: string; messageID: string; hash: string; files: string[] }
  | { type: "agent"; id: string; sessionID: string; messageID: string; name: string }
  | { type: "retry"; id: string; sessionID: string; messageID: string; attempt: number; error: object }
  | { type: "compaction"; id: string; sessionID: string; messageID: string; auto: boolean }

// ── FilePart (for upload — no server-controlled fields) ─────────────────

export interface FilePart {
  type: 'file';
  mime: string;
  url: string;
  filename?: string;
}

// ── Message model (new typed message for part-based flow) ───────────────

export type Message = {
  id: string
  sessionID: string
  role: "user" | "assistant" | "system"
  time: { created: number; completed?: number }
  error?: object
  parentID?: string
  modelID?: string
  providerID?: string
  parts?: Part[]
}

// ── Thinking modes ──────────────────────────────────────────────────────

export type ThinkingMode = "show" | "hide"

// ── Subtask session state ───────────────────────────────────────────────

export interface SubtaskSession {
  callID: string;
  parentSessionID: string;
  childSessionID?: string;
  prompt: string;
  description: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  messages: Message[];
  errors?: string[];
  createdAt: number;
  completedAt?: number;
}
