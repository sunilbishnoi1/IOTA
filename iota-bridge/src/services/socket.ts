import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { validateCodespaceOwner } from './github';
import { normalizeOpenCodePayload } from './opencodeEvents';
import { opencodeRunner } from './opencode';
import { opencodeStore } from './opencodeStore';
import {
  NormalizedOpenCodeEvent,
  OpenCodeApprovalDecision,
  OpenCodeMessageRequest,
  OpenCodeStopRequest,
  OpenCodeSyncRequest,
} from '../types/opencode';

let ioInstance: Server | null = null;

export const initSocketIO = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  ioInstance = io;

  // Authentication Middleware
  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    let token = socket.handshake.query.token as string;

    if (!token && socket.handshake.headers['authorization']) {
      const authHeader = socket.handshake.headers['authorization'];
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else {
        token = authHeader;
      }
    }

    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token;
    }

    if (!token) {
      return next(new Error('Authentication error: Token is required'));
    }

    const isValid = await validateCodespaceOwner(token);
    if (!isValid) {
      return next(new Error('Authentication error: Unauthorized user token'));
    }

    next();
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    const credentials = (socket.handshake.auth?.credentials || {}) as Record<string, string>;
    opencodeStore.setCredentials(socket.id, credentials);

    const emitNormalized = (event: NormalizedOpenCodeEvent) => {
      switch (event.type) {
        case 'message_delta':
          opencodeStore.appendAssistantDelta(event.conversationId, event.messageId, event.content, event.done);
          io.emit('opencode:message_delta', event);
          break;
        case 'message':
          opencodeStore.addMessage(event.message);
          io.emit('opencode:message', { conversationId: event.conversationId, message: event.message });
          break;
        case 'tool_activity':
          opencodeStore.addTool(event.activity);
          io.emit('opencode:tool_activity', { conversationId: event.conversationId, activity: event.activity });
          break;
        case 'file_change':
          opencodeStore.addFileChange(event.change);
          io.emit('opencode:file_change', { conversationId: event.conversationId, change: event.change });
          break;
        case 'approval_request':
          opencodeStore.addApproval(event.approval);
          io.emit('opencode:approval_request', { conversationId: event.conversationId, approval: event.approval });
          break;
        case 'session':
          opencodeStore.setSession(event.conversationId, event.sessionId);
          break;
        case 'error':
          io.emit('opencode:error', event);
          break;
      }
    };

    opencodeRunner
      .checkCapability()
      .then((capability) => socket.emit('opencode:capability', capability))
      .catch(() => socket.emit('opencode:capability', {
        status: 'unavailable',
        details: 'OpenCode capability could not be checked',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: new Date().toISOString(),
      }));

    socket.on('opencode:install', async () => {
      socket.emit('opencode:capability', {
        status: 'installing',
        details: 'Installing OpenCode...',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: new Date().toISOString(),
      });

      const capability = await opencodeRunner.install((message) => {
        socket.emit('opencode:capability', {
          status: 'installing',
          details: message,
          canSubmit: false,
          canInstall: false,
          lastCheckedAt: new Date().toISOString(),
        });
      });
      io.emit('opencode:capability', capability);
    });

    socket.on('opencode:message', async (payload: OpenCodeMessageRequest) => {
      const content = payload?.content?.trim();
      if (!content) {
        socket.emit('opencode:error', {
          code: 'OPENCODE_EMPTY_PROMPT',
          message: 'Enter a task for OpenCode.',
          retryable: true,
        });
        return;
      }

      const conversation = opencodeStore.getOrCreateConversation(payload.conversationId, payload.sessionId);
      const request = opencodeStore.startRequest(conversation.id);
      if (!request.ok) {
        socket.emit('opencode:error', {
          conversationId: conversation.id,
          code: 'OPENCODE_ALREADY_RUNNING',
          message: request.message,
          retryable: true,
        });
        return;
      }

      const userMessage = opencodeStore.addUserMessage(conversation.id, content);
      const assistantMessage = opencodeStore.createAssistantMessage(conversation.id);
      io.emit('opencode:message', { conversationId: conversation.id, message: userMessage });
      io.emit('opencode:message', { conversationId: conversation.id, message: assistantMessage });

      await opencodeRunner.ensureServer();
      const handle = opencodeRunner.run({
        prompt: content,
        sessionId: conversation.opencodeSessionId || payload.sessionId,
        env: opencodeStore.getCredentials(socket.id),
        onJson: (raw) => {
          for (const event of normalizeOpenCodePayload(raw, conversation.id, assistantMessage.id)) {
            emitNormalized(event);
          }
        },
      });

      const result = await handle.done;
      const failed = result.exitCode !== 0;
      if (failed) {
        emitNormalized({
          type: 'error',
          conversationId: conversation.id,
          code: 'OPENCODE_RUN_FAILED',
          message: result.stderr.split(/\r?\n/).find(Boolean) || 'OpenCode exited before completing the task.',
          retryable: true,
        });
      }
      opencodeStore.finishRequest(conversation.id, failed);
      const snapshot = opencodeStore.getSnapshot(conversation.id);
      if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('opencode:approval', (payload: OpenCodeApprovalDecision) => {
      const approval = opencodeStore.resolveApproval(payload);
      if (!approval) {
        socket.emit('opencode:error', {
          conversationId: payload.conversationId,
          code: 'OPENCODE_APPROVAL_NOT_FOUND',
          message: 'That approval request is no longer pending.',
          retryable: true,
        });
        return;
      }

      const input = payload.decision === 'approve' ? 'y\n' : 'n\n';
      opencodeRunner.writeInput(input);

      io.emit('opencode:approval_request', { conversationId: payload.conversationId, approval });
      io.emit('opencode:message', {
        conversationId: payload.conversationId,
        message: {
          id: `approval-${Date.now()}`,
          conversationId: payload.conversationId,
          role: 'status',
          content: `Approval ${payload.decision === 'approve' ? 'approved' : 'denied'}.`,
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
      });
    });

    socket.on('opencode:sync', async (payload: OpenCodeSyncRequest = {}) => {
      let snapshot = opencodeStore.getSnapshot(payload.conversationId);
      if (!snapshot) {
        await opencodeRunner.syncFromCliSessions(payload.conversationId);
        snapshot = opencodeStore.getSnapshot(payload.conversationId);
      }
      socket.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('opencode:stop', (payload: OpenCodeStopRequest) => {
      opencodeRunner.stopActiveRun();
      opencodeStore.finishRequest(payload.conversationId, true);
      io.emit('opencode:message', {
        conversationId: payload.conversationId,
        message: {
          id: `stop-${Date.now()}`,
          conversationId: payload.conversationId,
          role: 'status',
          content: 'OpenCode run stopped.',
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
      });
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
      opencodeStore.cleanupCredentials(socket.id);
    });
  });

  return io;
};

export const getSocketIO = () => ioInstance;
