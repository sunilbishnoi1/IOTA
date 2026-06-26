import { Socket } from 'socket.io-client';
import { OpenCodeApprovalRequest, OpenCodeConversation, OpenCodeFileChange, OpenCodeMessage, OpenCodeRunStatusEvent, OpenCodeToolActivity } from '../types/opencode';

export interface OpenCodeSocketHandlers {
  onCapability?: (payload: unknown) => void;
  onSnapshot?: (payload: { conversation?: OpenCodeConversation }) => void;
  onMessage?: (payload: { conversationId: string; message: OpenCodeMessage }) => void;
  onMessageDelta?: (payload: { conversationId: string; messageId: string; content: string; done?: boolean }) => void;
  onRunStatus?: (payload: OpenCodeRunStatusEvent) => void;
  onToolActivity?: (payload: { conversationId: string; activity: OpenCodeToolActivity }) => void;
  onFileChange?: (payload: { conversationId: string; change: OpenCodeFileChange }) => void;
  onApprovalRequest?: (payload: { conversationId: string; approval: OpenCodeApprovalRequest }) => void;
  onError?: (payload: { conversationId?: string; code: string; message: string; retryable: boolean }) => void;
}

export function registerOpenCodeSocketHandlers(socket: Socket, handlers: OpenCodeSocketHandlers) {
  socket.on('opencode:capability', handlers.onCapability || (() => undefined));
  socket.on('opencode:snapshot', handlers.onSnapshot || (() => undefined));
  socket.on('opencode:message', handlers.onMessage || (() => undefined));
  socket.on('opencode:message_delta', handlers.onMessageDelta || (() => undefined));
  socket.on('opencode:run_status', handlers.onRunStatus || (() => undefined));
  socket.on('opencode:tool_activity', handlers.onToolActivity || (() => undefined));
  socket.on('opencode:file_change', handlers.onFileChange || (() => undefined));
  socket.on('opencode:approval_request', handlers.onApprovalRequest || (() => undefined));
  socket.on('opencode:error', handlers.onError || (() => undefined));
}

export const emitOpenCodeInstall = (socket?: Socket | null) => socket?.emit('opencode:install', {});

export const emitOpenCodeMessage = (
  socket: Socket | null | undefined,
  payload: { conversationId?: string; sessionId?: string; content: string }
) => socket?.emit('opencode:message', payload);

export const emitOpenCodeApproval = (
  socket: Socket | null | undefined,
  payload: { conversationId: string; approvalId: string; decision: 'approve' | 'deny' }
) => socket?.emit('opencode:approval', payload);

export const emitOpenCodeSync = (socket: Socket | null | undefined, conversationId?: string) =>
  socket?.emit('opencode:sync', { conversationId });

export const emitOpenCodeStop = (socket: Socket | null | undefined, conversationId: string) =>
  socket?.emit('opencode:stop', { conversationId });
