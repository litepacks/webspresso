/**
 * Unit Tests for Queue Plugin (plugins/queue/index.js)
 */

const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const queuePlugin = require('../../../plugins/queue');

describe('Queue Plugin Express Integration', () => {
  let app;
  let plugin;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    plugin = queuePlugin({
      adapter: 'memory',
      concurrency: 2,
      pollInterval: 20,
      autoStart: true,
    });

    const ctx = {
      app,
      addRoute: (method, routePath, ...handlers) => {
        app[method.toLowerCase()](routePath, ...handlers);
      },
    };

    plugin.register(ctx);
    plugin.onRoutesReady(ctx);

    app.get('/dispatch-test', async (req, res) => {
      req.queue.define('http.job', async (job) => {
        return { greeted: job.data.user };
      });

      const job = await req.queue.dispatch('http.job', { user: 'Alice' });
      res.json({ id: job.id, status: job.status });
    });
  });

  afterAll(async () => {
    if (plugin) {
      await plugin.dispose();
    }
  });

  it('attaches req.queue middleware and dispatches jobs from express routes', async () => {
    const res = await request(app)
      .get('/dispatch-test')
      .expect(200);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');
  });

  it('exposes queue instance on app.queue and plugin.queue', () => {
    expect(app.queue).toBeDefined();
    expect(plugin.queue).toBeDefined();
    expect(typeof plugin.queue.define).toBe('function');
    expect(typeof plugin.queue.dispatch).toBe('function');
  });
});
