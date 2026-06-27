import {
  OpenCodeApprovalDecision,
  OpenCodeApprovalRequest,
  OpenCodeConversation,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
} from '../types/opencode';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SUPPORTED_PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
];

const sanitizeSummary = (summary?: string): string | undefined => {
  if (!summary) return undefined;
  return summary.trim().replace(/[\r\n]+/g, ' ');
};

class OpenCodeStore {
  private conversations = new Map<string, OpenCodeConversation>();
  private defaultConversationId?: string;
  private credentialsBySocket = new Map<string, Record<string, string>>();

  public setCredentials(socketId: string, credentials: Record<string, string>) {
    this.credentialsBySocket.set(socketId, { ...credentials });
  }

  public getCredentials(socketId: string): Record<string, string> {
    return this.credentialsBySocket.get(socketId) || {};
  }

  public hasTransientCredentials(socketId: string): boolean {
    const credentials = this.getCredentials(socketId);
    return SUPPORTED_PROVIDER_KEYS.some((key) => Boolean(credentials[key]?.trim()));
  }

  public cleanupCredentials(socketId: string) {
    this.credentialsBySocket.delete(socketId);
  }

  public getOrCreateConversation(conversationId?: string, sessionId?: string): OpenCodeConversation {
    const existingId = conversationId || this.defaultConversationId;
    if (existingId && this.conversations.has(existingId)) {
      const conversation = this.conversations.get(existingId)!;
      if (sessionId && !conversation.opencodeSessionId) conversation.opencodeSessionId = sessionId;
      return conversation;
    }

    const timestamp = now();
    const next: OpenCodeConversation = {
      id: conversationId || id('conversation'),
      opencodeSessionId: sessionId,
      status: 'idle',
      messages: [],
      tools: [],
      fileChanges: [],
      approvals: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.conversations.set(next.id, next);
    this.defaultConversationId = next.id;
    return next;
  }

  public getConversation(conversationId?: string): OpenCodeConversation | undefined {
    if (conversationId) return this.conversations.get(conversationId);
    return this.defaultConversationId ? this.conversations.get(this.defaultConversationId) : undefined;
  }

  public getSnapshot(conversationId?: string): OpenCodeConversation | undefined {
    const conversation = this.getConversation(conversationId);
    return conversation ? JSON.parse(JSON.stringify(conversation)) : undefined;
  }

  public startRequest(conversationId: string): { ok: true; requestId: string } | { ok: false; message: string } {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return { ok: false, message: 'Conversation not found.' };
    if (conversation.activeRequestId) return { ok: false, message: 'OpenCode is already running for this conversation.' };
    const requestId = id('request');
    conversation.activeRequestId = requestId;
    conversation.status = 'starting';
    conversation.lastRunPhase = 'preflight';
    conversation.lastError = undefined;
    conversation.updatedAt = now();
    return { ok: true, requestId };
  }

  public addUserMessage(conversationId: string, content: string): OpenCodeMessage {
    const message: OpenCodeMessage = {
      id: id('user'),
      conversationId,
      role: 'user',
      content,
      createdAt: now(),
      status: 'complete',
    };
    this.addMessage(message);
    return message;
  }

  public createAssistantMessage(conversationId: string): OpenCodeMessage {
    const message: OpenCodeMessage = {
      id: id('assistant'),
      conversationId,
      role: 'assistant',
      content: '',
      createdAt: now(),
      status: 'streaming',
    };
    this.addMessage(message);
    return message;
  }

  public addMessage(message: OpenCodeMessage) {
    const conversation = this.getOrCreateConversation(message.conversationId);
    const existingIndex = conversation.messages.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) conversation.messages[existingIndex] = message;
    else conversation.messages.push(message);
    conversation.updatedAt = now();
  }

  public appendAssistantDelta(conversationId: string, messageId: string, content: string, done = false): OpenCodeMessage | undefined {
    const conversation = this.conversations.get(conversationId);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (!conversation || !message) return undefined;
    message.content += content;
    message.status = done ? 'complete' : 'streaming';
    conversation.updatedAt = now();
    return message;
  }

  public addTool(activity: OpenCodeToolActivity) {
    const conversation = this.getOrCreateConversation(activity.conversationId);
    const index = conversation.tools.findIndex((item) => item.id === activity.id);
    if (index >= 0) conversation.tools[index] = activity;
    else conversation.tools.push(activity);
    conversation.updatedAt = now();
  }

  public addFileChange(change: OpenCodeFileChange) {
    const conversation = this.getOrCreateConversation(change.conversationId);
    conversation.fileChanges.push(change);
    conversation.updatedAt = now();
  }

  public addApproval(approval: OpenCodeApprovalRequest) {
    const conversation = this.getOrCreateConversation(approval.conversationId);
    conversation.approvals.push(approval);
    conversation.status = 'awaiting_approval';
    conversation.updatedAt = now();
  }

  public resolveApproval(decision: OpenCodeApprovalDecision): OpenCodeApprovalRequest | undefined {
    const conversation = this.conversations.get(decision.conversationId);
    const approval = conversation?.approvals.find((item) => item.id === decision.approvalId && item.status === 'pending');
    if (!conversation || !approval) return undefined;
    approval.status = decision.decision === 'approve' ? 'approved' : 'denied';
    approval.resolvedAt = now();
    conversation.status = conversation.activeRequestId ? 'running' : 'idle';
    conversation.updatedAt = now();
    return approval;
  }

  public setSession(conversationId: string, sessionId: string) {
    const conversation = this.getOrCreateConversation(conversationId);
    conversation.opencodeSessionId = sessionId;
    conversation.updatedAt = now();
  }

  public setRunPhase(conversationId: string, phase: import('../types/opencode').OpenCodeRunPhase) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.lastRunPhase = phase;
    if (phase === 'awaiting_first_output') conversation.status = 'awaiting_first_output';
    if (phase === 'streaming') conversation.status = 'running';
    conversation.updatedAt = now();
  }

  public finishRequest(conversationId: string, failed = false, options: { stopped?: boolean; errorSummary?: string } = {}) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.activeRequestId = undefined;
    conversation.status = options.stopped ? 'stopped' : failed ? 'failed' : 'completed';
    conversation.lastRunPhase = options.stopped ? 'stopped' : failed ? 'failed' : 'completed';
    conversation.lastError = failed || options.stopped ? sanitizeSummary(options.errorSummary) : undefined;
    for (const message of conversation.messages) {
      if (message.role === 'assistant' && (message.status === 'streaming' || message.status === 'pending')) {
        message.status = options.stopped ? 'stopped' : failed ? 'error' : 'complete';
        if (!message.content.trim() && (failed || options.stopped)) {
          message.content = options.errorSummary || (options.stopped ? 'OpenCode run stopped.' : 'OpenCode run failed.');
        }
      }
    }
    for (const tool of conversation.tools) {
      if (tool.status === 'started' || tool.status === 'running') {
        tool.status = options.stopped ? 'failed' : failed ? 'failed' : 'completed';
        tool.completedAt = now();
      }
    }
    conversation.updatedAt = now();
  }
}

export const opencodeStore = new OpenCodeStore();