import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { createApp } from '../../../src/server';

describe('Dev Mode On-Demand (Lazy) Route Evaluation', () => {
  const tempDir = path.join(__dirname, '../../fixtures/temp-lazy-routes-' + Date.now());
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });
  });

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should not eagerly require API route files until the first request in dev mode', async () => {
    const apiFilePath = path.join(tempDir, 'pages', 'api', 'lazy-test.get.js');
    let loadedCount = 0;

    // Create route file that tracks when it gets evaluated/required
    fs.writeFileSync(
      apiFilePath,
      `
      global.__lazyRouteLoads = (global.__lazyRouteLoads || 0) + 1;
      module.exports = {
        handler: async (req, res) => {
          res.json({ message: 'lazy evaluated', loads: global.__lazyRouteLoads });
        }
      };
      `
    );

    global.__lazyRouteLoads = 0;

    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      logging: false,
    });

    // Verify route was registered in the router without being executed/required yet
    expect(app.fastPathStaticByMethod.GET.has('/api/lazy-test')).toBe(true);
    expect(global.__lazyRouteLoads).toBe(0);

    // Make the first request -> triggers JIT / on-demand require
    const res1 = await request(app).get('/api/lazy-test');
    expect(res1.status).toBe(200);
    expect(res1.body.message).toBe('lazy evaluated');
    expect(global.__lazyRouteLoads).toBe(1);

    delete global.__lazyRouteLoads;
  });

  it('should not eagerly require SSR companion configs until first request in dev mode', async () => {
    const ssrConfigPath = path.join(tempDir, 'pages', 'dashboard.js');
    const ssrNjkPath = path.join(tempDir, 'pages', 'dashboard.njk');

    fs.writeFileSync(ssrNjkPath, '<h1>{{ greeting }}</h1>');
    fs.writeFileSync(
      ssrConfigPath,
      `
      global.__lazyCompanionLoads = (global.__lazyCompanionLoads || 0) + 1;
      module.exports = {
        load: async () => ({ greeting: 'Hello Lazy' })
      };
      `
    );

    global.__lazyCompanionLoads = 0;

    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      logging: false,
    });

    // Companion config should NOT be required at mount time in dev mode
    expect(global.__lazyCompanionLoads).toBe(0);

    // First request triggers on-demand loading of companion config
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello Lazy');
    expect(global.__lazyCompanionLoads).toBeGreaterThanOrEqual(1);

    delete global.__lazyCompanionLoads;
  });

  it('should memoize and preserve stateful middlewares across requests in dev mode', async () => {
    const apiFilePath = path.join(tempDir, 'pages', 'api', 'stateful-mw.get.js');
    
    // Create an API route with a custom stateful middleware tuple/factory
    fs.writeFileSync(
      apiFilePath,
      `
      module.exports = {
        middleware: [
          ['counterLimiter', { max: 2 }]
        ],
        handler: async (req, res) => {
          res.json({ ok: true });
        }
      };
      `
    );

    let factoryCallCount = 0;
    const middlewares = {
      counterLimiter: ({ max }) => {
        factoryCallCount++;
        let count = 0;
        return (req, res, next) => {
          count++;
          if (count > max) {
            return res.status(429).json({ error: 'Too Many Requests', count });
          }
          next();
        };
      }
    };

    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      middlewares,
      logging: false,
    });

    // Factory should NOT be called at boot time (lazy evaluation)
    expect(factoryCallCount).toBe(0);

    // Request 1: initializes middleware
    const res1 = await request(app).get('/api/stateful-mw');
    expect(res1.status).toBe(200);
    expect(factoryCallCount).toBe(1);

    // Request 2: reuses memoized middleware
    const res2 = await request(app).get('/api/stateful-mw');
    expect(res2.status).toBe(200);
    expect(factoryCallCount).toBe(1);

    // Request 3: exceeds max -> 429
    const res3 = await request(app).get('/api/stateful-mw');
    expect(res3.status).toBe(429);
    expect(res3.body.count).toBe(3);
    expect(factoryCallCount).toBe(1);
  });
});
