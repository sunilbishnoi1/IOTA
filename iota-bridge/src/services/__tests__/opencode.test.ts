import * as fs from 'fs';
import * as path from 'path';
import { opencodeRunner } from '../opencode';
import { opencodeStore } from '../opencodeStore';

describe('OpenCodeRunner Integration & Simulation Tests', () => {
  const mockBinDir = path.join(__dirname, 'mock-bin');
  const originalPath = process.env.PATH;

  beforeAll(() => {
    // 1. Create a mock bin directory
    if (!fs.existsSync(mockBinDir)) {
      fs.mkdirSync(mockBinDir, { recursive: true });
    }

    // 2. Write the mock javascript parser logic
    const mockCode = `
const fs = require('fs');
const http = require('http');

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
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(port, '127.0.0.1', () => {
    // Keep running to act as daemon
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
    opencodeRunner.clearStaleServer();

    // Clean up temporary files
    try {
      if (fs.existsSync(mockBinDir)) {
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors if processes lock files
    }
  });

  afterEach(() => {
    opencodeRunner.clearStaleServer();
  });

  test('should successfully probe capability and return version from mock binary', async () => {
    const capability = await opencodeRunner.checkCapability();
    expect(capability.status).toBe('available');
    expect(capability.canSubmit).toBe(true);
  });

  test('should execute run and successfully capture ND-JSON streaming outputs without hanging', async () => {
    const jsonEvents: any[] = [];
    const textChunks: string[] = [];

    const handle = await opencodeRunner.run({
      conversationId: 'test-convo',
      requestId: 'test-req',
      prompt: 'hello',
      onJson: (payload) => jsonEvents.push(payload),
      onText: (text) => textChunks.push(text),
    });

    const result = await handle.done;
    expect(result.exitCode).toBe(0);
    expect(result.spawnError).toBeUndefined();

    // Verify events were parsed
    expect(jsonEvents.length).toBeGreaterThanOrEqual(2);
    expect(jsonEvents[0].type).toBe('step_start');
    
    // Check that we captured mock text delta
    const textOutputs = jsonEvents.filter(e => e.type === 'text');
    expect(textOutputs.length).toBe(1);
    expect(textOutputs[0].part.text).toBe('Hello from mock CLI');
  });

  test('should spin up mock warm server and attached run works', async () => {
    const server = await opencodeRunner.ensureServer();
    expect(server.ready).toBe(true);

    const jsonEvents: any[] = [];
    const handle = await opencodeRunner.run({
      conversationId: 'test-convo-attached',
      requestId: 'test-req-attached',
      prompt: 'hello',
      onJson: (payload) => jsonEvents.push(payload),
    });

    const result = await handle.done;
    expect(result.exitCode).toBe(0);
    expect(handle.mode).toBe('attached');
    expect(jsonEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('should inject activeModel into buildRunArgs when executing run', async () => {
    const jsonEvents: any[] = [];
    const convoId = 'test-convo-active-model';
    
    // Set the activeModel in opencodeStore
    const conversation = opencodeStore.getOrCreateConversation(convoId);
    conversation.activeModel = 'test-provider/test-model-name';

    const handle = await opencodeRunner.run({
      conversationId: convoId,
      requestId: 'test-req-model',
      prompt: 'hello',
      onJson: (payload) => jsonEvents.push(payload),
    });

    const result = await handle.done;
    expect(result.exitCode).toBe(0);

    const argsEvent = jsonEvents.find(e => e.type === 'args');
    expect(argsEvent).toBeDefined();
    expect(argsEvent.args).toContain('--model');
    const modelIndex = argsEvent.args.indexOf('--model');
    expect(argsEvent.args[modelIndex + 1]).toBe('test-provider/test-model-name');
  });

  test('should run compact query successfully and extract summary text', async () => {
    const summary = await opencodeRunner.runCompactQuery('test-convo');
    expect(summary).toBe('Summary of conversation and workspace changes.');
  });

  test('should run skills query successfully and return list of custom skills', async () => {
    const skills = await opencodeRunner.runSkillsQuery();
    expect(skills).toContain('Custom Agent Skills');
    expect(skills).toContain('speckit-implement');
  });

  test('should run init query successfully executing update script', async () => {
    const initRes = await opencodeRunner.runInitQuery();
    expect(initRes).toContain('Mock');
  });
});
