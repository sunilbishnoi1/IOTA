import { Server, Socket } from 'socket.io';
import { initSocketIO } from '../socket';
import { opencodeServerClient } from '../opencode';
import { opencodeStore } from '../opencodeStore';
import * as http from 'http';

jest.mock('../opencode', () => {
  return {
    opencodeServerClient: {
      checkCapability: jest.fn().mockResolvedValue({ status: 'available' }),
      runStatsQuery: jest.fn(),
      runSessionsQuery: jest.fn(),
      runSessionDelete: jest.fn(),
      runExportQuery: jest.fn(),
    },
  };
});

jest.mock('socket.io', () => {
  return {
    Server: jest.fn().mockImplementation(() => {
      const io = {
        use: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };
      return io;
    }),
  };
});

describe('Socket Message Handling Unit Tests', () => {
  let mockSocket: any;
  let socketListeners: Record<string, Function> = {};
  let ioInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    socketListeners = {};

    mockSocket = {
      id: 'mock-socket-id',
      handshake: {
        query: { token: 'mock-token' },
        auth: { credentials: {} },
      },
      on: jest.fn().mockImplementation((event, callback) => {
        socketListeners[event] = callback;
      }),
      emit: jest.fn(),
    };

    // Instantiate initSocketIO to capture registration
    const mockServer = {} as http.Server;
    initSocketIO(mockServer);

    // Retrieve Server mock instance and invoke the connection callback
    const ServerMock = require('socket.io').Server;
    const mockIo = ServerMock.mock.results[0].value;
    ioInstance = mockIo;

    // Trigger connection
    const connectionCallback = mockIo.on.mock.calls.find((call: any) => call[0] === 'connection')[1];
    connectionCallback(mockSocket);
  });

  test('should intercept /stats slash command and runStatsQuery', async () => {
    (opencodeServerClient.runStatsQuery as jest.Mock).mockResolvedValue('Mock Stats Output');

    // Trigger opencode:message with /stats
    const messageCallback = socketListeners['opencode:message'];
    expect(messageCallback).toBeDefined();

    await messageCallback({
      conversationId: 'test-stats-convo',
      content: '/stats',
    });

    expect(opencodeServerClient.runStatsQuery).toHaveBeenCalled();
    // Verify a message was emitted containing stats
    const emitCalls = ioInstance.emit.mock.calls;
    const msgEmit = emitCalls.find((call: any) => call[0] === 'opencode:message' && call[1].message.role === 'assistant');
    expect(msgEmit).toBeDefined();
    expect(msgEmit[1].message.content).toContain('Mock Stats Output');
  });

  test('should intercept /sessions slash command and runSessionsQuery', async () => {
    (opencodeServerClient.runSessionsQuery as jest.Mock).mockResolvedValue('Mock Sessions List Table');

    const messageCallback = socketListeners['opencode:message'];
    await messageCallback({
      conversationId: 'test-sessions-convo',
      content: '/sessions',
    });

    expect(opencodeServerClient.runSessionsQuery).toHaveBeenCalled();
    const emitCalls = ioInstance.emit.mock.calls;
    const msgEmit = emitCalls.find((call: any) => call[0] === 'opencode:message' && call[1].message.role === 'assistant');
    expect(msgEmit).toBeDefined();
    expect(msgEmit[1].message.content).toContain('Mock Sessions List Table');
  });

  test('should intercept /sessions delete <id> and runSessionDelete', async () => {
    (opencodeServerClient.runSessionDelete as jest.Mock).mockResolvedValue('Session deleted successfully.');

    const messageCallback = socketListeners['opencode:message'];
    await messageCallback({
      conversationId: 'test-delete-sessions-convo',
      content: '/sessions delete ses_123',
    });

    expect(opencodeServerClient.runSessionDelete).toHaveBeenCalledWith('ses_123');
    const emitCalls = ioInstance.emit.mock.calls;
    const msgEmit = emitCalls.find((call: any) => call[0] === 'opencode:message' && call[1].message.role === 'assistant');
    expect(msgEmit).toBeDefined();
    expect(msgEmit[1].message.content).toContain('Session deleted successfully.');
  });
});
