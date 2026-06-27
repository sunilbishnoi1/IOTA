import * as fs from 'fs';
import * as path from 'path';

let logStream: fs.WriteStream | null = null;

export function getWorkspaceRoot(): string {
  // 1. Check CODESPACE_VSCODE_FOLDER environment variable
  if (process.env.CODESPACE_VSCODE_FOLDER && fs.existsSync(process.env.CODESPACE_VSCODE_FOLDER)) {
    return process.env.CODESPACE_VSCODE_FOLDER;
  }

  // 2. Check CONTAINER_WORKSPACE_FOLDER environment variable
  if (process.env.CONTAINER_WORKSPACE_FOLDER && fs.existsSync(process.env.CONTAINER_WORKSPACE_FOLDER)) {
    return process.env.CONTAINER_WORKSPACE_FOLDER;
  }

  // 3. Scan /workspaces directory if running inside a Devcontainer / Codespace
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
      
      // Find the first directory that is not hidden and is not 'iota' (cloned bridge)
      const workspaceDir = dirs.find(dir => {
        const base = path.basename(dir).toLowerCase();
        return !base.startsWith('.') && base !== 'iota';
      });
      if (workspaceDir) {
        return workspaceDir;
      }
      
      // Fallback to any non-hidden directory
      const anyDir = dirs.find(dir => !path.basename(dir).startsWith('.'));
      if (anyDir) {
        return anyDir;
      }
    } catch (err) {
      // ignore
    }
  }

  // 4. Default fallback: resolve relative to current file or process.cwd()
  // If we are running in the bridge (either locally or in /tmp/iota/iota-bridge),
  // process.cwd() is /path/to/iota-bridge. So path.resolve(process.cwd(), '..') is /path/to/iota.
  return path.resolve(process.cwd(), '..');
}


export const initLogger = () => {
  if (logStream) return;
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
