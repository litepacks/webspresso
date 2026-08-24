const request = require('supertest');
const express = require('express');
const corsPlugin = require('../../plugins/cors');

describe('Security: CORS Plugin Security', () => {
  it('should not allow wildcard origin * when credentials is true', async () => {
    const app = express();
    const plugin = corsPlugin({
      origin: '*',
      credentials: true,
    });

    const ctx = {
      app,
      addMiddleware: (fn) => app.use(fn),
    };
    plugin.register(ctx);

    app.get('/api/data', (req, res) => res.json({ secret: 'data' }));

    const res = await request(app)
      .get('/api/data')
      .set('Origin', 'https://attacker.com')
      .expect(200);

    // Access-Control-Allow-Origin must NOT be * or attacker.com when wildcard + credentials are configured
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('should reject null origin', async () => {
    const app = express();
    const plugin = corsPlugin({
      origin: 'https://example.com',
      credentials: true,
    });

    plugin.register({ app, addMiddleware: (fn) => app.use(fn) });
    app.get('/api/data', (req, res) => res.json({ secret: 'data' }));

    const res = await request(app)
      .get('/api/data')
      .set('Origin', 'null')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should safely allow specific matched origins and set Vary: Origin', async () => {
    const app = express();
    const plugin = corsPlugin({
      origin: ['https://trusted.com', 'https://app.trusted.com'],
      credentials: true,
    });

    plugin.register({ app, addMiddleware: (fn) => app.use(fn) });
    app.get('/api/data', (req, res) => res.json({ secret: 'data' }));

    const resTrusted = await request(app)
      .get('/api/data')
      .set('Origin', 'https://trusted.com')
      .expect(200);

    expect(resTrusted.headers['access-control-allow-origin']).toBe('https://trusted.com');
    expect(resTrusted.headers['access-control-allow-credentials']).toBe('true');
    expect(resTrusted.headers['vary']).toContain('Origin');

    const resUntrusted = await request(app)
      .get('/api/data')
      .set('Origin', 'https://evil.com')
      .expect(200);

    expect(resUntrusted.headers['access-control-allow-origin']).toBeUndefined();
  });
});
