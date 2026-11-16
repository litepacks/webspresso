'use strict';

import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import http from 'http';
import express from 'express';

const { executePagePipeline } = require('../../core/http/pipeline');
const { ConfigurationError } = require('../../core/errors');
const { createApp } = require('../../src/server');
const { generateManifest } = require('../../src/bundle/manifest');
const { AssetManager } = require('../../src/helpers');
const { QueryBuilder } = require('../../core/orm/query-builder');
const { QueueManager } = require('../../core/queue/manager');
const { useDb, useService } = require('../../core/context');
const { createDevReloadHub } = require('../../src/dev-reload');
const { createTimeoutMiddleware } = require('../../core/utils/timeout');
const { lazyPlugin } = require('../../plugins/lazy');

function requestApp(app, reqPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
    });
  });
}

describe('Webspresso 17-item report regressions', () => {
  it('1. executePagePipeline throws ConfigurationError when defineApi handler is outside pages/api/', async () => {
    const req = { method: 'GET', path: '/s/demo', headers: {}, params: {}, query: {} };
    const res = {
      headersSent: false,
      writableEnded: false,
      finished: false,
      setHeader: vi.fn(),
      json: vi.fn(),
      send: vi.fn(),
    };

    await expect(
      executePagePipeline({
        descriptor: { path: '/s/:slug', source: 'pages/s/[slug]/index.get.js' },
        context: {},
        pageDef: { handler: async () => ({ ok: true }) },
        middlewares: [],
        req,
        res,
        hasNjkTemplate: false,
      })
    ).rejects.toThrow(ConfigurationError);
  });

  it('4. createApp merges top-level contentSecurityPolicy directives without dropping defaults', async () => {
    const app = createApp({
      pagesDir: path.resolve(__dirname, '../../tests/fixtures/empty-pages'),
      isDev: false,
      logging: false,
      contentSecurityPolicy: {
        directives: {
          frameSrc: ["'self'", 'https://publish.example.com'],
        },
      },
    });
    app.get('/csp-check', (req, res) => res.send('ok'));

    const res = await requestApp(app, '/csp-check');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain("frame-src 'self' https://publish.example.com");
    expect(csp).toContain("default-src 'self'");
  });

  it('6. generateManifest and AssetManager normalize public/ prefix to /dist/', () => {
    const manifest = generateManifest(
      {
        outputs: {
          'public/dist/main-abc123.js': {
            entryPoint: 'src/client/main.ts',
            bytes: 1200,
          },
        },
      },
      { publicDir: '/abs/other/public', outdir: '/abs/other/public/dist' }
    );
    expect(manifest['src/client/main.ts'].file).toBe('dist/main-abc123.js');

    const manager = new AssetManager({ publicDir: path.join(process.cwd(), 'public') });
    manager.manifest = { 'main.js': { file: 'public/dist/main-xyz.js' } };
    expect(manager.resolve('main.js')).toBe('/dist/main-xyz.js');
  });

  it('9. QueryBuilder converts null values in where() and whereNot() to IS NULL / IS NOT NULL', () => {
    const qb = new QueryBuilder({ name: 'Project', tableName: 'projects' }, null);
    qb.where({ deleted_at: null, status: 'active' }).whereNot({ published_at: null });

    expect(qb.state.wheres).toEqual([
      { column: 'deleted_at', operator: 'is null', value: null, boolean: 'and' },
      { column: 'status', operator: '=', value: 'active', boolean: 'and' },
      { column: 'published_at', operator: 'is not null', value: null, boolean: 'and' },
    ]);
  });

  it('10. QueueManager injects db, service, and ambient context into job workers', async () => {
    const fakeDb = { tag: 'sqlite-db' };
    const fakeRegistry = {
      call: vi.fn(async (name, input, ctx) => ({ name, input, hasDb: ctx.db === fakeDb })),
    };

    const queue = new QueueManager({ autoStart: false, pollInterval: 50 });
    queue.setContext({ db: fakeDb, serviceRegistry: fakeRegistry });

    let captured = null;
    queue.define('project.sync', async (job, ctx) => {
      const ambientDb = useDb();
      const svcResult = await useService('sync.run', { id: job.data.id });
      const directResult = await ctx.service('sync.direct', { id: job.data.id });
      captured = {
        ctxHasDb: ctx.db === fakeDb,
        ambientHasDb: ambientDb === fakeDb,
        svcResult,
        directResult,
      };
      return captured;
    });

    const job = await queue.dispatch('project.sync', { id: 42 });
    await queue._executeJob(job);

    expect(captured).toEqual({
      ctxHasDb: true,
      ambientHasDb: true,
      svcResult: { name: 'sync.run', input: { id: 42 }, hasDb: true },
      directResult: { name: 'sync.direct', input: { id: 42 }, hasDb: true },
    });
  });

  it('12. devReload autoInjectMiddleware omits inline meta script and skips /api/ and sandboxed responses', async () => {
    const app = express();
    const hub = createDevReloadHub({
      app,
      enabled: true,
      watchDirs: [],
      autoInject: true,
      rootDir: process.cwd(),
    });

    app.get('/page', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send('<html><body><h1>Hello</h1></body></html>');
    });
    app.get('/api/sandbox/s/demo/index.html', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send('<html><body><h1>Sandbox</h1></body></html>');
    });
    app.get('/sandboxed-page', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; sandbox allow-scripts");
      res.send('<html><body><h1>CSP Sandbox</h1></body></html>');
    });

    try {
      const pageRes = await requestApp(app, '/page');
      expect(pageRes.body).toContain('/__webspresso/dev-reload.js');
      expect(pageRes.body).not.toContain('window.__WEBSPRESSO_DEV_META__');

      const apiRes = await requestApp(app, '/api/sandbox/s/demo/index.html');
      expect(apiRes.body).not.toContain('/__webspresso/dev-reload.js');

      const sandboxRes = await requestApp(app, '/sandboxed-page');
      expect(sandboxRes.body).not.toContain('/__webspresso/dev-reload.js');
    } finally {
      if (hub && typeof hub.close === 'function') hub.close();
    }
  });

  it('15. createTimeoutMiddleware guards late async writes after timeout response is sent', async () => {
    const app = express();
    app.use(createTimeoutMiddleware(30));

    let lateError = null;
    app.get('/slow', async (req, res) => {
      await new Promise((r) => setTimeout(r, 90));
      try {
        res.setHeader('X-Late', '1');
        res.status(200).send('late-ok');
      } catch (err) {
        lateError = err;
      }
    });

    app.use((err, req, res, next) => {
      if (!res.headersSent) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    });

    const res = await requestApp(app, '/slow');
    expect(res.status).toBe(503);
    await new Promise((r) => setTimeout(r, 100));
    expect(lateError).toBeNull();
  });

  it('17. lazyPlugin proxies app.get/app.use into its lazy router so /_admin does not 404', async () => {
    const app = express();
    const lazyAdmin = lazyPlugin(
      () => ({
        name: 'mock-admin',
        onRoutesReady(ctx) {
          ctx.app.get('/_admin', (req, res) => res.status(200).send('admin-home'));
          ctx.app.get('/_admin/api/ping', (req, res) => res.status(200).json({ pong: true }));
        },
      }),
      { name: 'mock-admin', prefix: '/_admin' }
    );

    const routesCtx = { app };
    lazyAdmin.register({ app });
    lazyAdmin.onRoutesReady(routesCtx);

    // Mount 404 catch-all AFTER lazyPlugin.onRoutesReady, just like src/server.js
    app.use((req, res) => res.status(404).send('Not Found'));

    const homeRes = await requestApp(app, '/_admin');
    expect(homeRes.status).toBe(200);
    expect(homeRes.body).toBe('admin-home');

    const pingRes = await requestApp(app, '/_admin/api/ping');
    expect(pingRes.status).toBe(200);
    expect(JSON.parse(pingRes.body)).toEqual({ pong: true });
  });
});
