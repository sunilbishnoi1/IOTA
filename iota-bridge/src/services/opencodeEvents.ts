import { Socket } from 'socket.io';

export function classifyEvent(raw: Record<string, unknown>): { type: 'v2' | 'global'; eventType: string; payload: Record<string, unknown> } {
  const eventType = String(
    (raw as Record<string, unknown>)?.type ||
    (raw as Record<string, unknown>)?.event ||
    (raw as Record<string, unknown>)?.kind ||
    'unknown'
  );
  const isV2 = eventType.startsWith('session.next.');
  return {
    type: isV2 ? 'v2' : 'global' as const,
    eventType,
    payload: raw,
  };
}

export function relayEvent(socket: Socket, raw: Record<string, unknown>): void {
  const { type, eventType, payload } = classifyEvent(raw);
  socket.emit('opencode:sse_event', { type, eventType, payload });
}
