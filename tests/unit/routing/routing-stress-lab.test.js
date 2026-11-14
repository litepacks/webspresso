'use strict';

/**
 * Webspresso - Routing Stress Lab
 * Stress-tests 500-route deterministic compilation & conflict detection, middleware resolver
 * factories/tuples, 6-level cascading hooks/layouts/error-boundaries, and static/dynamic mounting.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const express = require('express');
const {
  compileRouteTable,
  getRouteSortMeta,
} = require('../../../src/routing/route-table');
const {
  resolveMiddlewares,
  isMiddlewareFactory,
} = require('../../../src/routing/middleware-resolver');
const {
  loadCascadingMiddlewares,
  runMiddlewareChain,
  findCascadingLayouts,
  findNearestErrorBoundary,
  findNearestLoadingTemplate,
  clearCascadingCaches,
} = require('../../../src/routing/cascading');
const { mountDiscoveredRoutes } = require('../../../src/routing/mount-discovered-routes');

function seededShuffle(arr, seed = 42) {
  const copy = [...arr];
  let s = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe('Src Routing Stress Lab (RouteTable, MiddlewareResolver, Cascading, Mount)', () => {
  const tempDirs = [];

  afterEach(() => {
    clearCascadingCaches();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('1. compiles 500 shuffled routes deterministically, respects explicit overrides, and catches conflicts', () => {
    const descriptors = [];
    const methods = ['GET', 'POST', 'PUT', 'DELETE'];

    for (let i = 0; i < 200; i++) {
      descriptors.push({
        method: methods[i % methods.length],
        path: `/api/v1/static-${i}/items`,
        type: 'api',
        source: `pages/api/v1/static-${i}/items.js`,
      });
    }
    for (let i = 0; i < 200; i++) {
      descriptors.push({
        method: methods[i % methods.length],
        path: `/api/v1/res-${i}/:id`,
        type: 'api',
        source: `pages/api/v1/res-${i}/[id].js`,
      });
    }
    for (let i = 0; i < 100; i++) {
      descriptors.push({
        method: 'GET',
        path: `/docs-${i}/*`,
        type: 'page',
        source: `pages/docs-${i}/[...slug].js`,
      });
    }

    const shuffled = seededShuffle(descriptors, 2026);
    const table = compileRouteTable(shuffled, { isDev: false });

    expect(table.size).toBe(500);
    expect(Object.isFrozen(table.routes)).toBe(true);

    // Verify strict tier monotonicity: tier 0 <= tier 1 <= tier 2
    let lastTier = 0;
    for (const r of table.routes) {
      const meta = getRouteSortMeta(r.path);
      expect(meta.tier).toBeGreaterThanOrEqual(lastTier);
      lastTier = meta.tier;
      expect(table.has(r.method, r.path)).toBe(true);
      expect(table.get(r.method, r.path)).toBe(r);
    }

    // Explicit route override skips discovered route cleanly
    const overriddenTable = compileRouteTable(descriptors.slice(0, 10), {
      explicitRoutes: [{ method: 'GET', path: '/api/v1/static-0/items' }],
      isDev: false,
    });
    expect(overriddenTable.size).toBe(9);
    expect(overriddenTable.has('GET', '/api/v1/static-0/items')).toBe(false);

    // Duplicate route conflict throws explicitly
    expect(() =>
      compileRouteTable([
        { method: 'GET', path: '/api/dup', source: 'a.js' },
        { method: 'GET', path: '/api/dup', source: 'b.js' },
      ])
    ).toThrow(/Route conflict detected/);
  });

  it('2. resolves plain handlers, factories, and [name, opts] tuples while guarding invalid configs', () => {
    const plainAuth = (req, _res, next) => { req.authed = true; next(); };
    const roleFactory = (opts = {}) => (req, _res, next) => { req.role = opts.role || 'user'; next(); };

    expect(isMiddlewareFactory(plainAuth)).toBe(false);
    expect(isMiddlewareFactory(roleFactory)).toBe(true);

    const registry = {
      auth: plainAuth,
      role: roleFactory,
      brokenFactory: (_opts) => 'not-a-function',
    };

    for (let i = 0; i < 50; i++) {
      const resolved = resolveMiddlewares(
        ['auth', ['role', { role: `tier-${i}` }], (_req, _res, next) => next()],
        registry
      );
      expect(resolved).toHaveLength(3);
      const fakeReq = {};
      resolved[0](fakeReq, {}, () => {});
      resolved[1](fakeReq, {}, () => {});
      expect(fakeReq.authed).toBe(true);
      expect(fakeReq.role).toBe(`tier-${i}`);
    }

    expect(() => resolveMiddlewares(['missing'], registry)).toThrow(/not found in registry/);
    expect(() => resolveMiddlewares([['auth', { strict: true }]], registry)).toThrow(/must be a factory/);
    expect(() => resolveMiddlewares([['brokenFactory', {}]], registry)).toThrow(/must return an Express middleware/);
    expect(() => resolveMiddlewares([12345], registry)).toThrow(/Invalid middleware/);
  });

  it('3. resolves 6-level cascading hooks, layouts, error boundaries, and loading templates', async () => {
    const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-routing-stress-'));
    tempDirs.push(pagesDir);

    const deepRel = 'org/team/project/sprint/task/detail.njk';
    const deepDir = path.join(pagesDir, 'org/team/project/sprint/task');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(pagesDir, deepRel), '<div>Detail</div>');

    // _middleware.js at root, level 2 (org/team), level 4 (org/team/project/sprint)
    fs.writeFileSync(
      path.join(pagesDir, '_middleware.js'),
      `module.exports = [async (req, _res, next) => { req.trace.push('root'); next(); }];`
    );
    fs.writeFileSync(
      path.join(pagesDir, 'org/team/_middleware.js'),
      `module.exports = ['namedGuard'];`
    );
    fs.writeFileSync(
      path.join(pagesDir, 'org/team/project/sprint/_middleware.js'),
      `module.exports = [async (req, res, next) => {
        req.trace.push('sprint');
        if (req.abortAtSprint) { res.headersSent = true; res.emit('finish'); return; }
        next();
      }];`
    );

    // Layouts, error boundary, loading template
    fs.writeFileSync(path.join(pagesDir, '_layout.njk'), '{{ content }}');
    fs.writeFileSync(path.join(pagesDir, 'org/team/project/_layout.njk'), '<section>{{ content }}</section>');
    fs.writeFileSync(path.join(pagesDir, 'org/team/_error.njk'), '<p>Err</p>');
    fs.writeFileSync(path.join(pagesDir, 'org/team/project/sprint/_loading.njk'), '<p>Loading</p>');

    const mwRegistry = {
      namedGuard: (req, _res, next) => { req.trace.push('team-guard'); next(); },
    };

    const chain = loadCascadingMiddlewares(pagesDir, deepRel, mwRegistry, true);
    expect(chain).toHaveLength(3);

    // Normal full pass
    const req1 = { trace: [] };
    const res1 = Object.assign(new EventEmitter(), { headersSent: false });
    await runMiddlewareChain(chain, req1, res1);
    expect(res1.headersSent).toBe(false);
    expect(req1.trace).toEqual(['root', 'team-guard', 'sprint']);

    // Early short-circuit at sprint hook
    const req2 = { trace: [], abortAtSprint: true };
    const res2 = Object.assign(new EventEmitter(), { headersSent: false });
    await runMiddlewareChain(chain, req2, res2);
    expect(res2.headersSent).toBe(true);
    expect(req2.trace).toEqual(['root', 'team-guard', 'sprint']);

    const layouts = findCascadingLayouts(pagesDir, deepRel, true);
    expect(layouts.length).toBe(2);
    expect(findNearestErrorBoundary(pagesDir, deepRel, true).errorRelPath).toBe('org/team/_error.njk');
    expect(findNearestLoadingTemplate(pagesDir, deepRel, true).loadingRelPath).toBe('org/team/project/sprint/_loading.njk');
  });

  it('4. mounts static routes before dynamic/catch-all routes and serves 60 concurrent requests accurately', async () => {
    const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-mount-stress-'));
    tempDirs.push(pagesDir);

    const apiDir = path.join(pagesDir, 'api');
    fs.mkdirSync(path.join(apiDir, 'users'), { recursive: true });
    fs.mkdirSync(path.join(apiDir, 'files'), { recursive: true });

    const staticFile = path.join(apiDir, 'users', 'me.get.js');
    const paramFile = path.join(apiDir, 'users', '[id].get.js');
    const catchAllFile = path.join(apiDir, 'files', '[...path].get.js');

    fs.writeFileSync(staticFile, `module.exports = { handler: async (_req, res) => res.json({ route: 'static-me' }) };`);
    fs.writeFileSync(paramFile, `module.exports = { handler: async (req, res) => res.json({ route: 'param-user', id: req.params.id }) };`);
    fs.writeFileSync(catchAllFile, `module.exports = { handler: async (req, res) => res.json({ route: 'catch-all', url: req.originalUrl }) };`);

    // Deliberately pass catch-all and param BEFORE static to verify compiler + two-phase mount ordering
    const table = compileRouteTable([
      { method: 'GET', path: '/api/files/*path', type: 'api', file: catchAllFile, source: 'pages/api/files/[...path].get.js' },
      { method: 'GET', path: '/api/users/:id', type: 'api', file: paramFile, source: 'pages/api/users/[id].get.js' },
      { method: 'GET', path: '/api/users/me', type: 'api', file: staticFile, source: 'pages/api/users/me.get.js' },
    ], { isDev: false });

    const app = express();
    const { registerDynamicDiscoveredRoutes } = mountDiscoveredRoutes(app, table, {
      silent: true,
      isDev: false,
      middlewares: {},
    });
    registerDynamicDiscoveredRoutes();

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    const getJson = (urlPath) =>
      new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(body) });
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });

    try {
      const calls = [];
      for (let i = 0; i < 60; i++) {
        if (i % 3 === 0) {
          calls.push(getJson('/api/users/me').then((r) => ({ kind: 'me', r })));
        } else if (i % 3 === 1) {
          calls.push(getJson(`/api/users/${i}`).then((r) => ({ kind: 'id', i, r })));
        } else {
          calls.push(getJson(`/api/files/a/b/${i}.txt`).then((r) => ({ kind: 'file', i, r })));
        }
      }

      const settled = await Promise.all(calls);
      for (const item of settled) {
        expect(item.r.status).toBe(200);
        if (item.kind === 'me') {
          expect(item.r.body.route).toBe('static-me');
        } else if (item.kind === 'id') {
          expect(item.r.body.route).toBe('param-user');
          expect(item.r.body.id).toBe(String(item.i));
        } else {
          expect(item.r.body.route).toBe('catch-all');
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
