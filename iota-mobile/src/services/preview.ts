import { Socket } from 'socket.io-client';
import { PreviewServerConfig } from './apiService';

export interface PreviewStatusPayload {
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'crashed';
  url?: string;
  command: string;
}

export interface PreviewLogPayload {
  port: number;
  text: string;
}

export interface PreviewErrorPayload {
  port: number;
  error: string;
}

export interface PreviewSocketHandlers {
  onStatus?: (payload: PreviewStatusPayload) => void;
  onLog?: (payload: PreviewLogPayload) => void;
  onError?: (payload: PreviewErrorPayload) => void;
  onConfig?: (payload: { servers: PreviewServerConfig[] }) => void;
}

export function registerPreviewSocketHandlers(socket: Socket, handlers: PreviewSocketHandlers) {
  socket.on('preview:status', (payload: PreviewStatusPayload) => {
    console.log('[PreviewSocket] Received preview:status:', JSON.stringify(payload));
    handlers.onStatus?.(payload);
  });
  
  socket.on('preview:log', (payload: PreviewLogPayload) => {
    handlers.onLog?.(payload);
  });
  
  socket.on('preview:error', (payload: PreviewErrorPayload) => {
    console.error('[PreviewSocket] Received preview:error:', JSON.stringify(payload));
    handlers.onError?.(payload);
  });

  socket.on('preview:config_response', (payload: { servers: PreviewServerConfig[] }) => {
    console.log('[PreviewSocket] Received preview:config_response:', JSON.stringify(payload));
    handlers.onConfig?.(payload);
  });
}

export const emitPreviewStart = (
  socket: Socket | null | undefined,
  payload: { port: number; command: string; cwd?: string; type: 'expo-go' | 'web' }
) => {
  console.log('[PreviewSocket] Emitting preview:start:', JSON.stringify(payload));
  socket?.emit('preview:start', payload);
};

export const emitPreviewStop = (
  socket: Socket | null | undefined,
  port: number
) => {
  console.log('[PreviewSocket] Emitting preview:stop for port:', port);
  socket?.emit('preview:stop', { port });
};

export const emitPreviewStatusRequest = (
  socket: Socket | null | undefined,
  port: number
) => {
  console.log('[PreviewSocket] Emitting preview:status_request for port:', port);
  socket?.emit('preview:status_request', { port });
};

export const emitPreviewConfigRequest = (socket: Socket | null | undefined) => {
  console.log('[PreviewSocket] Emitting preview:config_request');
  socket?.emit('preview:config_request');
};
