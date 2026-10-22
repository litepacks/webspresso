const { PassThrough } = require('stream');
const { McpServer } = require('../../../plugins/mcp/server');
const { startStdioTransport, redirectConsoleToStderr, restoreConsole } = require('../../../plugins/mcp/transports/stdio');
const { createMcpAuthMiddleware, isLocalhost } = require('../../../plugins/mcp/auth');

describe('MCP Transports & Security', () => {
  describe('Stdio Transport', () => {
    it('should process JSON-RPC requests from input stream and write responses to output stream', async () => {
      const server = new McpServer();
      server.registerTool({
        name: 'greet',
        handler: async ({ name }) => `Hello, ${name}!`,
      });

      const input = new PassThrough();
      const output = new PassThrough();

      const transport = startStdioTransport(server, {
        input,
        output,
        redirectStderr: false,
      });

      let outputData = '';
      output.on('data', (chunk) => {
        outputData += chunk.toString();
      });

      // Send initialize
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }) + '\n'
      );

      // Wait a tick
      await new Promise((r) => setTimeout(r, 50));

      const lines = outputData.trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0].id).toBe(1);
      expect(lines[0].result.serverInfo.name).toBe('webspresso-mcp');

      // Send tool call
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'greet', arguments: { name: 'World' } },
        }) + '\n'
      );

      await new Promise((r) => setTimeout(r, 50));

      const allLines = outputData.trim().split('\n').map((l) => JSON.parse(l));
      expect(allLines).toHaveLength(2);
      expect(allLines[1].id).toBe(2);
      expect(allLines[1].result.content[0].text).toBe('Hello, World!');

      transport.close();
    });

    it('should redirect console.log to process.stderr when enabled', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});

      redirectConsoleToStderr();
      console.log('App log message', { id: 123 });

      expect(stderrSpy).toHaveBeenCalled();
      const callArg = stderrSpy.mock.calls[0][0];
      expect(callArg).toContain('App log message');

      restoreConsole();
      stderrSpy.mockRestore();
    });
  });

  describe('Auth Middleware', () => {
    it('should detect localhost IPs correctly', () => {
      expect(isLocalhost({ ip: '127.0.0.1' })).toBe(true);
      expect(isLocalhost({ ip: '::1' })).toBe(true);
      expect(isLocalhost({ ip: '::ffff:127.0.0.1' })).toBe(true);
      expect(isLocalhost({ hostname: 'localhost' })).toBe(true);
      expect(isLocalhost({ ip: '192.168.1.50' })).toBe(false);
      expect(isLocalhost({ ip: '85.105.20.1' })).toBe(false);
    });

    it('should reject requests without valid Bearer token', async () => {
      const middleware = createMcpAuthMiddleware({ token: 'secret-key-123' });

      let statusCalled = null;
      let jsonCalled = null;
      const res = {
        status: (code) => {
          statusCalled = code;
          return {
            json: (payload) => {
              jsonCalled = payload;
            },
          };
        },
      };

      const reqUnauthorized = { headers: {}, query: {} };
      let nextCalled = false;
      await middleware(reqUnauthorized, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(statusCalled).toBe(401);
      expect(jsonCalled.error.message).toContain('Unauthorized');
    });

    it('should accept requests with valid Bearer token in header or query', async () => {
      const middleware = createMcpAuthMiddleware({ token: 'secret-key-123' });

      let next1 = false;
      await middleware(
        { headers: { authorization: 'Bearer secret-key-123' }, query: {} },
        {},
        () => {
          next1 = true;
        }
      );
      expect(next1).toBe(true);

      let next2 = false;
      await middleware(
        { headers: {}, query: { token: 'secret-key-123' } },
        {},
        () => {
          next2 = true;
        }
      );
      expect(next2).toBe(true);
    });

    it('should enforce localhostOnly restriction', async () => {
      const middleware = createMcpAuthMiddleware({ localhostOnly: true });

      let status = null;
      const res = {
        status: (code) => {
          status = code;
          return { json: () => {} };
        },
      };

      let next = false;
      await middleware({ ip: '203.0.113.195' }, res, () => {
        next = true;
      });

      expect(next).toBe(false);
      expect(status).toBe(403);
    });
  });

  describe('SSE Transport Session Lifecycle', () => {
    it('should register session and clean it up when request closes', () => {
      const { EventEmitter } = require('events');
      const { mountSseTransport } = require('../../../plugins/mcp/transports/sse');
      const server = new McpServer();
      const routes = {};
      const app = {
        get: (path, handler) => { routes[path] = handler; },
        post: (path, handler) => { routes[path] = handler; },
      };

      const { sessions } = mountSseTransport({ app, server, path: '/_mcp' });
      expect(routes['/_mcp/sse']).toBeDefined();

      const req = new EventEmitter();
      const res = new EventEmitter();
      res.writeHead = () => {};
      res.write = () => true;

      routes['/_mcp/sse'](req, res);
      expect(sessions.size).toBe(1);
      const sessionId = Array.from(sessions.keys())[0];

      // Client disconnect
      req.emit('close');
      expect(sessions.size).toBe(0);
      expect(sessions.has(sessionId)).toBe(false);
    });

    it('should clean up session when response closes or finishes', () => {
      const { EventEmitter } = require('events');
      const { mountSseTransport } = require('../../../plugins/mcp/transports/sse');
      const server = new McpServer();
      const routes = {};
      const app = {
        get: (path, handler) => { routes[path] = handler; },
        post: (path, handler) => { routes[path] = handler; },
      };

      const { sessions } = mountSseTransport({ app, server, path: '/_mcp' });

      const req = new EventEmitter();
      const res = new EventEmitter();
      res.writeHead = () => {};
      res.write = () => true;

      routes['/_mcp/sse'](req, res);
      expect(sessions.size).toBe(1);

      // Response close
      res.emit('close');
      expect(sessions.size).toBe(0);
    });

    it('should clean up session if send fails due to broken connection', () => {
      const { EventEmitter } = require('events');
      const { mountSseTransport } = require('../../../plugins/mcp/transports/sse');
      const server = new McpServer();
      const routes = {};
      const app = {
        get: (path, handler) => { routes[path] = handler; },
        post: (path, handler) => { routes[path] = handler; },
      };

      const { sessions } = mountSseTransport({ app, server, path: '/_mcp' });

      const req = new EventEmitter();
      const res = new EventEmitter();
      res.writeHead = () => {};
      res.write = () => true;

      routes['/_mcp/sse'](req, res);
      expect(sessions.size).toBe(1);
      const session = Array.from(sessions.values())[0];

      // Make res.write throw on write (broken pipe)
      res.write = () => { throw new Error('EPIPE: Broken pipe'); };
      session.send({ jsonrpc: '2.0', id: 1, result: {} });

      expect(sessions.size).toBe(0);
    });
  });
});
