import * as fs from 'fs';
import * as path from 'path';

let logStream: fs.WriteStream | null = null;
let activeWorkspaceRoot: string | null = null;
let lastResolvedRoot: string | null = null;
let cachedResolvedRoot: string | null = null;
let cachedResolvedRootTime = 0;
const ROOT_CACHE_TTL_MS = 5000;

export function setWorkspaceRoot(newRoot: string) {
  if (fs.existsSync(newRoot)) {
    activeWorkspaceRoot = newRoot;
    lastResolvedRoot = newRoot;
    initLogger(true);
  }
}

export function getWorkspaceRoot(): string {
  if (activeWorkspaceRoot) {
    return activeWorkspaceRoot;
  }

  // Use cached result if recent enough to avoid repeated fs.existsSync calls
  const now = Date.now();
  if (cachedResolvedRoot && (now - cachedResolvedRootTime) < ROOT_CACHE_TTL_MS) {
    return cachedResolvedRoot;
  }

  const candidates: string[] = [];

  // 0. Check for custom environment variable overrides (local testing)
  if (process.env.IOTA_WORKSPACE_ROOT && fs.existsSync(process.env.IOTA_WORKSPACE_ROOT)) {
    candidates.push(process.env.IOTA_WORKSPACE_ROOT);
  }
  if (process.env.WORKSPACE_ROOT && fs.existsSync(process.env.WORKSPACE_ROOT)) {
    candidates.push(process.env.WORKSPACE_ROOT);
  }

  // 1. Check CODESPACE_VSCODE_FOLDER environment variable
  if (process.env.CODESPACE_VSCODE_FOLDER && fs.existsSync(process.env.CODESPACE_VSCODE_FOLDER)) {
    candidates.push(process.env.CODESPACE_VSCODE_FOLDER);
  }

  // 2. Check CONTAINER_WORKSPACE_FOLDER environment variable
  if (process.env.CONTAINER_WORKSPACE_FOLDER && fs.existsSync(process.env.CONTAINER_WORKSPACE_FOLDER)) {
    candidates.push(process.env.CONTAINER_WORKSPACE_FOLDER);
  }

  // 3. Scan /workspaces directory if running inside a Devcontainer / Codespace.
  //    When scanning, prefer the IOTA directory over other workspaces.
  if (fs.existsSync('/workspaces')) {
    try {
      const dirs = fs.readdirSync('/workspaces')
        .map(name => path.join('/workspaces', name))
        .filter(fullPath => {
          try {
            return fs.statSync(fullPath).isDirectory();
          } catch {
            return false;
          }
        });

      const iotaDir = dirs.find(dir => path.basename(dir).toLowerCase() === 'iota');
      if (iotaDir) {
        candidates.push(iotaDir);
      }
      const otherDirs = dirs
        .filter(dir => path.basename(dir).toLowerCase() !== 'iota' && !path.basename(dir).startsWith('.'))
        .sort();
      candidates.push(...otherDirs);
    } catch (err: any) {
      console.error(`[logger] Failed to scan /workspaces directory: ${err?.message || err}`);
    }
  }

  // 4. Default fallback: resolve relative to current file (__dirname) to get the IOTA root project directory.
  const relativeRoot = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(relativeRoot)) {
    candidates.push(relativeRoot);
  }

  const finalFallback = path.resolve(process.cwd(), '..');
  if (fs.existsSync(finalFallback)) {
    candidates.push(finalFallback);
  }

  // Resolve best candidate: prefer one with .iota directory
  const iotaWorkspace = candidates.find(c => fs.existsSync(path.join(c, '.iota')));
  const result = iotaWorkspace || candidates[0] || finalFallback;

  if (lastResolvedRoot !== result) {
    console.log(`[logger] Workspace root resolved: ${result}`);
    lastResolvedRoot = result;
  }

  cachedResolvedRoot = result;
  cachedResolvedRootTime = now;
  return result;
}


export const initLogger = (force = false) => {
  if (logStream && !force) return;
  if (logStream) {
    try {
      logStream.end();
    } catch (e) {
      // ignore
    }
  }
  const rootDir = getWorkspaceRoot();
  const logPath = path.join(rootDir, 'bridge.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  logInfo(`Logger initialized. Log path: ${logPath}`);
};

export const logInfo = (message: string, meta?: any) => {
  const timestamp = new Date().toISOString();
  const formattedMeta = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
  const logLine = `[${timestamp}] [INFO] ${message}${formattedMeta}\n`;
  
  // Log to console
  console.log(logLine.trim());
  
  // Append to file
  if (logStream) {
    logStream.write(logLine);
  } else {
    const rootDir = getWorkspaceRoot();
    try {
      fs.appendFileSync(path.join(rootDir, 'bridge.log'), logLine, 'utf8');
    } catch {
      // fallback if file write fails
    }
  }
};

export const logError = (message: string, meta?: any) => {
  const timestamp = new Date().toISOString();
  const formattedMeta = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
  const logLine = `[${timestamp}] [ERROR] ${message}${formattedMeta}\n`;
  
  // Log to console
  console.error(logLine.trim());
  
  // Append to file
  if (logStream) {
    logStream.write(logLine);
  } else {
    const rootDir = getWorkspaceRoot();
    try {
      fs.appendFileSync(path.join(rootDir, 'bridge.log'), logLine, 'utf8');
    } catch {
      // fallback if file write fails
    }
  }
};
