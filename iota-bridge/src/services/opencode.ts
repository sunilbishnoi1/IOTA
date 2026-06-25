import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { OpenCodeCapabilityState } from '../types/opencode';
import { opencodeStore } from './opencodeStore';

export interface OpenCodeRunOptions {
  prompt: string;
  sessionId?: string;
  env?: Record<string, string>;
  onJson: (payload: unknown) => void;
  onText?: (chunk: string) => void;
}

export interface OpenCodeRunHandle {
  stop: () => void;
  done: Promise<{ exitCode: number | null; stderr: string }>;
}

class OpenCodeRunner {
  private serveProcess: ChildProcess | null = null;
  private activeRun: ChildProcess | null = null;
  private installing = false;
  private lastKnownCapability: OpenCodeCapabilityState | null = null;

  public async checkCapability(): Promise<OpenCodeCapabilityState> {
    const available = await this.commandExists('opencode');
    const capability: OpenCodeCapabilityState = {
      status: available ? 'available' : 'missing',
      details: available ? 'OpenCode is ready' : 'OpenCode is not installed in this Codespace',
      canSubmit: available,
      canInstall: !available,
      lastCheckedAt: new Date().toISOString(),
    };
    this.lastKnownCapability = capability;
    return capability;
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
    onProgress('Installing OpenCode...');
    const npmCommand = await this.findNpmCommand();
    if (!npmCommand) {
      this.installing = false;
      const errorCapability: OpenCodeCapabilityState = {
        status: 'install_failed',
        details: 'OpenCode installation could not start',
        canSubmit: false,
        canInstall: true,
        lastCheckedAt: new Date().toISOString(),
        errorSummary: 'npm was not found in this Codespace. Install Node.js/npm in the devcontainer and retry.',
      };
      this.lastKnownCapability = errorCapability;
      return errorCapability;
    }

    const child = spawn(npmCommand.command, [...npmCommand.prefixArgs, 'install', '-g', 'opencode-ai'], {
      cwd: await this.getWorkspaceRoot(),
      env: { ...process.env, PATH: this.buildInstallerPath() },
      shell: true,
    });

    return await new Promise((resolve) => {
      let stderr = '';
      child.stdout.on('data', (data) => onProgress(this.summarizeInstallChunk(String(data))));
      child.stderr.on('data', (data) => {
        stderr += String(data);
        onProgress(this.summarizeInstallChunk(String(data)));
      });
      child.on('close', async (exitCode) => {
        this.installing = false;
        const capability = await this.checkCapability();
        if (exitCode === 0 && capability.status === 'available') {
          this.lastKnownCapability = capability;
          resolve(capability);
          return;
        }
        const failedCapability: OpenCodeCapabilityState = {
          status: 'install_failed',
          details: 'OpenCode installation failed',
          canSubmit: false,
          canInstall: true,
          lastCheckedAt: new Date().toISOString(),
          errorSummary: stderr.split(/\r?\n/).find(Boolean)?.slice(0, 180) || `Installer exited with code ${exitCode}`,
        };
        this.lastKnownCapability = failedCapability;
        resolve(failedCapability);
      });
      child.on('error', (error) => {
        this.installing = false;
        const errorCapability: OpenCodeCapabilityState = {
          status: 'install_failed',
          details: 'OpenCode installation could not start',
          canSubmit: false,
          canInstall: true,
          lastCheckedAt: new Date().toISOString(),
          errorSummary: error.message,
        };
        this.lastKnownCapability = errorCapability;
        resolve(errorCapability);
      });
    });
  }

  public run(options: OpenCodeRunOptions): OpenCodeRunHandle {
    const args = this.buildRunArgs(options.prompt, options.sessionId, Boolean(this.serveProcess));
    const child = spawn('opencode', args, {
      cwd: this.getWorkspaceRootSync(),
      env: { ...process.env, ...options.env, PATH: this.buildInstallerPath() },
      shell: true,
    });

    this.activeRun = child;
    let buffer = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
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
      stderr += String(data);
    });

    const done = new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
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
        resolve({ exitCode: null, stderr: error.message });
      });
    });

    return {
      stop: () => child.kill(),
      done,
    };
  }

  public stopActiveRun() {
    this.activeRun?.kill();
    this.activeRun = null;
  }

  public async ensureServer(): Promise<boolean> {
    if (this.serveProcess) return true;
    const available = await this.commandExists('opencode');
    if (!available) return false;

    try {
      this.serveProcess = spawn('opencode', ['serve', '--port', '4096'], {
        cwd: await this.getWorkspaceRoot(),
        env: { ...process.env, PATH: this.buildInstallerPath() },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.serveProcess.on('close', () => {
        this.serveProcess = null;
      });
      return true;
    } catch {
      this.serveProcess = null;
      return false;
    }
  }

  public async listSessions(): Promise<unknown[]> {
    return await new Promise((resolve) => {
      const child = spawn('opencode', ['session', 'list', '--format', 'json'], { cwd: this.getWorkspaceRootSync(), env: { ...process.env, PATH: this.buildInstallerPath() }, shell: true });
      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += String(data);
      });
      child.on('close', () => {
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve([]);
        }
      });
      child.on('error', () => resolve([]));
    });
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
        if (session.status) {
          conversation.status = session.status as any;
        }
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
    if (attach) args.push('--attach', 'http://localhost:4096');
    if (sessionId) args.push('--continue', '--session', sessionId);
    args.push(prompt, '--format', 'json');
    return args;
  }

  private async commandExists(command: string): Promise<boolean> {
    const probe = process.platform === 'win32' ? ['where.exe', command] : ['which', command];
    return await new Promise((resolve) => {
      const child = spawn(probe[0], [probe[1]], { env: { ...process.env, PATH: this.buildInstallerPath() }, shell: true });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
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

    // Resolve npm-cli.js directly — covers nvm-managed installs in devcontainers
    // where npm may not be on PATH but the cli script exists on disk.
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
    if (process.platform === 'win32') {
      return process.env.PATH || '';
    }
    const nodeDir = path.dirname(process.execPath);
    const nvmDir = process.env.NVM_DIR || '/usr/local/share/nvm';
    const extra = [
      nodeDir,                        // directory of the running node binary (nvm-managed)
      `${nvmDir}/current/bin`,        // devcontainer nvm current symlink
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/opt/nodejs/bin',
    ];
    return [...extra, process.env.PATH || ''].filter(Boolean).join(sep);
  }

  private summarizeInstallChunk(chunk: string): string {
    return chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 180) || 'OpenCode setup is still running...';
  }
}

export const opencodeRunner = new OpenCodeRunner();
