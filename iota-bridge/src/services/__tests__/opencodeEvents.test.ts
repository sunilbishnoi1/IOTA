import { classifyEvent } from '../opencodeEvents';

describe('classifyEvent', () => {
  it('correctly classifies session.next. events as v2', () => {
    const raw = { type: 'session.next.text.delta', content: 'hello' };
    const result = classifyEvent(raw);
    expect(result.type).toBe('v2');
    expect(result.eventType).toBe('session.next.text.delta');
    expect(result.payload).toEqual(raw);
  });

  it('correctly classifies other events as global', () => {
    const raw = { type: 'message.updated', properties: {} };
    const result = classifyEvent(raw);
    expect(result.type).toBe('global');
    expect(result.eventType).toBe('message.updated');
    expect(result.payload).toEqual(raw);
  });
});
