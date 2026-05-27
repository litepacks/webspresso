/**
 * @hono/node-server listen helper
 */

const http = require('http');
const { Hono } = require('hono');
const { listen } = require('../../../src/http/node-serve');

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

describe('http/node-serve', () => {
  it('listen binds ephemeral port when port is 0', async () => {
    const app = new Hono();
    app.get('/ping', (c) => c.text('pong'));
    const server = listen(app, 0);
    await new Promise((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : addr;
    expect(port).toBeGreaterThan(0);
    const body = await httpGetText(`http://127.0.0.1:${port}/ping`);
    expect(body).toBe('pong');
    await new Promise((resolve) => server.close(resolve));
  });

  it('invokes optional listen callback with (null, info)', async () => {
    const app = new Hono();
    app.get('/ping', (c) => c.text('pong'));
    const onListen = vi.fn();
    const server = listen(app, 0, onListen);
    await new Promise((resolve) => server.once('listening', resolve));
    expect(onListen).toHaveBeenCalledTimes(1);
    expect(onListen.mock.calls[0][0]).toBeNull();
    expect(onListen.mock.calls[0][1]).toEqual(expect.objectContaining({ port: expect.any(Number) }));
    await new Promise((resolve) => server.close(resolve));
  });

  it('uses PORT from env when port argument omitted', async () => {
    const prev = process.env.PORT;
    process.env.PORT = '0';
    const app = new Hono();
    app.get('/', (c) => c.text('ok'));
    const server = listen(app);
    await new Promise((resolve) => server.once('listening', resolve));
    const addr = server.address();
    expect(typeof addr === 'object' ? addr.port : addr).toBeGreaterThan(0);
    await new Promise((resolve) => server.close(resolve));
    if (prev === undefined) delete process.env.PORT;
    else process.env.PORT = prev;
  });
});
