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
import { PreviewProcessState, PreviewServerConfig, PreviewStatus } from '../types/preview';
import { getWorkspaceRoot, logInfo, logError } from './logger';

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

  public detectServers(): PreviewServerConfig[] {
    const rootDir = getWorkspaceRoot();
    return this.detectPreviewServersRecursive(rootDir, rootDir);
  }

  private detectPreviewServersRecursive(dir: string, workspaceRoot: string, depth = 0): PreviewServerConfig[] {
    const configs: PreviewServerConfig[] = [];
    if (depth > 2) return configs;

    try {
      const files = fs.readdirSync(dir);
      
      // Check package.json
      if (files.includes('package.json')) {
        try {
          const pkgContent = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
          const pkg = JSON.parse(pkgContent);
          const relativeCwd = path.relative(workspaceRoot, dir) || '.';
          const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          
          if (dependencies['expo']) {
            configs.push({
              name: `${pkg.name || 'Expo'} App`,
              cwd: relativeCwd,
              command: 'npx expo start',
              port: 8081,
              type: 'expo-go'
            });
          } else if (dependencies['next']) {
            configs.push({
              name: `${pkg.name || 'Next.js'} Web App`,
              cwd: relativeCwd,
              command: 'npx next dev',
              port: 3000,
              type: 'web'
            });
          } else if (dependencies['vite']) {
            configs.push({
              name: `${pkg.name || 'Vite'} Web App`,
              cwd: relativeCwd,
              command: 'npx vite',
              port: 5173,
              type: 'web'
            });
          } else {
            const scripts = pkg.scripts || {};
            if (scripts.dev) {
              configs.push({
                name: `${pkg.name || 'Web'} App (dev)`,
                cwd: relativeCwd,
                command: 'npm run dev',
                port: 3000,
                type: 'web'
              });
            } else if (scripts.start) {
              configs.push({
                name: `${pkg.name || 'Web'} App (start)`,
                cwd: relativeCwd,
                command: 'npm run start',
                port: 3000,
                type: 'web'
              });
            }
          }
        } catch (e) {
          // ignore JSON parse errors
        }
      }

      // Check pubspec.yaml
      if (files.includes('pubspec.yaml')) {
        const relativeCwd = path.relative(workspaceRoot, dir) || '.';
        configs.push({
          name: 'Flutter Web App',
          cwd: relativeCwd,
          command: 'flutter run -d web-server --web-port 8080 --web-hostname 0.0.0.0',
          port: 8080,
          type: 'web'
        });
      }

      // Recurse subdirs
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build' || file.startsWith('.')) {
          continue;
        }
        const fullPath = path.join(dir, file);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            configs.push(...this.detectPreviewServersRecursive(fullPath, workspaceRoot, depth + 1));
          }
        } catch (e) {
          // ignore stat errors
        }
      }
    } catch (e) {
      // ignore read errors
    }

    return configs;
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
