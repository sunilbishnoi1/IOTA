import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import { OpenCodeCapabilityState, OpenCodeRunStatusEvent } from '../types/opencode';
import { opencodeStore } from './opencodeStore';
import { EnvService } from './envService';
import { logInfo, logError, getWorkspaceRoot } from './logger';


const OPENCODE_PORT = 4096;
const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;

const checkPortReady = (port: number, host = '127.0.0.1', timeout = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    const start = Date.now();
    logInfo(`[OpenCodeRunner] checkPortReady: probing ${host}:${port} with timeout=${timeout}ms`);
    const check = () => {
      let settled = false;
      const req = http.request({
        host,
        port,
        path: '/',
        method: 'GET',
        timeout: 500,
      }, (res) => {
        if (settled) return;
        settled = true;
        const statusCode = res.statusCode ?? 0;
        const isReady = statusCode >= 200 && statusCode < 300;
        logInfo(`[OpenCodeRunner] checkPortReady: received HTTP response status=${statusCode} from ${host}:${port} — server ${isReady ? 'ready' : 'not ready (non-2xx)'}`);
        resolve(isReady);
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        const elapsed = Date.now() - start;
        logInfo(`[OpenCodeRunner] checkPortReady: probe failed on ${host}:${port} (error: ${err.message}) elapsed=${elapsed}ms`);
        if (elapsed > timeout) resolve(false);
        else setTimeout(check, 200);
      });

      req.on('timeout', () => {
        req.destroy();
        if (settled) return;
        settled = true;
        const elapsed = Date.now() - start;
        logInfo(`[OpenCodeRunner] checkPortReady: probe timed out on ${host}:${port} elapsed=${elapsed}ms`);
        if (elapsed > timeout) resolve(false);
        else setTimeout(check, 200);
      });

      req.end();
    };
    check();
  });
};

export interface OpenCodeRunOptions {
  conversationId: string;
  requestId: string;
  prompt: string;
  sessionId?: string;
  env?: Record<string, string>;
  onJson: (payload: unknown) => void;
  onText?: (chunk: string) => void;
  onStderr?: (line: string) => void;
  onActivity?: () => void;
  onRunStatus?: (status: OpenCodeRunStatusEvent) => void;
}

export interface OpenCodeRunHandle {
  stop: (reason?: 'user' | 'watchdog') => void;
  done: Promise<{ exitCode: number | null; stderr: string; spawnError?: string }>;
  mode: 'attached' | 'direct';
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

class OpenCodeRunner {
  private serveProcess: ChildProcess | null = null;
  private activeRun: ChildProcess | null = null;
  private activeRequestId: string | null = null;
  private userStoppedRequests = new Set<string>();
  private serverStartPromise: Promise<ServerReadinessResult> | null = null;
  private installing = false;
  private lastKnownCapability: OpenCodeCapabilityState | null = null;

