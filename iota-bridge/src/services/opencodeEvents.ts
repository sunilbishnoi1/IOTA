import {
  NormalizedOpenCodeEvent,
  OpenCodeApprovalRequest,
  OpenCodeDiffHunk,
  OpenCodeFileChange,
  OpenCodeToolActivity,
  OpenCodeToolKind,
} from '../types/opencode';

const now = () => new Date().toISOString();

const valueAsString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const stableId = (prefix: string, payload: Record<string, unknown>): string => {
  const explicit = valueAsString(payload.id) || valueAsString(payload.messageId) || valueAsString(payload.requestId);
  return explicit || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const mapToolKind = (tool?: string): OpenCodeToolKind => {
  const normalized = (tool || '').toLowerCase();
  if (normalized.includes('command') || normalized.includes('shell') || normalized.includes('bash')) return 'command';
  if (normalized.includes('read')) return 'file_read';
  if (normalized.includes('write') || normalized.includes('edit')) return 'file_write';
  if (normalized.includes('search') || normalized.includes('grep')) return 'search';
  if (normalized.includes('test')) return 'test';
  return 'other';
};

export function parseUnifiedPatch(patch: string): Pick<OpenCodeFileChange, 'hunks' | 'additions' | 'deletions' | 'filePath' | 'changeType'> {
  const lines = patch.split(/\r?\n/);
  const hunks: OpenCodeDiffHunk[] = [];
  let filePath = 'unknown';
  let additions = 0;
  let deletions = 0;
  let current: OpenCodeDiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('new file ') || line.startsWith('deleted file ')) {
      continue;
    }
    if (line.startsWith('--- ')) {
      continue;
    }
    if (line.startsWith('+++ ')) {
      filePath = line.replace(/^\+\+\+\s+b?\//, '').trim() || filePath;
      continue;
    }
    if (line.startsWith('@@')) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+')) {
      additions += 1;
      current.lines.push({ type: 'addition', content: line.slice(1) });
    } else if (line.startsWith('-')) {
      deletions += 1;
      current.lines.push({ type: 'deletion', content: line.slice(1) });
    } else {
      current.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }

  return {
    filePath,
    changeType: additions > 0 && deletions === 0 ? 'added' : deletions > 0 && additions === 0 ? 'deleted' : 'modified',
    additions,
    deletions,
    hunks,
  };
}

export function normalizeOpenCodePayload(
  payload: unknown,
  conversationId: string,
  assistantMessageId: string
): NormalizedOpenCodeEvent[] {
  if (!payload || typeof payload !== 'object') {
    return [
      {
        type: 'error',
        conversationId,
        code: 'OPENCODE_MALFORMED_EVENT',
        message: 'OpenCode emitted an unreadable event.',
        retryable: true,
      },
    ];
  }

  const event = payload as Record<string, unknown>;
  const type = valueAsString(event.type) || valueAsString(event.event) || valueAsString(event.kind);
  const events: NormalizedOpenCodeEvent[] = [];

  if (type === 'text_delta' || type === 'message_delta' || type === 'assistant_delta') {
    const content = valueAsString(event.content) || valueAsString(event.text) || valueAsString(event.delta) || '';
    events.push({ type: 'message_delta', conversationId, messageId: assistantMessageId, content, done: Boolean(event.done) });
    return events;
  }

  if (type === 'message' || type === 'assistant_message' || type === 'text') {
    const content = valueAsString(event.content) || valueAsString(event.text) || '';
    events.push({
      type: 'message',
      conversationId,
      message: {
        id: stableId('assistant', event),
        conversationId,
        role: 'assistant',
        content,
        createdAt: now(),
        status: 'complete',
      },
    });
    return events;
  }

  if (type === 'tool_start' || type === 'tool' || type === 'tool_update') {
    const tool = valueAsString(event.tool) || valueAsString(event.name);
    const activity: OpenCodeToolActivity = {
      id: stableId('tool', event),
      conversationId,
      label: valueAsString(event.label) || (tool ? `Running ${tool}` : 'Running tool'),
      kind: mapToolKind(tool),
      status: type === 'tool_start' ? 'started' : ((valueAsString(event.status) as OpenCodeToolActivity['status']) || 'running'),
      summary: valueAsString(event.summary) || valueAsString(event.input),
      startedAt: now(),
    };
    events.push({ type: 'tool_activity', conversationId, activity });
    return events;
  }

  if (type === 'file_change' || type === 'file_modified' || type === 'patch') {
    const patch = valueAsString(event.patch) || valueAsString(event.diff);
    const parsed = patch ? parseUnifiedPatch(patch) : undefined;
    const change: OpenCodeFileChange = {
      id: stableId('change', event),
      conversationId,
      filePath: valueAsString(event.filePath) || valueAsString(event.path) || parsed?.filePath || 'unknown',
      changeType: (valueAsString(event.changeType) as OpenCodeFileChange['changeType']) || parsed?.changeType || 'modified',
      additions: Number(event.additions ?? parsed?.additions ?? 0),
      deletions: Number(event.deletions ?? parsed?.deletions ?? 0),
      hunks: parsed?.hunks || [],
    };
    events.push({ type: 'file_change', conversationId, change });
    return events;
  }

  if (type === 'approval' || type === 'authorization_request' || type === 'confirmation') {
    const approval: OpenCodeApprovalRequest = {
      id: stableId('approval', event),
      conversationId,
      title: valueAsString(event.title) || 'Approval required',
      description: valueAsString(event.description) || valueAsString(event.prompt) || 'OpenCode needs your approval to continue.',
      riskLevel: (valueAsString(event.riskLevel) as OpenCodeApprovalRequest['riskLevel']) || 'medium',
      status: 'pending',
      createdAt: now(),
    };
    events.push({ type: 'approval_request', conversationId, approval });
    return events;
  }

  if (type === 'session' || type === 'session_created') {
    const sessionId = valueAsString(event.sessionId) || valueAsString(event.session_id) || valueAsString(event.id);
    if (sessionId) {
      events.push({ type: 'session', conversationId, sessionId });
      return events;
    }
  }

  events.push({
    type: 'message',
    conversationId,
    message: {
      id: stableId('status', event),
      conversationId,
      role: 'status',
      content: 'OpenCode reported progress.',
      createdAt: now(),
      status: 'complete',
      metadata: { rawType: type || 'unknown' },
    },
  });
  return events;
}
