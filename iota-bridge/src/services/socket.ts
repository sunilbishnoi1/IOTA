import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { validateCodespaceOwner } from './github';
import { relayEvent } from './opencodeEvents';
import { opencodeServerClient, PromptHandle, ModelInfo } from './opencode';
import { opencodeStore } from './opencodeStore';
import { logInfo, logError, getWorkspaceRoot } from './logger';
import { registerSelfKeepAlive, pokeSelfKeepAlive } from './codespaceService';
import { PreviewService } from './previewService';
import { EnvService } from './envService';
import { PreviewServerConfig } from '../types/preview';
import * as fs from 'fs';
import * as path from 'path';
import {
  OpenCodeApprovalDecision,
  OpenCodeMessage,
  OpenCodeMessageRequest,
  OpenCodePart,
  OpenCodePromptStatusEvent,
  OpenCodeStopRequest,
  OpenCodeSyncRequest,
} from '../types/opencode';

let ioInstance: Server | null = null;

const FIRST_OUTPUT_TIMEOUT_MS = Number(process.env.OPENCODE_FIRST_OUTPUT_TIMEOUT_MS || 120000);
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const __DEV__ = process.env.NODE_ENV !== 'production';

const isAuthOrConfigFailure = (line: string) => /auth|credential|api[_ -]?key|provider|login|unauthorized|forbidden|config/i.test(line);

