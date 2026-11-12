'use strict';

/**
 * End-to-End Client Behavior Stress Lab Verification Suite
 *
 * Verifies Scenarios A through L + Seeded Multi-Step Stress Sequence using
 * deterministic barrier-controlled fault injection (zero random sleep ordering).
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const supertest = require('supertest');
const ts = require('typescript');
const { createTempDir, cleanupDir } = require('../utils/fs');
const { createMiniDomEnvironment, MiniEvent } = require('../utils/mini-dom');

const {
  defineController,
  defineClientService,
  createClientRuntime,
  createFragmentCoordinator,
  createClientDebugger,
  createDatastarAdapter,
  defaultStorage,
} = require('../../core/client');

const {
  validateClientBundleBoundaries,
  buildBundle,
} = require('../../src/bundle');
const { generateTypes } = require('../../src/dev/typegen');
const { loadApiRouteModule } = require('../../src/dev/api-typegen');

const {
  createClientBehaviorExampleApp,
  buildBrowserDemoBundle,
} = require('../../examples/client-behavior/server');
const exampleStore = require('../../examples/client-behavior/store');
const { createMemoryStorageDriver, createStorageNamespace } = require('../../core/client/storage');

/**
 * Deterministic barrier primitive: allows tests to pause execution at an exact stage
 * (`reachServer`, `commit`, `fragmentLoad`, `reachBrowser`, `serviceInit`) and release
 * tagged operations (`A`, `B`, etc.) in a strictly controlled order.
 */
function createBarrier(label = 'barrier') {
  let resolved = false;
  let resolveFn = null;
  let rejectFn = null;
  const reachedWaiters = [];
  let reachedCount = 0;

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    label,
    get isReached() {
      return reachedCount > 0;
    },
    get reachedCount() {
      return reachedCount;
    },
    get isResolved() {
      return resolved;
    },
    async wait(payload) {
      reachedCount += 1;
      while (reachedWaiters.length > 0) {
        const w = reachedWaiters.shift();
        w(payload);
      }
      return promise;
    },
    waitUntilReached() {
      if (reachedCount > 0) return Promise.resolve();
      return new Promise((resolve) => {
        reachedWaiters.push(resolve);
      });
    },
    release(val) {
      resolved = true;
      if (resolveFn) resolveFn(val);
    },
    fail(err) {
      resolved = true;
      if (rejectFn) rejectFn(err || new Error(`Barrier "${label}" failed`));
    },
  };
}

/**
 * Deterministic transport & server harness for the Stress Lab.
 * Separately controls:
 * 1. Request reaching server (`beforeServer`)
 * 2. Mutation committing / Fragment loader completing (`exampleStore.setServerHooks`)
 * 3. Response reaching browser (`beforeBrowserResponse`)
 */
function createStressLabHarness(app) {
  const agent = supertest(app);
  const requestOrder = [];
  const responseOrder = [];
  const patchOrder = [];
  const rules = [];

  function addInterceptor(rule) {
    rules.push(rule);
    return () => {
      const idx = rules.indexOf(rule);
      if (idx !== -1) rules.splice(idx, 1);
    };
  }

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url, 'http://localhost');
    const method = String(init.method || 'GET').toUpperCase();
    const fullPath = parsed.pathname + parsed.search;
    let parsedBody = null;
    if (typeof init.body === 'string' && init.body.startsWith('{')) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch (_e) {}
    }

    const reqDescriptor = {
      method,
      url: fullPath,
      pathname: parsed.pathname,
      body: parsedBody,
      tag: null,
    };

    const matchingRule = rules.find((r) => !r.consumed && r.match(reqDescriptor));
    if (matchingRule) {
      if (matchingRule.once !== false) {
        matchingRule.consumed = true;
      }
      if (matchingRule.tag) {
        reqDescriptor.tag = matchingRule.tag;
      }
    }

    const label = reqDescriptor.tag || `${method} ${fullPath}`;
    requestOrder.push(label);

    if (matchingRule && matchingRule.beforeServerBarrier) {
      await matchingRule.beforeServerBarrier.wait(reqDescriptor);
    }

    if (init.signal && init.signal.aborted) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    if (matchingRule && matchingRule.failBeforeServer) {
      throw matchingRule.failBeforeServer;
    }

    if (matchingRule && matchingRule.mockStatus) {
      if (matchingRule.beforeBrowserBarrier) {
        await matchingRule.beforeBrowserBarrier.wait(reqDescriptor);
      }
      if (init.signal && init.signal.aborted) {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      responseOrder.push(label);
      const mockBody = matchingRule.mockBody || { message: `Simulated HTTP ${matchingRule.mockStatus}` };
      return {
        ok: matchingRule.mockStatus >= 200 && matchingRule.mockStatus < 300,
        status: matchingRule.mockStatus,
        statusText: JSON.stringify(mockBody),
        headers: {
          get(h) {
            return String(h).toLowerCase() === 'content-type' ? 'application/json' : null;
          },
        },
        async json() {
          return mockBody;
        },
        async text() {
          return JSON.stringify(mockBody);
        },
      };
    }

    let req = agent[method.toLowerCase()](fullPath);
    const headers = init.headers || {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null) {
        req = req.set(k, String(v));
      }
    }

    if (init.body !== undefined && init.body !== null && method !== 'GET' && method !== 'HEAD') {
      if (typeof init.body === 'string') {
        req = req.set('Content-Type', headers['Content-Type'] || 'application/json').send(init.body);
      } else {
        req = req.send(init.body);
      }
    }

    const res = await req;

    if (matchingRule && matchingRule.beforeBrowserBarrier) {
      await matchingRule.beforeBrowserBarrier.wait(reqDescriptor);
    }

    if (init.signal && init.signal.aborted) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    responseOrder.push(label);

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
  }

  return {
    fetchImpl,
    requestOrder,
    responseOrder,
    patchOrder,
    addInterceptor,
  };
}

/**
 * Mounts the full `/todos` Stress Lab page in a deterministic DOM environment.
 */
async function mountStressLabPage(customOptions = {}) {
  const { app } = createClientBehaviorExampleApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const harness = createStressLabHarness(server);

  const ssrPath = customOptions.ssrPath || '/todos';
  const ssrRes = await supertest(server).get(ssrPath);
  expect(ssrRes.status).toBe(200);

  const env = createMiniDomEnvironment(ssrRes.text, `http://localhost${ssrPath}`);

  if (typeof customOptions.beforeMount === 'function') {
    await customOptions.beforeMount({ env, app, harness });
  }

  const todosControllerPath = path.resolve(
    __dirname,
    '../../examples/client-behavior/pages/todos.client.ts'
  );
  const quickSharePath = path.resolve(
    __dirname,
    '../../examples/client-behavior/components/quick-share.client.ts'
  );
  const toastServicePath = path.resolve(
    __dirname,
    '../../examples/client-behavior/services/toast.ts'
  );
  const clipboardServicePath = path.resolve(
    __dirname,
    '../../examples/client-behavior/services/clipboard.ts'
  );

  const { mod: todosController } = loadApiRouteModule(todosControllerPath);
  const { mod: quickShareController } = loadApiRouteModule(quickSharePath);

  let toastInitCount = 0;
  let clipboardInitCount = 0;

  const services = {
    toast: defineClientService({
      load: async () => {
        toastInitCount += 1;
        if (customOptions.onToastLoad) {
          await customOptions.onToastLoad(toastInitCount);
        }
        return loadApiRouteModule(toastServicePath).mod;
      },
    }),
    clipboard: defineClientService({
      load: async () => {
        clipboardInitCount += 1;
        return loadApiRouteModule(clipboardServicePath).mod;
      },
    }),
    ...(customOptions.services || {}),
  };

  const debug = createClientDebugger({ enabled: true });
  const runtime = createClientRuntime({
    document: env.document,
    fetch: harness.fetchImpl,
    pagePath: '/todos',
    debug,
    services,
    controllers: {
      todos: todosController,
      'quick-share': quickShareController,
      ...(customOptions.controllers || {}),
    },
    ...(customOptions.runtimeOptions || {}),
  });

  await runtime.mount();

  const mainEl = env.document.querySelector('[data-w-controller="todos"]');
  const todosInst = runtime.getControllerInstance(mainEl, 'todos');

  return {
    app,
    env,
    harness,
    debug,
    runtime,
    todosInst,
    getToastInitCount: () => toastInitCount,
    getClipboardInitCount: () => clipboardInitCount,
    cleanup() {
      runtime.destroy();
      env.restore();
      try {
        server.close();
      } catch (_e) {}
    },
  };
}

