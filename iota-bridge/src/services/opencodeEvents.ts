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

const getExplicitId = (payload: Record<string, unknown>): string | undefined => {
  const checkKeys = ['id', 'messageid', 'requestid', 'tool_id', 'call_id', 'toolcallid', 'tool_call_id'];
  
  // Helper to find key case-insensitively
  const findKey = (obj: Record<string, unknown>): string | undefined => {
    for (const key of Object.keys(obj)) {
      if (checkKeys.includes(key.toLowerCase())) {
        const val = valueAsString(obj[key]);
        if (val) return val;
      }
    }
    return undefined;
  };

  const rootId = findKey(payload);
  if (rootId) return rootId;

  if (payload.part && typeof payload.part === 'object') {
    return findKey(payload.part as Record<string, unknown>);
  }

  return undefined;
};

const stableId = (prefix: string, payload: Record<string, unknown>, fallbackId?: string): string => {
  const explicit = getExplicitId(payload);
  return explicit || fallbackId || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  // Extract session ID from any event payload if present
  const sessionId =
    valueAsString(event.sessionID) ||
    valueAsString(event.sessionId) ||
    valueAsString(event.session_id) ||
    (event.part && typeof event.part === 'object' && event.part !== null
      ? valueAsString((event.part as any).sessionID) ||
        valueAsString((event.part as any).sessionId) ||
        valueAsString((event.part as any).session_id)
      : undefined);

  if (sessionId) {
    events.push({ type: 'session', conversationId, sessionId });
  }

  if (type === 'step_start' || type === 'step_finish') {
    return events;
  }

  const extractText = (evt: Record<string, unknown>): string => {
    const direct = valueAsString(evt.content) || valueAsString(evt.text) || valueAsString(evt.delta);
    if (direct !== undefined) return direct;
    if (evt.part) {
      if (typeof evt.part === 'string') return evt.part;
      if (typeof evt.part === 'object' && evt.part !== null) {
        const p = evt.part as Record<string, unknown>;
        const nested = p.text ?? p.content ?? p.delta;
        if (typeof nested === 'string') return nested;
      }
    }
    return '';
  };

  const getVal = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = valueAsString(event[k]);
      if (v) return v;
    }
    if (event.part && typeof event.part === 'object' && event.part !== null) {
      const p = event.part as Record<string, unknown>;
      for (const k of keys) {
        const v = valueAsString(p[k]);
        if (v) return v;
      }
    }
    return undefined;
  };

  if (type === 'text_delta' || type === 'message_delta' || type === 'assistant_delta') {
    const content = extractText(event);
    events.push({ type: 'message_delta', conversationId, messageId: assistantMessageId, content, done: Boolean(event.done || (event.part as any)?.done) });
    return events;
  }

  if (type === 'message' || type === 'assistant_message' || type === 'text') {
    const content = extractText(event);
    events.push({
      type: 'message',
      conversationId,
      message: {
        id: stableId('assistant', event, assistantMessageId),
        conversationId,
        role: 'assistant',
        content,
        createdAt: now(),
        status: 'complete',
      },
    });
    return events;
  }

  if (type === 'tool_start' || type === 'tool' || type === 'tool_update' || type === 'tool_use' || type === 'tool_finish' || type === 'tool_completed' || type === 'tool_end' || type === 'tool_done') {
    const tool = getVal(['tool', 'name']);
    const isStart = type === 'tool_start' || type === 'tool_use';
    const isFinish = type === 'tool_finish' || type === 'tool_completed' || type === 'tool_end' || type === 'tool_done';
    const statusVal = getVal(['status']);
    const status: OpenCodeToolActivity['status'] = isStart 
      ? 'started' 
      : isFinish 
        ? (statusVal === 'failed' ? 'failed' : 'completed') 
        : ((statusVal as OpenCodeToolActivity['status']) || 'running');

    const activity: OpenCodeToolActivity = {
      id: stableId('tool', event),
      conversationId,
      label: getVal(['label']) || (tool ? `Running ${tool}` : 'Running tool'),
      kind: mapToolKind(tool),
      status,
      summary: getVal(['summary', 'input']),
      startedAt: now(),
      completedAt: isFinish ? now() : undefined,
    };
    events.push({ type: 'tool_activity', conversationId, activity });
    return events;
  }

  if (type === 'file_change' || type === 'file_modified' || type === 'patch') {
    const patch = getVal(['patch', 'diff']);
    const parsed = patch ? parseUnifiedPatch(patch) : undefined;
    const change: OpenCodeFileChange = {
      id: stableId('change', event),
      conversationId,
      filePath: getVal(['filePath', 'path']) || parsed?.filePath || 'unknown',
      changeType: (getVal(['changeType']) as OpenCodeFileChange['changeType']) || parsed?.changeType || 'modified',
      additions: Number(event.additions ?? (event.part as any)?.additions ?? parsed?.additions ?? 0),
      deletions: Number(event.deletions ?? (event.part as any)?.deletions ?? parsed?.deletions ?? 0),
      hunks: parsed?.hunks || [],
      createdAt: now(),
    };
    events.push({ type: 'file_change', conversationId, change });
    return events;
  }

  if (type === 'approval' || type === 'authorization_request' || type === 'confirmation') {
    const approval: OpenCodeApprovalRequest = {
      id: stableId('approval', event),
      conversationId,
      title: getVal(['title']) || 'Approval required',
      description: getVal(['description', 'prompt']) || 'OpenCode needs your approval to continue.',
      riskLevel: (getVal(['riskLevel']) as OpenCodeApprovalRequest['riskLevel']) || 'medium',
      status: 'pending',
      createdAt: now(),
    };
    events.push({ type: 'approval_request', conversationId, approval });
    return events;
  }

  return events;

}
