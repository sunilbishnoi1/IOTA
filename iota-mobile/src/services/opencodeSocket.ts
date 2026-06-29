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
  socket.on('opencode:capability', (payload: any) => {
    console.log('[SocketClient] Received opencode:capability status:', payload?.status);
    handlers.onCapability?.(payload);
  });
  socket.on('opencode:snapshot', (payload: any) => {
    console.log('[SocketClient] Received opencode:snapshot (msg count:', payload?.conversation?.messages?.length || 0, ')');
    handlers.onSnapshot?.(payload);
  });
  socket.on('opencode:message', (payload: any) => {
    console.log('[SocketClient] Received opencode:message id:', payload?.message?.id, 'role:', payload?.message?.role);
    handlers.onMessage?.(payload);
  });
  socket.on('opencode:message_delta', (payload: any) => {
    // Only log delta details at very end or short summary to avoid console clutter
    if (payload?.done) {
      console.log(`[SocketClient] Received opencode:message_delta done (msgId=${payload?.messageId})`);
    }
    handlers.onMessageDelta?.(payload);
  });
  socket.on('opencode:run_status', (payload: any) => {
    console.log('[SocketClient] Received opencode:run_status phase:', payload?.phase, 'msg:', payload?.message);
    handlers.onRunStatus?.(payload);
  });
  socket.on('opencode:tool_activity', (payload: any) => {
    console.log('[SocketClient] Received opencode:tool_activity tool:', payload?.activity?.toolName, 'status:', payload?.activity?.status);
    handlers.onToolActivity?.(payload);
  });
  socket.on('opencode:file_change', (payload: any) => {
    console.log('[SocketClient] Received opencode:file_change file:', payload?.change?.filePath, 'type:', payload?.change?.type);
    handlers.onFileChange?.(payload);
  });
  socket.on('opencode:approval_request', (payload: any) => {
    console.log('[SocketClient] Received opencode:approval_request id:', payload?.approval?.id, 'cmd:', payload?.approval?.command);
    handlers.onApprovalRequest?.(payload);
  });
  socket.on('opencode:error', (payload: any) => {
    console.error('[SocketClient] Received opencode:error code:', payload?.code, 'msg:', payload?.message);
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

export const emitOpenCodeCredentials = (
  socket: Socket | null | undefined,
  credentials: Record<string, string>
) => {
  console.log('[SocketClient] Emitting opencode:credentials:', JSON.stringify(Object.keys(credentials)));
  socket?.emit('opencode:credentials', credentials);
};

