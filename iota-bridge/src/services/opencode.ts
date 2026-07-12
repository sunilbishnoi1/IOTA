import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import { EventEmitter } from 'events';
import { OpenCodeCapabilityState, OpenCodePromptStatusEvent } from '../types/opencode';
import { opencodeStore } from './opencodeStore';
import { EnvService } from './envService';
import { logInfo, logError, getWorkspaceRoot } from './logger';

export interface ModelVariant {
  id: string;
  description: string;
}

export interface ModelInfo {
  providerID: string;
  modelID: string;
  name: string;
  variants: ModelVariant[];
}

export interface ListModelsResult {
  models: ModelInfo[];
}


const OPENCODE_PORT = Number(process.env.OPENCODE_PORT) || 4096;
const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;

const checkPortReady = (port: number, host = '127.0.0.1', timeout = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    const start = Date.now();
    logInfo(`[OpenCodeServerClient] checkPortReady: probing ${host}:${port} with timeout=${timeout}ms`);
    const check = () => {
      let settled = false;
      const req = http.request({
        host,
        port,
        path: '/global/health',
        method: 'GET',
        timeout: 500,
      }, (res) => {
        if (settled) return;
        settled = true;
        const statusCode = res.statusCode ?? 0;
        const isReady = statusCode >= 200 && statusCode < 300;
        logInfo(`[OpenCodeServerClient] checkPortReady: received HTTP response status=${statusCode} from ${host}:${port} — server ${isReady ? 'ready' : 'not ready (non-2xx)'}`);
        resolve(isReady);
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        const elapsed = Date.now() - start;
        logInfo(`[OpenCodeServerClient] checkPortReady: probe failed on ${host}:${port} (error: ${err.message}) elapsed=${elapsed}ms`);
        if (elapsed > timeout) resolve(false);
        else setTimeout(check, 200);
      });

      req.on('timeout', () => {
        req.destroy();
        if (settled) return;
        settled = true;
        const elapsed = Date.now() - start;
        logInfo(`[OpenCodeServerClient] checkPortReady: probe timed out on ${host}:${port} elapsed=${elapsed}ms`);
        if (elapsed > timeout) resolve(false);
        else setTimeout(check, 200);
      });

      req.end();
    };
    check();
  });
};

class OpenCodeSSEClient extends EventEmitter {
  private activeRequest: http.ClientRequest | null = null;
  private sessionListeners = new Map<string, (event: any) => void>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private isDesiredStateConnected = false;
  public onEvent: ((type: string, payload: object) => void) | null = null;

  constructor() {
    super();
  }

  public registerSessionListener(sessionId: string, callback: (event: any) => void) {
    logInfo(`[OpenCodeSSEClient] Registering listener for session ${sessionId}`);
    this.sessionListeners.set(sessionId, callback);
  }

  public removeSessionListener(sessionId: string) {
    logInfo(`[OpenCodeSSEClient] Removing listener for session ${sessionId}`);
    this.sessionListeners.delete(sessionId);
  }

  public start() {
    this.isDesiredStateConnected = true;
    if (this.activeRequest || this.isConnecting) {
      logInfo(`[OpenCodeSSEClient] SSE client is already started or connecting.`);
      return;
    }
    this.connect();
  }

  public stop() {
    this.isDesiredStateConnected = false;
    this.cleanup();
  }

