import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { validateCodespaceOwner } from './github';
import { normalizeOpenCodePayload } from './opencodeEvents';
import { opencodeRunner, OpenCodeRunHandle } from './opencode';
import { opencodeStore } from './opencodeStore';
import { logInfo, logError } from './logger';
import {
  NormalizedOpenCodeEvent,
  OpenCodeApprovalDecision,
  OpenCodeMessage,
  OpenCodeMessageRequest,
  OpenCodeRunStatusEvent,
  OpenCodeStopRequest,
  OpenCodeSyncRequest,
} from '../types/opencode';

let ioInstance: Server | null = null;

const FIRST_OUTPUT_TIMEOUT_MS = Number(process.env.OPENCODE_FIRST_OUTPUT_TIMEOUT_MS || 60000);
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

const isAuthOrConfigFailure = (line: string) => /auth|credential|api[_ -]?key|provider|login|unauthorized|forbidden|config/i.test(line);

export const initSocketIO = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  ioInstance = io;

  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    let token = socket.handshake.query.token as string;

    if (!token && socket.handshake.headers['authorization']) {
      const authHeader = socket.handshake.headers['authorization'];
      token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    }

    if (!token && socket.handshake.auth?.token) token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error: Token is required'));

    const isValid = await validateCodespaceOwner(token);
    if (!isValid) return next(new Error('Authentication error: Unauthorized user token'));

    next();
  });

  io.on('connection', (socket: Socket) => {
    logInfo(`Socket client connected: ${socket.id}`);

    const credentials = (socket.handshake.auth?.credentials || {}) as Record<string, string>;
    opencodeStore.setCredentials(socket.id, credentials);

    const emitRunStatus = (status: OpenCodeRunStatusEvent) => {
      opencodeStore.setRunPhase(status.conversationId, status.phase);
      logInfo(`[Socket] Run status transition: conversationId=${status.conversationId}, phase=${status.phase}, message="${status.message}"`);
      const statusMessage: OpenCodeMessage = {
        id: `run-${status.requestId}`,
        conversationId: status.conversationId,
        role: 'status',
        content: status.message,
        createdAt: now(),
        status: status.phase === 'failed' ? 'error' : status.phase === 'stopped' ? 'stopped' : 'complete',
        metadata: { phase: status.phase, requestId: status.requestId, retryable: status.retryable },
      };
      opencodeStore.addMessage(statusMessage);
      io.emit('opencode:run_status', status);
      io.emit('opencode:message', { conversationId: status.conversationId, message: statusMessage });
    };

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
        case 'run_status':
          emitRunStatus(event.status);
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
        lastCheckedAt: now(),
      }));

    socket.on('opencode:install', async () => {
      socket.emit('opencode:capability', {
        status: 'installing',
        details: 'Installing OpenCode...',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: now(),
      });

      const capability = await opencodeRunner.install((message) => {
        socket.emit('opencode:capability', {
          status: 'installing',
          details: message,
          canSubmit: false,
          canInstall: false,
          lastCheckedAt: now(),
        });
      });
      io.emit('opencode:capability', capability);
    });

    socket.on('opencode:message', async (payload: OpenCodeMessageRequest) => {
      const content = payload?.content?.trim();
      if (!content) {
        logError(`[Socket] Received empty prompt from socket ${socket.id}`);
        socket.emit('opencode:error', {
          code: 'OPENCODE_EMPTY_PROMPT',
          message: 'Enter a task for OpenCode.',
          retryable: true,
        });
        return;
      }

      logInfo(`[Socket] Received prompt from socket ${socket.id}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`);

      const capability = await opencodeRunner.checkCapability();
      if (capability.status !== 'available') {
        logError(`[Socket] OpenCode capability not ready: ${capability.status} - ${capability.details}`);
        socket.emit('opencode:capability', capability);
        socket.emit('opencode:error', {
          conversationId: payload.conversationId,
          code: capability.status === 'missing' ? 'OPENCODE_NOT_READY' : 'OPENCODE_NOT_READY',
          message: capability.details,
          retryable: capability.canInstall || capability.status !== 'installed_uninitialized',
        });
        return;
      }

      const conversation = opencodeStore.getOrCreateConversation(payload.conversationId, payload.sessionId);
      const request = opencodeStore.startRequest(conversation.id);
      if (!request.ok) {
        logError(`[Socket] Active run already exists for conversation ${conversation.id}: ${request.message}`);
        socket.emit('opencode:error', {
          conversationId: conversation.id,
          code: 'OPENCODE_ALREADY_RUNNING',
          message: request.message,
          retryable: true,
        });
        return;
      }

      logInfo(`[Socket] Starting request ${request.requestId} for conversation ${conversation.id}`);

      const userMessage = opencodeStore.addUserMessage(conversation.id, content);
      io.emit('opencode:message', { conversationId: conversation.id, message: userMessage });
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'preflight',
        message: 'OpenCode preflight passed. Starting run...',
        retryable: false,
      });

      let assistantMessage: OpenCodeMessage | undefined;
      let handle: OpenCodeRunHandle | undefined;
      let firstActivity = false;
      let finalized = false;
      let watchdog: NodeJS.Timeout | undefined;

      const ensureAssistantMessage = () => {
        if (!assistantMessage) {
          assistantMessage = opencodeStore.createAssistantMessage(conversation.id);
          io.emit('opencode:message', { conversationId: conversation.id, message: assistantMessage });
        }
        return assistantMessage;
      };

      const markFirstActivity = () => {
        if (firstActivity) return;
        firstActivity = true;
        if (watchdog) clearTimeout(watchdog);
        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: 'streaming',
          message: 'OpenCode is responding...',
          retryable: false,
        });
      };

      const finalize = (failed: boolean, options: { stopped?: boolean; errorSummary?: string } = {}) => {
        if (finalized) return;
        finalized = true;
        if (watchdog) clearTimeout(watchdog);
        opencodeStore.finishRequest(conversation.id, failed, options);
        const snapshot = opencodeStore.getSnapshot(conversation.id);
        if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
      };

      try {
        handle = await opencodeRunner.run({
          conversationId: conversation.id,
          requestId: request.requestId,
          prompt: content,
          sessionId: conversation.opencodeSessionId || payload.sessionId,
          env: opencodeStore.getCredentials(socket.id),
          onActivity: markFirstActivity,
          onRunStatus: (status) => {
            if (status.phase === 'direct_run') {
              if (watchdog) clearTimeout(watchdog);
              watchdog = setTimeout(() => {
                if (firstActivity || finalized) return;
                const message = 'OpenCode direct run timed out without producing output.';
                logError(`[Socket] Output timeout triggered for direct run ${request.requestId}`);
                handle?.stop();
                emitRunStatus({ conversationId: conversation.id, requestId: request.requestId, phase: 'failed', message, retryable: true });
                socket.emit('opencode:error', {
                  conversationId: conversation.id,
                  code: 'OPENCODE_FIRST_OUTPUT_TIMEOUT',
                  message,
                  retryable: true,
                });
                finalize(true, { errorSummary: message });
              }, FIRST_OUTPUT_TIMEOUT_MS);
            }
            emitRunStatus(status);
          },
          onStderr: (line) => {
            logError(`[Socket] stderr delta: ${line}`);
            emitRunStatus({
              conversationId: conversation.id,
              requestId: request.requestId,
              phase: 'streaming',
              message: line,
              retryable: isAuthOrConfigFailure(line),
            });
            if (isAuthOrConfigFailure(line)) {
              socket.emit('opencode:error', {
                conversationId: conversation.id,
                code: 'OPENCODE_RUN_FAILED',
                message: line,
                retryable: true,
              });
            }
          },
          onJson: (raw) => {
            const message = ensureAssistantMessage();
            for (const event of normalizeOpenCodePayload(raw, conversation.id, message.id)) {
              emitNormalized(event);
            }
          },
        });
      } catch (error: any) {
        const message = error?.message || 'OpenCode could not start.';
        logError(`[Socket] OpenCode spawn/run initiation failed: ${message}`, { error });
        emitRunStatus({ conversationId: conversation.id, requestId: request.requestId, phase: 'failed', message, retryable: true });
        socket.emit('opencode:error', { conversationId: conversation.id, code: 'OPENCODE_START_FAILED', message, retryable: true });
        finalize(true, { errorSummary: message });
        return;
      }

      ensureAssistantMessage();
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'spawned',
        message: 'OpenCode process started.',
        retryable: false,
      });
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'awaiting_first_output',
        message: 'Waiting for OpenCode output...',
        retryable: false,
      });

      watchdog = setTimeout(() => {
        if (firstActivity || finalized) return;
        
        const message = 'OpenCode started but produced no output before the timeout.';
        logError(`[Socket] Output timeout triggered for request ${request.requestId}`);
        
        if (handle?.mode === 'attached') {
          logInfo(`[Socket] Attached run timed out. Killing process to force direct run fallback.`);
          handle.stop(); // This triggers the fallback runner loop in opencode.ts
        } else {
          logError(`[Socket] Direct run timed out. Finalizing request as failed.`);
          handle?.stop();
          emitRunStatus({ conversationId: conversation.id, requestId: request.requestId, phase: 'failed', message, retryable: true });
          socket.emit('opencode:error', {
            conversationId: conversation.id,
            code: 'OPENCODE_FIRST_OUTPUT_TIMEOUT',
            message,
            retryable: true,
          });
          finalize(true, { errorSummary: message });
        }
      }, FIRST_OUTPUT_TIMEOUT_MS);

      const result = await handle.done;
      if (finalized) return;

      if (result.spawnError) {
        const message = result.spawnError;
        logError(`[Socket] Request ${request.requestId} ended with spawn error: ${message}`);
        emitRunStatus({ conversationId: conversation.id, requestId: request.requestId, phase: 'failed', message, retryable: true });
        socket.emit('opencode:error', { conversationId: conversation.id, code: 'OPENCODE_START_FAILED', message, retryable: true });
        finalize(true, { errorSummary: message });
        return;
      }

      const failed = result.exitCode !== 0;
      if (failed) {
        const message = result.stderr.split(/\r?\n/).find(Boolean)?.slice(0, 220) || 'OpenCode exited before completing the task.';
        logError(`[Socket] Request ${request.requestId} ended in failure with exitCode=${result.exitCode}: ${message}`);
        emitRunStatus({ conversationId: conversation.id, requestId: request.requestId, phase: 'failed', message, retryable: true });
        socket.emit('opencode:error', {
          conversationId: conversation.id,
          code: 'OPENCODE_RUN_FAILED',
          message,
          retryable: true,
        });
      } else {
        logInfo(`[Socket] Request ${request.requestId} completed successfully`);
        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: 'completed',
          message: 'OpenCode run completed.',
          retryable: false,
        });
      }
      finalize(failed, { errorSummary: failed ? result.stderr : undefined });
    });

    socket.on('opencode:approval', (payload: OpenCodeApprovalDecision) => {
      logInfo(`[Socket] Received approval event for conversation ${payload.conversationId}, approvalId=${payload.approvalId}, decision=${payload.decision}`);
      const approval = opencodeStore.resolveApproval(payload);
      if (!approval) {
        logError(`[Socket] Approval resolution failed: approval ${payload.approvalId} not found or not pending`);
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

      const approvalStatusMessage: OpenCodeMessage = {
        id: id('approval'),
        conversationId: payload.conversationId,
        role: 'status',
        content: `Approval ${payload.decision === 'approve' ? 'approved' : 'denied'}.`,
        createdAt: now(),
        status: 'complete',
      };
      opencodeStore.addMessage(approvalStatusMessage);
      io.emit('opencode:message', { conversationId: payload.conversationId, message: approvalStatusMessage });
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
      opencodeStore.finishRequest(payload.conversationId, true, { stopped: true, errorSummary: 'OpenCode run stopped.' });

      const activeRequestId = opencodeStore.getSnapshot(payload.conversationId)?.activeRequestId || id('stop');
      emitRunStatus({
        conversationId: payload.conversationId,
        requestId: activeRequestId,
        phase: 'stopped',
        message: 'OpenCode run stopped.',
        retryable: true,
      });

      const snapshot = opencodeStore.getSnapshot(payload.conversationId);
      if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('disconnect', () => {
      logInfo(`Socket client disconnected: ${socket.id}`);
      opencodeStore.cleanupCredentials(socket.id);
    });
  });

  return io;
};

export const getSocketIO = () => ioInstance;