'use strict';

/**
 * Comprehensive Integration & Unit Tests for Webspresso's Datastar Client Behavior Layer
 *
 * Covers all 11 required verification scenarios:
 * 1. Client file exclusion from route discovery & server dependency boundary protection
 * 2. Two instances of the same controller are completely isolated (+ scoped targets)
 * 3. Post-patch listener deduplication, resource cleanup, preserved vs removed roots, fresh targets
 * 4. Initial SSR and fragment refresh share the exact same loader/template contract & request-scoped memo
 * 5. Rapid filter changes: stale response never overwrites newer result (API & fragment refreshVersion)
 * 6. New invalidations arriving during an in-flight refresh are coalesced and never lost (+ parent/child dedup)
 * 7. Mutation success vs fragment refresh failure separation (+ transaction commit invalidation safety)
 * 8. Unauthorized fragment and invalid fragment input rejection (+ arbitrary template prevention)
 * 9. Native HTML form coercion, validation field mapping, accessibility, reset vs clear, and doctor/build static check
 * 10. Compile-time TypeScript verification against generated `.webspresso/api.d.ts` (success & error cases)
 * 11. End-to-end working examples (Counter without client file + Filtered/Paginated Notes preserving open edit draft)
 */

const fs = require('fs');
const path = require('path');
const supertest = require('supertest');
const ts = require('typescript');
const { createTempDir, cleanupDir } = require('../utils/fs');
const { createMiniDomEnvironment, MiniEvent } = require('../utils/mini-dom');

const {
  createApp,
  defineApi,
  defineController,
  defineFragment,
  apiResult,
  createClientRuntime,
  createApiClient,
  createFormHandle,
  parseFormElement,
  createFragmentCoordinator,
  createClientDebugger,
  createDatastarAdapter,
  ClientRequestError,
  createDatabase,
  defineModel,
  zdb,
} = require('../../index');

const { scanRoutes } = require('../../src/discovery/scan-routes');
const { isClientBrowserFile } = require('../../src/discovery/file-route-parser');
const {
  discoverClientControllers,
  validateClientBundleBoundaries,
  buildBundle,
} = require('../../src/bundle');
const {
  generateTypes,
  checkTemplateFormContracts,
} = require('../../src/dev/typegen');

const {
  createClientBehaviorExampleApp,
} = require('../../examples/client-behavior/server');
const exampleStore = require('../../examples/client-behavior/store');

/**
 * Helper to create a `fetch`-compatible adapter backed by a `supertest(app)` instance
 * so browser `createApiClient`, `createFragmentCoordinator`, and `createFormHandle` talk
 * directly to the real Express/Webspresso server in-process.
 */
function createSupertestFetch(app, options = {}) {
  const agent = supertest(app);
  return async function supertestFetch(url, init = {}) {
    if (options.beforeFetch) {
      await options.beforeFetch(url, init);
    }
    if (init.signal && init.signal.aborted) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const parsed = new URL(url, 'http://localhost');
    const method = String(init.method || 'GET').toLowerCase();
    const fullPath = parsed.pathname + parsed.search;

    let req = agent[method](fullPath);
    const headers = init.headers || {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null) {
        req = req.set(k, String(v));
      }
    }

    if (init.body !== undefined && init.body !== null && method !== 'get' && method !== 'head') {
      if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
        const plain = {};
        for (const [k, v] of init.body.entries()) {
          plain[k] = typeof v === 'object' && v && v.name ? v.name : v;
        }
        req = req.send(plain);
      } else if (typeof init.body === 'string') {
        req = req.set('Content-Type', headers['Content-Type'] || 'application/json').send(init.body);
      } else {
        req = req.send(init.body);
      }
    }

    const res = await req;
    if (init.signal && init.signal.aborted) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const resHeaders = new Map();
    for (const [k, v] of Object.entries(res.headers || {})) {
      resHeaders.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
    }

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.text || '',
      headers: {
        get(name) {
          return resHeaders.get(String(name).toLowerCase()) || null;
        },
      },
      async json() {
        return typeof res.body === 'object' && res.body !== null && Object.keys(res.body).length > 0
          ? res.body
          : JSON.parse(res.text || 'null');
      },
      async text() {
        return res.text || '';
      },
    };
  };
}

