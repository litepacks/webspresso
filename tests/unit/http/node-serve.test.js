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
});