export const initSocketIO = (server: HttpServer) => {
  const corsOriginSocket = process.env.CORS_ORIGIN || '*';
  logInfo(`[SocketIO] CORS origin configured: ${corsOriginSocket}`);
  const io = new Server(server, {
    cors: {
      origin: corsOriginSocket,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 120000,
    pingInterval: 25000,
    maxHttpBufferSize: 10485760,
  });
  ioInstance = io;
  startPreviewConfigWatcher(io);
  startEnvWatcher(io);

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

    // Emit debug info on connect
    try {
      const wsRoot = getWorkspaceRoot();
      const ocPort = process.env.OPENCODE_PORT || '3000';
      socket.emit('opencode:debug', { msg: `workspaceRoot=${wsRoot} opencodePort=${ocPort} apiKeys=${Object.keys(credentials).length}` });
    } catch (dbgErr) {
      logError(`[Socket] Failed to emit debug info: ${dbgErr}`);
    }

    const emitRunStatus = (status: OpenCodePromptStatusEvent) => {
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

    opencodeServerClient
      .checkCapability()
      .then((capability) => {
        socket.emit('opencode:capability', capability);
        socket.emit('opencode:debug', { msg: `checkCapability on connect result: status=${capability.status} canSubmit=${capability.canSubmit} canInstall=${capability.canInstall}` });

        if (capability.status === 'available') {
          opencodeServerClient.listModels().then((result) => {
            const conversation = opencodeStore.getConversation();
            if (conversation) {
              socket.emit('opencode:model_list', {
                models: result.models,
                activeModel: conversation.activeModel,
                activeVariant: conversation.activeVariant,
              });
            } else {
              socket.emit('opencode:model_list', {
                models: result.models,
              });
            }
          }).catch((err) => {
            logError(`[Socket] Failed to fetch model list on connect: ${err.message}`);
          });
        }
      })
      .catch(() => {
        socket.emit('opencode:capability', {
          status: 'unavailable',
          details: 'OpenCode capability could not be checked',
          canSubmit: false,
          canInstall: false,
          lastCheckedAt: now(),
        });
      });

    socket.on('opencode:set_model', async (payload: { modelID: string; variant?: string }) => {
      pokeSelfKeepAlive();
      const conversation = opencodeStore.getConversation();
      if (!conversation) {
        logError(`[Socket] set_model: no active conversation`);
        return;
      }

      try {
        const result = await opencodeServerClient.listModels();
        const matched = result.models.find(m =>
          `${m.providerID}/${m.modelID}` === payload.modelID ||
          m.modelID === payload.modelID
        );
        if (!matched) {
          logError(`[Socket] set_model: model ${payload.modelID} not found`);
          socket.emit('opencode:error', {
            code: 'OPENCODE_MODEL_NOT_FOUND',
            message: `Model "${payload.modelID}" is not available.`,
            retryable: true,
          });
          return;
        }
        const fullModel = `${matched.providerID}/${matched.modelID}`;
        conversation.activeModel = fullModel;
        conversation.activeVariant = payload.variant;
        opencodeStore.saveConversation(conversation);
        logInfo(`[Socket] Model set to ${fullModel}${payload.variant ? ` variant=${payload.variant}` : ''}`);
        socket.emit('opencode:model_selected', {
          modelID: fullModel,
          variant: payload.variant,
        });
        const snapshot = opencodeStore.getSnapshot(conversation.id);
        if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
      } catch (err: any) {
        logError(`[Socket] set_model failed: ${err.message}`);
        socket.emit('opencode:error', {
          code: 'OPENCODE_MODEL_SET_FAILED',
          message: `Failed to set model: ${err.message}`,
          retryable: true,
        });
      }
    });

    socket.on('opencode:install', async () => {
      pokeSelfKeepAlive();
      socket.emit('opencode:capability', {
        status: 'installing',
        details: 'Installing OpenCode...',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: now(),
      });

      const capability = await opencodeServerClient.install((message) => {
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
      try {
      const content = payload?.content?.trim() || '';
      const hasParts = payload?.parts && payload.parts.length > 0;
      if (!content && !hasParts) {
        logError(`[Socket] Received empty prompt from socket ${socket.id}`);
        socket.emit('opencode:error', {
          code: 'OPENCODE_EMPTY_PROMPT',
          message: 'Enter a task for OpenCode.',
          retryable: true,
        });
        return;
      }

      socket.emit('opencode:debug', { msg: `Received prompt: convId=${payload.conversationId} sessionId=${payload.sessionId} contentLen=${content.length} hasParts=${hasParts}` });
      logInfo(`[Socket] Received prompt from socket ${socket.id}: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`);

      logInfo(`[Socket] Checking OpenCode capability before processing prompt...`);
      const capability = await opencodeServerClient.checkCapability();
      socket.emit('opencode:debug', { msg: `checkCapability: status=${capability.status} canSubmit=${capability.canSubmit} canInstall=${capability.canInstall} details=${capability.details}` });
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
          phase: 'prompt_sent',
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
          if (command === '/stats') {
            const stats = await opencodeServerClient.runStatsQuery();
            assistantContent = `### Session Stats\n\n\`\`\`text\n${stats}\n\`\`\``;
          } else if (command === '/sessions') {
            const sub = parts[1]?.toLowerCase();
            if (sub === 'delete') {
              const targetSessionId = parts[2];
              if (!targetSessionId) {
                failed = true;
                assistantContent = 'Please specify a Session ID to delete: `/sessions delete <session-id>`';
              } else {
                const deleteResult = await opencodeServerClient.runSessionDelete(targetSessionId);
                assistantContent = deleteResult;
              }
            } else {
              const sessionsTable = await opencodeServerClient.runSessionsQuery();
              assistantContent = sessionsTable;
            }
          } else if (command === '/export') {
            const targetSessionId = parts[1];
            const exported = await opencodeServerClient.runExportQuery(targetSessionId);
            assistantContent = exported;
          } else if (command === '/skills') {
            const skills = await opencodeServerClient.runSkillsQuery();
            assistantContent = skills;
          } else if (command === '/init') {
            const initRes = await opencodeServerClient.runInitQuery();
            assistantContent = initRes;
          } else if (command === '/compact' || command === '/summarize') {
            const summary = await opencodeServerClient.runCompactQuery(conversation.id);
            assistantContent = summary;
          } else if (command === '/exit' || command === '/quit' || command === '/q') {
            opencodeServerClient.stopActiveRun();
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

      const partsToStore: OpenCodePart[] | undefined = payload.parts?.map(p => ({
        id: id('part'),
        type: 'file' as const,
        mime: p.mime,
        url: p.url,
        filename: p.filename,
      }));
      const userMessage = opencodeStore.addUserMessage(conversation.id, content, partsToStore);
      io.emit('opencode:message', { conversationId: conversation.id, message: userMessage });
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'connecting',
        message: 'Working...', //OpenCode preflight passed. Starting run...
        retryable: false,
      });

      let assistantMessage: OpenCodeMessage | undefined;
      let handle: PromptHandle | undefined;
      let firstActivity = false;
      let finalized = false;
      let watchdog: NodeJS.Timeout | undefined;
      const activeTools = new Set<string>();
      let isSessionBusy = true;
      let msgId = '';
      const pendingTaskCalls = new Map<string, {
        callID: string;
        parentSessionID: string;
        input: Record<string, unknown>;
        matchedChildSessionID?: string;
      }>();
      const childSessionMappings = new Map<string, string>();

      const handleStoreEvent = (event: Record<string, unknown>) => {
        const rawType = String(event.type || event.event || event.kind || '');
        const props = (event.properties || {}) as Record<string, unknown>;
        const part = (props.part || (event as any)?.part || {}) as Record<string, any>;
        const partID = String(props.textID || props.reasoningID || part?.id || part?.callID || (event as any)?.partID || '');

        if (rawType === 'session') {
          const sessionID = String(event.sessionID || event.sessionId || '');
          if (sessionID) {
            opencodeStore.setSession(conversation.id, sessionID);
          }
          return;
        }

        if (!msgId) return;

        if (rawType === 'session.next.text.started') {
          opencodeStore.startPart(conversation.id, msgId, 'text', partID || id('part'), { sessionID: String(event.sessionID || event.sessionId || '') });
        } else if (rawType === 'session.next.text.delta') {
          const delta = String((event as any)?.delta || props.delta || '');
          if (delta) {
            opencodeStore.appendPartDelta(conversation.id, msgId, partID, delta);
          }
        } else if (rawType === 'session.next.text.ended') {
          const fullText = String((event as any)?.text || props.text || '');
          if (fullText) opencodeStore.setPartText(conversation.id, msgId, partID, fullText);
          opencodeStore.endPart(conversation.id, msgId, partID);
        } else if (rawType === 'session.next.reasoning.started') {
          opencodeStore.startPart(conversation.id, msgId, 'reasoning', partID || id('part'), { sessionID: String(event.sessionID || event.sessionId || '') });
        } else if (rawType === 'session.next.reasoning.delta') {
          const delta = String((event as any)?.delta || props.delta || '');
          if (delta) {
            opencodeStore.appendPartDelta(conversation.id, msgId, partID, delta);
          }
        } else if (rawType === 'session.next.reasoning.ended') {
          const fullText = String((event as any)?.text || props.text || '');
          if (fullText) opencodeStore.setPartText(conversation.id, msgId, partID, fullText);
          opencodeStore.endPart(conversation.id, msgId, partID);
        } else if (rawType === 'session.next.tool.called' || rawType === 'session.next.tool.input.started') {
          const callID = String(part?.callID || (event as any)?.callID || part?.id || '');
          const toolName = String(part?.tool || part?.toolName || 'Tool');
          opencodeStore.addTool({
            id: callID || id('tool'),
            conversationId: conversation.id,
            label: toolName,
            kind: 'other',
            status: 'running',
            startedAt: now(),
            metadata: { input: part?.input || {}, toolName: toolName },
          });
          if (callID) {
            opencodeStore.addToolPart(conversation.id, msgId, callID, toolName, part?.input || {}, String(event.sessionID || props.sessionID || ''));
          }
        } else if (rawType === 'session.next.tool.success') {
          const callID = String(part?.callID || (event as any)?.callID || '');
          opencodeStore.updateToolStatus(conversation.id, callID, 'completed', {
            result: (event as any)?.result || part?.result,
            output: String((event as any)?.content || part?.content || part?.output || ''),
          });
          if (callID) {
            opencodeStore.updateToolPartStatus(conversation.id, msgId, callID, 'completed', {
              output: String((event as any)?.content || part?.content || part?.output || ''),
            });
          }
        } else if (rawType === 'session.next.tool.failed') {
          const callID = String(part?.callID || (event as any)?.callID || '');
          opencodeStore.updateToolStatus(conversation.id, callID, 'failed', {
            error: String((event as any)?.error || part?.error || 'Tool execution failed'),
          });
          if (callID) {
            opencodeStore.updateToolPartStatus(conversation.id, msgId, callID, 'error', {
              error: String((event as any)?.error || part?.error || 'Tool execution failed'),
            });
          }
        } else if (rawType === 'message.part.updated' && part?.type === 'tool') {
          const callID = String(part?.callID || '');
          const toolStatus = part?.state?.status;
          if (callID) {
            if (toolStatus === 'running' || toolStatus === 'pending') {
              opencodeStore.addTool({
                id: callID,
                conversationId: conversation.id,
                label: String(part?.tool || 'Tool'),
                kind: 'other',
                status: 'running',
                startedAt: now(),
                metadata: { input: part?.state?.input || {}, toolName: part?.tool },
              });
              opencodeStore.addToolPart(conversation.id, msgId, callID, part?.tool || 'Tool', part?.state?.input || {}, String(event.sessionID || props.sessionID || ''));
            } else if (toolStatus === 'completed') {
              opencodeStore.updateToolStatus(conversation.id, callID, 'completed', {
                result: part?.state?.result,
                output: String(part?.state?.output || ''),
              });
              opencodeStore.updateToolPartStatus(conversation.id, msgId, callID, 'completed', {
                output: String(part?.state?.output || ''),
              });
            } else if (toolStatus === 'error') {
              opencodeStore.updateToolStatus(conversation.id, callID, 'failed', {
                error: String(part?.state?.error || 'Tool execution failed'),
              });
              opencodeStore.updateToolPartStatus(conversation.id, msgId, callID, 'error', {
                error: String(part?.state?.error || 'Tool execution failed'),
              });
            }
          }
        } else if (rawType === 'session.next.step.ended') {
          const cost = (event as any)?.cost || props.cost;
          const tokens = (event as any)?.tokens || props.tokens;
          if (cost || tokens) {
            opencodeStore.recordTokenUsage(conversation.id, { cost, tokens });
          }
        } else if (rawType === 'permission.asked' || rawType === 'permission.v2.asked') {
          const approval = {
            id: String((event as any)?.id || part?.id || id('approval')),
            conversationId: conversation.id,
            title: String((event as any)?.action || part?.action || 'Approval required'),
            description: JSON.stringify((event as any)?.resources || part?.resources || (event as any)?.patterns || part?.patterns || ''),
            riskLevel: 'medium' as const,
            status: 'pending' as const,
            createdAt: now(),
          };
          opencodeStore.addApproval(approval);
          io.emit('opencode:approval_request', { conversationId: conversation.id, approval });
        } else if (rawType === 'question.asked') {
          const question = {
            id: String((event as any)?.id || part?.id || id('question')),
            conversationId: conversation.id,
            questions: (event as any)?.questions || part?.questions || [],
            tool: String((event as any)?.tool || part?.tool || ''),
            createdAt: now(),
          };
          const convo = opencodeStore.getConversation(conversation.id);
          if (convo) {
            convo.status = 'awaiting_approval';
            convo.updatedAt = now();
            opencodeStore.saveConversation(convo);
          }
          io.emit('opencode:question_request', { conversationId: conversation.id, question });
        } else if (rawType === 'session.status') {
          const statusObj = (event as any)?.status || {};
          if (statusObj?.type === 'idle') {
            emitRunStatus({
              conversationId: conversation.id,
              requestId: request.requestId,
              phase: 'completed',
              message: 'Completed',
              retryable: false,
            });
          }
        } else if (rawType === 'message.part.delta') {
          const delta = String((event as any)?.delta || props.delta || '');
          if (delta && partID) {
            opencodeStore.appendPartDelta(conversation.id, msgId, partID, delta);
          }
        } else if (rawType === 'message.part.updated') {
          const partType = part?.type;
          if (partType === 'text' || partType === 'reasoning') {
            const isFinished = part.time?.end !== undefined;
            if (isFinished) {
              opencodeStore.setPartText(conversation.id, msgId, partID, part.text || '');
              opencodeStore.endPart(conversation.id, msgId, partID);
            } else {
              opencodeStore.startPart(conversation.id, msgId, partType, partID, { sessionID: String(event.sessionID || event.sessionId || '') });
            }
          }
        } else if (rawType === 'session.error') {
          const errorMsg = ((event as any)?.error?.data?.message) || ((event as any)?.error?.message) || 'Unknown server error';
          io.emit('opencode:error', {
            conversationId: conversation.id,
            code: 'OPENCODE_SERVER_ERROR',
            message: errorMsg,
            retryable: true,
          });
        }
      };

      const ensureAssistantMessage = () => {
        if (!assistantMessage) {
          assistantMessage = opencodeStore.createAssistantMessage(conversation.id);
          io.emit('opencode:message', { conversationId: conversation.id, message: assistantMessage });
        }
        return assistantMessage;
      };

      const resetWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        const timeoutMs = (activeTools.size > 0 || isSessionBusy) ? 300000 : 30000;
        watchdog = setTimeout(async () => {
          if (finalized) return;
          const message = (activeTools.size > 0 || isSessionBusy)
            ? 'OpenCode request timed out after 5 minutes of execution.'
            : 'OpenCode request timed out due to 30 seconds of inactivity.';
          logError(`[Socket] Watchdog inactivity timeout triggered for request ${request.requestId} (timeoutMs=${timeoutMs}, tools=${activeTools.size}, busy=${isSessionBusy})`);

          try {
            await handle?.stop('watchdog');
          } catch (err: any) {
            logError(`[Socket] Failed to stop active run on watchdog timeout: ${err.message}`);
          }

          emitRunStatus({
            conversationId: conversation.id,
            requestId: request.requestId,
            phase: 'failed',
            message,
            retryable: true,
          });
          socket.emit('opencode:error', {
            conversationId: conversation.id,
            code: 'OPENCODE_INACTIVITY_TIMEOUT',
            message,
            retryable: true,
          });
          opencodeStore.finishRequest(conversation.id, true, { errorSummary: message });
        }, timeoutMs);
      };

      const markFirstActivity = () => {
        resetWatchdog();
        if (firstActivity) return;
        firstActivity = true;
        logInfo(`[Socket] First activity received for request ${request.requestId} - transitioning to streaming`);
        emitRunStatus({
          conversationId: conversation.id,
          requestId: request.requestId,
          phase: 'streaming',
          message: 'Working...',
          retryable: false,
        });
      };

      const finalize = async (failed: boolean, options: { stopped?: boolean; errorSummary?: string } = {}) => {
        if (finalized) {
          logInfo(`[Socket] finalize called but already finalized for request ${request.requestId}`);
          return;
        }
        finalized = true;
        logInfo(`[Socket] Finalizing request ${request.requestId}: failed=${failed}, stopped=${options.stopped || false}, errorSummary="${(options.errorSummary || '').slice(0, 120)}"`);
        if (watchdog) clearTimeout(watchdog);

        pendingTaskCalls.clear();
        childSessionMappings.clear();

        opencodeStore.finishRequest(conversation.id, failed, options);

        try {
          const sessions = await opencodeServerClient.listSessions();
          opencodeStore.syncConversationTitlesWithCli(sessions);
        } catch (err) {
          logError(`Failed to sync titles on finalize: ${err}`);
        }

        const snapshot = opencodeStore.getSnapshot(conversation.id);
        if (snapshot) io.emit('opencode:snapshot', { conversation: snapshot });
        io.emit('opencode:conversations_list', { conversations: opencodeStore.getAllConversations() });
      };

      try {
        logInfo(`[Socket] Calling opencodeServerClient.executePrompt() for request ${request.requestId}...`);
        socket.emit('opencode:debug', { msg: `executePrompt: convId=${conversation.id} sessionId=${conversation.opencodeSessionId || payload.sessionId} promptLen=${runPrompt.length}` });

        handle = await opencodeServerClient.executePrompt({
          conversationId: conversation.id,
          requestId: request.requestId,
          prompt: runPrompt,
          parts: payload.parts,
          sessionId: conversation.opencodeSessionId || payload.sessionId,
          env: opencodeStore.getCredentials(socket.id),
          onActivity: markFirstActivity,
          onRunStatus: (status) => {
            emitRunStatus(status);
          },
          onStderr: (line) => {
            resetWatchdog();
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
          onJson: function handleJson(raw) {
            resetWatchdog();

            const rawEvent = raw as Record<string, unknown>;
            const props = (rawEvent.properties || {}) as Record<string, unknown>;
            const part = (props.part || (rawEvent as any)?.part || {}) as Record<string, any>;
            const rawType = String(rawEvent.type || rawEvent.event || rawEvent.kind || part.type || 'unknown');
            logInfo(`[SSEClientDebug] handleJson entered: type=${rawType} sessionId=${rawEvent.sessionID || rawEvent.sessionId || 'none'}`);

            // Track active tools and session status for watchdog
            if (rawType === 'session.status') {
              const statusObj = (props.status || (rawEvent as any)?.status || {}) as Record<string, any>;
              if (statusObj?.type === 'idle') {
                isSessionBusy = false;
              } else if (statusObj?.type === 'busy') {
                isSessionBusy = true;
              }
              resetWatchdog();
            }

            const toolCallID = String(
              part?.callID ||
              props.callID ||
              rawEvent.callID ||
              part?.id ||
              props.id ||
              (rawEvent as any)?.id ||
              ''
            );

            if (rawType === 'session.next.tool.called' || rawType === 'session.next.tool.input.started') {
              if (toolCallID) {
                activeTools.add(toolCallID);
                resetWatchdog();
                if (rawType === 'session.next.tool.called') {
                  const toolName = String(part?.tool || props.tool || '');
                  if (toolName === 'task') {
                    const parentSid = String(rawEvent.sessionID || props.sessionID || '');
                    pendingTaskCalls.set(toolCallID, {
                      callID: toolCallID,
                      parentSessionID: parentSid,
                      input: (part?.input || props.input || {}) as Record<string, unknown>,
                    });
                    logInfo(`[Socket] Detected task tool call ${toolCallID} for session ${parentSid}`);
                  }
                }
              }
            } else if (rawType === 'session.next.tool.success' || rawType === 'session.next.tool.failed') {
              if (toolCallID) {
                activeTools.delete(toolCallID);
                resetWatchdog();
                pendingTaskCalls.delete(toolCallID);
                for (const [childSid, mappedCallID] of childSessionMappings) {
                  if (mappedCallID === toolCallID) {
                    childSessionMappings.delete(childSid);
                    logInfo(`[Socket] Cleaned up child session mapping ${childSid} for task call ${toolCallID}`);
                  }
                }
              }
            } else if (rawType === 'message.part.updated' && part.type === 'tool') {
              const toolStatus = part.state?.status;
              if (toolCallID) {
                if (toolStatus === 'running' || toolStatus === 'pending') {
                  activeTools.add(toolCallID);
                  resetWatchdog();
                  const toolName = String(part.tool || part.toolName || props.tool || '');
                  
                  const childSessionID = part.metadata?.childSessionID || part.metadata?.sessionID || part.state?.metadata?.sessionId || part.state?.metadata?.childSessionID;

                  if (toolName === 'task') {
                    const parentSid = String(rawEvent.sessionID || props.sessionID || '');
                    if (!pendingTaskCalls.has(toolCallID)) {
                      pendingTaskCalls.set(toolCallID, {
                        callID: toolCallID,
                        parentSessionID: parentSid,
                        input: (part.state?.input || part.input || props.input || {}) as Record<string, unknown>,
                      });
                      logInfo(`[Socket] Detected task tool call ${toolCallID} for session ${parentSid} via message.part.updated`);
                    }
                    
                    if (childSessionID && !childSessionMappings.has(childSessionID)) {
                      childSessionMappings.set(childSessionID, toolCallID);
                      const pendingCall = pendingTaskCalls.get(toolCallID);
                      if (pendingCall) {
                        pendingCall.matchedChildSessionID = childSessionID;
                      }
                      logInfo(`[Socket] Dynamically mapped and subscribed to child session ${childSessionID} for task call ${toolCallID}`);
                      opencodeServerClient.registerChildSessionListener(childSessionID, handleJson);
                    }
                  }
                } else if (toolStatus === 'completed' || toolStatus === 'error') {
                  activeTools.delete(toolCallID);
                  resetWatchdog();
                  pendingTaskCalls.delete(toolCallID);
                  for (const [childSid, mappedCallID] of childSessionMappings) {
                    if (mappedCallID === toolCallID) {
                      childSessionMappings.delete(childSid);
                      logInfo(`[Socket] Cleaned up child session mapping ${childSid} for task call ${toolCallID}`);
                      opencodeServerClient.removeChildSessionListener(childSid);
                    }
                  }
                }
              }
            }

            // logInfo(`[Socket] onJson received for request ${request.requestId}: type=${rawType}`);

            // Ensure assistant message exists for session events
            if (rawType !== 'session') {
              const msg = ensureAssistantMessage();
              msgId = msg.id;
            }

            if (rawType === 'message.updated') {
              const role = (props.info as any)?.role;
              const serverMsgId = String((props.info as any)?.id || '');
              if (serverMsgId) {
                if (role === 'assistant') {
                  const msg = ensureAssistantMessage();
                  if (msg.id !== serverMsgId) {
                    logInfo(`[Socket] Updating assistant message ID from ${msg.id} to server ID ${serverMsgId}`);
                    msg.id = serverMsgId;
                    msgId = serverMsgId;
                  }
                } else if (role === 'user') {
                  const userMsg = conversation.messages.find((m) => m.role === 'user' && m.id.startsWith('user-'));
                  if (userMsg && userMsg.id !== serverMsgId) {
                    logInfo(`[Socket] Updating user message ID from ${userMsg.id} to server ID ${serverMsgId}`);
                    userMsg.id = serverMsgId;
                  }
                }
              }
            }

            // Subtask session tracking: detect child sessions and inject parent metadata
            const eventSessionID = String(rawEvent.sessionID || props.sessionID || '');
            const mainSessionID = conversation?.opencodeSessionId || '';
            if (eventSessionID && eventSessionID !== mainSessionID && !childSessionMappings.has(eventSessionID)) {
              for (const [callID, entry] of pendingTaskCalls) {
                if (!entry.matchedChildSessionID) {
                  entry.matchedChildSessionID = eventSessionID;
                  childSessionMappings.set(eventSessionID, callID);
                  logInfo(`[Socket] Mapped child session ${eventSessionID} to task call ${callID}`);
                  
                  const convoObj = opencodeStore.getConversation(conversation.id);
                  if (convoObj) {
                    const toolObj = convoObj.tools.find(t => t.id === callID);
                    if (toolObj) {
                      if (!toolObj.metadata) toolObj.metadata = {};
                      toolObj.metadata.childSessionID = eventSessionID;
                    }
                    
                    // Also update the message part directly so history hydrates correctly
                    for (const msg of convoObj.messages || []) {
                      if (!msg.parts) continue;
                      for (let i = 0; i < msg.parts.length; i++) {
                        const p = msg.parts[i];
                        if (p.type === 'tool' && (p.callID === callID || (p as any).id === callID)) {
                          if (!(p as any).metadata) (p as any).metadata = {};
                          (p as any).metadata.childSessionID = eventSessionID;
                        }
                      }
                    }
                    opencodeStore.saveConversation(convoObj);
                  }
                  break;
                }
              }
            }
            const matchedCallID = childSessionMappings.get(eventSessionID);
            if (matchedCallID) {
              const entry = pendingTaskCalls.get(matchedCallID);
              if (entry) {
                (rawEvent as Record<string, unknown>).parentSessionID = entry.parentSessionID;
                (rawEvent as Record<string, unknown>).parentCallID = matchedCallID;
                (rawEvent as Record<string, unknown>).subtaskPrompt = entry.input?.prompt || '';
                (rawEvent as Record<string, unknown>).subtaskAgent = entry.input?.agent || '';
                (rawEvent as Record<string, unknown>).subtaskDescription = entry.input?.description || '';
              }
            }

            // Normalize tool call properties for mobile detection.
            // SDK puts tool/callID/input inside properties.part; mobile reads them from properties directly.
            if (rawType === 'session.next.tool.called' || (rawType === 'message.part.updated' && part?.type === 'tool')) {
              const toolName = part?.tool || part?.toolName || props.tool || props.toolName;
              if (toolName && !props.tool) (props as Record<string, unknown>).tool = toolName;
              const actualCallID = part?.callID || part?.id || props.callID;
              if (actualCallID && !props.callID) (props as Record<string, unknown>).callID = actualCallID;
              if (part?.input && !props.input) (props as Record<string, unknown>).input = part.input;
              if (part?.state?.input && !props.input) (props as Record<string, unknown>).input = part.state.input;
            }

            // Relay raw event to mobile via single SSE channel
            if (__DEV__) {
              if ((rawEvent as any).parentCallID) {
                console.log('\n\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
                console.log(`[Socket] EMITTING SUBTASK EVENT to mobile.`);
                console.log(`parentCallID=${(rawEvent as any).parentCallID}`);
                console.log(`Payload: ${JSON.stringify(rawEvent, null, 2)}`);
                console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n\n');
              } else if ((rawType === 'session.next.tool.called' && (props as any).tool === 'task') || (rawType === 'message.part.updated' && part?.type === 'tool' && (part.toolName === 'task' || part.tool === 'task'))) {
                console.log('\n\n🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢');
                console.log(`[Socket] EMITTING SUBTASK CREATION EVENT to mobile.`);
                console.log(`Payload: ${JSON.stringify(rawEvent, null, 2)}`);
                console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢\n\n');
              }
            }
            logInfo(`[SSEClientDebug] handleJson: about to relayEvent type=${rawType}`);
            relayEvent(socket, rawEvent);

            // Persist event to local store
            handleStoreEvent(rawEvent);
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

      logInfo(`[Socket] opencodeServerClient.run() returned handle for request ${request.requestId}`);
      resetWatchdog();

      ensureAssistantMessage();
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'prompt_sent',
        message: 'Working...', //OpenCode process started.
        retryable: false,
      });
      emitRunStatus({
        conversationId: conversation.id,
        requestId: request.requestId,
        phase: 'streaming',
        message: 'Working...',
        retryable: false,
      });

      // Watchdog is set up dynamically in onRunStatus callback for both attached_run and direct_run phases.

      logInfo(`[Socket] Awaiting handle.done for request ${request.requestId}...`);
      const result = await handle.done;
      logInfo(`[Socket] handle.done resolved for request ${request.requestId}: completed=${result.completed}, error=${result.error || 'none'}, finalized=${finalized}`);
      if (finalized) return;

      socket.emit('opencode:debug', { msg: `executePrompt result: completed=${result.completed} error=${result.error || 'none'}` });
      if (!result.completed) {
        const message = result.error || 'OpenCode exited before completing the task.';
        logError(`[Socket] Request ${request.requestId} ended in failure: ${message}`);
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
      finalize(!result.completed, { errorSummary: result.error });
    } catch (error: any) {
      const errMsg = error?.message || 'An unexpected error occurred';
      logError(`[Socket] Unhandled error in opencode:message handler: ${errMsg}`, { error });
      socket.emit('opencode:debug', { msg: `Unhandled error in opencode:message: ${errMsg}` });
      try {
        socket.emit('opencode:error', {
          conversationId: payload?.conversationId,
          code: 'OPENCODE_INTERNAL_ERROR',
          message: errMsg,
          retryable: true,
        });
      } catch { /* socket may be closed */ }
    }
    });

    socket.on('opencode:approval', async (payload: OpenCodeApprovalDecision) => {
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

      try {
        await opencodeServerClient.respondToPermission(payload.approvalId, payload.decision);
      } catch (err: any) {
        logError(`[Socket] Failed to respond to permission request ${payload.approvalId}: ${err.message}`);
        socket.emit('opencode:error', {
          conversationId: payload.conversationId,
          code: 'OPENCODE_APPROVAL_FAILED',
          message: `Failed to submit approval: ${err.message}`,
          retryable: true,
        });
        return;
      }

      io.emit('opencode:approval_request', { conversationId: payload.conversationId, approval });

      const approvalStatusMessage: OpenCodeMessage = {
        id: id('approval'),
        conversationId: payload.conversationId,
        role: 'status',
        content: `Approval ${payload.decision === 'reject' ? 'denied' : 'approved'}.`,
        createdAt: now(),
        status: 'complete',
      };
      opencodeStore.addMessage(approvalStatusMessage);
      io.emit('opencode:message', { conversationId: payload.conversationId, message: approvalStatusMessage });
    });

    socket.on('opencode:question_reply', async (payload: { conversationId: string; requestId: string; answers: string[][] }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received question reply event for conversation ${payload.conversationId}, requestId=${payload.requestId}`);

      try {
        await opencodeServerClient.respondToQuestion(payload.requestId, payload.answers);

        const convo = opencodeStore.getConversation(payload.conversationId);
        if (convo) {
          convo.status = convo.activeRequestId ? 'running' : 'idle';
          convo.updatedAt = now();
          opencodeStore.saveConversation(convo);
          io.emit('opencode:snapshot', { conversation: opencodeStore.getSnapshot(payload.conversationId) });
        }
      } catch (err: any) {
        logError(`[Socket] Failed to respond to question request ${payload.requestId}: ${err.message}`);
        socket.emit('opencode:error', {
          conversationId: payload.conversationId,
          code: 'OPENCODE_QUESTION_REPLY_FAILED',
          message: `Failed to submit answer: ${err.message}`,
          retryable: true,
        });
      }
    });

    socket.on('opencode:question_reject', async (payload: { conversationId: string; requestId: string }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received question reject event for conversation ${payload.conversationId}, requestId=${payload.requestId}`);

      try {
        await opencodeServerClient.rejectQuestion(payload.requestId);

        const convo = opencodeStore.getConversation(payload.conversationId);
        if (convo) {
          convo.status = convo.activeRequestId ? 'running' : 'idle';
          convo.updatedAt = now();
          opencodeStore.saveConversation(convo);
          io.emit('opencode:snapshot', { conversation: opencodeStore.getSnapshot(payload.conversationId) });
        }
      } catch (err: any) {
        logError(`[Socket] Failed to reject question request ${payload.requestId}: ${err.message}`);
        socket.emit('opencode:error', {
          conversationId: payload.conversationId,
          code: 'OPENCODE_QUESTION_REJECT_FAILED',
          message: `Failed to reject/skip question: ${err.message}`,
          retryable: true,
        });
      }
    });

    socket.on('opencode:sync', async (payload: OpenCodeSyncRequest = {}) => {
      pokeSelfKeepAlive();
      const conversation = opencodeStore.getOrCreateConversation(payload.conversationId);
      if (conversation.opencodeSessionId) {
        await opencodeServerClient.syncConversationHistory(conversation.id);
      }
      const snapshot = opencodeStore.getSnapshot(conversation.id);
      socket.emit('opencode:snapshot', { conversation: snapshot });
    });

    socket.on('opencode:new_session', () => {
      pokeSelfKeepAlive();
      const conversation = opencodeStore.getOrCreateConversation(undefined, undefined, true);
      socket.emit('opencode:snapshot', { conversation: opencodeStore.getSnapshot(conversation.id) });
      io.emit('opencode:conversations_list', { conversations: opencodeStore.getAllConversations() });
    });

    socket.on('opencode:list_conversations', async () => {
      pokeSelfKeepAlive();
      try {
        const sessions = await opencodeServerClient.listSessions();
        opencodeStore.syncConversationTitlesWithCli(sessions);
      } catch (err) {
        logError(`Failed to sync titles on list_conversations: ${err}`);
      }
      socket.emit('opencode:conversations_list', { conversations: opencodeStore.getAllConversations() });
    });

    socket.on('opencode:delete_conversation', (payload: { conversationId: string }) => {
      pokeSelfKeepAlive();
      if (payload?.conversationId) {
        opencodeStore.deleteConversation(payload.conversationId);
        io.emit('opencode:conversations_list', { conversations: opencodeStore.getAllConversations() });
        const activeConvo = opencodeStore.getSnapshot();
        if (activeConvo) {
          io.emit('opencode:snapshot', { conversation: activeConvo });
        }
      }
    });

    socket.on('opencode:stop', (payload: OpenCodeStopRequest) => {
      pokeSelfKeepAlive();
      const activeRequestId = opencodeStore.getSnapshot(payload.conversationId)?.activeRequestId || id('stop');
      opencodeServerClient.abortActiveSession(payload.conversationId);
      opencodeServerClient.stopActiveRun('user', payload.conversationId);
      opencodeStore.finishRequest(payload.conversationId, true, { stopped: true, errorSummary: 'OpenCode run stopped.' });
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

    socket.on('opencode:env_vars', (newEnv: Record<string, string>) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received opencode:env_vars updates for socket ${socket.id} (keys: ${JSON.stringify(Object.keys(newEnv))})`);
      try {
        EnvService.getInstance().saveEnvVars(newEnv);
        io.emit('opencode:env_vars:update', { env: EnvService.getInstance().getEnvVars() });
      } catch (err: any) {
        logError(`Failed to save env vars via socket: ${err.message}`);
        socket.emit('opencode:error', { error: err.message || String(err) });
      }
    });

    socket.on('opencode:env_vars:request', () => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received opencode:env_vars:request for socket ${socket.id}`);
      socket.emit('opencode:env_vars:update', { env: EnvService.getInstance().getEnvVars() });
    });

    // Preview Event Listeners
    socket.on('preview:start', async (payload: { port: number; command: string; cwd?: string; type: 'expo-go' | 'web' | 'api'; env?: Record<string, string> }) => {
      pokeSelfKeepAlive();
      logInfo(`[Socket] Received preview:start for port ${payload.port}`);
      try {
        const previewService = PreviewService.getInstance();

        // Resolve env vars from original config to ensure ${PORT:X} interpolation
        // (e.g. EXPO_PUBLIC_BRIDGE_PORT=${PORT:3000} → "3001" when Bridge Server shifts to port 3001)
        const resolvedPayload: typeof payload = { ...payload };
        try {
          const fullConfig = previewService.getPreviewConfigPayload();
          const serverConfig = fullConfig.servers.find(s => s.port === payload.port);
          if (serverConfig?.env) {
            resolvedPayload.env = serverConfig.env;
          }
        } catch (e) {
          logError(`[Socket] Failed to resolve preview env vars: ${e}`);
        }

        await previewService.startPreview(
          {
            name: `Preview:${payload.port}`,
            ...resolvedPayload
          },
          (actualPort: number, text: string) => {
            io.emit('preview:log', { port: actualPort, text });
          },
          (actualPort: number, error: string) => {
            io.emit('preview:error', { port: actualPort, error });
          },
          (state) => {
            io.emit('preview:status', {
              port: state.port,
              originalPort: state.originalPort,
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
          originalPort: state.originalPort,
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
        const config = PreviewService.getInstance().getPreviewConfigPayload();
        socket.emit('preview:config_response', config);
      } catch (err: any) {
        logError(`Failed to fetch preview config over socket: ${err.message}`);
        socket.emit('preview:error', { port: 0, error: `Failed to fetch config: ${err.message}` });
      }
    });

    socket.on('disconnect', (reason) => {
      logInfo(`Socket client disconnected: ${socket.id}, reason: ${reason}`);
      opencodeStore.cleanupCredentials(socket.id);
    });
  });

  return io;
};

export const getSocketIO = () => ioInstance;

// Track active watcher instances so they can be recreated when the workspace root changes
let previewWatcher: fs.FSWatcher | null = null;
let envWatcher: fs.FSWatcher | null = null;

// Single module-level SIGINT/SIGTERM handlers that close whatever watchers are active.
// Registered once to avoid handler accumulation across recreateWatchers() calls.
const handleShutdown = () => {
  if (previewWatcher) { try { previewWatcher.close(); } catch { /* ignore */ } }
  if (envWatcher) { try { envWatcher.close(); } catch { /* ignore */ } }
};
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

const startPreviewConfigWatcher = (io: Server) => {
  // Close previous watcher if any
  if (previewWatcher) {
    try { previewWatcher.close(); } catch { /* ignore */ }
    previewWatcher = null;
  }

  const rootDir = getWorkspaceRoot();
  const configDir = path.join(rootDir, '.iota');
  const configPath = path.join(configDir, 'preview.json');

  if (!fs.existsSync(configDir)) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
    } catch (err: any) {
      logError(`Failed to create config directory ${configDir} for watcher: ${err.message}`);
      return;
    }
  }

  let debounceTimeout: NodeJS.Timeout | null = null;

  logInfo(`[Watcher] Starting file watcher for ${configPath}`);

  try {
    previewWatcher = fs.watch(configDir, (eventType, filename) => {
      if (filename === 'preview.json') {
        logInfo(`[Watcher] Detected ${eventType} change in ${filename}`);

        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }

        debounceTimeout = setTimeout(() => {
          try {
            logInfo(`[Watcher] Reading updated preview config payload`);
            const payload = PreviewService.getInstance().getPreviewConfigPayload();
            logInfo(`[Watcher] Broadcasting updated preview config to all connected clients`);
            io.emit('preview:config_response', payload);
          } catch (err: any) {
            logError(`[Watcher] Error broadcasting updated config: ${err.message}`);
          }
        }, 300);
      }
    });
  } catch (err: any) {
    logError(`Failed to initialize fs.watch on ${configDir}: ${err.message}`);
  }
};

const startEnvWatcher = (io: Server) => {
  // Close previous watcher if any
  if (envWatcher) {
    try { envWatcher.close(); } catch { /* ignore */ }
    envWatcher = null;
  }

  const rootDir = getWorkspaceRoot();
  const configDir = path.join(rootDir, '.iota');
  const envPath = path.join(configDir, 'env.json');

  if (!fs.existsSync(configDir)) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
    } catch (err: any) {
      logError(`Failed to create config directory ${configDir} for env watcher: ${err.message}`);
      return;
    }
  }

  let debounceTimeout: NodeJS.Timeout | null = null;

  logInfo(`[Watcher] Starting file watcher for ${envPath}`);

  try {
    envWatcher = fs.watch(configDir, (eventType, filename) => {
      if (filename === 'env.json') {
        logInfo(`[Watcher] Detected ${eventType} change in ${filename}`);

        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }

        debounceTimeout = setTimeout(() => {
          try {
            logInfo(`[Watcher] Reading updated environment variables`);
            const env = EnvService.getInstance().reload();
            logInfo(`[Watcher] Broadcasting updated environment variables to all connected clients`);
            io.emit('opencode:env_vars:update', { env });
          } catch (err: any) {
            logError(`[Watcher] Error broadcasting updated env vars: ${err.message}`);
          }
        }, 300);
      }
    });
  } catch (err: any) {
    logError(`Failed to initialize fs.watch on ${configDir} for env.json: ${err.message}`);
  }
};

/**
 * Recreates file watchers to point at the current workspace root.
 * Should be called after the workspace root is changed dynamically.
 */
export function recreateWatchers() {
  const io = getSocketIO();
  if (!io) {
    logError('[Watcher] Cannot recreate watchers — Socket.IO not initialized');
    return;
  }
  logInfo('[Watcher] Recreating file watchers for new workspace root');
  startPreviewConfigWatcher(io);
  startEnvWatcher(io);
}
