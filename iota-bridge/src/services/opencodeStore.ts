import {
  OpenCodeApprovalDecision,
  OpenCodeApprovalRequest,
  OpenCodeConversation,
  OpenCodeFileChange,
  OpenCodeMessage,
  OpenCodeToolActivity,
} from '../types/opencode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, logInfo, logError } from './logger';

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
  private lastWorkspaceRoot?: string;

  private pruneOldConversations() {
    const maxConversations = 50;
    const sorted = Array.from(this.conversations.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    if (sorted.length > maxConversations) {
      const toPrune = sorted.slice(maxConversations);
      for (const convo of toPrune) {
        logInfo(`[OpenCodeStore] Pruning old conversation: id=${convo.id}, title=${convo.title || 'Untitled'}`);
        this.conversations.delete(convo.id);
        
        const rootDir = getWorkspaceRoot();
        const filePath = path.join(rootDir, '.iota', 'conversations', `${convo.id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            logError(`[OpenCodeStore] Failed to delete pruned conversation file ${convo.id}.json: ${err}`);
          }
        }
      }
    }
  }

  private ensureLoaded() {
    const rootDir = getWorkspaceRoot();
    if (this.lastWorkspaceRoot !== rootDir) {
      this.lastWorkspaceRoot = rootDir;
      this.conversations.clear();
      this.defaultConversationId = undefined;
      this.loadConversationsFromDisk();
    }
  }

  public loadConversationsFromDisk() {
    const rootDir = getWorkspaceRoot();
    const convoDir = path.join(rootDir, '.iota', 'conversations');
    if (!fs.existsSync(convoDir)) {
      try {
        fs.mkdirSync(convoDir, { recursive: true });
      } catch (err) {
        logError(`[OpenCodeStore] Failed to create conversations directory: ${err}`);
        return;
      }
    }

    try {
      const files = fs.readdirSync(convoDir);
      let latestConvo: OpenCodeConversation | undefined = undefined;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(convoDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const convo = JSON.parse(content) as OpenCodeConversation;
          if (convo && convo.id) {
            this.conversations.set(convo.id, convo);
            if (!latestConvo || new Date(convo.updatedAt) > new Date(latestConvo.updatedAt)) {
              latestConvo = convo;
            }
          }
        } catch (err) {
          logError(`[OpenCodeStore] Failed to load conversation file ${file}: ${err}`);
        }
      }

      if (latestConvo) {
        this.defaultConversationId = latestConvo.id;
      }
      logInfo(`[OpenCodeStore] Loaded ${this.conversations.size} conversations from disk.`);
    } catch (err) {
      logError(`[OpenCodeStore] Failed to read conversations directory: ${err}`);
    }
  }

  public saveConversation(conversation: OpenCodeConversation) {
    const rootDir = getWorkspaceRoot();
    const convoDir = path.join(rootDir, '.iota', 'conversations');
    if (!fs.existsSync(convoDir)) {
      try {
        fs.mkdirSync(convoDir, { recursive: true });
      } catch (err) {
        logError(`[OpenCodeStore] Failed to create conversations directory: ${err}`);
        return;
      }
    }

    const filePath = path.join(convoDir, `${conversation.id}.json`);
    const tempPath = path.join(convoDir, `${conversation.id}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);

    try {
      const data = JSON.stringify(conversation, null, 2);
      fs.writeFileSync(tempPath, data, 'utf8');

      // Atomic rename
      try {
        fs.renameSync(tempPath, filePath);
      } catch (renameErr) {
        // Fallback for Windows or cross-device mount issues
        logError(`[OpenCodeStore] Rename failed, trying copy fallback: ${renameErr}`);
        fs.copyFileSync(tempPath, filePath);
        fs.unlinkSync(tempPath);
      }

      // Prune after successful save
      this.pruneOldConversations();
    } catch (err) {
      logError(`[OpenCodeStore] Failed to save conversation ${conversation.id} atomically: ${err}`);
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
    }
  }

  public getAllConversations(): OpenCodeConversation[] {
    this.ensureLoaded();
    return Array.from(this.conversations.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public deleteConversation(conversationId: string) {
    this.ensureLoaded();
    this.conversations.delete(conversationId);
    
    const rootDir = getWorkspaceRoot();
    const filePath = path.join(rootDir, '.iota', 'conversations', `${conversationId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        logError(`[OpenCodeStore] Failed to delete conversation file ${conversationId}.json: ${err}`);
      }
    }

    if (this.defaultConversationId === conversationId) {
      const sorted = this.getAllConversations();
      this.defaultConversationId = sorted.length > 0 ? sorted[0].id : undefined;
    }
  }

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

  public getOrCreateConversation(conversationId?: string, sessionId?: string, forceNew = false): OpenCodeConversation {
    this.ensureLoaded();
    const existingId = !forceNew && (conversationId || this.defaultConversationId);
    if (existingId && this.conversations.has(existingId)) {
      const conversation = this.conversations.get(existingId)!;
      if (sessionId && !conversation.opencodeSessionId) {
        conversation.opencodeSessionId = sessionId;
        this.saveConversation(conversation);
      }
      return conversation;
    }

    const timestamp = now();
    const next: OpenCodeConversation = {
      id: (conversationId && !forceNew) ? conversationId : id('conversation'),
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
    this.saveConversation(next);
    return next;
  }

  public getConversation(conversationId?: string): OpenCodeConversation | undefined {
    this.ensureLoaded();
    if (conversationId) return this.conversations.get(conversationId);
    return this.defaultConversationId ? this.conversations.get(this.defaultConversationId) : undefined;
  }

  public getSnapshot(conversationId?: string): OpenCodeConversation | undefined {
    this.ensureLoaded();
    const conversation = this.getConversation(conversationId);
    return conversation ? JSON.parse(JSON.stringify(conversation)) : undefined;
  }

  public startRequest(conversationId: string): { ok: true; requestId: string } | { ok: false; message: string } {
    this.ensureLoaded();
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return { ok: false, message: 'Conversation not found.' };
    if (conversation.activeRequestId) return { ok: false, message: 'OpenCode is already running for this conversation.' };
    const requestId = id('request');
    conversation.activeRequestId = requestId;
    conversation.status = 'starting';
    conversation.lastRunPhase = 'preflight';
    conversation.lastError = undefined;
    conversation.updatedAt = now();
    this.saveConversation(conversation);
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
    this.ensureLoaded();
    const conversation = this.getOrCreateConversation(message.conversationId);
    const existingIndex = conversation.messages.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) conversation.messages[existingIndex] = message;
    else conversation.messages.push(message);

    // If this is the first user message, generate a title
    if (message.role === 'user' && (!conversation.title || conversation.title === 'Untitled' || conversation.title.startsWith('opencode-'))) {
      const firstLine = message.content.trim().split('\n')[0].trim();
      let generatedTitle = firstLine;
      if (generatedTitle.length > 40) {
        generatedTitle = generatedTitle.substring(0, 37) + '...';
      }
      conversation.title = generatedTitle || 'Untitled';
    }

    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public appendAssistantDelta(conversationId: string, messageId: string, content: string, done = false): OpenCodeMessage | undefined {
    this.ensureLoaded();
    const conversation = this.conversations.get(conversationId);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (!conversation || !message) return undefined;
    message.content += content;
    message.status = done ? 'complete' : 'streaming';
    conversation.updatedAt = now();
    if (done) {
      this.saveConversation(conversation);
    }
    return message;
  }

  public addTool(activity: OpenCodeToolActivity) {
    this.ensureLoaded();
    const conversation = this.getOrCreateConversation(activity.conversationId);
    const index = conversation.tools.findIndex((item) => item.id === activity.id);
    if (index >= 0) conversation.tools[index] = activity;
    else conversation.tools.push(activity);
    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public addFileChange(change: OpenCodeFileChange) {
    this.ensureLoaded();
    const conversation = this.getOrCreateConversation(change.conversationId);
    conversation.fileChanges.push(change);
    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public addApproval(approval: OpenCodeApprovalRequest) {
    this.ensureLoaded();
    const conversation = this.getOrCreateConversation(approval.conversationId);
    conversation.approvals.push(approval);
    conversation.status = 'awaiting_approval';
    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public resolveApproval(decision: OpenCodeApprovalDecision): OpenCodeApprovalRequest | undefined {
    this.ensureLoaded();
    const conversation = this.conversations.get(decision.conversationId);
    const approval = conversation?.approvals.find((item) => item.id === decision.approvalId && item.status === 'pending');
    if (!conversation || !approval) return undefined;
    approval.status = decision.decision === 'approve' ? 'approved' : 'denied';
    approval.resolvedAt = now();
    conversation.status = conversation.activeRequestId ? 'running' : 'idle';
    conversation.updatedAt = now();
    this.saveConversation(conversation);
    return approval;
  }

  public setSession(conversationId: string, sessionId: string) {
    this.ensureLoaded();
    const conversation = this.getOrCreateConversation(conversationId);
    conversation.opencodeSessionId = sessionId;
    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public syncConversationTitlesWithCli(sessions: any[]) {
    this.ensureLoaded();
    let updated = false;
    for (const session of sessions) {
      if (!session || !session.id || !session.title) continue;
      for (const conversation of this.conversations.values()) {
        if (conversation.opencodeSessionId === session.id) {
          // If the title is not set, or is default/generic, or is a fallback first-line (ends in ellipsis or generic)
          if (!conversation.title || conversation.title === 'Untitled' || conversation.title.startsWith('opencode-') || conversation.title.endsWith('...')) {
            if (conversation.title !== session.title) {
              conversation.title = session.title;
              conversation.updatedAt = now();
              this.saveConversation(conversation);
              updated = true;
            }
          }
        }
      }
    }
    return updated;
  }

  public setRunPhase(conversationId: string, phase: import('../types/opencode').OpenCodeRunPhase) {
    this.ensureLoaded();
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.lastRunPhase = phase;
    if (phase === 'awaiting_first_output') conversation.status = 'awaiting_first_output';
    if (phase === 'streaming') conversation.status = 'running';
    conversation.updatedAt = now();
    this.saveConversation(conversation);
  }

  public finishRequest(conversationId: string, failed = false, options: { stopped?: boolean; errorSummary?: string } = {}) {
    this.ensureLoaded();
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
    this.saveConversation(conversation);
  }
}

export const opencodeStore = new OpenCodeStore();