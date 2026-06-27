import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';
import { getWorkspaceRoot } from './logger';

export interface TerminalSession {
  ptyProcess: pty.IPty;
  logBuffer: string[];
}


class TerminalManager {
  private activeSession: TerminalSession | null = null;
  private readonly maxLogLines = 2000;

  /**
   * Internal PTY helper retained for maintenance flows only.
   * Control Screen chat uses services/opencode.ts and normalized opencode:* events.
   */
  public spawn(
    agentName: string,
    prompt: string,
    env: Record<string, string>,
    onData: (chunk: string) => void,
    onExit: (exitCode: number) => void
  ): pty.IPty {
    this.killActiveSession();

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const escapedPrompt = prompt.replace(/"/g, '\\"');
    let args: string[] = [];

    if (agentName === 'install-opencode') {
      args = os.platform() === 'win32'
        ? ['-Command', 'npm install -g opencode-ai']
        : ['-c', 'npm install -g opencode-ai || curl -fsSL https://opencode.ai/install | bash'];
    } else if (agentName === 'opencode') {
      args = os.platform() === 'win32'
        ? ['-Command', `opencode run "${escapedPrompt}" --format json`]
        : ['-c', `opencode run "${escapedPrompt}" --format json`];
    } else {
      let packageSpec = '@anthropic-ai/claude-code';
      if (agentName === 'cline') {
        packageSpec = 'cline';
      }
      args = os.platform() === 'win32'
        ? ['-Command', `Write-Host 'Spawning ${agentName}...'; npx -y ${packageSpec} "${escapedPrompt}"`]
        : ['-c', `npx -y ${packageSpec} "${escapedPrompt}"`];
    }

    const mergedEnv = {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
    };

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: getWorkspaceRoot(),
      env: mergedEnv,
    });

    const session: TerminalSession = {
      ptyProcess,
      logBuffer: [],
    };

    ptyProcess.onData((data) => {
      session.logBuffer.push(data);
      if (session.logBuffer.length > this.maxLogLines) {
        session.logBuffer.shift();
      }
      onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (this.activeSession?.ptyProcess === ptyProcess) {
        this.activeSession = null;
      }
      onExit(exitCode);
    });

    this.activeSession = session;
    return ptyProcess;
  }

  /**
   * Writes raw input keystrokes or selection choice to the active terminal
   */
  public writeInput(input: string): void {
    if (this.activeSession?.ptyProcess) {
      this.activeSession.ptyProcess.write(input);
    }
  }

  /**
   * Kills the active terminal execution
   */
  public killActiveSession(): void {
    if (this.activeSession?.ptyProcess) {
      try {
        this.activeSession.ptyProcess.kill();
      } catch (err) {
        console.error('Error killing PTY session:', err);
      }
      this.activeSession = null;
    }
  }

  /**
   * Retrieves the buffered output logs
   */
  public getLogs(): string {
    return this.activeSession ? this.activeSession.logBuffer.join('') : '';
  }

  /**
   * Checks if a session is currently active
   */
  public isActive(): boolean {
    return this.activeSession !== null;
  }
}

export const terminalManager = new TerminalManager();
