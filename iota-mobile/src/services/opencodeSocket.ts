import { Socket } from 'socket.io-client';
import { FilePart, GlobalEvent, OpenCodeApprovalRequest, OpenCodeConversation, OpenCodeFileChange, OpenCodeMessage, OpenCodeQuestionRequest, OpenCodeToolActivity, Part } from '../types/opencode';

export interface OpenCodeSocketHandlers {
  onCapability?: (payload: unknown) => void;
  onSnapshot?: (payload: { conversation?: OpenCodeConversation }) => void;
  onMessage?: (payload: { conversationId: string; message: OpenCodeMessage }) => void;
  onMessageDelta?: (payload: { conversationId: string; messageId: string; content: string; done?: boolean }) => void;
  onRunStatus?: (payload: { conversationId: string; requestId: string; phase: string; message: string; retryable?: boolean }) => void;
  onToolActivity?: (payload: { conversationId: string; activity: OpenCodeToolActivity }) => void;
  onFileChange?: (payload: { conversationId: string; change: OpenCodeFileChange }) => void;
  onApprovalRequest?: (payload: { conversationId: string; approval: OpenCodeApprovalRequest }) => void;
  onQuestionRequest?: (payload: { conversationId: string; question: OpenCodeQuestionRequest }) => void;
  onError?: (payload: { conversationId?: string; code: string; message: string; retryable: boolean }) => void;
  onConversationsList?: (payload: { conversations: any[] }) => void;
  onSSEEvent?: (event: GlobalEvent) => void;
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
    console.log('[SocketClient] Received opencode:approval_request id:', payload?.approval?.id);
    handlers.onApprovalRequest?.(payload);
  });
  socket.on('opencode:question_request', (payload: any) => {
    console.log('[SocketClient] Received opencode:question_request id:', payload?.question?.id);
    handlers.onQuestionRequest?.(payload);
  });
  socket.on('opencode:error', (payload: any) => {
    console.error('[SocketClient] Received opencode:error code:', payload?.code, 'msg:', payload?.message);
    handlers.onError?.(payload);
  });
  socket.on('opencode:conversations_list', (payload: any) => {
    console.log('[SocketClient] Received opencode:conversations_list count:', payload?.conversations?.length || 0);
    handlers.onConversationsList?.(payload);
  });
  socket.on('opencode:sse_event', (event: GlobalEvent) => {
    // console.log('[SocketClient] Received opencode:sse_event type:', event?.payload?.type);
    handlers.onSSEEvent?.(event);
  });
}

export const emitOpenCodeInstall = (socket?: Socket | null) => {
  console.log('[SocketClient] Emitting opencode:install');
  socket?.emit('opencode:install', {});
};

export const emitOpenCodeMessage = (
  socket: Socket | null | undefined,
  payload: { conversationId?: string; sessionId?: string; content: string; parts?: FilePart[] }
) => {
  console.log('[SocketClient] Emitting opencode:message:', JSON.stringify({ ...payload, parts: payload.parts ? `[${payload.parts.length} files]` : undefined }));
  socket?.emit('opencode:message', payload);
};

export const emitOpenCodeApproval = (
  socket: Socket | null | undefined,
  payload: { conversationId: string; approvalId: string; decision: 'once' | 'always' | 'reject' }
) => {
  console.log('[SocketClient] Emitting opencode:approval:', JSON.stringify(payload));
  socket?.emit('opencode:approval', payload);
};

export const emitOpenCodeQuestionReply = (
  socket: Socket | null | undefined,
  payload: { conversationId: string; requestId: string; answers: string[][] }
) => {
  console.log('[SocketClient] Emitting opencode:question_reply:', JSON.stringify(payload));
  socket?.emit('opencode:question_reply', payload);
};

