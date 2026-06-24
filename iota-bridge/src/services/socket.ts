import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { validateCodespaceOwner } from './github';
import { terminalManager } from './terminal';

let ioInstance: Server | null = null;

export const initSocketIO = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  ioInstance = io;

  // Authentication Middleware
  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.query.token as string;
    if (!token) {
      return next(new Error('Authentication error: Token is required'));
    }

    const isValid = await validateCodespaceOwner(token);
    if (!isValid) {
      return next(new Error('Authentication error: Unauthorized user token'));
    }

    next();
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    // Retrieve credentials from handshake auth
    const credentials = (socket.handshake.auth?.credentials || {}) as Record<string, string>;

    // Send current status and log buffer immediately upon connection
    if (terminalManager.isActive()) {
      socket.emit('agent:status', {
        status: 'running',
        details: 'Active terminal session restored',
      });
      const existingLogs = terminalManager.getLogs();
      if (existingLogs) {
        socket.emit('terminal:log', { chunk: existingLogs });
      }
    } else {
      socket.emit('agent:status', {
        status: 'idle',
        details: 'No active session',
      });
    }

    socket.on('agent:start', (payload: { agent: string; prompt: string }) => {
      const { agent, prompt } = payload;
      if (!agent || !prompt) {
        socket.emit('agent:status', {
          status: 'error',
          details: 'Agent name and prompt are required',
        });
        return;
      }

      io.emit('agent:status', {
        status: 'running',
        details: `Starting agent ${agent}...`,
      });

      try {
        terminalManager.spawn(
          agent,
          prompt,
          credentials,
          (chunk) => {
            io.emit('terminal:log', { chunk });
          },
          (exitCode) => {
            io.emit('terminal:exit', {
              exitCode,
              completed: exitCode === 0,
            });
            io.emit('agent:status', {
              status: 'idle',
              details: 'Terminal session completed',
            });
          }
        );
      } catch (err: any) {
        io.emit('agent:status', {
          status: 'error',
          details: `Failed to spawn agent: ${err.message}`,
        });
      }
    });

    socket.on('terminal:input', (payload: { input: string }) => {
      const { input } = payload;
      if (input !== undefined) {
        terminalManager.writeInput(input);
      }
    });

    socket.on('agent:stop', () => {
      terminalManager.killActiveSession();
      io.emit('agent:status', {
        status: 'idle',
        details: 'Agent execution manually stopped',
      });
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
      // DO NOT kill terminal session here to allow reconnection
    });
  });

  return io;
};
