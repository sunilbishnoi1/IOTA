import { normalizeOpenCodePayload } from '../opencodeEvents';

describe('normalizeOpenCodePayload', () => {
  const convId = 'test-conv';
  const msgId = 'test-msg';

  it('normalizes flat message_delta events', () => {
    const payload = { type: 'message_delta', content: 'hello' };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message_delta',
      conversationId: convId,
      messageId: msgId,
      content: 'hello',
      done: false,
    });
  });

  it('normalizes nested part object payloads with text', () => {
    const payload = {
      type: 'text_delta',
      part: {
        text: 'hello nested text',
      },
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message_delta',
      conversationId: convId,
      messageId: msgId,
      content: 'hello nested text',
      done: false,
    });
  });

  it('normalizes nested part object payloads with content', () => {
    const payload = {
      type: 'message_delta',
      part: {
        content: 'hello nested content',
      },
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message_delta',
      conversationId: convId,
      messageId: msgId,
      content: 'hello nested content',
      done: false,
    });
  });

  it('normalizes nested part as a raw string', () => {
    const payload = {
      type: 'assistant_delta',
      part: 'hello raw string',
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message_delta',
      conversationId: convId,
      messageId: msgId,
      content: 'hello raw string',
      done: false,
    });
  });

  it('normalizes nested part for full message events', () => {
    const payload = {
      type: 'text',
      part: {
        text: 'completed text',
      },
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message');
    if (events[0].type === 'message') {
      expect(events[0].message.content).toBe('completed text');
      expect(events[0].message.role).toBe('assistant');
    }
  });

  it('maps step_start and step_finish to empty arrays to prevent timeline spam', () => {
    const startPayload = { type: 'step_start', step: 'git_status' };
    const finishPayload = { type: 'step_finish', step: 'git_status' };

    expect(normalizeOpenCodePayload(startPayload, convId, msgId)).toEqual([]);
    expect(normalizeOpenCodePayload(finishPayload, convId, msgId)).toEqual([]);
  });

  it('handles malformed or invalid payloads gracefully', () => {
    expect(normalizeOpenCodePayload(null, convId, msgId)[0].type).toBe('error');
    expect(normalizeOpenCodePayload(undefined, convId, msgId)[0].type).toBe('error');
    expect(normalizeOpenCodePayload('not-an-object', convId, msgId)[0].type).toBe('error');
  });

  it('respects case-insensitive explicit IDs and nested IDs', () => {
    // 1. Root level lowercase id
    const payload1 = { type: 'text', id: 'my-explicit-id-1', content: 'test1' };
    const events1 = normalizeOpenCodePayload(payload1, convId, msgId);
    expect(events1[0].type).toBe('message');
    if (events1[0].type === 'message') {
      expect(events1[0].message.id).toBe('my-explicit-id-1');
    }

    // 2. Root level mixed case messageID
    const payload2 = { type: 'text', messageID: 'my-explicit-id-2', content: 'test2' };
    const events2 = normalizeOpenCodePayload(payload2, convId, msgId);
    expect(events2[0].type).toBe('message');
    if (events2[0].type === 'message') {
      expect(events2[0].message.id).toBe('my-explicit-id-2');
    }

    // 3. Nested inside part object
    const payload3 = { type: 'text', part: { requestid: 'my-explicit-id-3', text: 'test3' } };
    const events3 = normalizeOpenCodePayload(payload3, convId, msgId);
    expect(events3[0].type).toBe('message');
    if (events3[0].type === 'message') {
      expect(events3[0].message.id).toBe('my-explicit-id-3');
    }
  });

  it('falls back to assistantMessageId (msgId) when no explicit ID is present', () => {
    const payload = { type: 'text', content: 'test without explicit id' };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message');
    if (events[0].type === 'message') {
      expect(events[0].message.id).toBe(msgId);
    }
  });

  it('normalizes tool_activity events with root properties', () => {
    const payload = {
      type: 'tool_start',
      id: 'tool-call-1',
      tool: 'ripgrep_search',
      input: 'search query',
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_activity');
    if (events[0].type === 'tool_activity') {
      expect(events[0].activity.id).toBe('tool-call-1');
      expect(events[0].activity.label).toBe('Running ripgrep_search');
      expect(events[0].activity.status).toBe('started');
      expect(events[0].activity.summary).toBe('search query');
    }
  });

  it('normalizes tool_activity events with nested part properties and completion status', () => {
    const payload = {
      type: 'tool_finish',
      part: {
        tool_call_id: 'tool-call-1',
        name: 'ripgrep_search',
        status: 'completed',
        summary: 'found 5 matches',
      },
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_activity');
    if (events[0].type === 'tool_activity') {
      expect(events[0].activity.id).toBe('tool-call-1');
      expect(events[0].activity.label).toBe('Running ripgrep_search');
      expect(events[0].activity.status).toBe('completed');
      expect(events[0].activity.summary).toBe('found 5 matches');
      expect(events[0].activity.completedAt).toBeDefined();
    }
  });

  it('extracts sessionID from any event type and spelling variant', () => {
    const payload = {
      type: 'step_start',
      sessionID: 'ses_123',
      step: 'git_status'
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'session',
      conversationId: convId,
      sessionId: 'ses_123'
    });
  });

  it('correctly maps tool activity metadata (query, commandLine, etc)', () => {
    const payload = {
      type: 'tool_completed',
      metadata: {
        commandLine: 'npm test',
        cwd: '/workspace',
        exitCode: 0,
        stdout: 'Tests passed!'
      },
      part: {
        tool_call_id: 'tool-call-x',
        name: 'run_command',
        status: 'completed',
        label: 'Executing tests',
      }
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_activity');
    if (events[0].type === 'tool_activity') {
      expect(events[0].activity.metadata).toEqual({
        commandLine: 'npm test',
        cwd: '/workspace',
        exitCode: 0,
        stdout: 'Tests passed!'
      });
    }
  });

  it('normalizes reasoning events to message_delta', () => {
    const payload = {
      type: 'reasoning',
      part: {
        text: 'Let me think about it...',
      },
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'message_delta',
      conversationId: convId,
      messageId: msgId,
      content: 'Let me think about it...',
      done: false,
    });
  });

  it('normalizes tool execution from nested part.state format', () => {
    const payload = {
      type: 'tool_use',
      part: {
        tool: 'glob',
        state: {
          status: 'completed',
          title: 'Found 3 files matching *.ts',
          input: {
            pattern: '*.ts',
          },
          output: [
            'src/index.ts',
            'src/types.ts',
            'src/utils.ts'
          ]
        }
      }
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_activity');
    if (events[0].type === 'tool_activity') {
      const act = events[0].activity;
      expect(act.kind).toBe('search');
      expect(act.status).toBe('completed');
      expect(act.label).toBe('Found 3 files matching *.ts');
      expect(act.metadata).toBeDefined();
      expect(act.metadata?.query).toBe('*.ts');
      expect(act.metadata?.stdout).toContain('src/index.ts');
    }
  });

  it('normalizes apply_patch tool execution and maps to file_write kind', () => {
    const payload = {
      type: 'tool_use',
      part: {
        tool: 'apply_patch',
        state: {
          status: 'completed',
          input: {
            filePath: 'src/index.ts',
            patch: 'diff --git...'
          }
        }
      }
    };
    const events = normalizeOpenCodePayload(payload, convId, msgId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_activity');
    if (events[0].type === 'tool_activity') {
      const act = events[0].activity;
      expect(act.kind).toBe('file_write');
      expect(act.metadata).toBeDefined();
      expect(act.metadata?.filePath).toBe('src/index.ts');
      expect(act.metadata?.content).toBe('diff --git...');
    }
  });
});