export const emitOpenCodeQuestionReject = (
  socket: Socket | null | undefined,
  payload: { conversationId: string; requestId: string }
) => {
  console.log('[SocketClient] Emitting opencode:question_reject:', JSON.stringify(payload));
  socket?.emit('opencode:question_reject', payload);
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

export const emitOpenCodeNewSession = (socket: Socket | null | undefined) => {
  console.log('[SocketClient] Emitting opencode:new_session');
  socket?.emit('opencode:new_session', {});
};

export const emitOpenCodeListConversations = (socket: Socket | null | undefined) => {
  console.log('[SocketClient] Emitting opencode:list_conversations');
  socket?.emit('opencode:list_conversations', {});
};

export const emitOpenCodeDeleteConversation = (
  socket: Socket | null | undefined,
  payload: { conversationId: string }
) => {
  console.log('[SocketClient] Emitting opencode:delete_conversation:', JSON.stringify(payload));
  socket?.emit('opencode:delete_conversation', payload);
};

// ── SSE event routing (pass-through relay) ─────────────────────────────

export type SSEMutation =
  | { action: 'part_delta'; partId: string; messageId: string; sessionID: string; delta: string; partType: 'text' | 'reasoning' }
  | { action: 'part_ended'; partId: string; messageId: string; sessionID: string; text: string; partType: 'text' | 'reasoning' }
  | { action: 'tool_called'; partId: string; messageId: string; sessionID: string; tool: string; input: Record<string, unknown> }
  | { action: 'tool_updated'; partId: string; messageId: string; sessionID: string; tool: string; state: import('../types/opencode').ToolState }
  | { action: 'tool_input_started'; callID: string; toolName: string; messageId: string; sessionID: string }
  | { action: 'tool_input_ended'; callID: string; input: Record<string, unknown>; messageId: string; sessionID: string }
  | { action: 'step_started'; messageId: string; sessionID: string; agent?: string; model?: string; snapshot?: string }
  | { action: 'step_ended'; messageId: string; sessionID: string; finish?: string; cost?: number; tokens?: object }
  | { action: 'text_started'; partId: string; messageId: string; sessionID: string }
  | { action: 'reasoning_started'; partId: string; messageId: string; sessionID: string }
  | { action: 'session_prompted'; sessionID: string }
  | { action: 'session_status'; sessionID: string; status: string }
  | { action: 'message_updated'; messageId: string; message: import('../types/opencode').Message; sessionID: string }
  | { action: 'part_updated'; part: Part; sessionID: string }
  | { action: 'permission_asked'; payload: Record<string, any> }
  | { action: 'question_asked'; payload: Record<string, any> }
  | { action: 'todo_updated'; payload: Record<string, any> }
  // ── Subtask mutations ──
  | { action: 'subtask_prompt'; callID: string; sessionID: string; messageID: string; prompt: string; description: string; agent: string }
  | { action: 'subtask_session_mapped'; callID: string; childSessionID: string }
  | { action: 'subtask_completed'; callID: string; result?: string }
  | { action: 'subtask_failed'; callID: string; error: string }
  | { action: 'subtask_event'; callID: string; childSessionID?: string; innerMutation: SSEMutation }

export function handleGlobalEvent(event: GlobalEvent): SSEMutation | null {
  const { payload } = event
  if (!payload) return null
  const { type } = payload
  const properties: Record<string, any> = payload.properties || {}

  // ── Subtask routing: detect bridge-injected parent metadata ──
  // Bridge injects parentSessionID/parentCallID at top level of rawEvent (socket.ts lines 714-718);
  // also check properties in case the raw event format differs.
  const parentSessionID = properties.parentSessionID || (payload as any).parentSessionID
  const parentCallID = properties.parentCallID || (payload as any).parentCallID
  const part = properties.part || (payload as any).part;
  const isV1Subtask = type === 'session.next.tool.called' && properties.tool === 'task';
  const isV2Subtask = type === 'message.part.updated' && part?.type === 'tool' && (part.toolName === 'task' || part.tool === 'task') && (part.state?.status === 'running' || part.state?.status === 'pending');
  const isSubtaskToolCall = isV1Subtask || isV2Subtask;

  // if (parentCallID) {
  //   console.log('\n\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
  //   console.log(`[SocketClient] RECEIVED SUBTASK EVENT from bridge.`);
  //   console.log(`parentCallID=${parentCallID}`);
  //   console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
  //   console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n\n');
  // } else if (isSubtaskToolCall) {
  //   console.log('\n\n🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢');
  //   console.log(`[SocketClient] RECEIVED SUBTASK CREATION EVENT from bridge.`);
  //   console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
  //   console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢\n\n');
  // }

  if (isSubtaskToolCall) {
    const input = isV2Subtask ? (part.state?.input || part.input || {}) : (properties.input || (payload as any).input || {});
    return {
      action: 'subtask_prompt',
      callID: isV2Subtask ? (part.callID || part.id || '') : (properties.callID || (payload as any).id || ''),
      sessionID: properties.sessionID || (payload as any).sessionID,
      messageID: properties.messageID || properties.assistantMessageID || part?.messageID || part?.messageId || (payload as any).assistantMessageID || '',
      prompt: input.prompt || '',
      description: input.description || properties.tool || part?.toolName || part?.tool || '',
      agent: input.agent || '',
    }
  }

  if (parentCallID) {
    const innerMutation = handleGlobalEventInner(event)
    if (!innerMutation) return null
    return {
      action: 'subtask_event',
      callID: parentCallID,
      childSessionID: properties.sessionID || (payload as any).sessionID,
      innerMutation,
    }
  }

  return handleGlobalEventInner(event)
}

function handleGlobalEventInner(event: GlobalEvent): SSEMutation | null {
  const { payload } = event
  if (!payload) return null
  const { type } = payload
  const properties: Record<string, any> = payload.properties || {}

  if (type.startsWith('session.next.text')) {
    if (type === 'session.next.text.delta') {
      return { action: 'part_delta', partId: properties.textID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, delta: properties.delta, partType: 'text' }
    }
    if (type === 'session.next.text.ended') {
      return { action: 'part_ended', partId: properties.textID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, text: properties.text, partType: 'text' }
    }
    if (type === 'session.next.text.started') {
      return { action: 'text_started', partId: properties.textID, messageId: properties.assistantMessageID, sessionID: properties.sessionID }
    }
    return null
  }

  if (type.startsWith('session.next.reasoning')) {
    if (type === 'session.next.reasoning.delta') {
      return { action: 'part_delta', partId: properties.reasoningID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, delta: properties.delta, partType: 'reasoning' }
    }
    if (type === 'session.next.reasoning.ended') {
      return { action: 'part_ended', partId: properties.reasoningID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, text: properties.text, partType: 'reasoning' }
    }
    if (type === 'session.next.reasoning.started') {
      return { action: 'reasoning_started', partId: properties.reasoningID, messageId: properties.assistantMessageID, sessionID: properties.sessionID }
    }
    return null
  }

  if (type === 'session.next.tool.called') {
    return { action: 'tool_called', partId: properties.callID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, tool: properties.tool, input: properties.input || {} }
  }
  if (type === 'session.next.tool.success') {
    return {
      action: 'tool_updated', partId: properties.callID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, tool: properties.tool,
      state: { status: 'completed', input: properties.input || {}, output: properties.content || properties.output || '', title: properties.tool || '', metadata: {}, time: { start: properties.timestamp || Date.now(), end: Date.now() } },
    }
  }
  if (type === 'session.next.tool.failed') {
    return {
      action: 'tool_updated', partId: properties.callID, messageId: properties.assistantMessageID, sessionID: properties.sessionID, tool: properties.tool,
      state: { status: 'error', input: properties.input || {}, error: properties.error?.message || String(properties.error || ''), time: { start: properties.timestamp || Date.now(), end: Date.now() } },
    }
  }
  if (type === 'session.next.tool.input.started') {
    return { action: 'tool_input_started', callID: properties.callID, toolName: properties.toolName, messageId: properties.assistantMessageID, sessionID: properties.sessionID }
  }
  if (type === 'session.next.tool.input.ended') {
    return { action: 'tool_input_ended', callID: properties.callID, input: properties.input || {}, messageId: properties.assistantMessageID, sessionID: properties.sessionID }
  }
  if (type === 'session.next.step.started') {
    return { action: 'step_started', messageId: properties.assistantMessageID, sessionID: properties.sessionID, agent: properties.agent, model: properties.model, snapshot: properties.snapshot }
  }
  if (type === 'session.next.step.ended') {
    return { action: 'step_ended', messageId: properties.assistantMessageID, sessionID: properties.sessionID, finish: properties.finish, cost: properties.cost, tokens: properties.tokens }
  }
  if (type === 'session.next.prompted') {
    return { action: 'session_prompted', sessionID: properties.sessionID }
  }
  if (type === 'session.status') {
    return { action: 'session_status', sessionID: properties.sessionID, status: properties.status?.type || 'idle' }
  }
  if (type === 'message.updated') {
    return { action: 'message_updated', messageId: properties.info?.id || properties.messageID || properties.assistantMessageID || '', message: properties.info, sessionID: properties.sessionID }
  }
  if (type === 'message.part.delta') {
    const partType = properties.part?.type || properties.partType || 'text';
    const partId = properties.partID || properties.part?.id || '';
    const messageId = properties.messageID || properties.assistantMessageID || '';
    return {
      action: 'part_delta',
      partId,
      messageId,
      sessionID: properties.sessionID,
      delta: properties.delta || '',
      partType: partType as 'text' | 'reasoning'
    }
  }
  if (type === 'message.part.updated') {
    const msgId = properties.messageID || properties.assistantMessageID || properties.info?.id || '';
    if (msgId && properties.part && !properties.part.messageID && !properties.part.messageId) {
      properties.part.messageID = msgId;
    }
    return { action: 'part_updated', part: properties.part, sessionID: properties.sessionID }
  }
  if (type === 'permission.asked' || type === 'permission.v2.asked') {
    return { action: 'permission_asked', payload: properties }
  }
  if (type === 'question.asked') {
    return { action: 'question_asked', payload: properties }
  }
  if (type === 'todo.updated') {
    return { action: 'todo_updated', payload: properties }
  }

  return null
}
