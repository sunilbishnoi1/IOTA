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
    expect(events[0].type).toBe('message');
    if (events[0].type === 'message') {
      expect(events[0].message.id).toBe(msgId);
    }
  });
});