  private cleanup() {
    if (this.activeRequest) {
      logInfo(`[OpenCodeSSEClient] Aborting active SSE request.`);
      this.activeRequest.destroy();
      this.activeRequest = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHeartbeatTimer();
    this.isConnecting = false;
  }

  private connect() {
    if (!this.isDesiredStateConnected) return;
    this.isConnecting = true;

    const port = OPENCODE_PORT;
    const host = '127.0.0.1';

    // Auth variables
    const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
    const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';

    let path = '/event';
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    if (password) {
      const authHeaderValue = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${authHeaderValue}`;
    }

    logInfo(`[OpenCodeSSEClient] Connecting to http://${host}:${port}${path} (attempt=${this.reconnectAttempts + 1})`);

    const req = http.request({
      host,
      port,
      path,
      method: 'GET',
      headers,
    }, (res) => {
      this.isConnecting = false;
      const statusCode = res.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        logError(`[OpenCodeSSEClient] Connection failed with status code ${statusCode}`);
        this.handleFailure();
        return;
      }

      logInfo(`[OpenCodeSSEClient] Connection established with status code ${statusCode}`);
      this.reconnectAttempts = 0; // Reset reconnect attempts on success
      this.resetHeartbeatTimer();

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        while (true) {
          let boundary = buffer.indexOf('\n\n');
          let boundaryLen = 2;
          const rnrnIdx = buffer.indexOf('\r\n\r\n');
          if (rnrnIdx !== -1 && (boundary === -1 || rnrnIdx < boundary)) {
            boundary = rnrnIdx;
            boundaryLen = 4;
          }
          if (boundary === -1) {
            break;
          }
          const block = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + boundaryLen);
          if (block) {
            this.parseBlock(block);
          }
        }
      });

      res.on('end', () => {
        logInfo(`[OpenCodeSSEClient] SSE stream closed by server.`);
        this.handleFailure();
      });

      res.on('error', (err) => {
        logError(`[OpenCodeSSEClient] SSE response stream error: ${err.message}`);
      });
    });

    req.on('error', (err) => {
      this.isConnecting = false;
      logError(`[OpenCodeSSEClient] Connection request error: ${err.message}`);
      this.handleFailure();
    });

    req.end();
    this.activeRequest = req;
  }

  private handleFailure() {
    this.cleanup();
    if (!this.isDesiredStateConnected) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    logInfo(`[OpenCodeSSEClient] Scheduling reconnection in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private parseBlock(block: string) {
    const lines = block.split(/\r?\n/);
    let dataBuffer = '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataBuffer += line.slice(5).trim();
      } else if (line.startsWith(':')) {
        // Comment/heartbeat
        this.resetHeartbeatTimer();
      }
    }
    if (dataBuffer) {
      try {
        const event = JSON.parse(dataBuffer);
        this.dispatchEvent(event);
      } catch (err: any) {
        logError(`[OpenCodeSSEClient] Failed to parse SSE JSON block: ${err.message}. Raw block: ${block}`);
      }
    }
  }

  private dispatchEvent(event: any) {
    this.resetHeartbeatTimer();

    if (event && typeof event === 'object') {
      if (event.properties && typeof event.properties === 'object') {
        Object.assign(event, event.properties);
      }
      if (event.payload && typeof event.payload === 'object') {
        if (event.payload.properties && typeof event.payload.properties === 'object') {
          Object.assign(event.payload, event.payload.properties);
        }
      }
    }

    const type = event.type || event.event || event.kind || (event.payload && (event.payload.type || event.payload.event || event.payload.kind));
    const sessionId = event.sessionID || event.sessionId || event.session_id ||
      (event.payload && (event.payload.sessionID || event.payload.sessionId || event.payload.session_id));

    logInfo(`[SSEClientDebug] dispatchEvent: type=${type} sessionId=${sessionId} hasOnEvent=${!!this.onEvent} listenersCount=${this.sessionListeners.size} hasSessionListener=${this.sessionListeners.has(sessionId)}`);

    if (this.onEvent && type) {
      this.onEvent(String(type), event);
    }

    if (sessionId) {
      const listener = this.sessionListeners.get(sessionId);
      if (listener) {
        logInfo(`[SSEClientDebug] dispatchEvent: invoking session listener for sessionId=${sessionId} type=${type}`);
        listener(event);
      }
    }
    this.emit('event', event);
  }

  private resetHeartbeatTimer() {
    this.clearHeartbeatTimer();
    // Heartbeat is sent every 15s. Let's set timeout to 30s to be safe.
    this.heartbeatTimer = setTimeout(() => {
      logError(`[OpenCodeSSEClient] Heartbeat timeout! Reconnecting...`);
      this.handleFailure();
    }, 30000);
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const openCodeSSEClient = new OpenCodeSSEClient();

export interface FilePartInput {
  type: 'file';
  mime: string;
  url: string;
  filename?: string;
}

export interface PromptOptions {
  conversationId: string;
  requestId: string;
  prompt: string;
  parts?: FilePartInput[];
  sessionId?: string;
  env?: Record<string, string>;
  onJson: (payload: unknown) => void;
  onText?: (chunk: string) => void;
  onStderr?: (line: string) => void;
  onActivity?: () => void;
  onRunStatus?: (status: OpenCodePromptStatusEvent) => void;
}

export interface PromptHandle {
  stop: (reason?: 'user' | 'watchdog') => void;
  done: Promise<{ completed: boolean; error?: string }>;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ServerReadinessResult {
  ready: boolean;
  url?: string;
  details: string;
}

class OpenCodeServerClient {
  private serveProcess: ChildProcess | null = null;
  private activeRequestIds = new Map<string, string>();
  private userStoppedRequests = new Set<string>();
  private serverStartPromise: Promise<ServerReadinessResult> | null = null;
  private installing = false;
  private lastKnownCapability: OpenCodeCapabilityState | null = null;
  private activeSessions = new Map<string, string>();

  public async checkCapability(): Promise<OpenCodeCapabilityState> {
    const timestamp = new Date().toISOString();

    // First probe the serve health endpoint to check if daemon is running
    const healthOk = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 1000);
    if (healthOk) {
      logInfo(`[OpenCodeServerClient] checkCapability: serve health endpoint responded OK`);
      const available: OpenCodeCapabilityState = {
        status: 'available',
        details: 'OpenCode server is running',
        canSubmit: true,
        canInstall: false,
        lastCheckedAt: timestamp,
      };
      this.lastKnownCapability = available;
      return available;
    }

    // Fall back to CLI binary existence check
    logInfo(`[OpenCodeServerClient] checkCapability: serve not responding, probing opencode --version`);
    const version = await this.runCommand('opencode', ['--version'], 5000);
    logInfo(`[OpenCodeServerClient] checkCapability: --version exitCode=${version.exitCode}, stdout="${(version.stdout || '').trim().slice(0, 80)}", stderr="${(version.stderr || '').trim().slice(0, 120)}"`);

    if (version.exitCode !== 0) {
      logInfo(`[OpenCodeServerClient] checkCapability: OpenCode is missing or returned non-zero exit code`);
      const missing: OpenCodeCapabilityState = {
        status: 'missing',
        details: 'OpenCode is not installed in this environment',
        canSubmit: false,
        canInstall: true,
        lastCheckedAt: timestamp,
        errorSummary: this.sanitizeLine(version.stderr || version.stdout),
      };
      this.lastKnownCapability = missing;
      return missing;
    }

    const workspaceRoot = this.getWorkspaceRootSync();
    logInfo(`[OpenCodeServerClient] checkCapability: checking workspace root: ${workspaceRoot}`);
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      logError(`[OpenCodeServerClient] checkCapability: workspace folder is not ready or not found: ${workspaceRoot}`);
      const uninitialized: OpenCodeCapabilityState = {
        status: 'installed_uninitialized',
        details: 'OpenCode is installed, but the workspace folder is not ready',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: timestamp,
        errorSummary: `Workspace not found: ${workspaceRoot}`,
      };
      this.lastKnownCapability = uninitialized;
      return uninitialized;
    }

    logInfo(`[OpenCodeServerClient] checkCapability: OpenCode binary found — can be started`);
    const available: OpenCodeCapabilityState = {
      status: 'available',
      details: 'OpenCode is ready',
      canSubmit: true,
      canInstall: false,
      lastCheckedAt: timestamp,
    };
    this.lastKnownCapability = available;
    return available;
  }

  public getLastCapability(): OpenCodeCapabilityState | null {
    return this.lastKnownCapability;
  }

  public async install(onProgress: (message: string) => void): Promise<OpenCodeCapabilityState> {
    logInfo(`[OpenCodeServerClient] install: starting installation`);
    if (this.installing) {
      logInfo(`[OpenCodeServerClient] install: already installing, skipping`);
      return {
        status: 'installing',
        details: 'OpenCode installation is already running',
        canSubmit: false,
        canInstall: false,
        lastCheckedAt: new Date().toISOString(),
      };
    }

    this.installing = true;
    onProgress('Installing OpenCode with npm...');

    const npmCommand = await this.findNpmCommand();
    let npmResult: CommandResult | undefined;
    if (npmCommand) {
      logInfo(`[OpenCodeServerClient] install: running npm installer using command: ${npmCommand.command}`);
      npmResult = await this.runInstaller(
        npmCommand.command,
        [...npmCommand.prefixArgs, 'install', '-g', 'opencode-ai'],
        onProgress
      );
    } else {
      logInfo(`[OpenCodeServerClient] install: npm not found, will fallback to curl`);
      onProgress('npm was not found. Trying the official OpenCode installer...');
    }

    let capability = await this.checkCapability();
    logInfo(`[OpenCodeServerClient] install: capability after npm install attempt is ${capability.status}`);
    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      this.installing = false;
      logInfo(`[OpenCodeServerClient] install: installation succeeded after npm install`);
      return capability;
    }

    logInfo(`[OpenCodeServerClient] install: npm install did not make OpenCode available. Trying curl script installer...`);
    onProgress('Trying the official OpenCode install script...');
    const curlResult = await this.runInstaller('bash', ['-lc', 'curl -fsSL https://opencode.ai/install | bash'], onProgress);
    capability = await this.checkCapability();
    this.installing = false;
    logInfo(`[OpenCodeServerClient] install: capability after curl install attempt is ${capability.status}`);

    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      logInfo(`[OpenCodeServerClient] install: installation succeeded after curl script`);
      return capability;
    }

    const failureText = this.sanitizeLine(curlResult.stderr || curlResult.stdout || npmResult?.stderr || npmResult?.stdout);
    logError(`[OpenCodeServerClient] install: installation failed. Failure text: "${failureText}"`);
    const failedCapability: OpenCodeCapabilityState = {
      status: 'install_failed',
      details: 'OpenCode installation failed',
      canSubmit: false,
      canInstall: true,
      lastCheckedAt: new Date().toISOString(),
      errorSummary: failureText || `Installer exited with code ${curlResult.exitCode}`,
    };
    this.lastKnownCapability = failedCapability;
    return failedCapability;
  }
  private async createSession(): Promise<string> {
    const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
    const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const req = http.request({
        host: '127.0.0.1',
        port: OPENCODE_PORT,
        path: '/session',
        method: 'POST',
        headers,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.id) {
                resolve(parsed.id);
              } else {
                reject(new Error(`Failed to parse session ID from response: ${body}`));
              }
            } catch (err: any) {
              reject(new Error(`Invalid JSON in session create response: ${err.message}`));
            }
          } else {
            reject(new Error(`Session create failed with status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(JSON.stringify({}));
      req.end();
    });
  }

  private async postPromptAsync(sessionId: string, prompt: string, conversationId: string, options?: FilePartInput[]): Promise<void> {
    const conversation = conversationId ? opencodeStore.getConversation(conversationId) : undefined;
    const modelStr = conversation?.activeModel || 'opencode/deepseek-v4-flash-free';
    const variant = conversation?.activeVariant;
    const slashIdx = modelStr.indexOf('/');
    const providerID = slashIdx !== -1 ? modelStr.substring(0, slashIdx) : 'opencode';
    const modelID = slashIdx !== -1 ? modelStr.substring(slashIdx + 1) : modelStr;

    if (variant) {
      try {
        const client = await this.getV2Client();
        const bodyParts: Array<{ type: string; text?: string; mime?: string; url?: string; filename?: string }> = [];
        if (prompt) bodyParts.push({ type: 'text', text: prompt });
        if (options) bodyParts.push(...options);
        await client.session.prompt({
          sessionID: sessionId,
          model: { providerID, modelID },
          variant,
          parts: bodyParts,
        });
        return;
      } catch (err: any) {
        logError(`[OpenCodeServerClient] postPromptAsync v2 failed for variant, falling back to v1: ${err.message}`);
      }
    }

    const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
    const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';
    const modelObj = { providerID, modelID };

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const req = http.request({
        host: '127.0.0.1',
        port: OPENCODE_PORT,
        path: `/session/${sessionId}/prompt_async`,
        method: 'POST',
        headers,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Prompt request failed with status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      const bodyParts: Array<{ type: string; text?: string; mime?: string; url?: string; filename?: string }> = [];
      if (prompt) bodyParts.push({ type: 'text', text: prompt });
      if (options) bodyParts.push(...options);
      req.write(JSON.stringify({
        parts: bodyParts,
        model: modelObj,
      }));
      req.end();
    });
  }

  private async abortSession(sessionId: string): Promise<void> {
    const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
    const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const req = http.request({
        host: '127.0.0.1',
        port: OPENCODE_PORT,
        path: `/session/${sessionId}/abort`,
        method: 'POST',
        headers,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Abort request failed with status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  public async executePrompt(options: PromptOptions): Promise<PromptHandle> {
    logInfo(`[OpenCodeServerClient] Starting prompt request ${options.requestId} for conversation ${options.conversationId}, prompt="${options.prompt.slice(0, 80)}"`);
    this.activeRequestIds.set(options.conversationId, options.requestId);
    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: 'connecting',
      message: 'working...',
      retryable: false,
    });

    const server = await this.ensureServer();
    logInfo(`[OpenCodeServerClient] ensureServer result: ready=${server.ready}, details="${server.details}"`);

    if (!server.ready) {
      throw new Error(`OpenCode server failed to start: ${server.details}`);
    }

    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: 'session_created',
      message: 'working...',
      retryable: false,
    });

    let activeSessionId = options.sessionId;

    const donePromise = new Promise<{ completed: boolean; error?: string }>(async (resolve) => {
      try {
        if (!activeSessionId) {
          logInfo(`[OpenCodeServerClient] Creating new session...`);
          activeSessionId = await this.createSession();
          logInfo(`[OpenCodeServerClient] Created new session ID: ${activeSessionId}`);
          options.onJson({ type: 'session', sessionID: activeSessionId });
        }

        this.activeSessions.set(options.conversationId, activeSessionId);

        openCodeSSEClient.registerSessionListener(activeSessionId, (event) => {
          const evType = event?.type || event?.event || event?.kind || 'unknown';
          const evSessionId = event?.sessionID || event?.sessionId || event?.session_id || '';
          logInfo(`[SSEClientDebug] sessionListener received: type=${evType} sessionId=${evSessionId} for registeredSession=${activeSessionId}`);
          options.onActivity?.();

          options.onJson(event);

          if (event.type === 'session.status' && event.status?.type === 'idle') {
            logInfo(`[OpenCodeServerClient] Session ${activeSessionId} status is idle, run completed.`);
            openCodeSSEClient.removeSessionListener(activeSessionId!);
            this.activeSessions.delete(options.conversationId);
            resolve({ completed: true });
          }

          if (event.type === 'session.error') {
            const errorMsg = event.error?.data?.message || event.error?.message || 'Unknown server error';
            logError(`[OpenCodeServerClient] Session error: ${errorMsg}`);
            options.onStderr?.(errorMsg);
            openCodeSSEClient.removeSessionListener(activeSessionId!);
            this.activeSessions.delete(options.conversationId);
            resolve({ completed: false, error: errorMsg });
          }
        });

        logInfo(`[OpenCodeServerClient] Posting prompt_async for session ${activeSessionId}...`);
        await this.postPromptAsync(activeSessionId, options.prompt, options.conversationId, options.parts);
      } catch (err: any) {
        logError(`[OpenCodeServerClient] Failed execution for request ${options.requestId}: ${err.message}`);
        resolve({ completed: false, error: err.message });
      }
    });

    return {
      stop: async (reason: 'user' | 'watchdog' = 'user') => {
        logInfo(`[OpenCodeServerClient] Stop requested for requestId=${options.requestId}, reason=${reason}`);
        if (reason === 'user') {
          this.userStoppedRequests.add(options.requestId);
        }
        if (activeSessionId) {
          try {
            await this.abortSession(activeSessionId);
          } catch (err: any) {
            logError(`[OpenCodeServerClient] Failed to abort session ${activeSessionId}: ${err.message}`);
          }
        }
      },
      done: donePromise,
    };
  }

  public stopActiveRun(reason: 'user' | 'watchdog' = 'user', conversationId?: string) {
    if (reason === 'user') {
      if (conversationId) {
        const requestId = this.activeRequestIds.get(conversationId);
        if (requestId) {
          this.userStoppedRequests.add(requestId);
        }
      } else {
        for (const requestId of this.activeRequestIds.values()) {
          this.userStoppedRequests.add(requestId);
        }
      }
    }
  }

  public async abortActiveSession(conversationId: string): Promise<void> {
    const sessionId = this.activeSessions.get(conversationId);
    if (!sessionId) {
      logInfo(`[OpenCodeServerClient] abortActiveSession: no active session for conversation ${conversationId}`);
      return;
    }
    logInfo(`[OpenCodeServerClient] abortActiveSession: aborting session ${sessionId} for conversation ${conversationId}`);
    try {
      await this.abortSession(sessionId);
      this.activeSessions.delete(conversationId);
    } catch (err: any) {
      logError(`[OpenCodeServerClient] abortActiveSession: failed to abort session ${sessionId}: ${err.message}`);
    }
  }

  private getCorsArgs(): string[] {
    const args: string[] = [];
    const corsOrigins = process.env.OPENCODE_CORS_ORIGINS;
    if (corsOrigins) {
      const origins = corsOrigins.split(',').map(o => o.trim()).filter(Boolean);
      for (const origin of origins) {
        args.push('--cors', origin);
      }
    }
    return args;
  }

  public async ensureServer(): Promise<ServerReadinessResult> {
    if (this.serverStartPromise) {
      logInfo(`[OpenCodeServerClient] ensureServer: server start is already in progress, waiting for it`);
      return this.serverStartPromise;
    }

    this.serverStartPromise = (async () => {
      logInfo(`[OpenCodeServerClient] ensureServer: serveProcess exists=${!!this.serveProcess}`);
      if (this.serveProcess) {
        const warm = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 500);
        logInfo(`[OpenCodeServerClient] ensureServer: existing server warm=${warm}`);
        if (warm) {
          openCodeSSEClient.start();
          return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
        }
        logInfo(`[OpenCodeServerClient] ensureServer: existing server is stale, clearing`);
        await this.clearStaleServer();
      } else {
        // If we don't have an active serveProcess, but the port is listening, it is an orphaned daemon. Clear it!
        const activeOrphaned = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 500);
        if (activeOrphaned) {
          logInfo(`[OpenCodeServerClient] ensureServer: detected orphaned opencode daemon on port ${OPENCODE_PORT}, killing it`);
          await this.killProcessOnPort(OPENCODE_PORT);
        }
      }

      const available = await this.commandExists('opencode');
      logInfo(`[OpenCodeServerClient] ensureServer: opencode binary available=${available}`);
      if (!available) return { ready: false, details: 'OpenCode binary is missing' };

      try {
        const corsArgs = this.getCorsArgs();
        const workspaceRoot = await this.getWorkspaceRoot();
        // Validate CWD — warn if the resolved root doesn't look like the IOTA workspace
        if (workspaceRoot && fs.existsSync(workspaceRoot)) {
          const hasIotaDir = fs.existsSync(path.join(workspaceRoot, '.iota'));
          const hasBridgePackage = fs.existsSync(path.join(workspaceRoot, 'iota-bridge', 'package.json'));
          if (!hasIotaDir && !hasBridgePackage) {
            logInfo(`[OpenCodeServerClient] ensureServer: workspace root "${workspaceRoot}" lacks .iota/ directory — verified path exists, proceeding`);
          }
        } else {
          logError(`[OpenCodeServerClient] ensureServer: workspace root "${workspaceRoot}" does not exist — falling back to process.cwd()`);
        }
        const resolvedCwd = (workspaceRoot && fs.existsSync(workspaceRoot)) ? workspaceRoot : process.cwd();
        logInfo(`[OpenCodeServerClient] ensureServer: spawning opencode serve --port ${OPENCODE_PORT} --hostname 127.0.0.1${corsArgs.length ? ' ' + corsArgs.join(' ') : ''}`);
        const child = this.spawnProcess('opencode', ['serve', '--port', String(OPENCODE_PORT), '--hostname', '127.0.0.1', ...corsArgs], {
          cwd: resolvedCwd,
          stdio: 'ignore',
          detached: true,
        });
        this.serveProcess = child;
        child.unref();
        logInfo(`[OpenCodeServerClient] ensureServer: serve process PID=${child.pid}`);

        child.on('close', (code) => {
          logInfo(`[OpenCodeServerClient] ensureServer: serve process PID=${child.pid} closed with code=${code}`);
          if (this.serveProcess === child) {
            this.serveProcess = null;
          }
        });
        child.on('error', (err) => {
          logError(`[OpenCodeServerClient] ensureServer: serve process PID=${child.pid} error: ${err.message}`);
          if (this.serveProcess === child) {
            this.serveProcess = null;
          }
        });

        const ready = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 10000);
        logInfo(`[OpenCodeServerClient] ensureServer: port probe result ready=${ready}`);
        if (!ready) {
          await this.clearStaleServer();
          return { ready: false, details: 'OpenCode server port did not become ready' };
        }

        // Warmup delay to allow daemon internal task pipelines to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Start the persistent SSE client
        openCodeSSEClient.start();

        return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
      } catch (error: any) {
        logError(`[OpenCodeServerClient] ensureServer: exception: ${error?.message}`);
        await this.clearStaleServer();
        return { ready: false, details: error?.message || 'OpenCode server could not start' };
      }
    })();

    try {
      return await this.serverStartPromise;
    } finally {
      this.serverStartPromise = null;
    }
  }

  public registerChildSessionListener(sessionId: string, callback: (event: any) => void) {
    openCodeSSEClient.registerSessionListener(sessionId, callback);
  }

  public removeChildSessionListener(sessionId: string) {
    openCodeSSEClient.removeSessionListener(sessionId);
  }

  public async clearStaleServer(): Promise<void> {
    openCodeSSEClient.stop();
    if (this.serveProcess) {
      logInfo(`[OpenCodeServerClient] clearStaleServer: killing active serveProcess PID=${this.serveProcess.pid}`);
      try {
        this.killProcess(this.serveProcess);
      } catch (err: any) {
        logError(`[OpenCodeServerClient] clearStaleServer: failed to kill: ${err.message}`);
      }
      this.serveProcess = null;
    }
    await this.killProcessOnPort(OPENCODE_PORT);
  }

  private async killProcessOnPort(port: number): Promise<void> {
    logInfo(`[OpenCodeServerClient] Attempting to kill any process occupying port ${port}`);
    const isWin = process.platform === 'win32';
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      if (isWin) {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port} | findstr LISTENING`);
        const lines = stdout.split('\n').map((l: string) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(Number(pid)) && Number(pid) > 0) {
            logInfo(`[OpenCodeServerClient] Killing process with PID ${pid} on port ${port}`);
            await execAsync(`taskkill /F /PID ${pid}`).catch(() => undefined);
          }
        }
      } else {
        await execAsync(`lsof -t -sTCP:LISTEN -i :${port} | xargs kill -9`);
        logInfo(`[OpenCodeServerClient] Killed process on port ${port} via lsof`);
      }
    } catch (err: any) {
      logError(`[OpenCodeServerClient] Failed to kill process on port ${port}: ${err.message || err}`);
    }
  }

  private async makeRequest(options: {
    path: string;
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
    body?: any;
  }): Promise<string> {
    const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
    const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }
      if (password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }

      const req = http.request({
        host: '127.0.0.1',
        port: OPENCODE_PORT,
        path: options.path,
        method: options.method,
        headers,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Request ${options.method} ${options.path} failed with status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  public async respondToPermission(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<boolean> {
    logInfo(`[OpenCodeServerClient] respondToPermission: requestId=${requestId}, reply=${reply}`);
    const body = await this.makeRequest({
      path: `/permission/${requestId}/reply`,
      method: 'POST',
      body: { reply },
    });
    return body === 'true' || body === '';
  }

  public async respondToQuestion(requestId: string, answers: string[][]): Promise<boolean> {
    logInfo(`[OpenCodeServerClient] respondToQuestion: requestId=${requestId}, answersCount=${answers.length}`);
    const body = await this.makeRequest({
      path: `/question/${requestId}/reply`,
      method: 'POST',
      body: { answers },
    });
    return body === 'true' || body === '';
  }

  public async rejectQuestion(requestId: string): Promise<boolean> {
    logInfo(`[OpenCodeServerClient] rejectQuestion: requestId=${requestId}`);
    const body = await this.makeRequest({
      path: `/question/${requestId}/reject`,
      method: 'POST',
    });
    return body === 'true' || body === '';
  }

  public async syncConversationHistory(conversationId: string): Promise<void> {
    logInfo(`[OpenCodeServerClient] syncConversationHistory: conversationId=${conversationId}`);
    const conversation = opencodeStore.getConversation(conversationId);
    if (!conversation || !conversation.opencodeSessionId) {
      logInfo(`[OpenCodeServerClient] syncConversationHistory: conversation not found or opencodeSessionId is missing`);
      return;
    }

    try {
      const body = await this.makeRequest({
        path: `/session/${conversation.opencodeSessionId}/message`,
        method: 'GET',
      });
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        logError(`[OpenCodeServerClient] syncConversationHistory: expected array from messages, got ${typeof parsed}`);
        return;
      }

      logInfo(`[OpenCodeServerClient] syncConversationHistory: fetched ${parsed.length} message(s) for session ${conversation.opencodeSessionId}`);

      const mappedMessages = parsed.map((item: any) => {
        const info = item.info || {};
        const parts = Array.isArray(item.parts) ? item.parts : [];

        let content = '';
        const parsedBlocks: any[] = [];
        const textParts = parts.filter((p: any) => p.type === 'text');
        const lastTextPart = textParts[textParts.length - 1];

        const baseTime = new Date(info.createdAt || new Date().toISOString()).getTime();
        let partIndex = 0;

        for (const part of parts) {
          const rawTime = part.time || part.createdAt || part.updatedAt;
          const partTime = rawTime ? new Date(rawTime).toISOString() : new Date(baseTime + partIndex * 10).toISOString();
          partIndex++;

          if (part.type === 'reasoning') {
            const partText = part.text || part.delta || part.content || '';
            content += `<thought>${partText}</thought>`;
            parsedBlocks.push({
              type: 'thought',
              content: partText,
              isFinished: true,
              startedAt: partTime,
              completedAt: partTime,
            });
          } else if (part.type === 'text') {
            const partText = part.text || part.delta || part.content || '';
            content += partText;
            const isLast = part === lastTextPart;
            parsedBlocks.push({
              type: isLast ? 'text' : 'intermediate',
              content: partText,
              isFinished: true,
              startedAt: partTime,
              completedAt: partTime,
            });
          }
        }

        if (!content && parts.length > 0) {
          content = parts.map((p: any) => p.text || p.content || '').join('');
        }

        return {
          id: info.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId,
          role: info.role || 'assistant',
          content,
          createdAt: info.createdAt || new Date().toISOString(),
          status: 'complete' as const,
          metadata: { parsedBlocks },
          parts: parts.map((part: any, idx: number) => {
            let startMs = baseTime + idx * 10;
            let endMs = startMs;
            
            if (part.time) {
              if (typeof part.time.start === 'number') startMs = part.time.start;
              else if (typeof part.time.start === 'string') startMs = new Date(part.time.start).getTime();
              
              if (typeof part.time.end === 'number') endMs = part.time.end;
              else if (typeof part.time.end === 'string') endMs = new Date(part.time.end).getTime();
            } else {
              const rawTime = part.createdAt || part.updatedAt;
              if (rawTime) {
                startMs = new Date(rawTime).getTime();
                endMs = startMs;
              }
            }
            
            if (isNaN(startMs)) startMs = baseTime + idx * 10;
            if (isNaN(endMs)) endMs = startMs;

            return {
              id: part.id || part.callID || `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: part.type,
              text: part.text,
              tool: part.tool,
              callID: part.callID,
              state: part.state,
              input: part.input,
              result: part.result,
              output: part.output,
              error: part.error,
              mime: part.mime,
              filename: part.filename,
              url: part.url,
              sessionID: part.sessionID || conversation.opencodeSessionId,
              messageID: part.messageID || info.id || `msg-${conversation.opencodeSessionId}`,
              time: { start: startMs, end: endMs },
              metadata: {
                ...(part.metadata || {}),
                sessionID: part.metadata?.sessionID || part.sessionID || conversation.opencodeSessionId,
                messageID: part.metadata?.messageID || part.messageID || info.id || `msg-${conversation.opencodeSessionId}`,
              },
            };
          }),
        };
      });

      for (const msg of mappedMessages) {
        if (!msg.parts) continue;
        const taskPartsToSync = msg.parts.filter(
          (p: any) => p.type === 'tool' && (p.tool === 'task' || p.toolName === 'task') && p.callID
        );

        for (const part of taskPartsToSync) {
          const state = part.state || {};
          const input = part.input || state.input || {};
          const metadata = part.metadata || state.metadata || {};
          const childSessionID = metadata.childSessionID || state.childSessionID || input.childSessionID;

          if (childSessionID) {
            try {
              const childBody = await this.makeRequest({
                path: `/session/${childSessionID}/message`,
                method: 'GET',
              });
              const childParsed = JSON.parse(childBody);
              if (Array.isArray(childParsed)) {
                for (const childItem of childParsed) {
                  const childParts = Array.isArray(childItem.parts) ? childItem.parts : [];
                  let childPartIndex = 0;
                  const childBaseTime = new Date(childItem.info?.createdAt || msg.createdAt || new Date().toISOString()).getTime();
                  for (const cp of childParts) {
                    let startMs = childBaseTime + childPartIndex * 10;
                    let endMs = startMs;
                    childPartIndex++;

                    if (cp.time) {
                      if (typeof cp.time.start === 'number') startMs = cp.time.start;
                      else if (typeof cp.time.start === 'string') startMs = new Date(cp.time.start).getTime();
                      
                      if (typeof cp.time.end === 'number') endMs = cp.time.end;
                      else if (typeof cp.time.end === 'string') endMs = new Date(cp.time.end).getTime();
                    } else {
                      const rawTime = cp.createdAt || cp.updatedAt;
                      if (rawTime) {
                        startMs = new Date(rawTime).getTime();
                        endMs = startMs;
                      }
                    }
                    if (isNaN(startMs)) startMs = childBaseTime + childPartIndex * 10;
                    if (isNaN(endMs)) endMs = startMs;

                    const mappedChildPart = {
                      id: cp.id || cp.callID || `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      type: cp.type,
                      text: cp.text,
                      tool: cp.tool,
                      callID: cp.callID,
                      state: cp.state,
                      input: cp.input,
                      result: cp.result,
                      output: cp.output,
                      error: cp.error,
                      mime: cp.mime,
                      filename: cp.filename,
                      url: cp.url,
                      sessionID: childSessionID,
                      messageID: childItem.info?.id || `msg-${childSessionID}`,
                      time: { start: startMs, end: endMs },
                      metadata: {
                        ...(cp.metadata || {}),
                        sessionID: childSessionID,
                        childSessionID: childSessionID,
                      }
                    };
                    msg.parts.push(mappedChildPart);
                  }
                }
              }
            } catch (childErr: any) {
              logError(`[OpenCodeServerClient] Failed to sync child session ${childSessionID} for task ${part.callID}: ${childErr.message}`);
            }
          }
        }
      }

      const localOnlyMessages = conversation.messages.filter(
        m => m.role !== 'user' && m.role !== 'assistant'
      );
      conversation.messages = [...localOnlyMessages, ...mappedMessages];
      conversation.updatedAt = new Date().toISOString();
      opencodeStore.saveConversation(conversation);
      logInfo(`[OpenCodeServerClient] syncConversationHistory: successfully synchronized ${mappedMessages.length} messages (preserved ${localOnlyMessages.length} local-only messages)`);
    } catch (err: any) {
      logError(`[OpenCodeServerClient] syncConversationHistory failed: ${err.message}`);
    }
  }

  public async listSessions(): Promise<unknown[]> {
    logInfo(`[OpenCodeServerClient] listSessions: listing sessions via REST`);
    try {
      const body = await this.makeRequest({ path: '/session', method: 'GET' });
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      logInfo(`[OpenCodeServerClient] listSessions: successfully retrieved ${list.length} session(s)`);
      return list;
    } catch (err: any) {
      logError(`[OpenCodeServerClient] listSessions failed: ${err.message}`);
      return [];
    }
  }

  public async runModelsQuery(): Promise<string> {
    logInfo(`[OpenCodeServerClient] runModelsQuery: querying providers config via REST`);
    try {
      const body = await this.makeRequest({ path: '/config/providers', method: 'GET' });
      const parsed = JSON.parse(body);
      let output = 'Available models:\n';
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const prov of parsed.providers) {
          if (prov.models && Array.isArray(prov.models)) {
            for (const model of prov.models) {
              output += `- ${prov.id}/${model.id || model}\n`;
            }
          }
        }
      }
      return output.trim();
    } catch (err: any) {
      logError(`[OpenCodeServerClient] runModelsQuery failed: ${err.message}`);
      throw err;
    }
  }

  public async runStatsQuery(): Promise<string> {
    logInfo(`[OpenCodeServerClient] runStatsQuery: querying health/stats via REST`);
    try {
      const body = await this.makeRequest({ path: '/global/health', method: 'GET' });
      const parsed = JSON.parse(body);
      return `Server is healthy: ${parsed.healthy}\nVersion: ${parsed.version}`;
    } catch (err: any) {
      logError(`[OpenCodeServerClient] runStatsQuery failed: ${err.message}`);
      throw err;
    }
  }

  public async runSessionsQuery(): Promise<string> {
    logInfo(`[OpenCodeServerClient] runSessionsQuery: executing session list query`);

    let cliSessionsMd = '';
    try {
      const list = await this.listSessions();
      if (list.length > 0) {
        cliSessionsMd = `### Active CLI Sessions (OpenCode)\n\n| Session ID | Title | Created | Updated |\n| :--- | :--- | :--- | :--- |\n`;
        for (const ses of list as any[]) {
          const createdDate = ses.created ? new Date(ses.created).toLocaleString() : 'N/A';
          const updatedDate = ses.updated ? new Date(ses.updated).toLocaleString() : 'N/A';
          cliSessionsMd += `| \`${ses.id}\` | ${ses.title || 'Untitled'} | ${createdDate} | ${updatedDate} |\n`;
        }
      } else {
        cliSessionsMd = '### Active CLI Sessions (OpenCode)\n\nNo active CLI sessions found.';
      }
    } catch (err: any) {
      logError(`[OpenCodeServerClient] runSessionsQuery: failed to load CLI sessions: ${err.message}`);
      cliSessionsMd = `### Active CLI Sessions (OpenCode)\n\nFailed to load CLI sessions.`;
    }

    const conversations = opencodeStore.getAllConversations();
    let convosMd = '';
    if (conversations.length > 0) {
      convosMd = `### IOTA Conversations\n\n| Conversation ID | Title | CLI Session ID | Messages | Status | Updated |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const convo of conversations) {
        const updatedDate = convo.updatedAt ? new Date(convo.updatedAt).toLocaleString() : 'N/A';
        const cliSessionId = convo.opencodeSessionId ? `\`${convo.opencodeSessionId}\`` : 'None';
        const title = convo.title || 'Untitled';
        const msgCount = convo.messages ? convo.messages.length : 0;
        convosMd += `| \`${convo.id}\` | ${title} | ${cliSessionId} | ${msgCount} | ${convo.status} | ${updatedDate} |\n`;
      }
    } else {
      convosMd = '### IOTA Conversations\n\nNo saved conversations found.';
    }

    return `${convosMd}\n\n${cliSessionsMd}`.trim();
  }

  public async runSessionDelete(sessionId: string): Promise<string> {
    logInfo(`[OpenCodeServerClient] runSessionDelete: deleting session ${sessionId} via REST`);
    await this.makeRequest({ path: `/session/${sessionId}`, method: 'DELETE' });
    return `Session \`${sessionId}\` deleted successfully.`;
  }

  public async runExportQuery(sessionId?: string): Promise<string> {
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const sessions = await this.listSessions();
      if (sessions && sessions.length > 0) {
        const first = sessions[0] as { id?: string; sessionId?: string; session_id?: string };
        targetSessionId = first.id || first.sessionId || first.session_id;
      }
    }
    if (!targetSessionId) {
      throw new Error('No active sessions found to export.');
    }
    logInfo(`[OpenCodeServerClient] runExportQuery: exporting session ${targetSessionId} via REST`);
    const body = await this.makeRequest({ path: `/session/${targetSessionId}`, method: 'GET' });
    try {
      const parsed = JSON.parse(body);
      return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
      return `\`\`\`json\n${body}\n\`\`\``;
    }
  }

  public async runCompactQuery(conversationId?: string): Promise<string> {
    logInfo(`[OpenCodeServerClient] runCompactQuery: summarizing session via REST`);
    const conversation = conversationId ? opencodeStore.getConversation(conversationId) : undefined;
    const sessionId = conversation?.opencodeSessionId;
    if (!sessionId) {
      throw new Error(`No active session found for conversation ${conversationId || 'unknown'}`);
    }
    const modelStr = conversation?.activeModel || 'opencode/deepseek-v4-flash-free';
    const slashIdx = modelStr.indexOf('/');
    const providerID = slashIdx !== -1 ? modelStr.substring(0, slashIdx) : 'opencode';
    const modelID = slashIdx !== -1 ? modelStr.substring(slashIdx + 1) : modelStr;

    await this.makeRequest({
      path: `/session/${sessionId}/summarize`,
      method: 'POST',
      body: {
        providerID,
        modelID,
      }
    });
    return 'Conversation summarized successfully.';
  }


  private v2Client: any = null;

  private async getV2Client(): Promise<any> {
    if (this.v2Client) return this.v2Client;
    try {
      const mod = await (Function('return import("@opencode-ai/sdk/v2/client")')()) as any;
      const { OpencodeClient } = mod;
      const password = process.env.OPENCODE_SERVER_PASSWORD || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_PASSWORD;
      const username = process.env.OPENCODE_SERVER_USERNAME || EnvService.getInstance().getEnvVars().OPENCODE_SERVER_USERNAME || 'opencode';
      const headers: Record<string, string> = {};
      if (password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }
      this.v2Client = new OpencodeClient({
        baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`,
        headers,
      });
      logInfo('[OpenCodeServerClient] v2 SDK client initialized');
    } catch (err: any) {
      logError(`[OpenCodeServerClient] Failed to initialize v2 SDK client: ${err.message}`);
      throw err;
    }
    return this.v2Client;
  }

public async listModels(): Promise<ListModelsResult> {
    logInfo(`[OpenCodeServerClient] listModels: querying providers with variants`);
    const serverReady = await this.ensureServer();
    if (!serverReady.ready) {
      logError(`[OpenCodeServerClient] listModels: server not ready — ${serverReady.details}`);
      return { models: [] };
    }
    logInfo(`[OpenCodeServerClient] listModels: server ready, querying via v2 SDK`);
    const client = await this.getV2Client();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data } = await client.config.providers();
        const providers = data?.providers || [];
        if (providers.length > 0) {
          const models = this.buildModelsFromProviders(providers);
          logInfo(`[OpenCodeServerClient] listModels: found ${models.length} models on attempt ${attempt + 1}`);
          return { models };
        } else if (attempt < 2) {
          logInfo(`[OpenCodeServerClient] listModels: empty providers on attempt ${attempt + 1}, retrying in ${(attempt + 1) * 1000}ms`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
        }
      } catch (err: any) {
        if (attempt < 2) {
          logError(`[OpenCodeServerClient] listModels: attempt ${attempt + 1} failed: ${err.message}, retrying`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
        } else {
          throw err;
        }
      }
    }
    logError(`[OpenCodeServerClient] listModels: all 3 attempts exhausted, returning empty`);
    return { models: [] };
  }

  private buildModelsFromProviders(providers: any[]): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const prov of providers) {
      if (!prov.models) continue;
      for (const [modelId, modelData] of Object.entries(prov.models) as any) {
        const model = modelData as { id?: string; name?: string; variants?: Record<string, any> };
        const variants: ModelVariant[] = [];
        if (model.variants) {
          for (const [variantId, variantOptions] of Object.entries(model.variants)) {
            const opts = variantOptions as Record<string, unknown>;
            variants.push({
              id: variantId,
              description: String(opts?.description || opts?.label || variantId),
            });
          }
        }
        models.push({
          providerID: prov.id,
          modelID: modelId,
          name: model.name || model.id || modelId,
          variants,
        });
      }
    }
    return models;
  }

  public async runSkillsQuery(): Promise<string> {
    logInfo(`[OpenCodeServerClient] runSkillsQuery: reading local skills directory`);
    const workspaceRoot = this.getWorkspaceRootSync();
    const skillsPath = path.join(workspaceRoot, '.agents', 'skills');
    try {
      if (!fs.existsSync(skillsPath)) {
        return 'No custom agent skills found (.agents/skills directory does not exist).';
      }
      const files = await fs.promises.readdir(skillsPath, { withFileTypes: true });
      const skillDirs = files.filter(f => f.isDirectory()).map(f => f.name);
      if (skillDirs.length === 0) {
        return 'No custom agent skills found in `.agents/skills`.';
      }
      let md = `### Custom Agent Skills\n\n`;
      for (const skill of skillDirs) {
        const skillMdPath = path.join(skillsPath, skill, 'SKILL.md');
        let description = '';
        if (fs.existsSync(skillMdPath)) {
          const content = await fs.promises.readFile(skillMdPath, 'utf8');
          const descMatch = content.match(/description:\s*["']?([^"'\r\n]+)["']?/i);
          if (descMatch) {
            description = descMatch[1].trim();
          }
        }
        md += `- **\`${skill}\`**${description ? `: ${description}` : ''}\n`;
      }
      return md.trim();
    } catch (err: any) {
      logError(`[OpenCodeServerClient] runSkillsQuery failed: ${err.message}`);
      return `Failed to read custom skills: ${err.message}`;
    }
  }

  public async runInitQuery(): Promise<string> {
    logInfo(`[OpenCodeServerClient] runInitQuery: initializing workspace context`);
    const isWin = process.platform === 'win32';
    const scriptPath = isWin
      ? path.join('.specify', 'extensions', 'agent-context', 'scripts', 'powershell', 'update-agent-context.ps1')
      : path.join('.specify', 'extensions', 'agent-context', 'scripts', 'bash', 'update-agent-context.sh');
    const cmd = isWin ? 'powershell' : 'bash';
    const args = isWin
      ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      : [scriptPath];
    const result = await this.runCommand(cmd, args, 30000);
    if (result.exitCode === 0) {
      return result.stdout.trim() || 'Workspace initialized successfully.';
    }
    throw new Error(result.stderr || `Failed to initialize workspace (code ${result.exitCode})`);
  }

  private spawnProcess(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      detached?: boolean;
      stdio?: any;
    }
  ): ChildProcess {
    const env = {
      ...process.env,
      ...EnvService.getInstance().getEnvVars(),
      ...options.env,
      WORKSPACE_ROOT: options.cwd,
      IOTA_WORKSPACE_ROOT: options.cwd,
      PATH: this.buildInstallerPath()
    };
    logInfo(`[OpenCodeServerClient] spawnProcess - command="${command}" args=${JSON.stringify(args)}`);
    logInfo(`[OpenCodeServerClient] spawnProcess - cwd="${options.cwd}" PATH length: ${env.PATH?.length || 0}`);
    const keysPresent = Object.keys(options.env || {}).filter(k => k.includes('KEY') || k.includes('TOKEN'));
    logInfo(`[OpenCodeServerClient] spawnProcess - custom environment key variables present: ${JSON.stringify(keysPresent)}`);
    if (process.platform === 'win32') {
      logInfo(`[OpenCodeServerClient] Spawning win32 process`);
      return spawn(command, args, {
        cwd: options.cwd,
        env,
        shell: true,
        stdio: options.stdio,
        detached: options.detached,
      });
    } else {
      const shArgs = ['-c', `exec ${command} "$@"`, '--', ...args];
      logInfo(`[OpenCodeServerClient] Spawning POSIX process wrapper: /bin/sh ${shArgs.join(' ')}`);
      return spawn('/bin/sh', shArgs, {
        cwd: options.cwd,
        env,
        shell: false,
        detached: options.detached,
        stdio: options.stdio,
      });
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    const probe = process.platform === 'win32' ? ['where.exe', command] : ['which', command];
    const result = await this.runCommand(probe[0], [probe[1]], 3000);
    return result.exitCode === 0;
  }

  private async getWorkspaceRoot(): Promise<string> {
    return this.getWorkspaceRootSync();
  }

  private getWorkspaceRootSync(): string {
    return getWorkspaceRoot();
  }

  private async findNpmCommand(): Promise<{ command: string; prefixArgs: string[] } | null> {
    const commandName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (await this.commandExists(commandName)) return { command: commandName, prefixArgs: [] };

    const nodeDir = path.dirname(process.execPath);
    const candidates = [
      process.env.npm_execpath,
      process.env.NPM_CLI_JS,
      path.join(nodeDir, '..', 'lib/node_modules/npm/bin/npm-cli.js'),
      '/usr/local/share/nvm/current/lib/node_modules/npm/bin/npm-cli.js',
      '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
      '/usr/lib/node_modules/npm/bin/npm-cli.js',
      '/opt/nodejs/lib/node_modules/npm/bin/npm-cli.js',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { command: process.execPath, prefixArgs: [candidate] };
    }

    return null;
  }

  private buildInstallerPath(): string {
    const sep = process.platform === 'win32' ? ';' : ':';
    if (process.platform === 'win32') return process.env.PATH || '';
    const nodeDir = path.dirname(process.execPath);
    const nvmDir = process.env.NVM_DIR || '/usr/local/share/nvm';
    const extra = [
      nodeDir,
      `${nvmDir}/current/bin`,
      `${process.env.HOME || ''}/.opencode/bin`,
      `${process.env.HOME || ''}/.local/bin`,
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/opt/nodejs/bin',
    ];
    return [...extra, process.env.PATH || ''].filter(Boolean).join(sep);
  }

  private runInstaller(command: string, args: string[], onProgress: (message: string) => void): Promise<CommandResult> {
    return new Promise((resolve) => {
      logInfo(`[OpenCodeServerClient] runInstaller: spawning ${command} ${args.join(' ')}`);
      const child = this.spawnProcess(command, args, {
        cwd: this.getWorkspaceRootSync(),
      });
      child.stdin?.end();
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data) => {
        const text = String(data);
        stdout += text;
        onProgress(this.summarizeInstallChunk(text));
      });
      child.stderr?.on('data', (data) => {
        const text = String(data);
        stderr += text;
        onProgress(this.summarizeInstallChunk(text));
      });
      child.on('close', (exitCode) => {
        logInfo(`[OpenCodeServerClient] runInstaller: ${command} closed with code=${exitCode}`);
        resolve({ exitCode, stdout, stderr });
      });
      child.on('error', (error) => {
        logError(`[OpenCodeServerClient] runInstaller: ${command} error: ${error.message}`);
        resolve({ exitCode: null, stdout, stderr: error.message });
      });
    });
  }

  private runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      logInfo(`[OpenCodeServerClient] runCommand: spawning ${command} ${args.join(' ')} with timeout=${timeoutMs}ms`);
      const child = this.spawnProcess(command, args, {
        cwd: this.getWorkspaceRootSync(),
      });
      child.stdin?.end();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logError(`[OpenCodeServerClient] runCommand: ${command} ${args.join(' ')} timed out after ${timeoutMs}ms. Killing child.`);
        this.killProcess(child);
        resolve({ exitCode: null, stdout, stderr: stderr || 'Command timed out' });
      }, timeoutMs);
      child.stdout?.on('data', (data) => { stdout += String(data); });
      child.stderr?.on('data', (data) => { stderr += String(data); });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logInfo(`[OpenCodeServerClient] runCommand: ${command} ${args.join(' ')} finished with exitCode=${exitCode}`);
        resolve({ exitCode, stdout, stderr });
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logError(`[OpenCodeServerClient] runCommand: ${command} ${args.join(' ')} encountered error: ${error.message}`);
        resolve({ exitCode: null, stdout, stderr: error.message });
      });
    });
  }

  private killProcess(child: ChildProcess) {
    if (!child.pid) {
      logInfo(`[OpenCodeServerClient] killProcess: child has no PID, skipping`);
      return;
    }
    const pid = child.pid;
    logInfo(`[OpenCodeServerClient] killProcess: killing PID=${pid}, platform=${process.platform}`);
    if (process.platform !== 'win32') {
      try {
        // Send SIGTERM to the process group first
        process.kill(-pid, 'SIGTERM');
        logInfo(`[OpenCodeServerClient] killProcess: sent SIGTERM to process group -${pid}`);

        // Schedule a SIGKILL fallback after 3 seconds
        const killTimer = setTimeout(() => {
          try {
            // Check if the process group is still alive
            process.kill(-pid, 0);
            logInfo(`[OpenCodeServerClient] killProcess: process group -${pid} still alive after SIGTERM, sending SIGKILL`);
            process.kill(-pid, 'SIGKILL');
          } catch (e) {
            // Process group has already exited cleanly
          }
        }, 3000);
        killTimer.unref();
        return;
      } catch (err: any) {
        logInfo(`[OpenCodeServerClient] killProcess: process group kill failed (${err.message}), falling back to child.kill()`);
      }
    }
    child.kill();
  }

  private summarizeInstallChunk(chunk: string): string {
    return this.sanitizeLine(chunk) || 'OpenCode setup is still running...';
  }

  private sanitizeLine(value?: string): string {
    return (value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/\s+/g, ' ')
      .slice(0, 180) || '';
  }
}

export const opencodeServerClient = new OpenCodeServerClient();