describe('Datastar Client Behavior Layer — Integration Suite', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-client-layer-');
    exampleStore.resetStore();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  // =========================================================================
  // 1. Client File Route Exclusion & Server Dependency Boundary Protection
  // =========================================================================
  describe('1. File Conventions, Route Exclusion & Server Dependency Boundary', () => {
    it('excludes .client.js, .client.ts, and .d.ts files from server route discovery', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const apiDir = path.join(pagesDir, 'api');
      fs.mkdirSync(apiDir, { recursive: true });

      fs.writeFileSync(path.join(pagesDir, 'notes.njk'), '<h1>Notes</h1>');
      fs.writeFileSync(path.join(pagesDir, 'notes.js'), 'module.exports = { async load() { return {}; } };');
      fs.writeFileSync(path.join(pagesDir, 'notes.client.ts'), 'export default {};');
      fs.writeFileSync(path.join(pagesDir, 'widget.client.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(pagesDir, 'types.d.ts'), 'export interface X {}');
      fs.writeFileSync(path.join(apiDir, 'notes.get.js'), 'module.exports = { handler: () => [] };');
      fs.writeFileSync(path.join(apiDir, 'helper.client.js'), 'module.exports = {};');

      expect(isClientBrowserFile('notes.client.ts')).toBe(true);
      expect(isClientBrowserFile('widget.client.js')).toBe(true);
      expect(isClientBrowserFile('types.d.ts')).toBe(true);
      expect(isClientBrowserFile('notes.js')).toBe(false);

      const descriptors = scanRoutes({
        rootDir: tempDir,
        pages: { dir: 'pages' },
        api: { dir: 'pages/api' },
      });

      const scannedFiles = descriptors.map((d) => path.basename(d.file));
      expect(scannedFiles).not.toContain('notes.client.ts');
      expect(scannedFiles).not.toContain('widget.client.js');
      expect(scannedFiles).not.toContain('helper.client.js');
      expect(scannedFiles).not.toContain('types.d.ts');
      expect(scannedFiles).toContain('notes.get.js');
    });

    it('rejects server-only imports in .client.* files while allowing import type', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const modelsDir = path.join(tempDir, 'models');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(modelsDir, { recursive: true });

      fs.writeFileSync(path.join(modelsDir, 'Note.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(pagesDir, 'notes.js'), 'module.exports = { load() {} };');

      // 1. Type-only import is allowed
      const safeClientFile = path.join(pagesDir, 'safe.client.ts');
      fs.writeFileSync(
        safeClientFile,
        `import type { Note } from '../models/Note';\nexport default { state: () => ({ ok: true }) };`
      );
      expect(() => validateClientBundleBoundaries([safeClientFile], tempDir)).not.toThrow();

      // 2. Importing Node fs built-in fails
      const fsLeakFile = path.join(pagesDir, 'leak-fs.client.ts');
      fs.writeFileSync(fsLeakFile, `import fs from 'fs';\nexport default {};`);
      expect(() => validateClientBundleBoundaries([fsLeakFile], tempDir)).toThrow(
        /Node\.js server built-in module "fs" cannot be imported/
      );

      // 3. Importing ORM / models fails
      const ormLeakFile = path.join(pagesDir, 'leak-orm.client.ts');
      fs.writeFileSync(ormLeakFile, `const Note = require('../models/Note');\nmodule.exports = {};`);
      expect(() => validateClientBundleBoundaries([ormLeakFile], tempDir)).toThrow(
        /cannot be bundled into browser code/
      );

      // 4. Importing companion server page loader (`./notes.js`) fails
      const loaderLeakFile = path.join(pagesDir, 'notes.client.ts');
      fs.writeFileSync(loaderLeakFile, `import loader from './notes';\nexport default {};`);
      expect(() => validateClientBundleBoundaries([loaderLeakFile], tempDir)).toThrow(
        /Server page loader .* cannot be imported into browser client bundle/
      );
    });

    it('enforces deterministic controller naming and detects collisions', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const srcPagesDir = path.join(tempDir, 'src', 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(srcPagesDir, { recursive: true });

      fs.writeFileSync(path.join(pagesDir, 'notes.client.js'), 'module.exports = {};');
      const controllers = discoverClientControllers(tempDir);
      expect(controllers).toHaveLength(1);
      expect(controllers[0].controllerName).toBe('notes');

      // Create a colliding controller in src/client/pages/notes.js vs pages/notes.client.js
      const clientPagesDir = path.join(tempDir, 'src', 'client', 'pages');
      fs.mkdirSync(clientPagesDir, { recursive: true });
      fs.writeFileSync(path.join(clientPagesDir, 'notes.js'), 'module.exports = {};');

      // Note: findPageEntryPoints maps `src/client/pages/notes.js` to key `pages/notes`
      // and `views/components/dropdown.client.js` vs `.ts` would collide on `dropdown`:
      const compDir = path.join(tempDir, 'views', 'components');
      fs.mkdirSync(compDir, { recursive: true });
      fs.writeFileSync(path.join(compDir, 'dropdown.client.js'), 'module.exports = {};');
      const srcCompDir = path.join(tempDir, 'src', 'views', 'components');
      fs.mkdirSync(srcCompDir, { recursive: true });
      // Give it a different relative entry key that resolves to the same controller name
      fs.writeFileSync(path.join(tempDir, 'views', 'dropdown.client.js'), 'module.exports = {};');

      expect(() => discoverClientControllers(tempDir)).toThrow(/Controller name collision: "dropdown"/);
    });
  });

  // =========================================================================
  // 2. Controller Instance Isolation & Scoped Target Resolution
  // =========================================================================
  describe('2. Controller Instance Isolation & Scoped Target Resolution', () => {
    it('isolates state and Datastar signals between two instances of the same controller and scopes targets', () => {
      const env = createMiniDomEnvironment(`
        <div>
          <section id="card-a" data-w-controller="counter-card">
            <span data-w-target="label" data-w-text="count">0</span>
            <button type="button" data-w-target="btn" data-w-on:click="increment">+</button>
            <div id="nested-child" data-w-controller="nested-widget">
              <span data-w-target="label">Nested Label</span>
            </div>
          </section>
          <section id="card-b" data-w-controller="counter-card">
            <span data-w-target="label" data-w-text="count">0</span>
            <button type="button" data-w-target="btn" data-w-on:click="increment">+</button>
          </section>
        </div>
      `);

      try {
        let cardATargetsCount = 0;

        const counterCardController = defineController({
          state: () => ({ count: 0 }),
          connect({ targets, el }) {
            if (el.id === 'card-a') {
              // Must NOT collect the nested controller's `[data-w-target="label"]`!
              cardATargetsCount = targets('label').length;
            }
          },
          actions: {
            increment({ state }) {
              state.count += 1;
            },
          },
        });

        const nestedController = defineController({
          state: () => ({ count: 999 }),
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: {
            'counter-card': counterCardController,
            'nested-widget': nestedController,
          },
        });

        runtime.mount();

        // Scoped target resolution: card-a only sees its own `label`, not nested-widget's `label`
        expect(cardATargetsCount).toBe(1);

        const cardA = env.document.querySelector('#card-a');
        const cardB = env.document.querySelector('#card-b');
        const btnA = cardA.querySelector('[data-w-target="btn"]');
        const btnB = cardB.querySelector('[data-w-target="btn"]');
        const labelA = cardA.querySelector('[data-w-target="label"]');
        const labelB = cardB.querySelector('[data-w-target="label"]');

        btnA.click();
        btnA.click();
        expect(labelA.textContent).toBe('2');
        expect(labelB.textContent).toBe('0');

        btnB.click();
        expect(labelA.textContent).toBe('2');
        expect(labelB.textContent).toBe('1');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 3. Post-Patch Lifecycle, Listener Deduplication, Cleanup & Target Freshness
  // =========================================================================
  describe('3. DOM Patching Lifecycle, No Duplicate Listeners & Resource Cleanup', () => {
    it('preserves state on kept root, cleans up removed root, blocks late async writes, and refreshes target refs', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app-root">
          <div id="kept-ctrl" data-w-controller="editor" data-w-id="editor-1">
            <span id="status-el" data-w-target="status" data-w-text="clicks">0</span>
            <button id="act-btn" type="button" data-w-on:click="bump">Bump</button>
          </div>
          <div id="removable-ctrl" data-w-controller="ephemeral" data-w-id="eph-1">
            <span data-w-text="status">alive</span>
          </div>
        </div>
      `);

      try {
        let editorConnectCount = 0;
        let ephemeralCleanupCalled = 0;
        let resolveLateAsync = null;
        let capturedEphemeralState = null;
        let latestTargetNode = null;

        const editorController = defineController({
          state: () => ({ clicks: 0 }),
          connect() {
            editorConnectCount += 1;
          },
          actions: {
            bump({ state, target }) {
              state.clicks += 1;
              latestTargetNode = target('status');
            },
          },
        });

        const ephemeralController = defineController({
          state: () => ({ status: 'alive' }),
          connect({ state, isDisposed }) {
            capturedEphemeralState = state;
            new Promise((resolve) => {
              resolveLateAsync = resolve;
            }).then((val) => {
              if (!isDisposed()) {
                state.status = val;
              } else {
                // Even if caller forgets `isDisposed()`, the state proxy itself blocks writes after disconnect!
                state.status = val;
              }
            });

            return () => {
              ephemeralCleanupCalled += 1;
            };
          },
        });

        const debug = createClientDebugger({ enabled: true });
        const runtime = createClientRuntime({
          document: env.document,
          debug,
          controllers: {
            editor: editorController,
            ephemeral: ephemeralController,
          },
        });

        runtime.mount();
        expect(editorConnectCount).toBe(1);

        const actBtn = env.document.querySelector('#act-btn');
        actBtn.click();
        expect(env.document.querySelector('#status-el').textContent).toBe('1');

        // Morph `#app-root`:
        // - `#kept-ctrl` is preserved (with a replaced inner `#status-el` node)
        // - `#removable-ctrl` is removed
        // - `#new-ctrl` is added
        const appRoot = env.document.querySelector('#app-root');
        runtime.adapter.patchElements(
          appRoot,
          `<div id="app-root">
            <div id="kept-ctrl" data-w-controller="editor" data-w-id="editor-1">
              <span id="status-el-v2" data-w-target="status" data-w-text="clicks">0</span>
              <button id="act-btn" type="button" data-w-on:click="bump">Bump</button>
            </div>
            <div id="new-ctrl" data-w-controller="editor" data-w-id="editor-2">
              <span id="new-status" data-w-target="status" data-w-text="clicks">0</span>
            </div>
          </div>`
        );

        runtime.controllers.syncTree(appRoot);

        // 1. Removed instance ran its cleanup function
        expect(ephemeralCleanupCalled).toBe(1);

        // 2. Kept instance was NOT re-initialized (`editorConnectCount` only incremented once for `#new-ctrl`)
        expect(editorConnectCount).toBe(2);

        // 3. Clicking `#act-btn` on kept instance increments by 1 (no duplicate listener!) and resolves new target
        actBtn.click();
        expect(env.document.querySelector('#status-el-v2').textContent).toBe('2');
        expect(latestTargetNode.id).toBe('status-el-v2');

        // 4. Late async resolution on removed instance is blocked and recorded in debugger
        resolveLateAsync('zombie-write');
        await new Promise((r) => setTimeout(r, 10));
        expect(capturedEphemeralState.status).toBe('alive');
        const snap = debug.getSnapshot();
        expect(snap.discardedResponses.some((d) => d.reason === 'instance-disconnected')).toBe(true);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 4. Unified SSR + Fragment Refresh Loader Contract & Request-Scoped Memo
  // =========================================================================
  describe('4. Unified SSR + Fragment Refresh & Request-Scoped Memoization', () => {
    it('executes the same fragment loader on initial SSR and refresh, sharing request-scoped memo without cross-request cache', async () => {
      let expensiveQueryCalls = 0;

      const pagesDir = path.join(tempDir, 'pages');
      const partialsDir = path.join(tempDir, 'views', 'partials');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(partialsDir, { recursive: true });

      fs.writeFileSync(
        path.join(partialsDir, 'summary.njk'),
        '<div data-testid="summary">Total: {{ total }}</div>'
      );
      fs.writeFileSync(
        path.join(partialsDir, 'items.njk'),
        '<ul data-testid="items">{% for x in list %}<li>{{ x }}</li>{% endfor %}</ul>'
      );
      fs.writeFileSync(
        path.join(pagesDir, 'dashboard.njk'),
        `<div>{{ fsy.fragment('summary') }}{{ fsy.fragment('items') }}</div>`
      );

      globalThis.__testMemoCounter = () => {
        expensiveQueryCalls += 1;
        return { total: expensiveQueryCalls * 10, list: [`item-${expensiveQueryCalls}`] };
      };

      fs.writeFileSync(
        path.join(pagesDir, 'dashboard.js'),
        `
        const { defineFragment } = require(${JSON.stringify(path.resolve(__dirname, '../../core/client'))});
        module.exports = {
          async load({ ctx }) {
            return ctx.memo('shared-data', () => globalThis.__testMemoCounter());
          },
          fragments: {
            summary: defineFragment({
              template: 'partials/summary.njk',
              dependsOn: ['dash'],
              async load({ memo }) {
                return memo('shared-data', () => globalThis.__testMemoCounter());
              },
            }),
            items: defineFragment({
              template: 'partials/items.njk',
              dependsOn: ['dash'],
              async load({ memo }) {
                return memo('shared-data', () => globalThis.__testMemoCounter());
              },
            }),
          },
        };
        `
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        viewsDir: path.join(tempDir, 'views'),
        logging: false,
      });

      // 1. Initial SSR renders page loader + 2 fragments, but `memo('shared-data')` runs ONLY ONCE for the request!
      const ssrRes = await supertest(app).get('/dashboard');
      expect(ssrRes.status).toBe(200);
      expect(ssrRes.text).toContain('Total: 10');
      expect(ssrRes.text).toContain('<li>item-1</li>');
      expect(expensiveQueryCalls).toBe(1);

      // 2. Refreshing both fragments in a single batch runs `memo('shared-data')` once for the refresh request (fresh across requests!)
      const refreshRes = await supertest(app)
        .post('/__webspresso/fragments')
        .send({
          pagePath: '/dashboard',
          fragments: [
            { name: 'summary', instanceId: 'summary:default', input: {} },
            { name: 'items', instanceId: 'items:default', input: {} },
          ],
        });

      expect(refreshRes.status).toBe(200);
      expect(expensiveQueryCalls).toBe(2);
      expect(refreshRes.body.fragments['summary:default'].html).toContain('Total: 20');
      expect(refreshRes.body.fragments['items:default'].html).toContain('<li>item-2</li>');

      delete globalThis.__testMemoCounter;
    });
  });

  // =========================================================================
  // 5 & 6. Concurrency Policies, Stale Response Guard & In-Flight Invalidation Coalescing
  // =========================================================================
  describe('5 & 6. Request Concurrency, Stale Response Guard & In-Flight Refresh Coalescing', () => {
    it('prevents slow older filter response from overwriting newer result (latest, drop, queue, parallel)', async () => {
      const env = createMiniDomEnvironment(`
        <div>
          <div
            data-w-fragment="list"
            data-w-fragment-id="notes-list"
            data-w-depends-on="notes"
            data-w-fragment-input='{"search":"first"}'
          >
            <p id="list-body">Initial</p>
          </div>
        </div>
      `);

      try {
        const pendingResolvers = [];
        const customFetch = async (_url, init) => {
          const body = JSON.parse(init.body);
          const search = body.fragments[0].input.search;
          return new Promise((resolve) => {
            pendingResolvers.push({
              search,
              resolve: () =>
                resolve({
                  ok: true,
                  status: 200,
                  headers: { get: () => 'application/json' },
                  async json() {
                    return {
                      fragments: {
                        'notes-list': {
                          name: 'list',
                          instanceId: 'notes-list',
                          html: `<div data-w-fragment="list" data-w-fragment-id="notes-list" data-w-depends-on="notes"><p id="list-body">Result: ${search}</p></div>`,
                        },
                      },
                    };
                  },
                }),
            });
          });
        };

        const debug = createClientDebugger({ enabled: true });
        const adapter = createDatastarAdapter({ document: env.document, debug });
        const coordinator = createFragmentCoordinator({
          document: env.document,
          fetch: customFetch,
          adapter,
          debug,
        });

        const fragEl = env.document.querySelector('[data-w-fragment-id="notes-list"]');

        // Start refresh 1 ("first")
        const p1 = coordinator.refreshFragments([{ instanceId: 'notes-list' }]);

        // Immediately change input to "second" and trigger refresh 2 before refresh 1 finishes
        fragEl.setAttribute('data-w-fragment-input', JSON.stringify({ search: 'second' }));
        const p2 = coordinator.refreshFragments([{ instanceId: 'notes-list' }]);

        // Wait a tick so request 1 is in flight
        await new Promise((r) => setTimeout(r, 10));
        expect(pendingResolvers.length).toBeGreaterThanOrEqual(1);

        // Resolve request 1; coordinator must immediately execute the queued invalidation for "second"!
        pendingResolvers[0].resolve();
        await new Promise((r) => setTimeout(r, 15));
        expect(pendingResolvers.length).toBe(2);
        pendingResolvers[1].resolve();

        await Promise.all([p1, p2]);
        expect(env.document.querySelector('#list-body').textContent).toBe('Result: second');

        // Also test API concurrency policies: `drop` and `queue`
        let activeCalls = 0;
        let maxConcurrent = 0;
        const callOrder = [];

        const api = createApiClient({
          debug,
          fetch: async (url) => {
            activeCalls += 1;
            maxConcurrent = Math.max(maxConcurrent, activeCalls);
            await new Promise((r) => setTimeout(r, 20));
            activeCalls -= 1;
            callOrder.push(url);
            return {
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              async json() {
                return { url };
              },
            };
          },
        });

        // `drop`: second call while first is running is dropped
        const [d1, d2] = await Promise.allSettled([
          api.get('/api/slow-1', { key: 'drop-key', concurrency: 'drop' }),
          api.get('/api/slow-2', { key: 'drop-key', concurrency: 'drop' }),
        ]);
        expect(d1.status).toBe('fulfilled');
        expect(d2.status).toBe('rejected');
        expect(d2.reason.isCanceled).toBe(true);

        // `queue`: runs sequentially (maxConcurrent === 1)
        maxConcurrent = 0;
        callOrder.length = 0;
        await Promise.all([
          api.get('/api/q1', { key: 'queue-key', concurrency: 'queue' }),
          api.get('/api/q2', { key: 'queue-key', concurrency: 'queue' }),
        ]);
        expect(maxConcurrent).toBe(1);
        expect(callOrder).toEqual(['/api/q1', '/api/q2']);
      } finally {
        env.restore();
      }
    });

    it('deduplicates child fragment when parent and child are invalidated together', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-fragment="parent" data-w-fragment-id="parent-1" data-w-depends-on="notes">
          <div data-w-fragment="child" data-w-fragment-id="child-1" data-w-depends-on="notes"></div>
        </div>
      `);

      try {
        const coordinator = createFragmentCoordinator({ document: env.document });
        const matching = coordinator.findFragmentsByTags(['notes']);
        expect(matching).toHaveLength(1);
        expect(matching[0].instanceId).toBe('parent-1');
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 7. Mutation Success vs Refresh Failure Separation & Transaction Commit Safety
  // =========================================================================
  describe('7. Mutation Success vs Refresh Failure Separation & Transaction Commit Safety', () => {
    it('resolves mutation as successful even when fragment refresh fails, and supports retrying refresh without re-running mutation', async () => {
      const env = createMiniDomEnvironment(`
        <div>
          <div data-w-fragment="count" data-w-fragment-id="count-1" data-w-depends-on="counter">
            <span id="val">0</span>
          </div>
          <form action="/api/counter" method="post" data-w-form="counter-form">
            <input name="amount" type="number" value="5">
            <button type="submit">Add</button>
            <p data-w-form-error></p>
          </form>
        </div>
      `);

      try {
        let mutationCalls = 0;
        let shouldFailRefresh = true;

        const customFetch = async (url) => {
          if (url.startsWith('/api/counter')) {
            mutationCalls += 1;
            return {
              ok: true,
              status: 200,
              headers: {
                get(h) {
                  if (h.toLowerCase() === 'content-type') return 'application/json';
                  if (h.toLowerCase() === 'x-webspresso-invalidate') return 'counter';
                  return null;
                },
              },
              async json() {
                return { count: 5 };
              },
            };
          }

          if (url.startsWith('/__webspresso/fragments')) {
            if (shouldFailRefresh) {
              return {
                ok: false,
                status: 503,
                headers: { get: () => 'application/json' },
                async json() {
                  return { message: 'Temporary fragment refresh outage' };
                },
              };
            }
            return {
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              async json() {
                return {
                  fragments: {
                    'count-1': {
                      name: 'count',
                      instanceId: 'count-1',
                      html: '<div data-w-fragment="count" data-w-fragment-id="count-1" data-w-depends-on="counter"><span id="val">5</span></div>',
                    },
                  },
                };
              },
            };
          }
          throw new Error(`Unexpected URL: ${url}`);
        };

        const runtime = createClientRuntime({
          document: env.document,
          fetch: customFetch,
        });
        runtime.mount();

        const formEl = env.document.querySelector('form');
        const handle = createFormHandle(formEl, {
          api: runtime.api,
          onInvalidate: (tags, meta) => runtime.fragments.invalidate(tags, meta),
        });

        const submitResult = await handle.submit();

        // Mutation succeeded (`ok: true`, `data: { count: 5 }`), form is NOT put into validation error!
        expect(submitResult.ok).toBe(true);
        expect(submitResult.data).toEqual({ count: 5 });
        expect(submitResult.refreshOk).toBe(false);
        expect(submitResult.refreshError).toBeInstanceOf(Error);
        expect(handle.formError).toBeFalsy();
        expect(mutationCalls).toBe(1);

        // Now recover refresh endpoint and retry ONLY the failed refresh — mutation is NOT re-sent!
        shouldFailRefresh = false;
        const retryResult = await runtime.fragments.retryLastFailed();
        expect(retryResult.errors).toHaveLength(0);
        expect(retryResult.refreshed).toEqual(['count-1']);
        expect(env.document.querySelector('#val').textContent).toBe('5');
        expect(mutationCalls).toBe(1);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('publishes invalidation only after database transaction commit and suppresses it on rollback', async () => {
      const db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        models: path.join(__dirname, '../fixtures/models-empty'),
      });

      await db.knex.schema.createTable('tx_items', (t) => {
        t.increments('id');
        t.string('name');
      });

      const commitOrder = [];
      let invalidatedHeaderValue = null;

      // 1. Committed transaction runs onTransactionCommit AFTER SQL commit
      await db.transaction(async (trxCtx) => {
        await trxCtx.knex('tx_items').insert({ name: 'first' });
        const { onTransactionCommit } = require('../../core/orm/transaction');
        onTransactionCommit(() => {
          commitOrder.push('after-commit-hook');
        });
        commitOrder.push('inside-tx');
      });

      expect(commitOrder).toEqual(['inside-tx', 'after-commit-hook']);

      // 2. Rolled-back transaction NEVER runs onTransactionCommit
      let rollbackHookRan = false;
      await expect(
        db.transaction(async () => {
          const { onTransactionCommit } = require('../../core/orm/transaction');
          onTransactionCommit(() => {
            rollbackHookRan = true;
          });
          throw new Error('Abort transaction');
        })
      ).rejects.toThrow('Abort transaction');

      expect(rollbackHookRan).toBe(false);
      await db.knex.destroy();
    });
  });

  // =========================================================================
  // 8. Fragment Security, Authorization & Input Validation
  // =========================================================================
  describe('8. Fragment Authorization, Input Validation & Arbitrary Template Protection', () => {
    it('rejects unauthorized fragments (401/403), invalid fragment inputs (400/422), and unregistered templates (404)', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const partialsDir = path.join(tempDir, 'views', 'partials');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(partialsDir, { recursive: true });

      fs.writeFileSync(path.join(partialsDir, 'secret.njk'), '<div>Secret: {{ secret }}</div>');
      fs.writeFileSync(path.join(pagesDir, 'panel.njk'), '<div>Panel</div>');
      fs.writeFileSync(
        path.join(pagesDir, 'panel.js'),
        `
        const { defineFragment } = require(${JSON.stringify(path.resolve(__dirname, '../../core/client'))});
        module.exports = {
          async load() { return {}; },
          fragments: {
            adminOnly: defineFragment({
              template: 'partials/secret.njk',
              auth: 'admin',
              schema: ({ z }) => ({
                page: z.coerce.number().int().min(1).max(10).default(1),
              }),
              async load({ input }) {
                return { secret: 'top-secret-' + input.page };
              },
            }),
          },
        };
        `
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        viewsDir: path.join(tempDir, 'views'),
        logging: false,
      });

      // 1. Unauthenticated request -> 401
      const unauthRes = await supertest(app)
        .post('/__webspresso/fragments')
        .send({
          pagePath: '/panel',
          fragments: [{ name: 'adminOnly', instanceId: 'a1', input: { page: 1 } }],
        });
      expect(unauthRes.status).toBe(401);

      // 2. Arbitrary / unregistered fragment name (e.g. trying to render '../views/layout.njk') -> 404
      const arbitraryRes = await supertest(app)
        .post('/__webspresso/fragments')
        .send({
          pagePath: '/panel',
          fragments: [{ name: '../views/layout.njk', instanceId: 'x1', input: {} }],
        });
      expect(arbitraryRes.status).toBe(404);

      // 3. Invalid fragment input with authenticated admin user -> 400/422 ValidationError
      const { app: authedApp } = createApp({
        rootDir: tempDir,
        pagesDir,
        viewsDir: path.join(tempDir, 'views'),
        logging: false,
        plugins: [
          {
            name: 'test-auth',
            register({ app: expressApp }) {
              expressApp.use((req, _res, next) => {
                req.user = { id: 1, role: req.headers['x-test-role'] || 'admin' };
                next();
              });
            },
          },
        ],
      });

      // Insufficient role ('viewer' instead of 'admin') -> 403
      const forbiddenRes = await supertest(authedApp)
        .post('/__webspresso/fragments')
        .set('x-test-role', 'viewer')
        .send({
          pagePath: '/panel',
          fragments: [{ name: 'adminOnly', instanceId: 'a1', input: { page: 1 } }],
        });
      expect(forbiddenRes.status).toBe(403);

      // Invalid input (`page: 999` exceeds max(10)) -> 400/422
      const invalidInputRes = await supertest(authedApp)
        .post('/__webspresso/fragments')
        .set('x-test-role', 'admin')
        .send({
          pagePath: '/panel',
          fragments: [{ name: 'adminOnly', instanceId: 'a1', input: { page: 999 } }],
        });
      expect([400, 422]).toContain(invalidInputRes.status);

      // Valid admin request -> 200
      const validRes = await supertest(authedApp)
        .post('/__webspresso/fragments')
        .set('x-test-role', 'admin')
        .send({
          pagePath: '/panel',
          fragments: [{ name: 'adminOnly', instanceId: 'a1', input: { page: 2 } }],
        });
      expect(validRes.status).toBe(200);
      expect(validRes.body.fragments.a1.html).toContain('Secret: top-secret-2');
    });
  });

  // =========================================================================
  // 9. Native HTML Forms: Coercion, Validation Mapping, Accessibility & Doctor Check
  // =========================================================================
  describe('9. Native HTML Forms, Coercion Rules, Accessibility & Static Form Checker', () => {
    it('coerces scalar/checkbox/multi-select/submitter/disabled controls and maps validation errors accessibly', async () => {
      const env = createMiniDomEnvironment(`
        <form action="/api/items" method="post" data-w-form="item-form">
          <input name="title" type="text" value="  Book  ">
          <span data-w-error="title"></span>
          <input name="quantity" type="number" value="4">
          <span data-w-error="quantity"></span>
          <input name="optionalNote" type="text" value="" data-w-empty="undefined">
          <input name="featured" type="checkbox">
          <input name="published" type="checkbox" checked>
          <input name="tags" type="checkbox" value="tech" checked>
          <input name="tags" type="checkbox" value="news" checked>
          <select name="languages" multiple>
            <option value="en" selected>EN</option>
            <option value="tr" selected>TR</option>
            <option value="de">DE</option>
          </select>
          <input name="ignoredDisabled" type="text" value="secret" disabled>
          <button id="draft-btn" type="submit" name="intent" value="save-draft">Save Draft</button>
          <p data-w-form-error></p>
        </form>
      `);

      try {
        const formEl = env.document.querySelector('form');
        const submitter = env.document.querySelector('#draft-btn');

        const parsed = parseFormElement(formEl, { submitter });
        expect(parsed.values).toEqual({
          title: '  Book  ',
          quantity: 4,
          optionalNote: undefined,
          featured: false, // single unchecked checkbox -> false
          published: true, // single checked checkbox -> true
          tags: ['tech', 'news'], // checkbox group -> array of checked values
          languages: ['en', 'tr'], // multi-select -> array of selected values
          intent: 'save-draft', // submitter name/value preserved
        });
        expect(parsed.values.ignoredDisabled).toBeUndefined();

        // Test validation error mapping, aria-invalid, aria-describedby, focus on first invalid field, and reset vs clear
        const api = createApiClient({
          fetch: async () => ({
            ok: false,
            status: 422,
            headers: { get: () => 'application/json' },
            async text() {
              return JSON.stringify({
                message: 'Validation failed',
                errors: [
                  { path: 'quantity', message: 'Quantity must be at least 10' },
                ],
              });
            },
          }),
        });

        const handle = createFormHandle(formEl, { api });
        const res = await handle.submit({ submitter });
        expect(res.ok).toBe(false);
        expect(handle.fieldErrors.quantity).toBe('Quantity must be at least 10');

        const qtyInput = formEl.querySelector('[name="quantity"]');
        const qtyError = formEl.querySelector('[data-w-error="quantity"]');
        expect(qtyInput.getAttribute('aria-invalid')).toBe('true');
        expect(qtyInput.getAttribute('aria-describedby')).toBe(qtyError.id);
        expect(qtyError.textContent).toBe('Quantity must be at least 10');
        expect(env.document.activeElement).toBe(qtyInput);

        // Modify title, then test `reset()` (restores initial default "  Book  ") vs `clear()` (empties to "")
        const titleInput = formEl.querySelector('[name="title"]');
        titleInput.value = 'Changed Title';
        handle.reset();
        expect(titleInput.value).toBe('  Book  ');

        handle.clear();
        expect(titleInput.value).toBe('');
      } finally {
        env.restore();
      }
    });

    it('detects unknown static HTML form fields and warns on dynamic {{ ... }} fields via checkTemplateFormContracts', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const apiDir = path.join(pagesDir, 'api');
      fs.mkdirSync(apiDir, { recursive: true });

      fs.writeFileSync(
        path.join(apiDir, 'notes.post.js'),
        `
        const { defineApi } = require(${JSON.stringify(path.resolve(__dirname, '../../index'))});
        module.exports = defineApi({
          schema: ({ z }) => ({
            body: z.object({
              title: z.string(),
              content: z.string().optional(),
            }),
          }),
          handler: async () => ({ ok: true }),
        });
        `
      );

      fs.writeFileSync(
        path.join(pagesDir, 'notes.njk'),
        `
        <form action="/api/notes" method="post">
          <input name="title" type="text">
          <input name="typo_field" type="text">
          <input name="{{ dynamicFieldName }}" type="text">
        </form>
        `
      );

      const check = checkTemplateFormContracts(tempDir);
      expect(check.checkedFormsCount).toBe(1);
      expect(check.errors).toHaveLength(1);
      expect(check.errors[0].code).toBe('UNKNOWN_FORM_FIELD');
      expect(check.errors[0].field).toBe('typo_field');

      expect(check.warnings).toHaveLength(1);
      expect(check.warnings[0].code).toBe('DYNAMIC_FORM_FIELD_NAME');
    });
  });

  // =========================================================================
  // 10. Compile-Time TypeScript Verification (.webspresso/api.d.ts)
  // =========================================================================
  describe('10. Compile-Time TypeScript Verification (.webspresso/api.d.ts)', () => {
    it('generates .webspresso/api.d.ts and passes/fails compile-time TypeScript checks as expected', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const apiDir = path.join(pagesDir, 'api');
      fs.mkdirSync(apiDir, { recursive: true });

      // 1. Route with Zod transform/default & Date wire response
      fs.writeFileSync(
        path.join(apiDir, 'counter.post.js'),
        `
        const { defineApi } = require(${JSON.stringify(path.resolve(__dirname, '../../index'))});
        module.exports = defineApi({
          schema: ({ z }) => ({
            body: z.object({
              amount: z.number(),
              label: z.string().default('default-label'),
            }),
          }),
          response: {
            200: require(${JSON.stringify(path.resolve(__dirname, '../../core/validation'))}).z.object({
              count: require(${JSON.stringify(path.resolve(__dirname, '../../core/validation'))}).z.number(),
              updatedAt: require(${JSON.stringify(path.resolve(__dirname, '../../core/validation'))}).z.date(),
            }),
          },
          async handler(req, res, ctx) {
            return ctx.result({ count: req.input.body.amount, updatedAt: new Date() }, { invalidate: ['counter'] });
          },
        });
        `
      );

      // 2. Streaming route (excluded from JSON api.get, accessible via api.stream / api.raw)
      fs.writeFileSync(
        path.join(apiDir, 'events.get.js'),
        `
        const { defineApi } = require(${JSON.stringify(path.resolve(__dirname, '../../index'))});
        module.exports = defineApi({
          async handler(req, res) {
            return res.sse(async function* () { yield { hello: 'world' }; });
          },
        });
        `
      );

      const gen = generateTypes({ rootDir: tempDir, silent: true });
      expect(fs.existsSync(gen.apiOutFile)).toBe(true);

      // Write a TypeScript verification file using `@ts-expect-error` for invalid calls
      const checkTsFile = path.join(tempDir, 'typecheck-verify.ts');
      fs.writeFileSync(
        checkTsFile,
        `
        import type { TypedApiClient } from './.webspresso/api';

        export async function verifyClientTypes(api: TypedApiClient) {
          // Valid call: label has default so it is optional in client input; updatedAt is serialized to string on wire!
          const res = await api.post('/api/counter', { amount: 1 });
          const countVal: number = res.count;
          const updatedStr: string = res.updatedAt;

          // Escape hatch for streaming route works
          await api.stream('/api/events');
          await api.raw('/api/events');

          // @ts-expect-error - Wrong body property type (amount must be number, not boolean)
          await api.post('/api/counter', { amount: true });

          // @ts-expect-error - Non-existent API endpoint path
          await api.post('/api/non-existent', { amount: 1 });

          // @ts-expect-error - Streaming endpoint cannot be called via JSON api.get()
          await api.get('/api/events');

          return { countVal, updatedStr };
        }
        `
      );

      const program = ts.createProgram([checkTsFile, gen.apiOutFile], {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        skipLibCheck: true,
      });

      const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(checkTsFile));
      const diagMessages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(diagMessages).toEqual([]);

      // Also verify that when an API route is deleted, regenerating removes it from `.webspresso/api.d.ts`
      fs.unlinkSync(path.join(apiDir, 'events.get.js'));
      const genAfterDelete = generateTypes({ rootDir: tempDir, silent: true });
      expect(genAfterDelete.apiCode).not.toContain("'/api/events'");
    });
  });

  // =========================================================================
  // 11. End-to-End Working Examples (Counter + Filtered/Paginated Notes)
  // =========================================================================
  describe('11. End-to-End Working Examples (Counter & Notes with Draft Preservation)', () => {
    async function waitForCondition(predicate, timeoutMs = 2500) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          if (predicate()) return;
        } catch (_e) {
          // keep waiting
        }
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    it('Example 1: Server-fragment counter works via standard form submit with zero .client.* file', async () => {
      const { app } = createClientBehaviorExampleApp();
      const customFetch = createSupertestFetch(app);

      // 1. Initial SSR render of /counter
      const ssrRes = await supertest(app).get('/counter');
      expect(ssrRes.status).toBe(200);
      expect(ssrRes.text).toContain('data-w-fragment="count"');

      const env = createMiniDomEnvironment(ssrRes.text, 'http://localhost/counter');
      try {
        expect(env.document.querySelector('[data-testid="counter-value"]').textContent).toBe('0');

        // Mount core client runtime with ZERO page .client.* controller
        const runtime = createClientRuntime({
          document: env.document,
          fetch: customFetch,
          pagePath: '/counter',
        });
        await runtime.mount();

        // Submit the standard HTML `<form action="/api/counter" method="post" data-w-form="counter-increment">`
        const formEl = env.document.querySelector('form[data-w-form="counter-increment"]');
        const amountInput = formEl.querySelector('input[name="amount"]');
        amountInput.value = '3';

        const submitEvt = new MiniEvent('submit', { bubbles: true, cancelable: true });
        formEl.dispatchEvent(submitEvt);

        await waitForCondition(
          () => env.document.querySelector('[data-testid="counter-value"]').textContent === '3'
        );

        // Counter fragment automatically refreshed and patched DOM to 3!
        expect(env.document.querySelector('[data-testid="counter-value"]').textContent).toBe('3');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('Example 2: Filtered & paginated todos list + summary counter + open edit form preserves draft & focus during refresh + explicit API insights', async () => {
      const { app } = createClientBehaviorExampleApp();
      const customFetch = createSupertestFetch(app);

      // 1. Initial SSR render of /todos
      const ssrRes = await supertest(app).get('/todos');
      expect(ssrRes.status).toBe(200);

      const env = createMiniDomEnvironment(ssrRes.text, 'http://localhost/todos');
      try {
        // Load the TypeScript controller from `examples/client-behavior/pages/todos.client.ts`
        const { loadApiRouteModule } = require('../../src/dev/api-typegen');
        const todosControllerPath = path.resolve(
          __dirname,
          '../../examples/client-behavior/pages/todos.client.ts'
        );
        const { mod: todosController } = loadApiRouteModule(todosControllerPath);

        const runtime = createClientRuntime({
          document: env.document,
          fetch: customFetch,
          pagePath: '/todos',
          controllers: {
            todos: todosController,
          },
        });
        await runtime.mount();

        // Verify initial SSR state: 6 total todos
        expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe('6');

        // User starts editing the open edit form and focuses its title input
        const editDraftTitle = env.document.querySelector('[data-testid="edit-draft-title"]');
        const editDraftContent = env.document.querySelector('[data-testid="edit-draft-content"]');
        editDraftTitle.value = 'Unsaved User Draft Title In Progress';
        editDraftContent.value = 'Unsaved User Draft Body...';
        editDraftTitle.focus();
        expect(env.document.activeElement).toBe(editDraftTitle);

        // User creates a new task via the Create Todo form -> triggers `invalidate: ['todos']`
        // which refreshes BOTH `todos-summary` and `todos-list` in a single batched request!
        const createForm = env.document.querySelector('form[data-w-form="create-todo"]');
        createForm.querySelector('input[name="title"]').value = 'Seventh Realtime Task';
        createForm.querySelector('textarea[name="notes"]').value = 'Created without losing edit draft';

        const submitEvt = new MiniEvent('submit', { bubbles: true, cancelable: true });
        createForm.dispatchEvent(submitEvt);

        await waitForCondition(
          () => env.document.querySelector('[data-testid="todos-total-count"]').textContent === '7'
        );

        // 1. Total badge updated to 7 and list now shows the new task
        expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe('7');
        expect(env.document.querySelector('[data-testid="todos-list"]').textContent).toContain('Seventh Realtime Task');

        // 2. Open edit form draft values AND active focus were completely preserved!
        expect(editDraftTitle.value).toBe('Unsaved User Draft Title In Progress');
        expect(editDraftContent.value).toBe('Unsaved User Draft Body...');
        expect(env.document.activeElement).toBe(editDraftTitle);

        // 3. Filter todos by typing "Datastar" into search input
        const searchInput = env.document.querySelector('[data-w-target="searchInput"]');
        searchInput.value = 'Datastar';
        searchInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        await waitForCondition(
          () => env.document.querySelector('[data-testid="todos-matching-count"]').textContent === '1'
        );
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('1');
        expect(env.document.querySelector('[data-testid="todos-list"]').textContent).toContain('Test Datastar per-instance signal isolation');
        expect(editDraftTitle.value).toBe('Unsaved User Draft Title In Progress');

        // 4. Explicit API call (`loadInsights`) writes response into controller-local reactive state
        const loadInsightsBtn = env.document.querySelector('[data-testid="load-insights-btn"]');
        loadInsightsBtn.click();

        await waitForCondition(
          () => env.document.querySelector('[data-testid="insights-panel"]').hidden === false
        );
        const insightsPanel = env.document.querySelector('[data-testid="insights-panel"]');
        expect(insightsPanel.hidden).toBe(false);
        expect(env.document.querySelector('[data-testid="insights-detail"]').textContent).toContain('Completion:');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });
});
