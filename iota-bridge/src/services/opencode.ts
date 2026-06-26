import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { OpenCodeCapabilityState, OpenCodeRunStatusEvent } from '../types/opencode';
import { opencodeStore } from './opencodeStore';

const OPENCODE_PORT = 4096;
const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;

const checkPortReady = (port: number, host = '127.0.0.1', timeout = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (ready || Date.now() - start > timeout) resolve(ready);
        else setTimeout(check, 200);
      };

      socket.setTimeout(200);
      socket.on('connect', () => finish(true));
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
      socket.connect(port, host);
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
  stop: () => void;
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
  private installing = false;
  private lastKnownCapability: OpenCodeCapabilityState | null = null;

  public async checkCapability(): Promise<OpenCodeCapabilityState> {
    const timestamp = new Date().toISOString();
    const version = await this.runCommand('opencode', ['--version'], 5000);

    if (version.exitCode !== 0) {
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
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
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
    if (this.installing) {
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
      npmResult = await this.runInstaller(
        npmCommand.command,
        [...npmCommand.prefixArgs, 'install', '-g', 'opencode-ai'],
        onProgress
      );
    } else {
      onProgress('npm was not found. Trying the official OpenCode installer...');
    }

    let capability = await this.checkCapability();
    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      this.installing = false;
      return capability;
    }

    onProgress('Trying the official OpenCode install script...');
    const curlResult = await this.runInstaller('bash', ['-lc', 'curl -fsSL https://opencode.ai/install | bash'], onProgress);
    capability = await this.checkCapability();
    this.installing = false;

    if (capability.status === 'available' || capability.status === 'installed_uninitialized') {
      return capability;
    }

    const failureText = this.sanitizeLine(curlResult.stderr || curlResult.stdout || npmResult?.stderr || npmResult?.stdout);
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
    this.clearStaleServer();
    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: 'server_start',
      message: 'Checking OpenCode warm server...',
      retryable: false,
    });

    const server = await this.ensureServer();
    const attach = server.ready;
    options.onRunStatus?.({
      conversationId: options.conversationId,
      requestId: options.requestId,
      phase: attach ? 'attached_run' : 'direct_run',
      message: attach ? 'OpenCode server is ready. Starting attached run...' : 'OpenCode server is unavailable. Starting direct run...',
      retryable: false,
    });

    const args = this.buildRunArgs(options.prompt, options.sessionId, attach);
    const child = spawn('opencode', args, {
      cwd: this.getWorkspaceRootSync(),
      env: { ...process.env, ...options.env, PATH: this.buildInstallerPath() },
      shell: true,
      detached: process.platform !== 'win32',
    });

    this.activeRun = child;
    let buffer = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      options.onActivity?.();
      const text = String(data);
      options.onText?.(text);
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          options.onJson(JSON.parse(line));
        } catch {
          options.onJson({ type: 'text_delta', content: line });
        }
      }
    });

    child.stderr.on('data', (data) => {
      options.onActivity?.();
      const text = String(data);
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const clean = this.sanitizeLine(line);
        if (clean) options.onStderr?.(clean);
      }
    });

    const done = new Promise<{ exitCode: number | null; stderr: string; spawnError?: string }>((resolve) => {
      child.on('close', (exitCode) => {
        if (buffer.trim()) {
          try {
            options.onJson(JSON.parse(buffer));
          } catch {
            options.onJson({ type: 'text_delta', content: buffer });
          }
        }
        if (this.activeRun === child) this.activeRun = null;
        resolve({ exitCode, stderr });
      });
      child.on('error', (error) => {
        if (this.activeRun === child) this.activeRun = null;
        resolve({ exitCode: null, stderr: error.message, spawnError: error.message });
      });
    });

    return {
      stop: () => this.killProcess(child),
      done,
      mode: attach ? 'attached' : 'direct',
    };
  }

  public stopActiveRun() {
    if (this.activeRun) this.killProcess(this.activeRun);
    this.activeRun = null;
  }

  public async ensureServer(): Promise<ServerReadinessResult> {
    if (this.serveProcess) {
      const warm = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 500);
      if (warm) return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
      this.clearStaleServer();
    }

    const available = await this.commandExists('opencode');
    if (!available) return { ready: false, details: 'OpenCode binary is missing' };

    try {
      this.serveProcess = spawn('opencode', ['serve', '--port', String(OPENCODE_PORT)], {
        cwd: await this.getWorkspaceRoot(),
        env: { ...process.env, PATH: this.buildInstallerPath() },
        shell: true,
        stdio: 'ignore',
      });

      this.serveProcess.on('close', () => {
        this.serveProcess = null;
      });
      this.serveProcess.on('error', () => {
        this.serveProcess = null;
      });

      const ready = await checkPortReady(OPENCODE_PORT, '127.0.0.1', 3000);
      if (!ready) {
        this.clearStaleServer();
        return { ready: false, details: 'OpenCode server port did not become ready' };
      }
      return { ready: true, url: OPENCODE_URL, details: 'OpenCode server is listening' };
    } catch (error: any) {
      this.clearStaleServer();
      return { ready: false, details: error?.message || 'OpenCode server could not start' };
    }
  }

  public clearStaleServer() {
    if (!this.serveProcess) return;
    try {
      this.serveProcess.kill();
    } catch {
      // Process is already gone.
    }
    this.serveProcess = null;
  }

  public async listSessions(): Promise<unknown[]> {
    const result = await this.runCommand('opencode', ['session', 'list', '--format', 'json'], 5000);
    try {
      const parsed = JSON.parse(result.stdout);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  public writeInput(input: string): boolean {
    if (this.activeRun && this.activeRun.stdin && this.activeRun.stdin.writable) {
      this.activeRun.stdin.write(input);
      return true;
    }
    return false;
  }

  public async syncFromCliSessions(conversationId?: string): Promise<void> {
    const sessions = await this.listSessions();
    if (sessions && sessions.length > 0) {
      const session = sessions[0] as { id?: string; sessionId?: string; session_id?: string; messages?: any[]; status?: string };
      const sessionId = session.id || session.sessionId || session.session_id;
      if (sessionId) {
        const conversation = opencodeStore.getOrCreateConversation(conversationId, sessionId);
        if (session.status) conversation.status = session.status as any;
        if (Array.isArray(session.messages) && session.messages.length > 0) {
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
    }
  }

  private buildRunArgs(prompt: string, sessionId?: string, attach = false): string[] {
    const args = ['run'];
    if (attach) args.push('--attach', OPENCODE_URL);
    if (sessionId) args.push('--continue', '--session', sessionId);
    args.push(prompt, '--format', 'json');
    return args;
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
    return process.env.CODESPACE_VSCODE_FOLDER || path.resolve(process.cwd(), '..');
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
      const child = spawn(command, args, {
        cwd: this.getWorkspaceRootSync(),
        env: { ...process.env, PATH: this.buildInstallerPath() },
        shell: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        const text = String(data);
        stdout += text;
        onProgress(this.summarizeInstallChunk(text));
      });
      child.stderr.on('data', (data) => {
        const text = String(data);
        stderr += text;
        onProgress(this.summarizeInstallChunk(text));
      });
      child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
      child.on('error', (error) => resolve({ exitCode: null, stdout, stderr: error.message }));
    });
  }

  private runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      const child = spawn(command, args, {
        cwd: this.getWorkspaceRootSync(),
        env: { ...process.env, PATH: this.buildInstallerPath() },
        shell: true,
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.killProcess(child);
        resolve({ exitCode: null, stdout, stderr: stderr || 'Command timed out' });
      }, timeoutMs);
      child.stdout.on('data', (data) => { stdout += String(data); });
      child.stderr.on('data', (data) => { stderr += String(data); });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: null, stdout, stderr: error.message });
      });
    });
  }

  private killProcess(child: ChildProcess) {
    if (!child.pid) return;
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return;
      } catch {
        // Fall through to child.kill().
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