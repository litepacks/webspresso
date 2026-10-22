const http = require('http');
const {
  startTestServer,
  closeServer,
  fetchJson,
  fetchText,
  withTestServer,
} = require('../utils/server');

describe('Test Utilities - Server Lifecycle & Ephemeral Port (Step 5)', () => {
  it('starts an isolated HTTP server on an ephemeral port with request helpers', async () => {
    const handler = (req, res) => {
      if (req.url === '/api/ping') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ pong: true, query: req.url }));
        return;
      }
      res.end('Hello Text');
    };

    const serverCtx = await startTestServer(handler);
    try {
      expect(serverCtx.port).toBeGreaterThan(0);
      expect(serverCtx.baseURL).toBe(`http://127.0.0.1:${serverCtx.port}`);
      expect(serverCtx.url('api/ping')).toBe(`http://127.0.0.1:${serverCtx.port}/api/ping`);

      const jsonRes = await serverCtx.fetchJson('/api/ping');
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.ok).toBe(true);
      expect(jsonRes.data).toEqual({ pong: true, query: '/api/ping' });

      const textRes = await serverCtx.fetchText('/hello');
      expect(textRes.status).toBe(200);
      expect(textRes.text).toBe('Hello Text');
    } finally {
      await serverCtx.close();
      expect(serverCtx.server.listening).toBe(false);
    }
  });

  it('serializes request body automatically in fetchJson', async () => {
    let receivedBody = null;
    const handler = (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ echo: receivedBody }));
      });
    };

    await withTestServer(handler, async ({ fetchJson }) => {
      const res = await fetchJson('/api/echo', {
        method: 'POST',
        body: { name: 'Webspresso', count: 123 },
      });

      expect(res.status).toBe(200);
      expect(res.data.echo).toEqual({ name: 'Webspresso', count: 123 });
      expect(receivedBody).toEqual({ name: 'Webspresso', count: 123 });
    });
  });

  it('guarantees server cleanup with withTestServer even on failure', async () => {
    let capturedServer;

    await expect(
      withTestServer(
        (req, res) => res.end('ok'),
        async (ctx) => {
          capturedServer = ctx.server;
          expect(capturedServer.listening).toBe(true);
          throw new Error('intentional_server_error');
        }
      )
    ).rejects.toThrow('intentional_server_error');

    expect(capturedServer.listening).toBe(false);
  });

  it('safely handles closeServer on null or non-listening server', async () => {
    await expect(closeServer(null)).resolves.toBeUndefined();

    const dummy = http.createServer();
    await expect(closeServer(dummy)).resolves.toBeUndefined();
  });
});
