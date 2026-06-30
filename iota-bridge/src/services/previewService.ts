import { ChildProcess, exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
  }
  return 'localhost';
}
import { PreviewProcessState, PreviewServerConfig, PreviewStatus, PreviewWorkspaceConfig } from '../types/preview';
import { getWorkspaceRoot, logInfo, logError } from './logger';
import { EnvService } from './envService';

const execAsync = promisify(exec);

export class PreviewService {
  private static instance: PreviewService;
  private activePreviews = new Map<number, {
    state: PreviewProcessState;
    process?: ChildProcess;
  }>();

  private constructor() {}

  public static getInstance(): PreviewService {
    if (!PreviewService.instance) {
      PreviewService.instance = new PreviewService();
    }
    return PreviewService.instance;
  }

  // Helper to kill anything on port
  public async killProcessOnPort(port: number): Promise<void> {
    const isTest = process.env.NODE_ENV === 'test';
    const bridgePort = Number(process.env.PORT) || 3000;
    const reservedPorts = [bridgePort, 8081];
    if (reservedPorts.includes(port) && !isTest) {
      logInfo(`Skipping kill request on port ${port} because it is a reserved development port (Bridge/Metro).`);
      return;
    }
    logInfo(`Attempting to kill any process occupying port ${port}`);
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
        const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(Number(pid)) && Number(pid) > 0) {
            logInfo(`Killing process with PID ${pid} on port ${port}`);
            try {
              await execAsync(`taskkill /F /PID ${pid}`);
            } catch (e) {
              // Ignore failure for individual PIDs
            }
          }
        }
      } catch (err) {
        // no process found
      }
    } else {
      try {
        await execAsync(`lsof -t -i :${port} | xargs kill -9`);
        logInfo(`Killed process on port ${port} via lsof`);
      } catch (err) {
        try {
          await execAsync(`fuser -k ${port}/tcp`);
          logInfo(`Killed process on port ${port} via fuser`);
        } catch (err2) {
          // ignore
        }
      }
    }
  }

  // Set port to public using gh CLI
  public async setPortVisibility(port: number, visibility: 'public' | 'private'): Promise<void> {
    const codespaceName = process.env.CODESPACE_NAME;
    if (!codespaceName) {
      logInfo(`Not in codespace, skipping port visibility update for ${port}`);
      return;
    }
    logInfo(`Setting port ${port} visibility to ${visibility}`);
    try {
      await execAsync(`gh codespace ports visibility ${port}:${visibility} -c ${codespaceName}`);
    } catch (err) {
      try {
        await execAsync(`gh codespace ports visibility ${port}:${visibility}`);
      } catch (e) {
        const errorMsg = `Failed to set port visibility for ${port} to ${visibility}: ${String(e)}`;
        logError(errorMsg);
        throw new Error(errorMsg);
      }
    }
  }

  // Start preview server
  public async startPreview(
    config: PreviewServerConfig,
    onLog: (port: number, text: string) => void,
    onError: (port: number, err: string) => void,
    onStatusChange: (state: PreviewProcessState) => void
  ): Promise<PreviewProcessState> {
    let port = config.port;
    const isTest = process.env.NODE_ENV === 'test';
    const bridgePort = Number(process.env.PORT) || 3000;
    const reservedPorts = [bridgePort, 8081];
    if (reservedPorts.includes(port) && !isTest) {
      port = await this.findFreePort(port + 1);
      logInfo(`Port ${config.port} is a reserved development port. Shifting preview to port ${port}.`);
    }
    
    // 1. Kill existing processes on the port
    await this.killProcessOnPort(port);

    // 2. Initialize state
    const codespaceName = process.env.CODESPACE_NAME;
    const portForwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    
    let resolvedUrl = '';
    if (codespaceName) {
      resolvedUrl = `https://${codespaceName}-${port}.${portForwardingDomain}`;
    } else {
      const localIp = getLocalIpAddress();
      resolvedUrl = `http://${localIp}:${port}`;
    }
      
    if (config.type === 'expo-go') {
      resolvedUrl = resolvedUrl.replace(/^https:/, 'exps:').replace(/^http:/, 'exp:');
    }

    // Parse command and replace/append ports if shifted
    let finalCommand = config.command;
    if (port !== config.port) {
      if (finalCommand.includes('--port') || finalCommand.includes('-p') || finalCommand.includes('--web-port')) {
        finalCommand = finalCommand
          .replace(/--port\s+\d+/, `--port ${port}`)
          .replace(/-p\s+\d+/, `-p ${port}`)
          .replace(/--web-port\s+\d+/, `--web-port ${port}`);
      } else {
        if (finalCommand.startsWith('npx expo start') || finalCommand.startsWith('expo start')) {
          finalCommand = `${finalCommand} --port ${port}`;
        } else if (finalCommand.startsWith('npx next dev') || finalCommand.startsWith('next dev')) {
          finalCommand = `${finalCommand} -p ${port}`;
        } else if (finalCommand.startsWith('npx vite') || finalCommand.startsWith('vite')) {
          finalCommand = `${finalCommand} --port ${port}`;
        }
      }
    }
    const state: PreviewProcessState = {
      port,
      originalPort: config.port !== port ? config.port : undefined,
      pid: null,
      status: 'starting',
      command: finalCommand,
      url: resolvedUrl
    };

    this.activePreviews.set(port, { state });
    onStatusChange(state);

    // 3. Make port public
    try {
      await this.setPortVisibility(port, 'public');
    } catch (err: any) {
      logError(`Non-fatal: Failed to set port visibility for ${port}: ${err.message || err}`);
    }

    // 4. Resolve cwd
    const workspaceRoot = getWorkspaceRoot();
    const resolvedCwd = config.cwd ? path.resolve(workspaceRoot, config.cwd) : workspaceRoot;

    logInfo(`Spawning preview process on port ${port} with command: ${finalCommand} in cwd: ${resolvedCwd}`);

    // T015: Enhance bridge preview subprocess manager to handle Flutter Web execution modes
    if (finalCommand.startsWith('flutter run') && !finalCommand.includes('-d web-server') && !finalCommand.includes('--web-port')) {
      finalCommand = `flutter run -d web-server --web-port ${port} --web-hostname 0.0.0.0`;
      logInfo(`Enhanced Flutter command to: ${finalCommand}`);
    }

    const parts = finalCommand.trim().split(/\s+/);
    const baseCommand = parts[0];
    const args = parts.slice(1);

    const env: Record<string, string | undefined> = { 
      ...process.env,
      ...EnvService.getInstance().getEnvVars(),
      WORKSPACE_ROOT: workspaceRoot,
      IOTA_WORKSPACE_ROOT: workspaceRoot,
      PORT: String(port),
    };

    if (codespaceName) {
      env.EXPO_PACKAGER_PROXY_URL = `https://${codespaceName}-${port}.${portForwardingDomain}`;
      env.REACT_NATIVE_PACKAGER_HOSTNAME = `${codespaceName}-${port}.${portForwardingDomain}`;
      const publicPorts = [3001, 3002, 8082, 8083];
      if (!publicPorts.includes(port)) {
        logInfo(`[WARNING] Preview port ${port} is not in the pre-forwarded public ports list (3001, 3002, 8082, 8083). The preview might be inaccessible on mobile/external browsers unless manually made public in your Codespaces/VS Code Ports panel.`);
      }
    }
    let child: ChildProcess;

    try {
      if (process.platform === 'win32') {
        child = spawn(baseCommand, args, { cwd: resolvedCwd, env, shell: true });
      } else {
        child = spawn('/bin/sh', ['-c', `${baseCommand} "$@"`, '--', ...args], { cwd: resolvedCwd, env, shell: false });
      }
    } catch (e: any) {
      logError(`Failed to spawn child process on port ${port}: ${e.message}`);
      state.status = 'crashed';
      this.activePreviews.set(port, { state });
      onStatusChange(state);
      onError(port, e.message || String(e));
      throw e;
    }

    state.pid = child.pid || null;
    state.status = 'running';
    
    this.activePreviews.set(port, { state, process: child });
    onStatusChange(state);

    child.stdout?.on('data', (data: any) => {
      onLog(port, data.toString());
    });

    child.stderr?.on('data', (data: any) => {
      onLog(port, data.toString());
    });

    child.on('error', (err: any) => {
      logError(`Process error on port ${port}: ${err.message}`);
      state.status = 'crashed';
      onStatusChange(state);
      onError(port, err.message || String(err));
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      logInfo(`Process on port ${port} exited with code: ${code}, signal: ${signal}`);
      const current = this.activePreviews.get(port);
      if (current && current.state.status !== 'stopped') {
        current.state.status = (code === 0 || code === null) ? 'stopped' : 'crashed';
        current.state.pid = null;
        onStatusChange(current.state);
      }
    });

    return state;
  }

  // Stop preview server
  public async stopPreview(port: number): Promise<void> {
    let resolvedPort = port;
    let current = this.activePreviews.get(port);
    if (!current) {
      // Fallback: search by originalPort
      for (const [p, val] of this.activePreviews.entries()) {
        if (val.state.originalPort === port) {
          resolvedPort = p;
          current = val;
          break;
        }
      }
    }

    if (!current) {
      logInfo(`No active preview process registered on port ${port}`);
      return;
    }

    logInfo(`Stopping preview process on port ${resolvedPort} (requested: ${port})`);
    current.state.status = 'stopped';
    current.state.pid = null;

    if (current.process) {
      try {
        current.process.kill();
      } catch (e) {
        logError(`Failed to kill process on port ${resolvedPort}: ${String(e)}`);
      }
    }

    // Set port back to private
    try {
      await this.setPortVisibility(resolvedPort, 'private');
    } catch (err: any) {
      logError(`Non-fatal: Failed to revert port visibility for ${resolvedPort}: ${err.message || err}`);
    }
    this.activePreviews.delete(resolvedPort);
  }

  public getPreviewState(port: number): PreviewProcessState | undefined {
    const direct = this.activePreviews.get(port)?.state;
    if (direct) return direct;

    // Fallback: search by originalPort
    for (const preview of this.activePreviews.values()) {
      if (preview.state.originalPort === port) {
        return preview.state;
      }
    }
    return undefined;
  }

  public getAllPreviewStates(): PreviewProcessState[] {
    return Array.from(this.activePreviews.values()).map(p => p.state);
  }

  // Clean up all processes on application shutdown
  public async cleanup(): Promise<void> {
    const ports = Array.from(this.activePreviews.keys());
    for (const port of ports) {
      await this.stopPreview(port);
    }
  }

  public getPreviewConfigPayload(): PreviewWorkspaceConfig {
    const rootDir = getWorkspaceRoot();
    const configPath = path.join(rootDir, '.iota', 'preview.json');
    let servers: PreviewServerConfig[] = [];
    let isPlaceholder = false;

    const defaultPlaceholderConfig: PreviewWorkspaceConfig = {
      isPlaceholder: true,
      servers: [
        {
          name: "Configure Server Name (e.g. My Web App)",
          cwd: ".",
          command: "npm run start",
          port: 3000,
          type: "web"
        }
      ]
    };

    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(content);
        servers = parsed.servers || [];
        isPlaceholder = parsed.isPlaceholder === true;
      } catch (err: any) {
        logError(`Failed to parse preview config file: ${err.message}`);
        servers = defaultPlaceholderConfig.servers;
        isPlaceholder = true;
      }
    } else {
      isPlaceholder = true;
      try {
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(defaultPlaceholderConfig, null, 2), 'utf8');
        servers = defaultPlaceholderConfig.servers;
      } catch (err: any) {
        logError(`Failed to auto-persist preview config: ${err.message}`);
        servers = defaultPlaceholderConfig.servers;
      }
    }

    // Shift any server configured on reserved ports (3000, 8081) dynamically
    const bridgePort = Number(process.env.PORT) || 3000;
    const reservedPorts = [bridgePort, 8081];
    const mappedServers = servers.map(s => {
      if (reservedPorts.includes(s.port)) {
        const shiftedPort = s.port + 1;
        let shiftedCommand = s.command;
        if (shiftedCommand.includes('--port') || shiftedCommand.includes('-p') || shiftedCommand.includes('--web-port')) {
          shiftedCommand = shiftedCommand
            .replace(/--port\s+\d+/, `--port ${shiftedPort}`)
            .replace(/-p\s+\d+/, `-p ${shiftedPort}`)
            .replace(/--web-port\s+\d+/, `--web-port ${shiftedPort}`);
        } else {
          if (shiftedCommand.startsWith('npx expo start') || shiftedCommand.startsWith('expo start')) {
            shiftedCommand = `${shiftedCommand} --port ${shiftedPort}`;
          } else if (shiftedCommand.startsWith('npx next dev') || shiftedCommand.startsWith('next dev')) {
            shiftedCommand = `${shiftedCommand} -p ${shiftedPort}`;
          } else if (shiftedCommand.startsWith('npx vite') || shiftedCommand.startsWith('vite')) {
            shiftedCommand = `${shiftedCommand} --port ${shiftedPort}`;
          }
        }
        return {
          ...s,
          port: shiftedPort,
          command: shiftedCommand
        };
      }
      return s;
    });

    return { servers: mappedServers, isPlaceholder };
  }

  private async findFreePort(startPort: number): Promise<number> {
    const checkPort = (p: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
          resolve(false);
        });
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(p, '127.0.0.1');
      });
    };

    let currentPort = startPort;
    while (!(await checkPort(currentPort))) {
      currentPort++;
      if (currentPort > startPort + 100) {
        break;
      }
    }
    return currentPort;
  }
}
