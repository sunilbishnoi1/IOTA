import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { validateCodespaceOwner } from './github';
import { normalizeOpenCodePayload } from './opencodeEvents';
import { opencodeRunner, OpenCodeRunHandle } from './opencode';
import { opencodeStore } from './opencodeStore';
import { logInfo, logError, getWorkspaceRoot } from './logger';
import { registerSelfKeepAlive, pokeSelfKeepAlive } from './codespaceService';
import { PreviewService } from './previewService';
import { PreviewServerConfig } from '../types/preview';
import * as fs from 'fs';
import * as path from 'path';
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

const FIRST_OUTPUT_TIMEOUT_MS = Number(process.env.OPENCODE_FIRST_OUTPUT_TIMEOUT_MS || 120000);
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
    logInfo(`Socket client credentials received for ${socket.id} (keys: ${JSON.stringify(Object.keys(credentials))})`);
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
      const convoId = event.type === 'run_status' ? event.status.conversationId : event.conversationId;
      logInfo(`[Socket] emitNormalized - type=${event.type} conversationId=${convoId || 'unknown'}`);
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
      pokeSelfKeepAlive();
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
      pokeSelfKeepAlive();
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

      logInfo(`[Socket] Checking OpenCode capability before processing prompt...`);
      const capability = await opencodeRunner.checkCapability();
      logInfo(`[Socket] Capability result: status=${capability.status}, canSubmit=${capability.canSubmit}, details="${capability.details}"`);
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
      logInfo(`[Socket] Conversation resolved: id=${conversation.id}, sessionId=${conversation.opencodeSessionId || 'none'}, existingMessages=${conversation.messages.length}`);

      let runPrompt = content;
      if (content.toLowerCase().startsWith('/review')) {
        runPrompt = "Review all staged and unstaged changes in this repository and audit for code quality, bugs, and style consistency.";
      }

      const isSlashCommand = content.startsWith('/') && !content.toLowerCase().startsWith('/review');
      if (isSlashCommand) {
        const parts = content.split(/\s+/);
        const command = parts[0].toLowerCase();

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

        const userMessage = opencodeStore.addUserMessage(conversation.id, content);
        io.emit('opencode:message', { conversationId: conversation.id, message: userMessage });

        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: 'direct_run',
          message: 'Executing command...',
          retryable: false,
        });

        const finalize = (failed: boolean, options: { stopped?: boolean; errorSummary?: string } = {}) => {
          logInfo(`[Socket] Finalizing command request ${request.requestId}`);
          opencodeStore.finishRequest(conversation.id, failed, options);
          const snapshot = opencodeStore.getSnapshot(conversation.id);
          if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
        };

        let assistantContent = '';
        let failed = false;

        try {
          if (command === '/models') {
            const sub = parts[1];
            if (sub) {
              const rawModels = await opencodeRunner.runModelsQuery();
              const modelsList = rawModels.split(/\r?\n/).map(m => m.trim()).filter(Boolean);
              const found = modelsList.find(m => m.toLowerCase() === sub.toLowerCase());
              if (found) {
                conversation.activeModel = found;
                assistantContent = `Active model successfully switched to \`${found}\`.`;
              } else {
                failed = true;
                assistantContent = `Invalid model name: \`${sub}\`.\n\nChoose from the available models: ${modelsList.map(m => `\n- \`${m}\``).join('')}`;
              }
            } else {
              const rawModels = await opencodeRunner.runModelsQuery();
              assistantContent = `### Available Models\n\n\`\`\`text\n${rawModels}\n\`\`\``;
            }
          } else if (command === '/stats') {
            const stats = await opencodeRunner.runStatsQuery();
            assistantContent = `### Session Stats\n\n\`\`\`text\n${stats}\n\`\`\``;
          } else if (command === '/sessions') {
            const sub = parts[1]?.toLowerCase();
            if (sub === 'delete') {
              const targetSessionId = parts[2];
              if (!targetSessionId) {
                failed = true;
                assistantContent = 'Please specify a Session ID to delete: `/sessions delete <session-id>`';
              } else {
                const deleteResult = await opencodeRunner.runSessionDelete(targetSessionId);
                assistantContent = deleteResult;
              }
            } else {
              const sessionsTable = await opencodeRunner.runSessionsQuery();
              assistantContent = sessionsTable;
            }
          } else if (command === '/export') {
            const targetSessionId = parts[1];
            const exported = await opencodeRunner.runExportQuery(targetSessionId);
            assistantContent = exported;
          } else if (command === '/skills') {
            const skills = await opencodeRunner.runSkillsQuery();
            assistantContent = skills;
          } else if (command === '/init') {
            const initRes = await opencodeRunner.runInitQuery();
            assistantContent = initRes;
          } else if (command === '/compact' || command === '/summarize') {
            const summary = await opencodeRunner.runCompactQuery(conversation.id);
            assistantContent = summary;
          } else if (command === '/exit' || command === '/quit' || command === '/q') {
            opencodeRunner.stopActiveRun();
            assistantContent = 'Session exited and active agent run stopped.';
          } else {
            failed = true;
            assistantContent = `Unrecognized slash command on bridge: \`${command}\`.`;
          }
        } catch (err: any) {
          failed = true;
          assistantContent = `Error: ${err.message}`;
        }

        const assistantMessage = opencodeStore.createAssistantMessage(conversation.id);
        assistantMessage.content = assistantContent;
        assistantMessage.status = failed ? 'error' : 'complete';
        opencodeStore.addMessage(assistantMessage);
        io.emit('opencode:message', { conversationId: conversation.id, message: assistantMessage });

        finalize(failed, { errorSummary: failed ? assistantContent : undefined });
        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: failed ? 'failed' : 'completed',
          message: failed ? 'Failed' : 'Completed',
          retryable: false,
        });
        return;
      }

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
        message: 'Working...', //OpenCode preflight passed. Starting run...
        retryable: false,
      });

      let assistantMessage: OpenCodeMessage | undefined;
      let handle: OpenCodeRunHandle | undefined;
      let firstActivity = false;
      let finalized = false;
      let watchdog: NodeJS.Timeout | undefined;
      let inThought = false;

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
        logInfo(`[Socket] First activity received for request ${request.requestId} - clearing watchdog and transitioning to streaming`);
        if (watchdog) clearTimeout(watchdog);
        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: 'streaming',
          message: 'Working...',
          retryable: false,
        });
      };

      const finalize = (failed: boolean, options: { stopped?: boolean; errorSummary?: string } = {}) => {
        if (finalized) {
          logInfo(`[Socket] finalize called but already finalized for request ${request.requestId}`);
          return;
        }
        finalized = true;
        logInfo(`[Socket] Finalizing request ${request.requestId}: failed=${failed}, stopped=${options.stopped || false}, errorSummary="${(options.errorSummary || '').slice(0, 120)}"`);
        if (watchdog) clearTimeout(watchdog);

        if (inThought) {
          inThought = false;
          const msg = ensureAssistantMessage();
          emitNormalized({
            type: 'message_delta',
            conversationId: conversation.id,
            messageId: msg.id,
            content: '</thought>',
            done: false,
          });
        }

        opencodeStore.finishRequest(conversation.id, failed, options);
        const snapshot = opencodeStore.getSnapshot(conversation.id);
        if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
      };

      try {
        logInfo(`[Socket] Calling opencodeRunner.run() for request ${request.requestId}...`);
        handle = await opencodeRunner.run({
          conversationId: conversation.id,
          requestId: request.requestId,
          prompt: runPrompt,
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
            const rawType = (raw as any)?.type || (raw as any)?.part?.type || 'unknown';
            logInfo(`[Socket] onJson received for request ${request.requestId}: type=${rawType}`);
            const message = ensureAssistantMessage();

            // Handle thought tag opening and closing transitions
            if (rawType === 'reasoning') {
              if (!inThought) {
                inThought = true;
                const openEvent: NormalizedOpenCodeEvent = {
                  type: 'message_delta',
                  conversationId: conversation.id,
                  messageId: message.id,
                  content: '<thought>',
                  done: false,
                };
                emitNormalized(openEvent);
              }
            } else if (inThought && ['text', 'message_delta', 'assistant_delta', 'tool', 'tool_use', 'tool_start', 'tool_completed', 'tool_finish', 'file_change', 'patch', 'approval'].includes(String(rawType))) {
              inThought = false;
              const closeEvent: NormalizedOpenCodeEvent = {
                type: 'message_delta',
                conversationId: conversation.id,
                messageId: message.id,
                content: '</thought>',
                done: false,
              };
              emitNormalized(closeEvent);
            }

            const events = normalizeOpenCodePayload(raw, conversation.id, message.id);
            logInfo(`[Socket] normalizeOpenCodePayload produced ${events.length} event(s): [${events.map(e => e.type).join(', ')}]`);
            for (const event of events) {
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

      logInfo(`[Socket] opencodeRunner.run() returned handle for request ${request.requestId}: mode=${handle.mode}`);

      ensureAssistantMessage();
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'spawned',
        message: 'Working...', //OpenCode process started.
        retryable: false,
      });
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'awaiting_first_output',
        message: 'Working...',
        retryable: false,
      });

      logInfo(`[Socket] Setting up watchdog timer (${FIRST_OUTPUT_TIMEOUT_MS}ms) for request ${request.requestId}, mode=${handle.mode}`);
      watchdog = setTimeout(() => {
        if (firstActivity || finalized) {
          logInfo(`[Socket] Watchdog fired but already handled: firstActivity=${firstActivity}, finalized=${finalized}`);
          return;
        }
        
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

      logInfo(`[Socket] Awaiting handle.done for request ${request.requestId}...`);
      const result = await handle.done;
      logInfo(`[Socket] handle.done resolved for request ${request.requestId}: exitCode=${result.exitCode}, stderrLength=${result.stderr.length}, spawnError=${result.spawnError || 'none'}, finalized=${finalized}`);
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
          message: 'Working...', //OpenCode run completed.
          retryable: false,
        });
      }
      finalize(failed, { errorSummary: failed ? result.stderr : undefined });
    });

    socket.on('opencode:approval', (payload: OpenCodeApprovalDecision) => {
      pokeSelfKeepAlive();
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
      pokeSelfKeepAlive();
      let snapshot = opencodeStore.getSnapshot(payload.conversationId);
      if (!snapshot) {
        await opencodeRunner.syncFromCliSessions(payload.conversationId);
        snapshot = opencodeStore.getSnapshot(payload.conversationId);
      }
      socket.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('opencode:stop', (payload: OpenCodeStopRequest) => {
      pokeSelfKeepAlive();
      opencodeRunner.stopActiveRun();
      opencodeStore.finishRequest(payload.conversationId, true, { stopped: true, errorSummary: 'OpenCode run stopped.' });

      const activeRequestId = opencodeStore.getSnapshot(payload.conversationId)?.activeRequestId || id('stop');
      emitRunStatus({
        conversationId: payload.conversationId,
        requestId: activeRequestId,
        phase: 'stopped',
        message: 'OpenCode stopped', //OpenCode run stopped.
        retryable: true,
      });

      const snapshot = opencodeStore.getSnapshot(payload.conversationId);
      if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('opencode:keepalive', (payload: { durationMinutes: number }) => {
      const duration = payload?.durationMinutes;
      logInfo(`[Socket] Received opencode:keepalive durationMinutes=${duration} from socket ${socket.id}`);
      const token = socket.handshake.query.token as string || socket.handshake.auth?.token as string;
      if (token && typeof duration === 'number') {
        registerSelfKeepAlive(token, duration);
      }
    });

    socket.on('opencode:credentials', (newCredentials: Record<string, string>) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received opencode:credentials updates for socket ${socket.id} (keys: ${JSON.stringify(Object.keys(newCredentials))})`);
      opencodeStore.setCredentials(socket.id, newCredentials);
    });

    // Preview Event Listeners
    socket.on('preview:start', async (payload: { port: number; command: string; cwd?: string; type: 'expo-go' | 'web' }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received preview:start for port ${payload.port}`);
      try {
        const previewService = PreviewService.getInstance();
        
        await previewService.startPreview(
          {
            name: `Preview:${payload.port}`,
            ...payload
          },
          (text: string) => {
            io.emit('preview:log', { port: payload.port, text });
          },
          (error: string) => {
            io.emit('preview:error', { port: payload.port, error });
          },
          (state) => {
            io.emit('preview:status', {
              port: state.port,
              status: state.status,
              url: state.url,
              command: state.command
            });
          }
        );
      } catch (err: any) {
        logError(`Failed to start preview on port ${payload.port}: ${err.message}`);
        socket.emit('preview:error', { port: payload.port, error: err.message || String(err) });
      }
    });

    socket.on('preview:stop', async (payload: { port: number }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received preview:stop for port ${payload.port}`);
      try {
        const previewService = PreviewService.getInstance();
        await previewService.stopPreview(payload.port);
        
        io.emit('preview:status', {
          port: payload.port,
          status: 'stopped',
          command: ''
        });
      } catch (err: any) {
        logError(`Failed to stop preview on port ${payload.port}: ${err.message}`);
        socket.emit('preview:error', { port: payload.port, error: err.message || String(err) });
      }
    });

    socket.on('preview:status_request', (payload: { port: number }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received preview:status_request for port ${payload.port}`);
      const previewService = PreviewService.getInstance();
      const state = previewService.getPreviewState(payload.port);
      if (state) {
        socket.emit('preview:status', {
          port: state.port,
          status: state.status,
          url: state.url,
          command: state.command
        });
      } else {
        socket.emit('preview:status', {
          port: payload.port,
          status: 'stopped',
          command: ''
        });
      }
    });

    socket.on('preview:config_request', () => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received preview:config_request`);
      try {
        const rootDir = getWorkspaceRoot();
        const configPath = path.join(rootDir, '.iota', 'preview.json');
        let servers: PreviewServerConfig[] = [];
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf8');
          const parsed = JSON.parse(content);
          servers = parsed.servers || [];
        } else {
          servers = PreviewService.getInstance().detectServers();
          try {
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify({ servers }, null, 2), 'utf8');
          } catch (err: any) {
            logError(`Failed to auto-persist preview config over socket: ${err.message}`);
          }
        }
        socket.emit('preview:config_response', { servers });
      } catch (err: any) {
        logError(`Failed to fetch preview config over socket: ${err.message}`);
        socket.emit('preview:error', { port: 0, error: `Failed to fetch config: ${err.message}` });
      }
    });

    socket.on('disconnect', () => {
      logInfo(`Socket client disconnected: ${socket.id}`);
      opencodeStore.cleanupCredentials(socket.id);
    });
  });

  return io;
};

export const getSocketIO = () => ioInstance;