  public async checkCapability(): Promise<OpenCodeCapabilityState> {
    const timestamp = new Date().toISOString();
    logInfo(`[OpenCodeRunner] checkCapability: probing opencode --version`);
    const version = await this.runCommand('opencode', ['--version'], 5000);
    logInfo(`[OpenCodeRunner] checkCapability: --version exitCode=${version.exitCode}, stdout="${(version.stdout || '').trim().slice(0, 80)}", stderr="${(version.stderr || '').trim().slice(0, 120)}"`);

    if (version.exitCode !== 0) {
      logInfo(`[OpenCodeRunner] checkCapability: OpenCode is missing or returned non-zero exit code`);
      const missing: OpenCodeCapabilityState = {
        status: 'missing',
        details: 'OpenCode is not installed in this Codespace',
        canSubmit: false,
        canInstall: true,
        lastCheckedAt: timestamp,
        errorSummary: this.sanitizeLine(version.stderr || version.stdout),
      };
      this.lastKnownCapability = missing;
      return missing;
    }

    const workspaceRoot = this.getWorkspaceRootSync();
    logInfo(`[OpenCodeRunner] checkCapability: checking workspace root: ${workspaceRoot}`);
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      logError(`[OpenCodeRunner] checkCapability: workspace folder is not ready or not found: ${workspaceRoot}`);
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

    logInfo(`[OpenCodeRunner] checkCapability: OpenCode is ready and available`);
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
    logInfo(`[OpenCodeRunner] install: starting installation`);
    if (this.installing) {
      logInfo(`[OpenCodeRunner] install: already installing, skipping`);
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
      logInfo(`[OpenCodeRunner] install: running npm installer using command: ${npmCommand.command}`);
      npmResult = await this.runInstaller(
        npmCommand.command,
        [...npmCommand.prefixArgs, 'install', '-g', 'opencode-ai'],
        onProgress
      );
    } else {
      logInfo(`[OpenCodeRunner] install: npm not found, will fallback to curl`);
      onProgress('npm was not found. Trying the official OpenCode installer...');
    }

    let capability = await this.checkCapability();
    logInfo(`[OpenCodeRunner] install: capability after npm install attempt is ${capability.status}`);
    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      this.installing = false;
      logInfo(`[OpenCodeRunner] install: installation succeeded after npm install`);
      return capability;
    }

    logInfo(`[OpenCodeRunner] install: npm install did not make OpenCode available. Trying curl script installer...`);
    onProgress('Trying the official OpenCode install script...');
    const curlResult = await this.runInstaller('bash', ['-lc', 'curl -fsSL https://opencode.ai/install | bash'], onProgress);
    capability = await this.checkCapability();
    this.installing = false;
    logInfo(`[OpenCodeRunner] install: capability after curl install attempt is ${capability.status}`);

    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      logInfo(`[OpenCodeRunner] install: installation succeeded after curl script`);
      return capability;
    }

