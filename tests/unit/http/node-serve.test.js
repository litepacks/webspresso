/**
 * @hono/node-server listen helper
 */

const { Hono } = require('hono');
const { listen } = require('../../../src/http/node-serve');

describe('http/node-serve', () => {
  it('listen binds ephemeral port when port is 0', async () => {
    const app = new Hono();
    app.get('/ping', (c) => c.text('pong'));
    const server = listen(app, 0);
    await new Promise((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : addr;
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(await res.text()).toBe('pong');
    await new Promise((resolve) => server.close(resolve));
  });
});
