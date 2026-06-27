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
  socket.on('opencode:capability', (payload) => {
    console.log('[SocketClient] Received opencode:capability:', JSON.stringify(payload));
    handlers.onCapability?.(payload);
  });
  socket.on('opencode:snapshot', (payload) => {
    console.log('[SocketClient] Received opencode:snapshot (msg count:', payload?.conversation?.messages?.length || 0, ')');
    handlers.onSnapshot?.(payload);
  });
  socket.on('opencode:message', (payload) => {
    console.log('[SocketClient] Received opencode:message:', JSON.stringify(payload));
    handlers.onMessage?.(payload);
  });
  socket.on('opencode:message_delta', (payload) => {
    console.log(`[SocketClient] Received opencode:message_delta (msgId=${payload?.messageId}, len=${payload?.content?.length || 0}, done=${payload?.done})`);
    handlers.onMessageDelta?.(payload);
  });
  socket.on('opencode:run_status', (payload) => {
    console.log('[SocketClient] Received opencode:run_status:', JSON.stringify(payload));
    handlers.onRunStatus?.(payload);
  });
  socket.on('opencode:tool_activity', (payload) => {
    console.log('[SocketClient] Received opencode:tool_activity:', JSON.stringify(payload));
    handlers.onToolActivity?.(payload);
  });
  socket.on('opencode:file_change', (payload) => {
    console.log('[SocketClient] Received opencode:file_change:', JSON.stringify(payload));
    handlers.onFileChange?.(payload);
  });
  socket.on('opencode:approval_request', (payload) => {
    console.log('[SocketClient] Received opencode:approval_request:', JSON.stringify(payload));
    handlers.onApprovalRequest?.(payload);
  });
  socket.on('opencode:error', (payload) => {
    console.error('[SocketClient] Received opencode:error:', JSON.stringify(payload));
    handlers.onError?.(payload);
  });
}

export const emitOpenCodeInstall = (socket?: Socket | null) => {
  console.log('[SocketClient] Emitting opencode:install');
  socket?.emit('opencode:install', {});
};

export const emitOpenCodeMessage = (
  socket: Socket | null | undefined,
  payload: { conversationId?: string; sessionId?: string; content: string }
) => {
  console.log('[SocketClient] Emitting opencode:message:', JSON.stringify(payload));
  socket?.emit('opencode:message', payload);
};

export const emitOpenCodeApproval = (
  socket: Socket | null | undefined,
  payload: { conversationId: string; approvalId: string; decision: 'approve' | 'deny' }
) => {
  console.log('[SocketClient] Emitting opencode:approval:', JSON.stringify(payload));
  socket?.emit('opencode:approval', payload);
};

export const emitOpenCodeSync = (socket: Socket | null | undefined, conversationId?: string) => {
  console.log('[SocketClient] Emitting opencode:sync for conversation:', conversationId);
  socket?.emit('opencode:sync', { conversationId });
};

export const emitOpenCodeStop = (socket: Socket | null | undefined, conversationId: string) => {
  console.log('[SocketClient] Emitting opencode:stop for conversation:', conversationId);
  socket?.emit('opencode:stop', { conversationId });
};