    const failureText = this.sanitizeLine(curlResult.stderr || curlResult.stdout || npmResult?.stderr || npmResult?.stdout);
    logError(`[OpenCodeRunner] install: installation failed. Failure text: "${failureText}"`);
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
  public async run(options: OpenCodeRunOptions): Promise<OpenCodeRunHandle> {
    logInfo(`[OpenCodeRunner] Starting run request ${options.requestId} for conversation ${options.conversationId}, prompt="${options.prompt.slice(0, 80)}"`);
    this.activeRequestId = options.requestId;
    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: 'server_start',
      message: 'working...',
      retryable: false,
    });

    const server = await this.ensureServer();
    logInfo(`[OpenCodeRunner] ensureServer result: ready=${server.ready}, details="${server.details}"`);
    const initialAttach = server.ready;
    
    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: initialAttach ? 'attached_run' : 'direct_run',
      message: 'working...',
      retryable: false,
    });

    let currentChild: ChildProcess | null = null;
    let mode: 'attached' | 'direct' = initialAttach ? 'attached' : 'direct';

    const donePromise = new Promise<{ exitCode: number | null; stderr: string; spawnError?: string }>(async (resolve) => {
      let attach = initialAttach;
      let attemptCount = 0;
      
      while (true) {
        attemptCount++;
        const args = this.buildRunArgs(options.prompt, options.sessionId, attach, options.conversationId);
        logInfo(`[OpenCodeRunner] Spawning process (attempt ${attemptCount}): opencode ${args.join(' ')}`);
        
        const child = this.spawnProcess('opencode', args, {
          cwd: this.getWorkspaceRootSync(),
          env: options.env,
          detached: process.platform !== 'win32',
        });

        // Close stdin immediately to prevent Go CLI from blocking on piped input
        child.stdin?.end();

        logInfo(`[OpenCodeRunner] Spawning attempt ${attemptCount} result - PID: ${child.pid}, connected: ${child.connected}`);

        currentChild = child;
        this.activeRun = child;

        let buffer = '';
        let stderr = '';
        let jsonCount = 0;
        let stdoutBytes = 0;
        let stderrBytes = 0;

        child.stdout?.on('data', (data) => {
          options.onActivity?.();
          const text = String(data);
          stdoutBytes += data.length;
          logInfo(`[OpenCode stdout] (${data.length}B, total=${stdoutBytes}B) ${text.trim().slice(0, 500)}`);
          options.onText?.(text);
          buffer += text;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              options.onJson(parsed);
              jsonCount++;
            } catch (err: any) {
              logInfo(`[OpenCodeRunner] non-JSON line on stdout fallback to text_delta: "${line}" | Error: ${err.message}`);
              options.onJson({ type: 'text_delta', content: line });
            }
          }
        });

        child.stderr?.on('data', (data) => {
          const text = String(data);
          stderrBytes += data.length;
          logError(`[OpenCode stderr] (${data.length}B, total=${stderrBytes}B) ${text.trim().slice(0, 500)}`);
          stderr += text;
          for (const line of text.split(/\r?\n/)) {
            const clean = this.sanitizeLine(line);
            if (clean) options.onStderr?.(clean);
          }
        });

        const childDone = new Promise<{ exitCode: number | null; stderr: string; spawnError?: string }>((resolveChild) => {
          child.on('exit', (exitCode, signal) => {
            logInfo(`[OpenCodeRunner] Process (attempt ${attemptCount}) exit event: exitCode=${exitCode}, signal=${signal}`);
          });

          child.on('close', (exitCode) => {
            logInfo(`[OpenCodeRunner] Process (attempt ${attemptCount}) close event: exitCode=${exitCode}`);
            if (buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer);
                options.onJson(parsed);
                jsonCount++;
              } catch {
                options.onJson({ type: 'text_delta', content: buffer });
              }
            }
            if (this.activeRun === child) this.activeRun = null;
            resolveChild({ exitCode, stderr });
          });
          
          child.on('error', (error) => {
            logError(`[OpenCodeRunner] Process (attempt ${attemptCount}) error: ${error.message}`);
            if (this.activeRun === child) this.activeRun = null;
            resolveChild({ exitCode: null, stderr: error.message, spawnError: error.message });
          });
        });

        const result = await childDone;
        logInfo(`[OpenCodeRunner] Attempt ${attemptCount} finished: exitCode=${result.exitCode}, jsonCount=${jsonCount}, stdoutBytes=${stdoutBytes}, stderrBytes=${stderrBytes}, attach=${attach}, spawnError=${result.spawnError || 'none'}`);

        if (this.userStoppedRequests.has(options.requestId)) {
          logInfo(`[OpenCodeRunner] Run was explicitly stopped by user. Exiting loop.`);
          this.userStoppedRequests.delete(options.requestId);
          if (this.activeRequestId === options.requestId) this.activeRequestId = null;
          resolve(result);
          break;
        }

        // Check if fallback is needed
        if (attach && jsonCount === 0) {
          logError(`[OpenCodeRunner] Attached run failed/returned with exitCode=${result.exitCode}, spawnError=${result.spawnError || 'none'} and 0 JSON outputs. Triggering fallback to direct run.`);
          
          options.onRunStatus?.({
            conversationId: options.conversationId,
            requestId: options.requestId,
            phase: 'direct_run',
            message: 'working...',
            retryable: false,
          });

          await this.clearStaleServer();
          attach = false;
          mode = 'direct';
          continue; // rerun loop in direct mode
        }

        // Otherwise we are done
        logInfo(`[OpenCodeRunner] Run loop completed after ${attemptCount} attempt(s). Final exitCode=${result.exitCode}, jsonCount=${jsonCount}`);
        if (this.activeRequestId === options.requestId) this.activeRequestId = null;
        resolve(result);
        break;
      }
    });

    return {
      stop: (reason: 'user' | 'watchdog' = 'user') => {
        logInfo(`[OpenCodeRunner] Stop requested for requestId=${options.requestId}, reason=${reason}`);
        if (reason === 'user') {
          this.userStoppedRequests.add(options.requestId);
        }
        if (currentChild) {
          this.killProcess(currentChild);
        }
      },
      done: donePromise,
      get mode() {
        return mode;
      },
    };
  }

  public stopActiveRun(reason: 'user' | 'watchdog' = 'user') {
    if (reason === 'user' && this.activeRequestId) {
      this.userStoppedRequests.add(this.activeRequestId);
    }
    if (this.activeRun) {
      logInfo(`[OpenCodeRunner] Stopping active run (reason=${reason})`);
      this.killProcess(this.activeRun);
    }
    this.activeRun = null;
  }

  public async ensureServer(): Promise<ServerReadinessResult> {
    if (this.serverStartPromise) {
      logInfo(`[OpenCodeRunner] ensureServer: server start is already in progress, waiting for it`);
      return this.serverStartPromise;
    }

    this.serverStartPromise = (async () => {
      logInfo(`[OpenCodeRunner] ensureServer: serveProcess exists=${!!this.serveProcess}`);
      if (this.serveProcess) {
        const warm = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 500);
        logInfo(`[OpenCodeRunner] ensureServer: existing server warm=${warm}`);
        if (warm) return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
        logInfo(`[OpenCodeRunner] ensureServer: existing server is stale, clearing`);
        await this.clearStaleServer();
      } else {
        // If we don't have an active serveProcess, but the port is listening, it is an orphaned daemon. Clear it!
        const activeOrphaned = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 500);
        if (activeOrphaned) {
          logInfo(`[OpenCodeRunner] ensureServer: detected orphaned opencode daemon on port ${OPENCODE_PORT}, killing it`);
          await this.killProcessOnPort(OPENCODE_PORT);
        }
      }

      const available = await this.commandExists('opencode');
      logInfo(`[OpenCodeRunner] ensureServer: opencode binary available=${available}`);
      if (!available) return { ready: false, details: 'OpenCode binary is missing' };

      try {
        logInfo(`[OpenCodeRunner] ensureServer: spawning opencode serve --port ${OPENCODE_PORT}`);
        const child = this.spawnProcess('opencode', ['serve', '--port', String(OPENCODE_PORT)], {
          cwd: await this.getWorkspaceRoot(),
          stdio: 'ignore',
          detached: true,
        });
        this.serveProcess = child;
        child.unref();
        logInfo(`[OpenCodeRunner] ensureServer: serve process PID=${child.pid}`);

        child.on('close', (code) => {
          logInfo(`[OpenCodeRunner] ensureServer: serve process PID=${child.pid} closed with code=${code}`);
          if (this.serveProcess === child) {
            this.serveProcess = null;
          }
        });
        child.on('error', (err) => {
          logError(`[OpenCodeRunner] ensureServer: serve process PID=${child.pid} error: ${err.message}`);
          if (this.serveProcess === child) {
            this.serveProcess = null;
          }
        });

        const ready = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 3000);
        logInfo(`[OpenCodeRunner] ensureServer: port probe result ready=${ready}`);
        if (!ready) {
          await this.clearStaleServer();
          return { ready: false, details: 'OpenCode server port did not become ready' };
        }
        
        // Warmup delay to allow daemon internal task pipelines to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
      } catch (error: any) {
        logError(`[OpenCodeRunner] ensureServer: exception: ${error?.message}`);
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

  public async clearStaleServer(): Promise<void> {
    if (this.serveProcess) {
      logInfo(`[OpenCodeRunner] clearStaleServer: killing active serveProcess PID=${this.serveProcess.pid}`);
      try {
        this.killProcess(this.serveProcess);
      } catch (err: any) {
        logError(`[OpenCodeRunner] clearStaleServer: failed to kill: ${err.message}`);
      }
      this.serveProcess = null;
    }
    await this.killProcessOnPort(OPENCODE_PORT);
  }

  private async killProcessOnPort(port: number): Promise<void> {
    logInfo(`[OpenCodeRunner] Attempting to kill any process occupying port ${port}`);
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
            logInfo(`[OpenCodeRunner] Killing process with PID ${pid} on port ${port}`);
            await execAsync(`taskkill /F /PID ${pid}`).catch(() => undefined);
          }
        }
      } else {
        await execAsync(`lsof -t -sTCP:LISTEN -i :${port} | xargs kill -9`);
        logInfo(`[OpenCodeRunner] Killed process on port ${port} via lsof`);
      }
    } catch (err: any) {
      logError(`[OpenCodeRunner] Failed to kill process on port ${port}: ${err.message || err}`);
    }
  }

  public async listSessions(): Promise<unknown[]> {
    logInfo(`[OpenCodeRunner] listSessions: listing session files`);
    const result = await this.runCommand('opencode', ['session', 'list', '--format', 'json'], 5000);
    try {
      const parsed = JSON.parse(result.stdout);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      logInfo(`[OpenCodeRunner] listSessions: successfully retrieved ${list.length} session(s)`);
      return list;
    } catch (err: any) {
      logError(`[OpenCodeRunner] listSessions: failed to parse JSON: ${err.message}. Raw stdout: "${result.stdout}"`);
      return [];
    }
  }

  public async runModelsQuery(): Promise<string> {
    logInfo(`[OpenCodeRunner] runModelsQuery: executing opencode models`);
    const result = await this.runCommand('opencode', ['models'], 15000);
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    throw new Error(result.stderr || `Failed to query models (code ${result.exitCode})`);
  }

  public async runStatsQuery(): Promise<string> {
    logInfo(`[OpenCodeRunner] runStatsQuery: executing opencode stats`);
    const result = await this.runCommand('opencode', ['stats'], 15000);
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    throw new Error(result.stderr || `Failed to query stats (code ${result.exitCode})`);
  }

  public async runSessionsQuery(): Promise<string> {
    logInfo(`[OpenCodeRunner] runSessionsQuery: executing opencode session list`);
    
    let cliSessionsMd = '';
    try {
      const result = await this.runCommand('opencode', ['session', 'list', '--format', 'json'], 15000);
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (list.length > 0) {
          cliSessionsMd = `### Active CLI Sessions (OpenCode)\n\n| Session ID | Title | Created | Updated |\n| :--- | :--- | :--- | :--- |\n`;
          for (const ses of list) {
            const createdDate = ses.created ? new Date(ses.created).toLocaleString() : 'N/A';
            const updatedDate = ses.updated ? new Date(ses.updated).toLocaleString() : 'N/A';
            cliSessionsMd += `| \`${ses.id}\` | ${ses.title || 'Untitled'} | ${createdDate} | ${updatedDate} |\n`;
          }
        } else {
          cliSessionsMd = '### Active CLI Sessions (OpenCode)\n\nNo active CLI sessions found.';
        }
      } else {
        cliSessionsMd = `### Active CLI Sessions (OpenCode)\n\nFailed to load CLI sessions: ${result.stderr}`;
      }
    } catch (err: any) {
      logError(`[OpenCodeRunner] runSessionsQuery: failed to load CLI sessions: ${err.message}`);
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
    logInfo(`[OpenCodeRunner] runSessionDelete: deleting session ${sessionId}`);
    const result = await this.runCommand('opencode', ['session', 'delete', sessionId], 15000);
    if (result.exitCode === 0) {
      return result.stdout.trim() || `Session \`${sessionId}\` deleted successfully.`;
    }
    throw new Error(result.stderr || `Failed to delete session (code ${result.exitCode})`);
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
    logInfo(`[OpenCodeRunner] runExportQuery: exporting session ${targetSessionId}`);
    const result = await this.runCommand('opencode', ['export', targetSessionId], 15000);
    if (result.exitCode === 0) {
      return `\`\`\`json\n${result.stdout.trim()}\n\`\`\``;
    }
    throw new Error(result.stderr || `Failed to export session (code ${result.exitCode})`);
  }

  public async runCompactQuery(conversationId?: string): Promise<string> {
    logInfo(`[OpenCodeRunner] runCompactQuery: executing opencode run with summarize instructions`);
    const conversation = conversationId ? opencodeStore.getConversation(conversationId) : undefined;
    const model = conversation?.activeModel || 'opencode/deepseek-v4-flash-free';
    const result = await this.runCommand(
      'opencode',
      ['run', '--model', model, '--dangerously-skip-permissions', 'Please summarize our conversation and the changes made in the workspace so far.', '--format', 'json'],
      30000
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to generate conversation summary (code ${result.exitCode})`);
    }
    try {
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      let summaryText = '';
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'text' && parsed.part?.text) {
            summaryText += parsed.part.text;
          } else if (parsed.type === 'text_delta' && parsed.content) {
            summaryText += parsed.content;
          }
        } catch {
          if (!line.trim().startsWith('{')) {
            summaryText += line + '\n';
          }
        }
      }
      const trimmed = summaryText.trim();
      return trimmed || result.stdout.trim() || 'Conversation summarized successfully.';
    } catch (err) {
      return result.stdout.trim() || 'Conversation summarized successfully.';
    }
  }

  public async runSkillsQuery(): Promise<string> {
    logInfo(`[OpenCodeRunner] runSkillsQuery: reading local skills directory`);
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
      logError(`[OpenCodeRunner] runSkillsQuery failed: ${err.message}`);
      return `Failed to read custom skills: ${err.message}`;
    }
  }

  public async runInitQuery(): Promise<string> {
    logInfo(`[OpenCodeRunner] runInitQuery: initializing workspace context`);
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


  public writeInput(input: string): boolean {
    if (this.activeRun && this.activeRun.stdin && this.activeRun.stdin.writable) {
      this.activeRun.stdin.write(input);
      return true;
    }
    return false;
  }

  public async syncFromCliSessions(conversationId?: string): Promise<void> {
    logInfo(`[OpenCodeRunner] syncFromCliSessions: syncing sessions for conversationId=${conversationId}`);
    const sessions = await this.listSessions();
    if (sessions && sessions.length > 0) {
      const session = sessions[0] as { id?: string; sessionId?: string; session_id?: string; messages?: any[]; status?: string };
      const sessionId = session.id || session.sessionId || session.session_id;
      logInfo(`[OpenCodeRunner] syncFromCliSessions: target sessionId=${sessionId}`);
      if (sessionId) {
        const conversation = opencodeStore.getOrCreateConversation(conversationId, sessionId);
        if (session.status) conversation.status = session.status as any;
        if (Array.isArray(session.messages) && session.messages.length > 0) {
          logInfo(`[OpenCodeRunner] syncFromCliSessions: syncing ${session.messages.length} message(s) for conversation ${conversation.id}`);
          conversation.messages = session.messages.map((msg: any) => ({
            id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conversationId: conversation.id,
            role: msg.role || 'assistant',
            content: msg.content || '',
            createdAt: msg.createdAt || new Date().toISOString(),
            status: msg.status || 'complete',
          }));
        }
      }
    } else {
      logInfo(`[OpenCodeRunner] syncFromCliSessions: no CLI sessions to sync`);
    }
  }

  private buildRunArgs(prompt: string, sessionId?: string, attach = false, conversationId?: string): string[] {
    const conversation = conversationId ? opencodeStore.getConversation(conversationId) : undefined;
    const model = conversation?.activeModel || 'opencode/deepseek-v4-flash-free';
    const args = ['run', '--model', model, '--dangerously-skip-permissions'];
    if (attach) args.push('--attach', OPENCODE_URL);
    if (sessionId) args.push('--continue', '--session', sessionId);
    args.push(prompt, '--format', 'json');
    logInfo(`[OpenCodeRunner] buildRunArgs: attach=${attach}, sessionId=${sessionId || 'none'}, argCount=${args.length}, fullArgs=[${args.join(', ')}]`);
    return args;
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
    logInfo(`[OpenCodeRunner] spawnProcess - command="${command}" args=${JSON.stringify(args)}`);
    logInfo(`[OpenCodeRunner] spawnProcess - cwd="${options.cwd}" PATH length: ${env.PATH?.length || 0}`);
    const keysPresent = Object.keys(options.env || {}).filter(k => k.includes('KEY') || k.includes('TOKEN'));
    logInfo(`[OpenCodeRunner] spawnProcess - custom environment key variables present: ${JSON.stringify(keysPresent)}`);
    if (process.platform === 'win32') {
      logInfo(`[OpenCodeRunner] Spawning win32 process`);
      return spawn(command, args, {
        cwd: options.cwd,
        env,
        shell: true,
        stdio: options.stdio,
        detached: options.detached,
      });
    } else {
      const shArgs = ['-c', `exec ${command} "$@"`, '--', ...args];
      logInfo(`[OpenCodeRunner] Spawning POSIX process wrapper: /bin/sh ${shArgs.join(' ')}`);
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
      logInfo(`[OpenCodeRunner] runInstaller: spawning ${command} ${args.join(' ')}`);
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
        logInfo(`[OpenCodeRunner] runInstaller: ${command} closed with code=${exitCode}`);
        resolve({ exitCode, stdout, stderr });
      });
      child.on('error', (error) => {
        logError(`[OpenCodeRunner] runInstaller: ${command} error: ${error.message}`);
        resolve({ exitCode: null, stdout, stderr: error.message });
      });
    });
  }

  private runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      logInfo(`[OpenCodeRunner] runCommand: spawning ${command} ${args.join(' ')} with timeout=${timeoutMs}ms`);
      const child = this.spawnProcess(command, args, {
        cwd: this.getWorkspaceRootSync(),
      });
      child.stdin?.end();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logError(`[OpenCodeRunner] runCommand: ${command} ${args.join(' ')} timed out after ${timeoutMs}ms. Killing child.`);
        this.killProcess(child);
        resolve({ exitCode: null, stdout, stderr: stderr || 'Command timed out' });
      }, timeoutMs);
      child.stdout?.on('data', (data) => { stdout += String(data); });
      child.stderr?.on('data', (data) => { stderr += String(data); });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logInfo(`[OpenCodeRunner] runCommand: ${command} ${args.join(' ')} finished with exitCode=${exitCode}`);
        resolve({ exitCode, stdout, stderr });
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logError(`[OpenCodeRunner] runCommand: ${command} ${args.join(' ')} encountered error: ${error.message}`);
        resolve({ exitCode: null, stdout, stderr: error.message });
      });
    });
  }

  private killProcess(child: ChildProcess) {
    if (!child.pid) {
      logInfo(`[OpenCodeRunner] killProcess: child has no PID, skipping`);
      return;
    }
    const pid = child.pid;
    logInfo(`[OpenCodeRunner] killProcess: killing PID=${pid}, platform=${process.platform}`);
    if (process.platform !== 'win32') {
      try {
        // Send SIGTERM to the process group first
        process.kill(-pid, 'SIGTERM');
        logInfo(`[OpenCodeRunner] killProcess: sent SIGTERM to process group -${pid}`);

        // Schedule a SIGKILL fallback after 3 seconds
        const killTimer = setTimeout(() => {
          try {
            // Check if the process group is still alive
            process.kill(-pid, 0);
            logInfo(`[OpenCodeRunner] killProcess: process group -${pid} still alive after SIGTERM, sending SIGKILL`);
            process.kill(-pid, 'SIGKILL');
          } catch (e) {
            // Process group has already exited cleanly
          }
        }, 3000);
        killTimer.unref();
        return;
      } catch (err: any) {
        logInfo(`[OpenCodeRunner] killProcess: process group kill failed (${err.message}), falling back to child.kill()`);
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

export const opencodeRunner = new OpenCodeRunner();