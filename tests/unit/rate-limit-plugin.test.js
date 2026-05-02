/**
 * rate-limit plugin
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const { rateLimitPlugin } = require('../../plugins/rate-limit');
const { resolveMiddlewares } = require('../../src/file-router');

const viewsDir = path.join(__dirname, '../fixtures/views');

describe('rateLimitPlugin', () => {
  it('createLimiterOptions uses ipKeyGenerator-backed default keyGenerator', () => {
    const p = rateLimitPlugin({ limit: 10 });
    const opts = p.api.createLimiterOptions();
    expect(typeof opts.keyGenerator).toBe('function');
    expect(opts.ipv6Subnet).toBeUndefined();
    const key = opts.keyGenerator({ ip: '127.0.0.1' }, {});
    expect(key).toBe('127.0.0.1');
  });

  it('createLimiterOptions honours custom keyGenerator and omits ipv6Subnet', () => {
    const p = rateLimitPlugin({
      keyGenerator: () => 'fixed-key',
    });
    const opts = p.api.createLimiterOptions({ limit: 2 });
    expect(opts.keyGenerator()).toBe('fixed-key');
    expect(opts.ipv6Subnet).toBeUndefined();
  });

  it('register adds factory to ctx.middlewares.rateLimit', () => {
    const p = rateLimitPlugin();
    const middlewares = {};
    const app = { use: () => {} };
    p.register({ middlewares, app });
    expect(typeof middlewares.rateLimit).toBe('function');
    const mw = middlewares.rateLimit({});
    expect(typeof mw).toBe('function');
  });

  it('resolveMiddlewares resolves rateLimit tuple with factory', () => {
    const p = rateLimitPlugin();
    const middlewares = {};
    p.register({ middlewares, app: { use() {} } });
    const resolved = resolveMiddlewares(
      [['rateLimit', { limit: 5, windowMs: 60_000 }]],
      middlewares
    );
    expect(resolved).toHaveLength(1);
    expect(typeof resolved[0]).toBe('function');
  });

  it('returns 429 after limit exceeded on API route', async () => {
    const rlPages = path.join(__dirname, '../fixtures/rate-limit-pages');
    const { app } = createApp({
      pagesDir: rlPages,
      viewsDir,
      logging: false,
      plugins: [rateLimitPlugin()],
    });

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/rate-limit-smoke').expect(200);
    }
    await request(app).get('/api/rate-limit-smoke').expect(429);
  });

  it('global mount calls app.use when global: true', () => {
    const uses = [];
    const p = rateLimitPlugin({ global: true, limit: 50 });
    p.register({
      middlewares: {},
      app: { use: (mw) => uses.push(mw) },
    });
    expect(uses.length).toBe(1);
    expect(typeof uses[0]).toBe('function');
  });
});
