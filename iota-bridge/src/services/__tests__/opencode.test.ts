import * as fs from 'fs';
import * as path from 'path';
import { opencodeServerClient } from '../opencode';
import { opencodeStore } from '../opencodeStore';
import { getWorkspaceRoot } from '../logger';

describe('OpenCodeServerClient Integration & Simulation Tests', () => {
  const mockBinDir = path.join(__dirname, 'mock-bin');
  const originalPath = process.env.PATH;

  beforeAll(() => {
    const logPath = path.join(process.cwd(), 'mock_server.log');
    if (fs.existsSync(logPath)) {
      try { fs.unlinkSync(logPath); } catch (e) {}
    }

    // 1. Create a mock bin directory
    if (!fs.existsSync(mockBinDir)) {
      fs.mkdirSync(mockBinDir, { recursive: true });
    }

    // 2. Write the mock javascript parser logic
    const mockCode = `
const fs = require('fs');
const http = require('http');
const path = require('path');

const logPath = path.join(process.cwd(), 'mock_server.log');
function log(msg) {
  try {
    fs.appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + msg + '\\n', 'utf8');
  } catch (e) {}
}

const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('1.17.11');
  process.exit(0);
}

if (args.includes('session') && args.includes('list')) {
  console.log('[]');
  process.exit(0);
}

if (args.includes('serve')) {
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) || 4096 : 4096;
  log('Starting serve command on port ' + port);
  const sseClients = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      log('req: ' + req.method + ' ' + req.url);
      if (req.url.startsWith('/global/health')) {
        log('received GET /global/health');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ healthy: true, version: '1.17.11' }));
        return;
      }
      if (req.url.startsWith('/event')) {
        log('received GET /event');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('data: {"type":"server.connected"}' + String.fromCharCode(10) + String.fromCharCode(10));
        sseClients.push(res);
        res.on('close', () => {
          log('SSE client connection closed');
          const idx = sseClients.indexOf(res);
          if (idx !== -1) sseClients.splice(idx, 1);
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/session') {
        log('received POST /session');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock-session-id' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/session') {
        log('received GET /session');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'mock-session-id', title: 'Mock Session' }]));
        return;
      }
      if (req.url.includes('/prompt_async')) {
        log('received POST /prompt_async: body=' + body);
        res.writeHead(204);
        res.end();
        let parsed = {};
        try { parsed = JSON.parse(body); } catch(e){}
        const modelUsed = parsed.model && typeof parsed.model === 'object'
          ? (parsed.model.providerID + '/' + parsed.model.modelID)
          : parsed.model || 'default-model';
        log('active SSE client count=' + sseClients.length);
        setTimeout(() => {
          for (const client of sseClients) {
            log('Writing to SSE client for prompt_async');
            client.write('data: {"type":"step_start","sessionID":"mock-session-id"}' + String.fromCharCode(10) + String.fromCharCode(10));
            client.write('data: {"type":"text","sessionID":"mock-session-id","part":{"text":"Hello from mock CLI"}}' + String.fromCharCode(10) + String.fromCharCode(10));
            client.write('data: {"type":"args","sessionID":"mock-session-id","args":["--model","' + modelUsed + '"]}' + String.fromCharCode(10) + String.fromCharCode(10));
            client.write('data: {"type":"step_finish","sessionID":"mock-session-id"}' + String.fromCharCode(10) + String.fromCharCode(10));
            client.write('data: {"type":"session.status","sessionID":"mock-session-id","status":{"type":"idle"}}' + String.fromCharCode(10) + String.fromCharCode(10));
          }
        }, 50);
        return;
      }
      if (req.url.includes('/summarize') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('true');
        return;
      }
      if (req.url.includes('/message') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          parts: [{ text: 'Summary of conversation and workspace changes.' }]
        }));
        return;
      }
      if (req.method === 'DELETE' && req.url.includes('/session/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('true');
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/session/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock-session-id', messages: [] }));
        return;
      }
      if (req.url.startsWith('/config/providers')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          providers: [{
            id: 'opencode',
            models: ['deepseek-v4-flash-free']
          }]
        }));
        return;
      }
      res.writeHead(200);
      res.end('ok');
    });
  });
  server.listen(port, '127.0.0.1', () => {
    log('Listening on port ' + port);
  });
  return;
}

if (args.includes('run')) {
  const isPiped = !process.stdin.isTTY;
  if (isPiped) {
    try {
      // Simulate blocking read on stdin if the pipe is kept open
      const buf = Buffer.alloc(1);
      fs.readSync(0, buf, 0, 1, null);
    } catch (err) {
      // EOF or read error (unblocks immediately)
    }
  }

  if (args.join(' ').includes('summarize')) {
    console.log(JSON.stringify({ type: 'text', part: { text: 'Summary of conversation and workspace changes.' } }));
  } else {
    // Output mock ND-JSON stream
    console.log(JSON.stringify({ type: 'step_start', timestamp: Date.now() }));
    console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), part: { text: 'Hello from mock CLI' } }));
    console.log(JSON.stringify({ type: 'args', args: args }));
    console.log(JSON.stringify({ type: 'step_finish', timestamp: Date.now() }));
  }
  process.exit(0);
}
    `;

    fs.writeFileSync(path.join(mockBinDir, 'mock_opencode.js'), mockCode.trim(), 'utf8');

    // 3. Write command wrappers depending on platform
    if (process.platform === 'win32') {
      const batContent = `@echo off\r\nnode "%~dp0mock_opencode.js" %*\r\n`;
      fs.writeFileSync(path.join(mockBinDir, 'opencode.cmd'), batContent, 'utf8');
      fs.writeFileSync(path.join(mockBinDir, 'opencode.bat'), batContent, 'utf8');

      // Mock powershell
      const psContent = `@echo off\r\necho Mock powershell output\r\nexit /b 0\r\n`;
      fs.writeFileSync(path.join(mockBinDir, 'powershell.cmd'), psContent, 'utf8');
      fs.writeFileSync(path.join(mockBinDir, 'powershell.bat'), psContent, 'utf8');
    } else {
      const shContent = `#!/bin/sh\nnode "$(dirname "$0")/mock_opencode.js" "$@"\n`;
      const binPath = path.join(mockBinDir, 'opencode');
      fs.writeFileSync(binPath, shContent, 'utf8');
      fs.chmodSync(binPath, '755');

      // Mock bash
      const bashContent = `#!/bin/sh\necho Mock bash output\nexit 0\n`;
      const bashBinPath = path.join(mockBinDir, 'bash');
      fs.writeFileSync(bashBinPath, bashContent, 'utf8');
      fs.chmodSync(bashBinPath, '755');
    }

    // 4. Prepend mock bin to PATH so the spawn runner targets it
    process.env.PATH = `${mockBinDir}${path.delimiter}${originalPath}`;
  });

  afterAll(() => {
    // Restore PATH
    process.env.PATH = originalPath;
    opencodeServerClient.clearStaleServer();

    // Clean up temporary files
    try {
      const logPath = path.join(process.cwd(), 'mock_server.log');
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
      if (fs.existsSync(mockBinDir)) {
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors if processes lock files
    }
  });

  afterEach(() => {
    opencodeServerClient.clearStaleServer();
  });

  test('should successfully probe capability and return version from mock binary', async () => {
    const capability = await opencodeServerClient.checkCapability();
    expect(capability.status).toBe('available');
    expect(capability.canSubmit).toBe(true);
  });

  test('should execute prompt via serve and successfully capture SSE streaming outputs without hanging', async () => {
    const jsonEvents: any[] = [];
    const textChunks: string[] = [];

    const server = await opencodeServerClient.ensureServer();
    expect(server.ready).toBe(true);

    const handle = await opencodeServerClient.executePrompt({
      conversationId: 'test-convo',
      requestId: 'test-req',
      prompt: 'hello',
      onJson: (payload: any) => jsonEvents.push(payload),
      onText: (text: string) => textChunks.push(text),
    });

    const result = await handle.done;
    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify events were received
    expect(jsonEvents.length).toBeGreaterThanOrEqual(2);
    
    // Check that we captured mock text delta
    const textOutputs = jsonEvents.filter((e: any) => e.type === 'text');
    expect(textOutputs.length).toBe(1);
    expect(textOutputs[0].part.text).toBe('Hello from mock CLI');
  });

  test('should spin up mock warm server and executePrompt works', async () => {
    const server = await opencodeServerClient.ensureServer();
    expect(server.ready).toBe(true);

    const jsonEvents: any[] = [];
    const handle = await opencodeServerClient.executePrompt({
      conversationId: 'test-convo-attached',
      requestId: 'test-req-attached',
      prompt: 'hello',
      onJson: (payload: any) => jsonEvents.push(payload),
    });

    const result = await handle.done;
    expect(result.completed).toBe(true);
    expect(jsonEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('should inject activeModel into prompt_async body when executing executePrompt', async () => {
    const jsonEvents: any[] = [];
    const convoId = 'test-convo-active-model';
    
    // Set the activeModel in opencodeStore
    const conversation = opencodeStore.getOrCreateConversation(convoId);
    conversation.activeModel = 'test-provider/test-model-name';

    const server = await opencodeServerClient.ensureServer();
    expect(server.ready).toBe(true);

    const handle = await opencodeServerClient.executePrompt({
      conversationId: convoId,
      requestId: 'test-req-model',
      prompt: 'hello',
      onJson: (payload: any) => jsonEvents.push(payload),
    });

    const result = await handle.done;
    expect(result.completed).toBe(true);

    // The model is injected into the prompt_async body via postPromptAsync
    // Verify by checking prompt_async body in logs (written to workspace root CWD)
    const workspaceRoot = getWorkspaceRoot();
    const logPath = path.join(workspaceRoot, 'mock_server.log');
    let logContent = '';
    try {
      logContent = fs.readFileSync(logPath, 'utf8');
    } catch {
      // fallback to process.cwd()
      const fallbackPath = path.join(process.cwd(), 'mock_server.log');
      logContent = fs.readFileSync(fallbackPath, 'utf8');
    }
    expect(logContent).toContain('test-provider/test-model-name');
  });

  test('should run compact query successfully and extract summary text', async () => {
    const conversation = opencodeStore.getOrCreateConversation('test-convo');
    conversation.opencodeSessionId = 'mock-session-id';
    const summary = await opencodeServerClient.runCompactQuery('test-convo');
    expect(summary).toBe('Conversation summarized successfully.');
  });

  test('should run skills query successfully and return list of custom skills', async () => {
    const skills = await opencodeServerClient.runSkillsQuery();
    expect(skills).toContain('Custom Agent Skills');
    expect(skills).toContain('speckit-implement');
  });

  test('should run init query successfully executing update script', async () => {
    const initRes = await opencodeServerClient.runInitQuery();
    expect(initRes).toContain('Mock');
  });
});