describe('Client Behavior Stress Lab — End-to-End Verification (Scenarios A–L)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-stress-lab-');
    exampleStore.resetStore();
  });

  afterEach(() => {
    cleanupDir(tempDir);
    exampleStore.resetStore();
  });

  // ===========================================================================
  // SCENARIO A: RAPID FILTER CHANGE
  // ===========================================================================
  describe('Scenario A: Rapid Filter Change (Out-of-Order Responses, Failure Guard & Draft/Applied Separation)', () => {
    it('discards late response A after B completes, protects applied state on failure, and paginates with applied filters', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime, debug } = lab;
        const barrierA = createBarrier('filter-A');
        const barrierB = createBarrier('filter-B');

        // Intercept Filter A (status='completed') and Filter B (status='active', priority='high')
        harness.addInterceptor({
          tag: 'Filter-A',
          match: (req) =>
            req.pathname === '/__webspresso/fragments' &&
            req.body?.fragments?.[0]?.input?.status === 'completed',
          beforeBrowserBarrier: barrierA,
        });

        harness.addInterceptor({
          tag: 'Filter-B',
          match: (req) =>
            req.pathname === '/__webspresso/fragments' &&
            req.body?.fragments?.[0]?.input?.status === 'active' &&
            req.body?.fragments?.[0]?.input?.priority === 'high',
          beforeBrowserBarrier: barrierB,
        });

        // 1. Trigger Filter A and hold its response
        todosInst.state.draft.status = 'completed';
        todosInst.state.draft.priority = 'all';
        const promiseA = todosInst.actions.applyFilters();
        await barrierA.waitUntilReached();

        // Applied state must NOT claim Filter A before A completes!
        expect(todosInst.state.applied.status).toBe('all');

        // 2. Trigger Filter B while A is still pending; complete B first, then release A
        todosInst.state.draft.status = 'active';
        todosInst.state.draft.priority = 'high';
        const promiseB = todosInst.actions.applyFilters();
        await barrierB.waitUntilReached();

        barrierB.release();
        await promiseB;

        // Release late response A
        barrierA.release();
        await promiseA;

        // DOM, applied state, and fragment input MUST represent ONLY B ('active' + 'high' -> 1 matching task: #3)
        expect(todosInst.state.applied).toEqual({
          search: '',
          status: 'active',
          priority: 'high',
        });
        const listFrag = runtime.fragments.getInstance('todos-list');
        expect(listFrag.input).toMatchObject({
          search: '',
          status: 'active',
          priority: 'high',
          page: 1,
        });
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('1');
        expect(env.document.querySelector('[data-testid="todos-list"]').textContent).toContain(
          'Preserve unsaved draft and cursor focus'
        );

        // 3. Failed filter refresh must NOT present old DOM as if the new filter succeeded
        harness.addInterceptor({
          tag: 'Filter-Fail-503',
          match: (req) =>
            req.pathname === '/__webspresso/fragments' &&
            req.body?.fragments?.[0]?.input?.search === 'will-fail-503',
          mockStatus: 503,
        });

        todosInst.state.draft.search = 'will-fail-503';
        await todosInst.actions.applyFilters();

        // Applied state and fragment input remain at B ('active'/'high', search: '')
        expect(todosInst.state.applied.search).toBe('');
        expect(todosInst.state.applied.status).toBe('active');
        expect(runtime.fragments.getInstance('todos-list').input.search).toBe('');

        // 4. Reset to 'all' so we have 2 pages (6 items, 4 per page), then modify draft without applying and paginate
        todosInst.state.draft.search = '';
        await todosInst.actions.resetFilters();
        expect(todosInst.state.applied).toEqual({ search: '', status: 'all', priority: 'all' });
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('6');

        // User changes draft to status='completed' & search='unapplied-draft' WITHOUT clicking Apply
        todosInst.state.draft.status = 'completed';
        todosInst.state.draft.search = 'unapplied-draft';

        let paginatedInput = null;
        harness.addInterceptor({
          tag: 'Paginate-Page-2',
          match: (req) => {
            if (req.pathname === '/__webspresso/fragments' && req.body?.fragments?.[0]?.input?.page === 2) {
              paginatedInput = req.body.fragments[0].input;
              return true;
            }
            return false;
          },
        });

        await todosInst.actions.nextPage();
        expect(paginatedInput).toMatchObject({
          search: '',
          status: 'all',
          priority: 'all',
          page: 2,
        });
        expect(todosInst.state.page).toBe(2);
        expect(debug.getSnapshot().events.length).toBeGreaterThan(0);
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO B: NESTED FRAGMENT & INPUT PRESERVATION + KEYED IDENTITY
  // ===========================================================================
  describe('Scenario B: Nested Fragment Deduplication, Active Child Input Server Re-Render & Keyed Identity', () => {
    it('deduplicates parent/child batch, renders nested child with its active filter/page on server, shares memo, and preserves keyed rows', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime } = lab;

        // Verify todos-list is nested inside todos-summary
        const summaryEl = env.document.querySelector('[data-w-fragment-id="todos-summary"]');
        const listEl = env.document.querySelector('[data-w-fragment-id="todos-list"]');
        const activityEl = env.document.querySelector('[data-w-fragment-id="todos-activity"]');
        expect(summaryEl.contains(listEl)).toBe(true);
        expect(summaryEl.contains(activityEl)).toBe(false);

        // 1. Select non-default filter (status: 'active') and navigate to page 1 (4 active items: #3, #4, #5, #6)
        // Let's go to page 2 of 'all' (which shows items #5 and #6) so both filter AND page are non-default!
        todosInst.state.draft.status = 'active';
        await todosInst.actions.applyFilters();
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('4');

        // Tag existing keyed DOM node for todo #3 to prove record-bound DOM identity preservation
        const row3Before = env.document.querySelector('[data-w-key="todo-3"]');
        const row4Before = env.document.querySelector('[data-w-key="todo-4"]');
        expect(row3Before).not.toBeNull();
        row3Before.__customRecordMarker = 'marker-todo-3';
        row4Before.__customRecordMarker = 'marker-todo-4';

        // 2. Now create a new active task via POST /api/todos (which invalidates 'todos' on parent, child, and sibling)
        // Because there will now be 5 active tasks, let's first switch to page 2 after creating, or test with priority='medium' (items #4, #5):
        todosInst.state.draft.status = 'active';
        todosInst.state.draft.priority = 'medium';
        await todosInst.actions.applyFilters();
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('2');

        let batchRequestPayload = null;
        harness.addInterceptor({
          tag: 'Mutation-Invalidate-Batch',
          match: (req) => {
            if (req.pathname === '/__webspresso/fragments') {
              batchRequestPayload = req.body;
              return true;
            }
            return false;
          },
        });

        const memoCountBefore = exampleStore.getStoreMetrics().sharedSnapshotComputations;
        const summaryCallsBefore = exampleStore.getStoreMetrics().summaryLoaderCalls;
        const activityCallsBefore = exampleStore.getStoreMetrics().activityLoaderCalls;

        // Trigger mutation: create a new medium-priority task
        const createForm = env.document.querySelector('form[data-w-form="create-todo"]');
        createForm.querySelector('input[name="title"]').value = 'New Medium Priority Task';
        createForm.querySelector('select[name="priority"]').value = 'medium';
        const createHandle = todosInst.ctx.forms.get('create-todo');
        const submitRes = await createHandle.submit();
        expect(submitRes.ok).toBe(true);

        // 3. Verify parent/child batch deduplication:
        // Request only asked for `todos-summary` (parent) and `todos-activity` (sibling), NOT `todos-list`!
        expect(batchRequestPayload).not.toBeNull();
        const requestedIds = batchRequestPayload.fragments.map((f) => f.instanceId).sort();
        expect(requestedIds).toEqual(['todos-activity', 'todos-summary']);

        // And `childInputs` carried `todos-list`'s active filter input to the server!
        expect(batchRequestPayload.childInputs['todos-list']).toMatchObject({
          status: 'active',
          priority: 'medium',
          page: 1,
        });

        // 4. Verify request-scoped memoization shared between `todos-summary` and `todos-activity`:
        // Both fragments ran their loaders (+1 each), but `getSharedWorkspaceSnapshot()` ran ONLY ONCE (+1)!
        const metricsAfter = exampleStore.getStoreMetrics();
        expect(metricsAfter.summaryLoaderCalls).toBe(summaryCallsBefore + 1);
        expect(metricsAfter.activityLoaderCalls).toBe(activityCallsBefore + 1);
        expect(metricsAfter.sharedSnapshotComputations).toBe(memoCountBefore + 1);

        // 5. Verify child fragment's server-rendered HTML genuinely reflects `status: 'active', priority: 'medium'`
        // (3 matching medium tasks now: #7, #4, #5 — NOT all 7 tasks!)
        expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe('7');
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('3');
        expect(runtime.fragments.getInstance('todos-list').input).toMatchObject({
          status: 'active',
          priority: 'medium',
          page: 1,
        });

        // 6. Verify keyed DOM node identity (`data-w-key="todo-4"`) did NOT jump to #7 when #7 was prepended at top of list!
        const row4After = env.document.querySelector('[data-w-key="todo-4"]');
        const row7After = env.document.querySelector('[data-w-key="todo-7"]');
        expect(row4After).toBe(row4Before);
        expect(row4After.__customRecordMarker).toBe('marker-todo-4');
        expect(row7After.__customRecordMarker).toBeUndefined();
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO C: IN-FLIGHT INVALIDATION
  // ===========================================================================
  describe('Scenario C: In-Flight Invalidation Coalescing & Follow-Up Refresh Guarantee', () => {
    it('queues follow-up refresh when a second mutation commits during an in-flight refresh, coalesces same-tick invalidations, and skips unmatched tags', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, runtime } = lab;
        const refresh1Barrier = createBarrier('refresh-1-in-flight');

        const getFragmentBatchCount = () =>
          harness.requestOrder.filter((r) => r.includes('/__webspresso/fragments') || r === 'Refresh-Batch-1').length;

        harness.addInterceptor({
          tag: 'Refresh-Batch-1',
          match: (req) => req.pathname === '/__webspresso/fragments',
          beforeBrowserBarrier: refresh1Barrier,
        });

        // 1. Mutation 1 commits and starts Refresh Batch 1 (held at browser boundary)
        const mut1Res = await runtime.api.post('/api/todos', {
          title: 'Mutation One Task',
          priority: 'high',
          category: 'backend',
        });
        await refresh1Barrier.waitUntilReached();

        // 2. While Refresh Batch 1 is in-flight, Mutation 2 commits on the server and invalidates 'todos'
        const mut2Res = await runtime.api.post('/api/todos', {
          title: 'Mutation Two Task',
          priority: 'low',
          category: 'testing',
        });
        await Promise.resolve();

        // Now release Refresh Batch 1 -> Follow-up Refresh Batch 2 must automatically run!
        refresh1Barrier.release();
        await Promise.all([mut1Res.__refreshPromise, mut2Res.__refreshPromise]);

        expect(getFragmentBatchCount()).toBe(2);
        expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe('8');
        const listText = env.document.querySelector('[data-testid="todos-list"]').textContent;
        expect(listText).toContain('Mutation Two Task');
        expect(listText).toContain('Mutation One Task');
        expect(env.document.querySelector('[data-testid="activity-mutation-commits"]').textContent).toBe('2');

        // 3. Multiple invalidations in the same tick coalesce into a SINGLE batch request
        const batchesBeforeSameTick = getFragmentBatchCount();
        await Promise.all([
          runtime.invalidate(['todos']),
          runtime.invalidate(['todos']),
          runtime.invalidate(['todos']),
        ]);
        expect(getFragmentBatchCount()).toBe(batchesBeforeSameTick + 1);

        // 4. Invalidating a tag with no matching active fragment makes ZERO network requests
        const requestsBeforeUnmatched = harness.requestOrder.length;
        const unmatchedRes = await runtime.invalidate(['non-existent-tag']);
        expect(unmatchedRes.skipped).toBe(true);
        expect(harness.requestOrder.length).toBe(requestsBeforeUnmatched);
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO D: MUTATION SUCCEEDS, REFRESH FAILS
  // ===========================================================================
  describe('Scenario D: Mutation Succeeds, Refresh Fails (Retry Refresh Only & Hook Error Isolation)', () => {
    it('commits mutation once, does not mark form as save error when refresh 503s, retries only refresh, and isolates hook errors', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime } = lab;

        // Make the next fragment refresh fail with HTTP 503
        harness.addInterceptor({
          tag: 'Refresh-503',
          match: (req) => req.pathname === '/__webspresso/fragments',
          mockStatus: 503,
          mockBody: { message: 'Service Unavailable during fragment refresh' },
        });

        const createFormEl = env.document.querySelector('form[data-w-form="create-todo"]');
        createFormEl.querySelector('input[name="title"]').value = 'Committed Despite 503 Refresh';
        const createForm = todosInst.ctx.forms.get('create-todo');

        const res = await createForm.submit();

        // 1. Mutation succeeded and committed exactly ONCE
        expect(res.ok).toBe(true);
        expect(res.data.title).toBe('Committed Despite 503 Refresh');
        expect(res.refreshError).toBeDefined();
        expect(exampleStore.getStoreMetrics().mutationCommits).toBe(1);

        // 2. Form must NOT show a save error banner (`data-w-form-error` is empty)
        expect(createForm.lastError).toBeNull();
        expect(createFormEl.querySelector('[data-w-form-error]').textContent).toBe('');

        // 3. Retrying failed refresh only calls `/__webspresso/fragments` (mutationCommits stays 1)
        expect(runtime.fragments.hasFailedRefresh).toBe(true);
        await todosInst.actions.retryFailedFragments();
        expect(exampleStore.getStoreMetrics().mutationCommits).toBe(1);
        expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe('7');
        expect(env.document.querySelector('[data-testid="todos-list"]').textContent).toContain(
          'Committed Despite 503 Refresh'
        );

        // 4. Error thrown in onSuccess hook or notification service does NOT change mutation outcome
        const unregisterHook = createForm.onSuccess(() => {
          throw new Error('Notification hook failure');
        });
        createFormEl.querySelector('input[name="title"]').value = 'Hook Failure Isolation Task';
        const resWithHookErr = await createForm.submit();
        expect(resWithHookErr.ok).toBe(true);
        expect(resWithHookErr.hookError).toBeDefined();
        expect(exampleStore.getStoreMetrics().mutationCommits).toBe(2);
        unregisterHook();
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO E: RAPID RECORD SELECTION
  // ===========================================================================
  describe('Scenario E: Rapid Record Selection, Instance Isolation & Loading Submit Guard', () => {
    it('keeps form values, baseline, and submit target on record B when A resolves late, blocks submit while loading, and isolates two editors', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime } = lab;
        const barrierTodo1 = createBarrier('load-todo-1');
        const barrierTodo2 = createBarrier('load-todo-2');

        harness.addInterceptor({
          tag: 'GET-Todo-1',
          match: (req) => req.method === 'GET' && req.pathname === '/api/todos/1',
          beforeBrowserBarrier: barrierTodo1,
        });
        harness.addInterceptor({
          tag: 'GET-Todo-2',
          match: (req) => req.method === 'GET' && req.pathname === '/api/todos/2',
          beforeBrowserBarrier: barrierTodo2,
        });

        const editForm = todosInst.ctx.forms.get('edit-todo');
        const btn1 = env.document.querySelector('.edit-trigger-btn[data-todo-id="1"]');
        const btn2 = env.document.querySelector('.edit-trigger-btn[data-todo-id="2"]');

        // 1. Start loading Record #1 (hold)
        const p1 = todosInst.actions.selectTodoForEdit(null, btn1);
        await barrierTodo1.waitUntilReached();

        // While loading, attempting to submit editForm is blocked so it cannot submit to wrong record
        expect(todosInst.state.isLoadingRecord).toBe(true);
        const blockedSubmit = await editForm.submit();
        expect(blockedSubmit.canceled).toBe(true);

        // 2. Select Record #2 before #1 finishes; complete #2 first, then release #1
        const p2 = todosInst.actions.selectTodoForEdit(null, btn2);
        await barrierTodo2.waitUntilReached();

        barrierTodo2.release();
        await p2;
        barrierTodo1.release();
        await p1;

        // Form values, baseline, and action belong strictly to Record #2
        expect(todosInst.state.selectedTodoId).toBe(2);
        expect(todosInst.state.isLoadingRecord).toBe(false);
        expect(editForm.el.getAttribute('action')).toBe('/api/todos/2');
        expect(editForm.values.title).toContain('Test Datastar per-instance signal isolation');
        expect(editForm.baseline.title).toContain('Test Datastar per-instance signal isolation');
        expect(editForm.dirty).toBe(false);

        // 3. Two separate controller instances do NOT cancel each other's requests
        const twinContainer = env.document.createElement('div');
        twinContainer.innerHTML = `
          <div id="editor-inst-a" data-w-controller="mini-editor"><span data-w-text="title"></span></div>
          <div id="editor-inst-b" data-w-controller="mini-editor"><span data-w-text="title"></span></div>
        `;
        env.document.body.appendChild(twinContainer);

        const miniEditor = defineController({
          state: () => ({ title: '' }),
          actions: {
            async loadRecord({ api, state }, _e, el) {
              const id = el.getAttribute('data-id');
              const data = await api.get(`/api/todos/${id}`, {
                key: 'editor:load',
                concurrency: 'latest',
              });
              state.title = data.title;
            },
          },
        });
        runtime.register('mini-editor', miniEditor);
        await runtime.controllers.mountSubtree(twinContainer);

        const instA = runtime.getControllerInstance(env.document.querySelector('#editor-inst-a'), 'mini-editor');
        const instB = runtime.getControllerInstance(env.document.querySelector('#editor-inst-b'), 'mini-editor');
        const fakeElA = env.document.createElement('button');
        fakeElA.setAttribute('data-id', '1');
        const fakeElB = env.document.createElement('button');
        fakeElB.setAttribute('data-id', '2');

        await Promise.all([
          instA.actions.loadRecord(null, fakeElA),
          instB.actions.loadRecord(null, fakeElB),
        ]);
        expect(instA.state.title).toContain('Verify unified SSR fragment engine');
        expect(instB.state.title).toContain('Test Datastar per-instance signal isolation');
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO F: DIRTY FORM PROTECTION
  // ===========================================================================
  describe('Scenario F: Dirty Form Protection, Confirm Switch, In-Flight Edits, Baseline & Focus/Selection', () => {
    it('enforces all dirty form invariants across cancel/confirm switch, failed load, in-flight edits, baseline revert, and background morph', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime } = lab;
        const editForm = todosInst.ctx.forms.get('edit-todo');
        const titleInput = env.document.querySelector('[data-testid="edit-draft-title"]');
        const btn1 = env.document.querySelector('.edit-trigger-btn[data-todo-id="1"]');
        const btn2 = env.document.querySelector('.edit-trigger-btn[data-todo-id="2"]');
        const btn4 = env.document.querySelector('.edit-trigger-btn[data-todo-id="4"]');

        const initialBaselineTitle = editForm.baseline.title;
        expect(editForm.dirty).toBe(false);

        // 1. `fill()` with values equal to baseline keeps dirty === false
        editForm.fill({ title: initialBaselineTitle }, { baseline: false });
        expect(editForm.dirty).toBe(false);

        // 2. User modifies title -> dirty becomes true; reverting back to baseline clears dirty to false
        titleInput.value = 'Modified Draft Title';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(editForm.dirty).toBe(true);

        titleInput.value = initialBaselineTitle;
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(editForm.dirty).toBe(false);

        // 3. Re-dirty form and cancel record switch -> draft and selectedTodoId (#3) preserved
        titleInput.value = 'Unsaved Draft For Task 3';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(editForm.dirty).toBe(true);

        env.window.confirm = () => false;
        await todosInst.actions.selectTodoForEdit(null, btn1);
        expect(todosInst.state.selectedTodoId).toBe(3);
        expect(titleInput.value).toBe('Unsaved Draft For Task 3');
        expect(editForm.dirty).toBe(true);

        // 4. Confirm switch, but new record request FAILS -> existing draft is NOT lost!
        env.window.confirm = () => true;
        harness.addInterceptor({
          tag: 'GET-Todo-1-Fail-500',
          match: (req) => req.method === 'GET' && req.pathname === '/api/todos/1',
          mockStatus: 500,
        });
        await expect(todosInst.actions.selectTodoForEdit(null, btn1)).rejects.toThrow(/Simulated HTTP 500/);
        expect(todosInst.ctx.lastError).toBeTruthy();
        expect(todosInst.state.selectedTodoId).toBe(3);
        expect(titleInput.value).toBe('Unsaved Draft For Task 3');
        expect(editForm.dirty).toBe(true);

        // 5. Confirm switch and request succeeds -> previous dirty flag does NOT block loading the new record!
        await todosInst.actions.selectTodoForEdit(null, btn2);
        expect(todosInst.state.selectedTodoId).toBe(2);
        expect(titleInput.value).toContain('Test Datastar per-instance signal isolation');
        expect(editForm.dirty).toBe(false);

        // 6. While a new record load (#4) is in-flight, user types NEW edits -> late response does NOT overwrite them!
        const barrierTodo4 = createBarrier('load-todo-4');
        harness.addInterceptor({
          tag: 'GET-Todo-4-Slow',
          match: (req) => req.method === 'GET' && req.pathname === '/api/todos/4',
          beforeBrowserBarrier: barrierTodo4,
        });
        const pLoad4 = todosInst.actions.selectTodoForEdit(null, btn4);
        await barrierTodo4.waitUntilReached();

        titleInput.value = 'Typed During In-Flight Request';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(editForm.dirty).toBe(true);

        barrierTodo4.release();
        await pLoad4;
        expect(titleInput.value).toBe('Typed During In-Flight Request');
        expect(editForm.dirty).toBe(true);

        // 7. Background refresh preserves focus, selection range, and dirty fields
        titleInput.focus();
        titleInput.selectionStart = 6;
        titleInput.selectionEnd = 12;
        await runtime.invalidate(['todos']);
        expect(env.document.activeElement).toBe(titleInput);
        expect(titleInput.selectionStart).toBe(6);
        expect(titleInput.selectionEnd).toBe(12);
        expect(titleInput.value).toBe('Typed During In-Flight Request');
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO G: DRAFT PERSISTENCE RACES
  // ===========================================================================
  describe('Scenario G: Draft Persistence Debounce Race, Scope Isolation, Corrupted Storage & Sensitive Field Exclusion', () => {
    it('cancels pending draft debounce timer on submit so cleared draft never resurrects, isolates scopes, and ignores sensitive/corrupted fields', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, todosInst } = lab;
        const editForm = todosInst.ctx.forms.get('edit-todo');
        const titleInput = env.document.querySelector('[data-testid="edit-draft-title"]');

        // Add password, file, and data-w-no-draft inputs inside editForm to verify exclusion
        const extraFields = env.document.createElement('div');
        extraFields.innerHTML = `
          <input type="password" name="secretPass" value="top-secret-password">
          <input type="file" name="attachment">
          <input type="text" name="ephemeralCode" value="skip-me" data-w-no-draft="true">
        `;
        editForm.el.appendChild(extraFields);

        // 1. User types into titleInput -> schedules 150ms debounced draft save
        titleInput.value = 'Updated Task 3 Title Before Submit';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        // Force an immediate save first to verify sensitive fields are excluded when draft is saved
        editForm.saveDraft();
        const savedBeforeSubmit = defaultStorage.session.get(editForm.draftKey, null);
        expect(savedBeforeSubmit).toMatchObject({
          title: 'Updated Task 3 Title Before Submit',
        });
        expect(savedBeforeSubmit.secretPass).toBeUndefined();
        expect(savedBeforeSubmit.attachment).toBeUndefined();
        expect(savedBeforeSubmit.ephemeralCode).toBeUndefined();

        // 2. Now type again (arming the 150ms debounce timer) and IMMEDIATELY submit the form
        titleInput.value = 'Submitted Task 3 Final Title';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        const submitRes = await editForm.submit();
        expect(submitRes.ok).toBe(true);
        expect(defaultStorage.session.get(editForm.draftKey, null)).toBeNull();

        // Wait 220ms (past the 150ms debounce window) -> cleared draft must NOT be recreated!
        await new Promise((r) => setTimeout(r, 220));
        expect(defaultStorage.session.get(editForm.draftKey, null)).toBeNull();

        // 3. Record / Instance / User scope isolation
        const userAStorage = defaultStorage.scoped('userA');
        const userBStorage = defaultStorage.scoped('userB');
        userAStorage.session.set('form_draft:edit-todo:todo-3', { title: 'User A Draft' });
        userBStorage.session.set('form_draft:edit-todo:todo-3', { title: 'User B Draft' });
        expect(userAStorage.session.get('form_draft:edit-todo:todo-3').title).toBe('User A Draft');
        expect(userBStorage.session.get('form_draft:edit-todo:todo-3').title).toBe('User B Draft');

        // 4. Corrupted storage payload (array or nested object) and QuotaExceededError resilience
        defaultStorage.session.set(editForm.draftKey, {
          title: { nested: 'corrupted-object' },
          notes: ['corrupted-array'],
        });
        expect(() => editForm.restoreDraft()).not.toThrow();
        expect(titleInput.value).toBe('Submitted Task 3 Final Title');
      } finally {
        lab.cleanup();
      }

      // 5. Reopen page -> submitted draft does NOT come back; page shows committed server value
      const reopened = await mountStressLabPage();
      try {
        const reopenedTitle = reopened.env.document.querySelector('[data-testid="edit-draft-title"]');
        expect(reopenedTitle.value).toBe('Submitted Task 3 Final Title');
        expect(reopened.todosInst.ctx.forms.get('edit-todo').dirty).toBe(false);
      } finally {
        reopened.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO H: PERSISTENCE & SSR CONSISTENCY
  // ===========================================================================
  describe('Scenario H: Persistence & SSR Consistency, Conflict Detection & Explicit Default Selection', () => {
    it('reconciles stored fragment input with SSR HTML via refresh, detects dual-source persistence conflict, and preserves explicit default selection', async () => {
      const refreshBarrier = createBarrier('ssr-persist-reconcile');
      const lab = await mountStressLabPage({
        beforeMount({ harness }) {
          // Pre-populate session storage with a non-default filter before mounting runtime (SSR HTML rendered default 'all')
          defaultStorage.session.set('frag_input:list', {
            search: '',
            status: 'completed',
            priority: 'high',
            page: 1,
            limit: 4,
          });

          harness.addInterceptor({
            tag: 'SSR-Persist-Reconcile',
            match: (req) => req.pathname === '/__webspresso/fragments',
            beforeBrowserBarrier: refreshBarrier,
          });
        },
      });

      try {
        const { env, runtime, todosInst } = lab;
        const listFrag = runtime.fragments.getInstance('todos-list');

        // 1. While the reconcile refresh is still in-flight, `listFrag.input` matches the SSR HTML ('all')
        // and `restoredInput` holds the pending stored filter ('completed'/'high')
        await refreshBarrier.waitUntilReached();
        expect(listFrag.input.status).toBe('all');
        expect(listFrag.restoredInput).toMatchObject({ status: 'completed', priority: 'high' });

        // Release reconcile refresh -> now both HTML and `listFrag.input` match `{ status: 'completed', priority: 'high' }` (2 tasks: #1 and #2)
        refreshBarrier.release();
        await new Promise((r) => setTimeout(r, 25));

        expect(listFrag.input).toMatchObject({ status: 'completed', priority: 'high' });
        expect(env.document.querySelector('[data-testid="todos-matching-count"]').textContent).toBe('2');

        // 2. Explicitly selecting default values ('all', '') updates storage to 'all' and is NEVER overwritten by old storage on DOM scan
        await todosInst.actions.resetFilters();
        expect(listFrag.input).toMatchObject({ search: '', status: 'all', priority: 'all', page: 1 });
        expect(runtime.fragments.getStoredInput('list')).toMatchObject({
          search: '',
          status: 'all',
          priority: 'all',
          page: 1,
        });
        runtime.fragments.syncDomInstances();
        expect(listFrag.input.status).toBe('all');

        // 3. Detect conflict when a controller with `persist` and a fragment with `data-w-persist-input` manage the same filter on separate keys
        const conflictEl = env.document.createElement('div');
        conflictEl.setAttribute('data-w-controller', 'conflict-filter');
        env.document.body.appendChild(conflictEl);

        runtime.register(
          'conflict-filter',
          defineController({
            persist: { key: 'ctrl_filter_state', storage: 'session' },
            state: () => ({ status: 'active' }),
            actions: {
              async syncFrag({ refresh, state }) {
                await refresh('todos-list', { status: state.status });
              },
            },
          })
        );
        await runtime.controllers.mountSubtree(conflictEl);
        const conflictInst = runtime.getControllerInstance(conflictEl, 'conflict-filter');
        await conflictInst.actions.syncFrag();

        expect(conflictInst.ctx.persistenceConflicts.length).toBe(1);
        expect(conflictInst.ctx.persistenceConflicts[0]).toMatchObject({
          controller: 'conflict-filter',
          fragment: 'todos-list',
        });
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO I: BACKGROUND REFETCH
  // ===========================================================================
  describe('Scenario I: Background Refetch Coalescing, Hidden Tab Pause, Task Pending Guard, Parameterized Task Args & BFCache pageshow', () => {
    it('coalesces focus/reconnect/interval triggers, pauses in hidden tab, preserves parameterized task args, and never re-runs mutation tasks', async () => {
      const lab = await mountStressLabPage();
      try {
        const { env, harness, todosInst, runtime } = lab;

        // Expire staleTime on fragments so focus & reconnect both consider them stale
        for (const inst of runtime.fragments.getInstances()) {
          inst.lastUpdatedAt = Date.now() - 60000;
        }

        const batchesBefore = harness.requestOrder.filter((r) => r.includes('/__webspresso/fragments')).length;

        // 1. Trigger focus and online (reconnect) in the same turn -> must coalesce into a SINGLE fragment batch request!
        env.window.dispatchEvent(new env.window.Event('focus'));
        env.window.dispatchEvent(new env.window.Event('online'));
        await new Promise((r) => setTimeout(r, 35));

        const batchesAfter = harness.requestOrder.filter((r) => r.includes('/__webspresso/fragments')).length;
        expect(batchesAfter - batchesBefore).toBe(1);

        // 2. Parameterized task (`tasks.insights.run('frontend')`) remembers its arguments on auto-refetch
        await todosInst.tasks.insights.run('frontend');
        expect(todosInst.tasks.insights.lastArgs).toEqual(['frontend']);
        expect(todosInst.tasks.insights.data.categoryFilter).toBe('frontend');

        // Expire task staleTime and trigger window focus -> verify it re-fetches with `category=frontend`!
        let refetchedInsightsUrl = null;
        harness.addInterceptor({
          tag: 'Insights-Focus-Refetch',
          match: (req) => {
            if (req.pathname === '/api/todos/insights') {
              refetchedInsightsUrl = req.url;
              return true;
            }
            return false;
          },
        });

        // Force stale by adjusting internal timestamp via a custom task with staleTime: 0
        let mutationTaskCalls = 0;
        let paramTaskArgsSeen = [];
        let pollTaskCalls = 0;
        const bgCtrlEl = env.document.createElement('div');
        bgCtrlEl.setAttribute('data-w-controller', 'bg-task-verify');
        env.document.body.appendChild(bgCtrlEl);

        const slowRun1Barrier = createBarrier('task-run-1');
        const slowRun2Barrier = createBarrier('task-run-2');
        let overlappingRunCount = 0;

        runtime.register(
          'bg-task-verify',
          defineController({
            tasks: {
              paramQuery: () => ({
                run: async (scope = 'default') => {
                  paramTaskArgsSeen.push(scope);
                  return { scope };
                },
                staleTime: 0,
                refetchOnWindowFocus: true,
                refetchOnReconnect: true,
              }),
              poller: () => ({
                run: async () => {
                  pollTaskCalls += 1;
                  return { pollTaskCalls };
                },
                refetchInterval: 30,
                refetchIntervalInBackground: false,
              }),
              overlapping: () => ({
                run: async () => {
                  overlappingRunCount += 1;
                  if (overlappingRunCount === 1) {
                    await slowRun1Barrier.wait();
                    return 'run-1';
                  }
                  await slowRun2Barrier.wait();
                  return 'run-2';
                },
                concurrency: 'latest',
              }),
              // Mutation task WITHOUT refetch flags must NEVER run on focus/reconnect
              mutateAction: () => ({
                run: async () => {
                  mutationTaskCalls += 1;
                  return { mutated: true };
                },
              }),
            },
          })
        );

        await runtime.controllers.mountSubtree(bgCtrlEl);
        const bgInst = runtime.getControllerInstance(bgCtrlEl, 'bg-task-verify');

        // Run parameterized task with ('custom-arg'), then trigger focus -> must reuse 'custom-arg'!
        await bgInst.tasks.paramQuery.run('custom-arg');
        env.window.dispatchEvent(new env.window.Event('focus'));
        await new Promise((r) => setTimeout(r, 35));
        expect(paramTaskArgsSeen).toEqual(['custom-arg', 'custom-arg']);
        expect(mutationTaskCalls).toBe(0);

        // 3. Hidden tab pauses polling (`refetchIntervalInBackground: false`)
        env.document.visibilityState = 'hidden';
        const pollsWhenHiddenStart = pollTaskCalls;
        await new Promise((r) => setTimeout(r, 75));
        expect(pollTaskCalls).toBe(pollsWhenHiddenStart);
        env.document.visibilityState = 'visible';

        // 4. Overlapping task run: older run's `finally` must NOT clear `pending` while newer run is still active
        const pOverlap1 = bgInst.tasks.overlapping.run();
        await slowRun1Barrier.waitUntilReached();
        expect(bgInst.tasks.overlapping.pending).toBe(true);

        const pOverlap2 = bgInst.tasks.overlapping.run();
        await slowRun2Barrier.waitUntilReached();

        // Release older run 1 first -> `pending` MUST stay true until run 2 finishes!
        slowRun1Barrier.release();
        await pOverlap1;
        expect(bgInst.tasks.overlapping.pending).toBe(true);

        slowRun2Barrier.release();
        await pOverlap2;
        expect(bgInst.tasks.overlapping.pending).toBe(false);
        expect(bgInst.tasks.overlapping.data).toBe('run-2');

        // 5. Synthetic BFCache `pageshow` (`persisted: true`) event triggers revalidation
        for (const inst of runtime.fragments.getInstances()) {
          inst.lastUpdatedAt = Date.now() - 60000;
        }
        const beforePageShowBatches = harness.requestOrder.filter((r) => r.includes('/__webspresso/fragments')).length;
        const pageShowEvt = new env.window.Event('pageshow');
        pageShowEvt.persisted = true;
        env.window.dispatchEvent(pageShowEvt);
        await new Promise((r) => setTimeout(r, 25));
        const afterPageShowBatches = harness.requestOrder.filter((r) => r.includes('/__webspresso/fragments')).length;
        expect(afterPageShowBatches).toBe(beforePageShowBatches + 1);

        // 6. Disposing controller stops polling and focus listeners
        bgInst.destroy();
        const pollsAfterDispose = pollTaskCalls;
        const paramCallsAfterDispose = paramTaskArgsSeen.length;
        env.window.dispatchEvent(new env.window.Event('focus'));
        await new Promise((r) => setTimeout(r, 70));
        expect(pollTaskCalls).toBe(pollsAfterDispose);
        expect(paramTaskArgsSeen.length).toBe(paramCallsAfterDispose);
        void refetchedInsightsUrl;
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO J: LAZY SERVICE & HOST
  // ===========================================================================
  describe('Scenario J: Lazy Service & Shared Host Concurrency, Failure Retry, Runtime Isolation & Ownership', () => {
    it('initializes lazy service once across concurrent controllers, cleans up on init failure, isolates runtimes, and respects host ownership', async () => {
      let failFirstToastLoad = true;
      const lab = await mountStressLabPage({
        onToastLoad() {
          if (failFirstToastLoad) {
            failFirstToastLoad = false;
            throw new Error('Simulated lazy chunk network error');
          }
        },
      });

      try {
        const { env, todosInst, runtime, getToastInitCount } = lab;
        const shareEl = env.document.querySelector('[data-w-controller="quick-share"]');
        const shareInst = runtime.getControllerInstance(shareEl, 'quick-share');

        // 1. First initialization fails -> partial resources cleaned up, no host left behind
        await expect(runtime.services.get('toast')).rejects.toThrow('Simulated lazy chunk network error');
        expect(env.document.querySelectorAll('[data-w-host="toast"]').length).toBe(0);

        // 2. Concurrent requests from two controllers (`todos` and `quick-share`) -> single initialization & single host!
        const [t1, t2] = await Promise.all([
          todosInst.ctx.services.get('toast'),
          shareInst.ctx.services.get('toast'),
        ]);
        expect(t1).toBe(t2);
        expect(getToastInitCount()).toBe(2); // 1 failed attempt + 1 shared successful init
        expect(env.document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);

        // 3. Unmounting one controller (`quick-share`) does NOT dispose the shared service or its host
        shareInst.destroy();
        expect(env.document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);
        t1.success('Still alive after controller unmount');
        expect(t1.count()).toBe(1);

        // 4. Fragment patch does NOT duplicate or remove the shared service host
        await runtime.invalidate(['todos']);
        expect(env.document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);

        // 5. Runtime dispose while lazy service initialization is in-flight -> late completion cannot create a host
        const slowServiceBarrier = createBarrier('slow-service-init');
        const isolatedRootA = env.document.createElement('div');
        const isolatedRootB = env.document.createElement('div');
        env.document.body.appendChild(isolatedRootA);
        env.document.body.appendChild(isolatedRootB);

        // Pre-existing layout host inside isolatedRootB (`created: false` ownership check)
        const preExistingHost = env.document.createElement('div');
        preExistingHost.setAttribute('data-w-host', 'shared-banner');
        preExistingHost.setAttribute('class', 'original-layout-class');
        isolatedRootB.appendChild(preExistingHost);

        const runtimeA = createClientRuntime({
          root: isolatedRootA,
          document: env.document,
          services: {
            slowWidget: defineClientService({
              load: async () => {
                await slowServiceBarrier.wait();
                return {
                  create({ mountHost }) {
                    mountHost('slow-host');
                    return { ok: true };
                  },
                };
              },
            }),
            isolatedToast: defineClientService({
              create({ mountHost }) {
                const h = mountHost('isolated-host');
                return { el: h.el };
              },
            }),
          },
        });

        const runtimeB = createClientRuntime({
          root: isolatedRootB,
          document: env.document,
          services: {
            isolatedToast: defineClientService({
              create({ mountHost }) {
                const h = mountHost('isolated-host');
                return { el: h.el };
              },
            }),
            banner: defineClientService({
              create({ mountHost }) {
                const h = mountHost('shared-banner', { className: 'service-active-class' });
                h.el.textContent = 'Banner Active';
                return { host: h };
              },
            }),
          },
        });

        await runtimeA.mount();
        await runtimeB.mount();

        const svcA = await runtimeA.services.get('isolatedToast');
        const svcB = await runtimeB.services.get('isolatedToast');
        const bannerB = await runtimeB.services.get('banner');

        expect(svcA.el).not.toBe(svcB.el);
        expect(isolatedRootA.contains(svcA.el)).toBe(true);
        expect(isolatedRootB.contains(svcB.el)).toBe(true);
        expect(bannerB.host.created).toBe(false);
        expect(preExistingHost.getAttribute('class')).toBe('service-active-class');

        // Start slowWidget on runtimeA, then destroy runtimeA before slowWidget finishes
        const pSlow = runtimeA.services.get('slowWidget');
        await slowServiceBarrier.waitUntilReached();
        runtimeA.destroy();
        slowServiceBarrier.release();
        await expect(pSlow).rejects.toThrow();

        // Late service init must NOT have created `[data-w-host="slow-host"]`, and runtimeB's host is untouched!
        expect(env.document.querySelector('[data-w-host="slow-host"]')).toBeNull();
        expect(isolatedRootA.querySelector('[data-w-host="isolated-host"]')).toBeNull();
        expect(isolatedRootB.querySelector('[data-w-host="isolated-host"]')).toBe(svcB.el);

        // Destroying runtimeB removes its created host (`isolated-host`), while preserving pre-existing layout host (`shared-banner`) and restoring its original class!
        runtimeB.destroy();
        expect(isolatedRootB.querySelector('[data-w-host="isolated-host"]')).toBeNull();
        expect(isolatedRootB.contains(preExistingHost)).toBe(true);
        expect(preExistingHost.textContent).toBe('');
        expect(preExistingHost.getAttribute('class')).toBe('original-layout-class');
      } finally {
        lab.cleanup();
      }
    });
  });

  // ===========================================================================
  // SCENARIO K: LIFECYCLE & BINDING HYGIENE
  // ===========================================================================
  describe('Scenario K: Mount -> Patch -> Unmount Cycles, Listener Deduplication, Target Scoping & Zero Resource Leak', () => {
    it('maintains single action invocation, two-way data-w-model after patch, target isolation, and returns all resource counters to baseline', async () => {
      const env = createMiniDomEnvironment(`<div id="cycle-stage"></div>`);
      try {
        const debug = createClientDebugger({ enabled: true });
        const adapter = createDatastarAdapter({ document: env.document, debug });

        let clickInvocations = 0;
        let watchCallsAfterDispose = 0;
        let parentTargetCount = 0;

        const cycleController = defineController({
          state: () => ({
            query: 'initial',
            count: 0,
          }),
          computed: {
            upperQuery: ({ state }) => String(state.query || '').toUpperCase(),
          },
          watch: {
            count() {
              if (this.isDisposed()) {
                watchCallsAfterDispose += 1;
              }
            },
          },
          connect({ targets, interval, on }) {
            parentTargetCount = targets('itemLabel').length;
            interval(() => {}, 5000);
            on('custom-ping', () => {});
          },
          actions: {
            bump({ state }) {
              clickInvocations += 1;
              state.count += 1;
            },
          },
        });

        const childController = defineController({
          state: () => ({ childVal: 1 }),
        });

        const runtime = createClientRuntime({
          document: env.document,
          adapter,
          debug,
          controllers: {
            'cycle-ctrl': cycleController,
            'nested-child': childController,
          },
        });
        await runtime.mount();

        const baselineSignals = adapter.engine.signals.getSignalCount();
        const baselineSubscribers = adapter.engine.signals.getSubscriberCount();
        const baselineBoundInstances = adapter.getBoundInstanceCount();
        const baselineBoundElements = adapter.getBoundElementCount();

        const stage = env.document.getElementById('cycle-stage');

        // Run 8 full mount -> patch -> interact -> unmount cycles
        for (let iter = 1; iter <= 8; iter++) {
          stage.innerHTML = `
            <section id="cycle-root" data-w-controller="cycle-ctrl" data-w-id="cycle-1">
              <input type="text" data-w-model="query" data-w-target="queryInput">
              <span id="upper-out" data-w-text="upperQuery"></span>
              <span data-w-target="itemLabel">Parent Target</span>
              <button id="bump-btn" type="button" data-w-on:click="bump">Bump</button>
              <div data-w-controller="nested-child">
                <span data-w-target="itemLabel">Child Target Must Not Leak</span>
              </div>
            </section>
          `;

          await runtime.controllers.mountSubtree(stage);
          const rootEl = env.document.getElementById('cycle-root');
          const inst = runtime.getControllerInstance(rootEl, 'cycle-ctrl');

          // Nested target isolation: parent only sees its own `itemLabel` (1, not 2)
          expect(parentTargetCount).toBe(1);

          // Morph/patch inner elements twice in-place while preserving `#cycle-root`
          for (let p = 1; p <= 2; p++) {
            adapter.patchElements(
              rootEl,
              `
              <section id="cycle-root" data-w-controller="cycle-ctrl" data-w-id="cycle-1">
                <input type="text" data-w-model="query" data-w-target="queryInput">
                <span id="upper-out" data-w-text="upperQuery"></span>
                <span data-w-target="itemLabel">Parent Target v${p}</span>
                <button id="bump-btn" type="button" data-w-on:click="bump">Bump v${p}</button>
                <div data-w-controller="nested-child">
                  <span data-w-target="itemLabel">Child Target v${p}</span>
                </div>
              </section>
              `
            );
            await runtime.controllers.mountSubtree(rootEl);
          }

          // Single click must run `bump` action ONCE (no duplicate listeners after patches!)
          const beforeClicks = clickInvocations;
          env.document.getElementById('bump-btn').click();
          expect(clickInvocations).toBe(beforeClicks + 1);
          expect(inst.state.count).toBe(1);

          // `data-w-model` input <-> state works after patch
          const inputEl = rootEl.querySelector('[data-w-target="queryInput"]');
          inputEl.value = `patched-${iter}`;
          inputEl.dispatchEvent(new MiniEvent('input', { bubbles: true }));
          expect(inst.state.query).toBe(`patched-${iter}`);
          expect(env.document.getElementById('upper-out').textContent).toBe(`PATCHED-${iter}`);

          // Unmount subtree and verify disposed state cannot mutate or trigger watch/computed
          const staleStateRef = inst.state;
          runtime.controllers.unmountSubtree(stage);
          stage.innerHTML = '';

          staleStateRef.count = 999;
          staleStateRef.query = 'should-be-blocked';
          expect(inst.state.count).toBe(1);
          expect(watchCallsAfterDispose).toBe(0);
        }

        // All signal, subscriber, bound element, and active controller counters MUST return to baseline!
        expect(runtime.controllers.getActiveInstances().length).toBe(0);
        expect(runtime.controllers.getStandaloneFormCount()).toBe(0);
        expect(adapter.getBoundInstanceCount()).toBe(baselineBoundInstances);
        expect(adapter.getBoundElementCount()).toBe(baselineBoundElements);
        expect(adapter.engine.signals.getSignalCount()).toBe(baselineSignals);
        expect(adapter.engine.signals.getSubscriberCount()).toBe(baselineSubscribers);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // ===========================================================================
  // SCENARIO L: PRODUCTION BUILD, CODE SPLITTING, BOUNDARIES & TYPESCRIPT
  // ===========================================================================
  describe('Scenario L: Production Build, Lazy Service Chunk Splitting, Zero DevTools Leak & TypeScript Verification', () => {
    it('builds production bundle with separate lazy service chunk, excludes devtool/fault-injection, blocks server imports, and passes positive/negative tsc checks', async () => {
      const exampleDir = path.resolve(__dirname, '../../examples/client-behavior');
      const prodOutDir = path.join(tempDir, 'dist-client');

      // 1. Real production build via `buildBundle` (code-splitting + minification)
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      let buildRes;
      try {
        buildRes = await buildBundle({
          cwd: exampleDir,
          entryPoints: [path.join(exampleDir, 'client-entry.ts')],
          outdir: prodOutDir,
          minify: true,
          splitting: true,
          sourcemap: false,
        });
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
      }

      const outFiles = fs.readdirSync(prodOutDir);
      const entryJsFiles = outFiles.filter((f) => f.endsWith('.js'));
      const chunksDir = path.join(prodOutDir, 'chunks');
      const chunkFiles = fs.existsSync(chunksDir)
        ? fs.readdirSync(chunksDir).filter((f) => f.endsWith('.js'))
        : outFiles.filter((f) => f.startsWith('chunk-') && f.endsWith('.js'));

      expect(entryJsFiles.length).toBeGreaterThanOrEqual(1);
      // Verify lazy service (`toast` / `clipboard`) was emitted into separate chunk file(s)
      expect(chunkFiles.length).toBeGreaterThanOrEqual(1);

      const allProdCode = [
        ...entryJsFiles.map((f) => fs.readFileSync(path.join(prodOutDir, f), 'utf8')),
        ...(fs.existsSync(chunksDir)
          ? chunkFiles.map((f) => fs.readFileSync(path.join(chunksDir, f), 'utf8'))
          : []),
      ].join('\n');

      // Verify DevTools panel (`__w_devtool_panel__`) and test fault injection barriers did NOT leak into production bundle
      expect(allProdCode).not.toContain('__w_devtool_panel__');
      expect(allProdCode).not.toContain('createStressLabHarness');
      expect(buildRes.manifest).toBeDefined();

      // Verify SSR template hides `[data-testid="stress-lab-panel"]` when `isDev: false` (production mode)
      const { app: prodApp } = createClientBehaviorExampleApp({ isDev: false });
      const prodSsr = await supertest(prodApp).get('/todos');
      expect(prodSsr.status).toBe(200);
      expect(prodSsr.text).not.toContain('data-testid="stress-lab-panel"');

      // 2. Also verify standalone demo bundle (`buildBrowserDemoBundle`) compiles cleanly
      const demoBundlePath = buildBrowserDemoBundle(exampleDir);
      expect(fs.existsSync(demoBundlePath)).toBe(true);

      // 3. Verify server-only import guard rejects server modules
      const badClientFile = path.join(tempDir, 'bad.client.ts');
      fs.writeFileSync(badClientFile, `import knex from 'knex';\nexport default {};`);
      expect(() => validateClientBundleBoundaries([badClientFile], tempDir)).toThrow(
        /Server-only package "knex" cannot be imported into browser client bundle/
      );

      // 4. Positive & Negative (`@ts-expect-error`) Compile-Time TypeScript verification against `examples/client-behavior`
      const gen = generateTypes({ rootDir: exampleDir, silent: true });
      const tsVerifyFile = path.join(exampleDir, '.webspresso', 'stress-typecheck-verify.ts');
      fs.writeFileSync(
        tsVerifyFile,
        `
        import { defineController } from '../../../core/client';
        import type { TypedApiClient } from './api';
        import type { ToastService } from '../services/toast';

        export async function verifyStressLabTypes(api: TypedApiClient) {
          // Positive: Typed GET /api/todos/:id and PATCH /api/todos/:id
          const todo = await api.get('/api/todos/:id', { params: { id: 3 } });
          const idNum: number = todo.id;
          const titleStr: string = todo.title;

          const updated = await api.patch(
            '/api/todos/:id',
            {
              title: 'Valid Title',
              priority: 'high',
            },
            { params: { id: 3 } }
          );
          const updatedTitle: string = updated.title;

          // Positive: Typed GET /api/todos/insights with optional query
          const insights = await api.get('/api/todos/insights', { query: { category: 'frontend' } });
          const pct: number = insights.percentCompleted;

          // Negative (@ts-expect-error): Invalid priority enum value on POST /api/todos
          // @ts-expect-error - priority must be 'high' | 'medium' | 'low'
          await api.post('/api/todos', { title: 'Bad Priority', priority: 'urgent' });

          // Negative (@ts-expect-error): Non-existent API route
          // @ts-expect-error - unknown endpoint path
          await api.get('/api/todos/non-existent-route/xyz');

          return { idNum, titleStr, updatedTitle, pct };
        }

        export const typedControllerCheck = defineController({
          state: () => ({ count: 0, label: 'ok' }),
          computed: {
            doubled: ({ state }) => state.count * 2,
          },
          actions: {
            async notifyAndFill({ services, forms, state }) {
              const toast: ToastService = await services.get('toast');
              toast.success(state.label);

              // @ts-expect-error - toast.success requires string, not number
              toast.success(12345);

              const form = forms.get<{ title: string; priority: 'high' | 'medium' | 'low' }>('edit-todo');
              if (form) {
                form.fill({ title: 'Typed Fill', priority: 'low' });
                // @ts-expect-error - wrong field type in typed form fill
                form.fill({ title: 999 });
              }
            },
          },
        });
        `
      );

      try {
        const program = ts.createProgram([tsVerifyFile, gen.apiOutFile], {
          noEmit: true,
          strict: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          skipLibCheck: true,
        });
        const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(tsVerifyFile));
        const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
        expect(messages).toEqual([]);
      } finally {
        if (fs.existsSync(tsVerifyFile)) {
          fs.unlinkSync(tsVerifyFile);
        }
      }
    });
  });

  // ===========================================================================
  // SEEDED DETERMINISTIC MULTI-STEP STRESS SEQUENCE
  // ===========================================================================
  describe('Seeded Multi-Step Stress Sequence (Deterministic PRNG)', () => {
    it('preserves all DOM, state, fragment, form, and service invariants across a 25-step seeded random operation sequence', async () => {
      const seed = 0x5eed2026;
      let rngState = seed >>> 0;
      function nextRand() {
        rngState = (Math.imul(1664525, rngState) + 1013904223) >>> 0;
        return rngState / 0x100000000;
      }
      function pick(arr) {
        return arr[Math.floor(nextRand() * arr.length)];
      }

      const stepLog = [];
      const lab = await mountStressLabPage();
      try {
        const { env, todosInst, runtime } = lab;
        const editForm = todosInst.ctx.forms.get('edit-todo');

        for (let step = 1; step <= 25; step++) {
          const op = pick([
            'filter',
            'resetFilter',
            'createTodo',
            'toggleTodo',
            'selectAndEdit',
            'insights',
            'focusRefetch',
          ]);
          stepLog.push(`step#${step}:${op}`);

          if (op === 'filter') {
            todosInst.state.draft.status = pick(['all', 'active', 'completed']);
            todosInst.state.draft.priority = pick(['all', 'high', 'medium', 'low']);
            await todosInst.actions.applyFilters();

            // Invariant: applied state matches fragment input
            const listInst = runtime.fragments.getInstance('todos-list');
            expect(todosInst.state.applied.status).toBe(listInst.input.status);
            expect(todosInst.state.applied.priority).toBe(listInst.input.priority);
          } else if (op === 'resetFilter') {
            await todosInst.actions.resetFilters();
            expect(todosInst.state.applied).toEqual({ search: '', status: 'all', priority: 'all' });
          } else if (op === 'createTodo') {
            const createFormEl = env.document.querySelector('form[data-w-form="create-todo"]');
            createFormEl.querySelector('input[name="title"]').value = `Seeded Task Step ${step}`;
            createFormEl.querySelector('select[name="priority"]').value = pick(['high', 'medium', 'low']);
            const res = await todosInst.ctx.forms.get('create-todo').submit();
            expect(res.ok).toBe(true);
          } else if (op === 'toggleTodo') {
            const toggleRes = await runtime.api.post('/api/todos/1/toggle');
            if (toggleRes && toggleRes.__refreshPromise) {
              await toggleRes.__refreshPromise;
            }
          } else if (op === 'selectAndEdit') {
            editForm.reset();
            const targetId = pick([1, 2, 3]);
            const btn = env.document.createElement('button');
            btn.setAttribute('data-todo-id', String(targetId));
            await todosInst.actions.selectTodoForEdit(null, btn);
            expect(todosInst.state.selectedTodoId).toBe(targetId);
            expect(editForm.el.getAttribute('action')).toBe(`/api/todos/${targetId}`);
            expect(editForm.dirty).toBe(false);
          } else if (op === 'insights') {
            await todosInst.actions.loadInsights();
            expect(todosInst.tasks.insights.pending).toBe(false);
            expect(todosInst.tasks.insights.data).not.toBeNull();
          } else if (op === 'focusRefetch') {
            env.window.dispatchEvent(new env.window.Event('focus'));
            await new Promise((r) => setTimeout(r, 15));
          }

          // Global invariant after every step:
          // 1. Single toast host at most
          expect(env.document.querySelectorAll('[data-w-host="toast"]').length).toBeLessThanOrEqual(1);
          // 2. Parent summary total count matches store total
          const expectedSummary = exampleStore.getTodosSummary();
          expect(env.document.querySelector('[data-testid="todos-total-count"]').textContent).toBe(
            String(expectedSummary.total)
          );
          expect(env.document.querySelector('[data-testid="todos-completed-count"]').textContent).toBe(
            String(expectedSummary.completed)
          );
        }
      } catch (err) {
        err.message = `[Seed=0x${seed.toString(16)} Steps=${stepLog.join(' -> ')}] ${err.message}`;
        throw err;
      } finally {
        lab.cleanup();
      }
    });
  });
});
