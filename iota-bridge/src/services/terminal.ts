import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

export interface TerminalSession {
  ptyProcess: pty.IPty;
  logBuffer: string[];
}

/**
 * Resolves the parent repository workspace root directory.
 */
function getWorkspaceRoot(): string {
  if (process.env.CODESPACE_VSCODE_FOLDER) {
    return process.env.CODESPACE_VSCODE_FOLDER;
  }
  return path.resolve(process.cwd(), '..');
}

class TerminalManager {
  private activeSession: TerminalSession | null = null;
  private readonly maxLogLines = 2000;

  /**
   * Spawns a new pseudo-terminal process running the specified command/agent
   */
  public spawn(
    agentName: string,
    prompt: string,
    env: Record<string, string>,
    onData: (chunk: string) => void,
    onExit: (exitCode: number) => void
  ): pty.IPty {
    // Teardown any existing session first
    this.killActiveSession();

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    
    // Construct command arguments depending on the agent
    let args: string[] = [];
    if (agentName === 'install-opencode') {
      if (os.platform() === 'win32') {
        args = ['-Command', 'npm install -g opencode-ai'];
      } else {
        args = ['-c', 'npm install -g opencode-ai || curl -fsSL https://opencode.ai/install | bash'];
      }
    } else if (agentName === 'opencode') {
      if (os.platform() === 'win32') {
        args = ['-Command', 'opencode'];
      } else {
        args = ['-c', 'opencode'];
      }
    } else {
      let packageSpec = '@anthropic-ai/claude-code';
      if (agentName === 'cline') {
        packageSpec = 'cline';
      }

      // Construct command arguments depending on the agent
      const escapedPrompt = prompt.replace(/"/g, '\\"');
      if (os.platform() === 'win32') {
        args = ['-Command', `Write-Host 'Spawning ${agentName}...'; npx -y ${packageSpec} "${escapedPrompt}"`];
      } else {
        args = ['-c', `npx -y ${packageSpec} "${escapedPrompt}"`];
      }
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

    if (agentName === 'opencode' && prompt) {
      setTimeout(() => {
        try {
          ptyProcess.write(prompt + '\n');
        } catch (err) {
          console.error('Failed to write initial prompt to opencode:', err);
        }
      }, 500);
    }

    const session: TerminalSession = {
      ptyProcess,
      logBuffer: [],
    };

    ptyProcess.onData((data) => {
      // Maintain rolling buffer of logs
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
