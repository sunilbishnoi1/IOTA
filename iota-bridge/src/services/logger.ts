import * as fs from 'fs';
import * as path from 'path';

let logStream: fs.WriteStream | null = null;

const getWorkspaceRoot = (): string => {
  return process.env.CODESPACE_VSCODE_FOLDER || path.resolve(__dirname, '..', '..', '..');
};

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
