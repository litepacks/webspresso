import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nunjucks from 'nunjucks';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  getPluginManager,
  createPluginManager,
  resetPluginManager,
} = require('../../../core/plugins/plugin-manager');
const {
  defineFragment,
  attachSsrFragmentHelper,
  resolvePendingSsrFragments,
  createFragmentRefreshHandler,
} = require('../../../core/client/server-fragments');
const {
  discoverClientControllers,
  findPageEntryPoints,
} = require('../../../src/bundle/index');

function createMulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Plugin Architecture Stress Lab', () => {
  let tmpDir;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    resetPluginManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-plugin-stress-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    resetPluginManager();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. resolves a 60-plugin multi-level DAG with diamond deps, routes, lifecycle hooks, and reverse-order disposal', async () => {
    const pm = createPluginManager();
    const initOrder = [];
    const disposeOrder = [];
    const mountedRoutes = [];

    const mockApp = {
      get: (p, ...h) => mountedRoutes.push({ method: 'get', path: p, count: h.length }),
      post: (p, ...h) => mountedRoutes.push({ method: 'post', path: p, count: h.length }),
    };

    // Build 60 plugins: layer 0 (0..9), layer 1 (10..29) depend on layer 0, layer 2 (30..59) depend on layer 1 + diamond
    const plugins = [];
    for (let i = 0; i < 60; i++) {
      const deps = {};
      if (i >= 10 && i < 30) {
        deps[`p-${i % 10}`] = '^1.0.0';
      } else if (i >= 30) {
        deps[`p-${10 + (i % 20)}`] = '^1.0.0';
        deps[`p-${(i + 3) % 10}`] = '>=1.0.0';
      }
      plugins.push({
        name: `p-${i}`,
        version: '1.2.0',
        dependencies: deps,
        register(ctx) {
          initOrder.push(i);
          ctx.addRoute('GET', `/_stress/p-${i}`, (_req, res) => res.json({ id: i }));
          ctx.onDispose(() => {
            disposeOrder.push(i);
          });
        },
        api: {
          getId: () => i,
        },
      });
    }

    // Shuffle input order deterministically + inject duplicates and null/invalid entries
    const rng = createMulberry32(4242);
    const shuffled = [...plugins].sort(() => rng() - 0.5);
    shuffled.splice(5, 0, plugins[0], null, undefined, { version: '1.0.0' });

    await pm.register(shuffled, { app: mockApp });

    expect(pm.getPluginNames().length).toBe(60);
    expect(initOrder.length).toBe(60);

    // Verify topological order: every dependency initialized before dependent
    const pos = new Map(initOrder.map((id, idx) => [id, idx]));
    for (let i = 10; i < 30; i++) {
      expect(pos.get(i % 10)).toBeLessThan(pos.get(i));
    }
    for (let i = 30; i < 60; i++) {
      expect(pos.get(10 + (i % 20))).toBeLessThan(pos.get(i));
      expect(pos.get((i + 3) % 10)).toBeLessThan(pos.get(i));
    }

    // Verify all 60 APIs & routes mounted without duplicates even on repeated mountCustomRoutes
    pm.mountCustomRoutes();
    pm.mountCustomRoutes();
    expect(mountedRoutes.length).toBe(60);
    expect(pm.getPluginAPI('p-59').getId()).toBe(59);

    // Verify reverse-order disposal
    await pm.dispose();
    expect(disposeOrder).toEqual(initOrder.slice().reverse());
  });

  it('2. isolates circular dependencies, missing deps, and throwing lifecycle hooks/disposers without breaking healthy plugins', async () => {
    const pm = createPluginManager();
    const healthyEvents = [];

    const plugins = [
      {
        name: 'cycle-a',
        version: '1.0.0',
        dependencies: { 'cycle-b': '*' },
        register() {
          healthyEvents.push('cycle-a');
        },
      },
      {
        name: 'cycle-b',
        version: '1.0.0',
        dependencies: { 'cycle-a': '*' },
        register() {
          healthyEvents.push('cycle-b');
        },
      },
      {
        name: 'broken-register',
        version: '1.0.0',
        register() {
          throw new Error('boom register');
        },
        onRoutesReady() {
          throw new Error('boom routes');
        },
        onReady() {
          throw new Error('boom ready');
        },
      },
      {
        name: 'healthy-one',
        version: '1.0.0',
        register(ctx) {
          healthyEvents.push('healthy-register');
          ctx.onDispose(() => {
            throw new Error('disposer boom');
          });
          ctx.onDispose(() => {
            healthyEvents.push('healthy-disposer-2');
          });
        },
        api: { ok: () => true },
        onRoutesReady() {
          healthyEvents.push('healthy-routes');
        },
        onReady() {
          healthyEvents.push('healthy-ready');
        },
      },
    ];

    await pm.register(plugins, {});
    await pm.onRoutesReady({ routes: [] });
    await pm.onReady({});

    expect(pm.getPluginAPI('healthy-one').ok()).toBe(true);
    expect(healthyEvents).toContain('healthy-register');
    expect(healthyEvents).toContain('healthy-routes');
    expect(healthyEvents).toContain('healthy-ready');

    await pm.dispose();
    expect(healthyEvents).toContain('healthy-disposer-2');
  });

  it('3. handles concurrent lazy hydration, async onRoutesReadySync tracking in whenReady(), and hanging disposers', async () => {
    const pm = createPluginManager();
    let hydrateCount = 0;

    pm.plugins.set('lazy-heavy', {
      name: 'lazy-heavy',
      isLazy: true,
      isHydrated: false,
      hydrate() {
        hydrateCount += 1;
        this.isHydrated = true;
        return { api: { value: () => 99 } };
      },
    });

    // Simulate 20 concurrent API lookups
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(pm.getPluginAPI('lazy-heavy').value()))
    );
    expect(results.every((v) => v === 99)).toBe(true);
    expect(hydrateCount).toBe(1);

    // Async onRoutesReadySync tracked by whenReady()
    let asyncDone = false;
    pm.plugins.set('async-routes-plugin', {
      name: 'async-routes-plugin',
      onRoutesReady() {
        return new Promise((resolve) => {
          setTimeout(() => {
            asyncDone = true;
            resolve();
          }, 15);
        });
      },
    });

    pm.onRoutesReadySync({});
    await pm.whenReady();
    expect(asyncDone).toBe(true);

    // Hanging disposer should not block dispose forever
    let normalDisposed = false;
    pm.registerDisposer('normal', () => {
      normalDisposed = true;
    });
    pm.registerDisposer('hanging', () => new Promise(() => {}));

    await pm.dispose({ timeoutMs: 25 });
    expect(normalDisposed).toBe(true);
  });

  it('4. stress-tests CSP aggregation, static helper cache invalidation, and request-scoped helpers across 30 plugins', async () => {
    const pm = createPluginManager();
    const plugins = Array.from({ length: 30 }, (_, i) => ({
      name: `helper-plugin-${i}`,
      version: '1.0.0',
      csp: {
        scriptSrc: ["'self'", `https://cdn-${i % 5}.example.com`],
        connectSrc: [`wss://ws-${i % 3}.example.com`],
      },
      register(ctx) {
        ctx.addHelper(`h_${i}`, () => i);
        ctx.addRequestHelper((req) => ({ [`req_${i}`]: `${req.id}:${i}` }));
      },
    }));

    await pm.register(plugins, {});

    const csp = pm.getCspDirectives();
    expect(csp.scriptSrc.length).toBe(6); // 'self' + 5 unique CDNs
    expect(csp.connectSrc.length).toBe(3);

    const staticA = pm.getHelpers();
    const staticB = pm.getHelpers();
    expect(staticA).toBe(staticB); // Cached reference when unchanged
    expect(staticA.h_29()).toBe(29);

    pm.addHelper('h_extra', () => 'extra', 'manual');
    const staticC = pm.getHelpers();
    expect(staticC).not.toBe(staticA);
    expect(staticC.h_extra()).toBe('extra');

    const reqHelpers = pm.getRequestHelpers({ id: 'r1' });
    expect(reqHelpers.req_0).toBe('r1:0');
    expect(reqHelpers.req_29).toBe('r1:29');
    expect(staticC.h_15()).toBe(15);
  });

  it('5. stress-tests 25 plugins registering client controllers, services, and fragments with concurrent /__webspresso/fragments refresh', async () => {
    const pm = getPluginManager();
    fs.writeFileSync(path.join(tmpDir, 'item.njk'), '<span data-id="{{ id }}">Item {{ id }}:{{ val }}</span>');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(tmpDir));

    const plugins = Array.from({ length: 25 }, (_, i) => {
      const ctrlFile = path.join(tmpDir, `plugin-${i}.client.js`);
      const svcFile = path.join(tmpDir, `plugin-${i}.service.js`);
      fs.writeFileSync(ctrlFile, `export default { id: ${i} };`);
      fs.writeFileSync(svcFile, `export default { svc: ${i} };`);
      return {
        name: `client-plugin-${i}`,
        version: '1.0.0',
        register(ctx) {
          ctx.registerClientController(`pctrl-${i}`, ctrlFile);
          ctx.registerClientService(`psvc-${i}`, svcFile);
          ctx.registerFragment(
            `pfrag-${i}`,
            defineFragment({
              template: 'item.njk',
              dependsOn: [`tag-${i % 4}`],
              async load({ input }) {
                return { id: i, val: input.val || 'init' };
              },
            })
          );
        },
      };
    });

    await pm.register(plugins, {});

    const manifest = pm.getClientManifest();
    expect(manifest.controllers.length).toBe(25);
    expect(manifest.services.length).toBe(25);
    expect(manifest.fragments.length).toBe(25);

    const entryPoints = findPageEntryPoints(tmpDir);
    expect(Object.keys(entryPoints).length).toBe(50);
    const discovered = discoverClientControllers(tmpDir);
    expect(discovered.length).toBe(25);

    // Concurrent SSR + refresh batch across 10 plugin fragments + 1 page override
    const pageMod = {
      fragments: {
        'pfrag-0': defineFragment({
          template: 'item.njk',
          async load({ input }) {
            return { id: 0, val: `override:${input.val || 'ok'}` };
          },
        }),
      },
    };

    const req = { params: {}, query: {}, body: {}, headers: {} };
    const fsy = {};
    attachSsrFragmentHelper({
      req,
      res: { locals: {} },
      ctx: {},
      pageMod,
      pagePath: '/stress',
      nunjucksEnv: env,
      fsy,
    });

    const htmlTokens = [0, 5, 12, 24].map((i) => fsy.fragment(`pfrag-${i}`, { val: 'ssr' })).join('');
    const ssrHtml = await resolvePendingSsrFragments(htmlTokens, req);
    expect(ssrHtml).toContain('Item 0:override:ssr');
    expect(ssrHtml).toContain('Item 24:ssr');

    const handler = createFragmentRefreshHandler({
      getPageEntries: () => [{ routePath: '/stress', pageMod }],
      nunjucksEnv: env,
      buildFsy: () => ({}),
      buildContext: (r, s, extra) => ({ req: r, res: s, ...extra }),
    });

    const batchTargets = Array.from({ length: 10 }, (_, i) => ({
      instanceId: `pfrag-${i}:default`,
      name: `pfrag-${i}`,
      input: { val: `batch-${i}` },
    }));

    let payload = null;
    await handler(
      { method: 'POST', headers: {}, body: { pagePath: '/stress', fragments: batchTargets } },
      { setHeader() {}, status() { return this; }, json(d) { payload = d; return this; } },
      (e) => { if (e) throw e; }
    );

    expect(payload.ok).toBe(true);
    expect(Object.keys(payload.fragments).length).toBe(10);
    expect(payload.fragments['pfrag-0:default'].html).toContain('override:batch-0');
    expect(payload.fragments['pfrag-9:default'].html).toContain('Item 9:batch-9');
  });

  it('6. preserves all invariants across a 40-step seeded PRNG plugin lifecycle fuzz sequence', async () => {
    const rng = createMulberry32(20261113);
    let pm = createPluginManager();
    let seq = 0;

    for (let step = 0; step < 40; step++) {
      const op = Math.floor(rng() * 6);
      if (op === 0) {
        const id = seq++;
        await pm.register(
          [
            {
              name: `fuzz-${id}`,
              version: '1.0.0',
              register(ctx) {
                ctx.addHelper(`fuzzH_${id}`, () => id);
                ctx.registerClientController(`fuzzC_${id}`, `/fuzz/${id}.client.js`);
                ctx.registerClientService(`fuzzS_${id}`, `/fuzz/${id}.service.js`);
                ctx.registerFragment(`fuzzF_${id}`, { template: 'x.njk', load: async () => ({}) });
              },
              api: { id: () => id },
            },
          ],
          {}
        );
        expect(pm.getPluginAPI(`fuzz-${id}`).id()).toBe(id);
      } else if (op === 1) {
        const helpers = pm.getHelpers();
        expect(typeof helpers).toBe('object');
      } else if (op === 2) {
        const manifest = pm.getClientManifest();
        expect(manifest.controllers.length).toBe(manifest.services.length);
        expect(manifest.fragments.length).toBe(manifest.controllers.length);
      } else if (op === 3) {
        await pm.whenReady();
      } else if (op === 4) {
        pm.mountCustomRoutes();
      } else if (op === 5 && step > 10) {
        await pm.dispose();
        pm = createPluginManager();
      }
    }

    await pm.dispose();
  });
});
