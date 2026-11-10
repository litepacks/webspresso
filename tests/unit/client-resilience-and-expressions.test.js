import { describe, it, expect, vi } from 'vitest';
import {
  createApiClient,
  ClientRequestError,
  normalizeRetryConfig,
  isRetryableError,
  calculateRetryDelay,
} from '../../core/client/api.js';
import { createFragmentCoordinator } from '../../core/client/fragments.js';
import {
  evaluateStateExpression,
  createDatastarAdapter,
} from '../../core/client/adapter/datastar.js';
import {
  defineController,
  createControllerRuntime,
} from '../../core/client/controller.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client Resilience & Expression Enhancements', () => {
  describe('1. API Request Timeout & Error Taxonomy', () => {
    it('initializes ClientRequestError with timeout flags and code', () => {
      const err = new ClientRequestError('Timeout occurred', {
        kind: 'timeout',
        status: 408,
      });

      expect(err.kind).toBe('timeout');
      expect(err.isTimedOut).toBe(true);
      expect(err.status).toBe(408);
      expect(err.code).toBe('REQUEST_TIMED_OUT');
      expect(err.isCanceled).toBe(false);
      expect(err.isNetwork).toBe(false);
      expect(err.isHttp).toBe(false);
    });

    it('aborts and throws structured ClientRequestError when request exceeds timeout', async () => {
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          }, 200);

          if (options && options.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      });

      const api = createApiClient({ fetch: mockFetch });

      let caughtErr = null;
      try {
        await api.get('/api/slow-operation', { timeout: 30 });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ClientRequestError);
      expect(caughtErr.kind).toBe('timeout');
      expect(caughtErr.isTimedOut).toBe(true);
      expect(caughtErr.status).toBe(408);
      expect(caughtErr.code).toBe('REQUEST_TIMED_OUT');
      expect(caughtErr.message).toContain('Request timed out after 30ms');
    });

    it('completes normally when request resolves well before timeout', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, count: 42 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const api = createApiClient({ fetch: mockFetch });
      const data = await api.get('/api/fast', { timeout: 1000 });

      expect(data).toEqual({ success: true, count: 42 });
    });
  });

  describe('2. Idempotent Retry Engine & Mutation Safety', () => {
    it('normalizes retry configuration and enforces mutation protection by default', () => {
      expect(normalizeRetryConfig(undefined, 'GET')).toBeNull();
      expect(normalizeRetryConfig(0, 'GET')).toBeNull();

      const getCfg = normalizeRetryConfig(true, 'GET');
      expect(getCfg).toEqual({
        count: 2,
        delay: 300,
        maxDelay: 5000,
        backoff: 'exponential',
        statusCodes: expect.any(Set),
        onRetry: null,
      });

      // Strict mutation protection: POST, PUT, PATCH, DELETE are NEVER retried by default
      expect(normalizeRetryConfig(3, 'POST')).toBeNull();
      expect(normalizeRetryConfig(true, 'PUT')).toBeNull();
      expect(normalizeRetryConfig(true, 'PATCH')).toBeNull();
      expect(normalizeRetryConfig(true, 'DELETE')).toBeNull();

      // Explicit opt-in via retryMutations: true
      const postExplicitCfg = normalizeRetryConfig(3, 'POST', true);
      expect(postExplicitCfg).not.toBeNull();
      expect(postExplicitCfg.count).toBe(3);
    });

    it('identifies transient errors correctly and never retries canceled or 4xx errors', () => {
      const statusCodes = new Set([408, 429, 502, 503, 504]);

      expect(isRetryableError(new ClientRequestError('net', { kind: 'network' }), statusCodes)).toBe(true);
      expect(isRetryableError(new ClientRequestError('time', { kind: 'timeout' }), statusCodes)).toBe(true);
      expect(isRetryableError(new ClientRequestError('503', { kind: 'http', status: 503 }), statusCodes)).toBe(true);
      expect(isRetryableError(new ClientRequestError('429', { kind: 'http', status: 429 }), statusCodes)).toBe(true);

      // Non-transient errors must NOT be retried
      expect(isRetryableError(new ClientRequestError('400', { kind: 'http', status: 400 }), statusCodes)).toBe(false);
      expect(isRetryableError(new ClientRequestError('401', { kind: 'http', status: 401 }), statusCodes)).toBe(false);
      expect(isRetryableError(new ClientRequestError('404', { kind: 'http', status: 404 }), statusCodes)).toBe(false);
      expect(isRetryableError(new ClientRequestError('422', { kind: 'validation', status: 422 }), statusCodes)).toBe(false);
      expect(isRetryableError(new ClientRequestError('canc', { kind: 'canceled' }), statusCodes)).toBe(false);
    });

    it('retries GET on transient 503 error with backoff and succeeds on recovery', async () => {
      let callCount = 0;
      const retryLog = [];

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response(JSON.stringify({ error: 'Service Unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ restored: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const api = createApiClient({ fetch: mockFetch });

      const result = await api.get('/api/health-check', {
        retry: {
          count: 3,
          delay: 10,
          maxDelay: 50,
          backoff: 'linear',
          onRetry: (err, attempt, delay) => {
            retryLog.push({ attempt, status: err.status, delay });
          },
        },
      });

      expect(result).toEqual({ restored: true });
      expect(callCount).toBe(3);
      expect(retryLog.length).toBe(2);
      expect(retryLog[0].attempt).toBe(1);
      expect(retryLog[0].status).toBe(503);
      expect(retryLog[1].attempt).toBe(2);
    });

    it('fails immediately without retry on non-retryable 404 HTTP error', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ message: 'Resource not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      });

      const api = createApiClient({ fetch: mockFetch });

      await expect(
        api.get('/api/missing', {
          retry: { count: 3, delay: 10 },
        })
      ).rejects.toThrow('Resource not found');

      expect(callCount).toBe(1);
    });

    it('does NOT retry POST mutations even if retry: 3 is passed (unless retryMutations: true)', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Gateway timeout' }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        });
      });

      const api = createApiClient({ fetch: mockFetch });

      await expect(
        api.post('/api/charge-payment', { amount: 100 }, { retry: 3 })
      ).rejects.toThrow();

      // Exactly 1 attempt, zero automatic retry on mutations
      expect(callCount).toBe(1);
    });
  });

  describe('3. Fragment Batch Refresh Timeout', () => {
    it('times out fragment refresh if endpoint hangs and throws FRAGMENT_REFRESH_TIMEOUT', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-fragment="feed" data-w-fragment-id="feed:1" data-w-fragment-page="/feed">
          <p>Initial feed</p>
        </div>
      `);

      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(new Response(JSON.stringify({ fragments: [] }), { status: 200 }));
          }, 200);

          if (options && options.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      });

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        timeout: 30, // 30ms timeout for testing
        root: env.document,
      });

      coordinator.syncDomInstances();

      let err = null;
      try {
        await coordinator.refresh('feed', {}, { timeout: 30 });
      } catch (e) {
        err = e;
      }

      expect(err).not.toBeNull();
      expect(err.code).toBe('FRAGMENT_REFRESH_TIMEOUT');
      expect(err.isTimedOut).toBe(true);
      expect(err.message).toContain('timed out after 30ms');

      env.restore();
    });
  });

  describe('4. Declarative Logical Operators in Expressions (&&, ||)', () => {
    it('evaluates logical AND (&&) with short-circuiting', () => {
      const state = { isReady: true, hasError: false, count: 5 };

      expect(evaluateStateExpression(state, 'isReady && !hasError')).toBe(true);
      expect(evaluateStateExpression(state, 'count > 0 && isReady')).toBe(true);
      expect(evaluateStateExpression(state, 'count > 10 && isReady')).toBe(false);
      expect(evaluateStateExpression(state, '!isReady && count > 0')).toBe(false);
    });

    it('evaluates logical OR (||) with short-circuiting', () => {
      const state = { status: 'pending', role: 'editor' };

      expect(evaluateStateExpression(state, "status === 'active' || status === 'pending'")).toBe(true);
      expect(evaluateStateExpression(state, "status === 'active' || status === 'archived'")).toBe(false);
      expect(evaluateStateExpression(state, "role === 'admin' || role === 'editor'")).toBe(true);
    });

    it('respects operator precedence: && binds tighter than ||', () => {
      // false || true && true => false || (true && true) => true
      const state = { a: false, b: true, c: true };
      expect(evaluateStateExpression(state, 'a || b && c')).toBe(true);

      // false && false || true => (false && false) || true => true
      const state2 = { a: false, b: false, c: true };
      expect(evaluateStateExpression(state2, 'a && b || c')).toBe(true);

      // true && false || false => (true && false) || false => false
      const state3 = { a: true, b: false, c: false };
      expect(evaluateStateExpression(state3, 'a && b || c')).toBe(false);
    });

    it('supports parenthesized groups: (a || b) && c', () => {
      const state = { a: true, b: false, c: false };
      // (true || false) && false => true && false => false
      expect(evaluateStateExpression(state, '(a || b) && c')).toBe(false);

      const state2 = { a: true, b: false, c: true };
      // (true || false) && true => true && true => true
      expect(evaluateStateExpression(state2, '(a || b) && c')).toBe(true);
    });

    it('does not split on operators inside string literals', () => {
      const state = {
        title: 'Rock && Roll',
        tag: 'cat || dog',
      };

      expect(evaluateStateExpression(state, "title === 'Rock && Roll'")).toBe(true);
      expect(evaluateStateExpression(state, 'tag === "cat || dog"')).toBe(true);
      expect(evaluateStateExpression(state, "title === 'Rock && Roll' && tag === 'cat || dog'")).toBe(true);
    });
  });

  describe('5. Controller Error Boundary (onError & w-controller:error)', () => {
    it('captures errors via defineController({ onError }) and records ctx.lastError', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="error-boundary-test"></div>
      `);

      const errorLog = [];
      const controllerDef = defineController({
        name: 'error-boundary-test',
        state: () => ({ counter: 0 }),
        onError: (err, ctx, meta) => {
          errorLog.push({ err, name: ctx.name, meta });
        },
        actions: {
          boom() {
            throw new Error('Explosion in action');
          },
          async asyncBoom() {
            throw new Error('Async explosion');
          },
        },
      });

      const rootEl = env.document.querySelector('[data-w-controller="error-boundary-test"]');

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      runtime.register('error-boundary-test', controllerDef);

      const instance = runtime.mountControllerOnElement(rootEl, 'error-boundary-test');
      expect(instance).not.toBeNull();
      expect(instance.ctx.lastError).toBeNull();

      // 1. Sync action throw
      expect(() => instance.actions.boom()).toThrow('Explosion in action');
      expect(errorLog.length).toBe(1);
      expect(errorLog[0].err.message).toBe('Explosion in action');
      expect(errorLog[0].meta.action).toBe('boom');
      expect(errorLog[0].meta.phase).toBe('action');
      expect(instance.ctx.lastError.message).toBe('Explosion in action');

      // Clear error
      instance.ctx.clearError();
      expect(instance.ctx.lastError).toBeNull();

      // 2. Async action rejection
      await expect(instance.actions.asyncBoom()).rejects.toThrow('Async explosion');
      expect(errorLog.length).toBe(2);
      expect(errorLog[1].err.message).toBe('Async explosion');
      expect(instance.ctx.lastError.message).toBe('Async explosion');

      instance.destroy();
      env.restore();
    });

    it('dispatches bubbling w-controller:error DOM event caught by parent container', async () => {
      const env = createMiniDomEnvironment(`
        <div id="container">
          <div data-w-controller="event-bubble-test"></div>
        </div>
      `);

      const container = env.document.getElementById('container');
      const rootEl = env.document.querySelector('[data-w-controller="event-bubble-test"]');

      const domEvents = [];
      container.addEventListener('w-controller:error', (evt) => {
        domEvents.push(evt.detail);
      });

      const controllerDef = defineController({
        name: 'event-bubble-test',
        actions: {
          failingAction() {
            throw new Error('Network failure simulation');
          },
        },
      });

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      runtime.register('event-bubble-test', controllerDef);

      const instance = runtime.mountControllerOnElement(rootEl, 'event-bubble-test');

      expect(() => instance.actions.failingAction()).toThrow('Network failure simulation');

      expect(domEvents.length).toBe(1);
      expect(domEvents[0].error.message).toBe('Network failure simulation');
      expect(domEvents[0].controllerName).toBe('event-bubble-test');
      expect(domEvents[0].action).toBe('failingAction');

      instance.destroy();
      env.restore();
    });

    it('supports dynamic ctx.onError listener with cleanup', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="dynamic-error-test"></div>
      `);
      const rootEl = env.document.querySelector('[data-w-controller="dynamic-error-test"]');

      const dynamicCalls = [];

      const controllerDef = defineController({
        name: 'dynamic-error-test',
        actions: {
          fail() {
            throw new Error('Dynamic failure');
          },
        },
      });

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      runtime.register('dynamic-error-test', controllerDef);

      const instance = runtime.mountControllerOnElement(rootEl, 'dynamic-error-test');

      const unregister = instance.ctx.onError((err, meta) => {
        dynamicCalls.push({ msg: err.message, meta });
      });

      expect(() => instance.actions.fail()).toThrow('Dynamic failure');
      expect(dynamicCalls.length).toBe(1);
      expect(dynamicCalls[0].msg).toBe('Dynamic failure');

      // Unregister listener
      unregister();
      expect(() => instance.actions.fail()).toThrow('Dynamic failure');
      // No second call recorded
      expect(dynamicCalls.length).toBe(1);

      instance.destroy();
      env.restore();
    });

    it('captures task execution errors and bubbles w-controller:error with phase: "task"', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="task-error-test"></div>
      `);
      const rootEl = env.document.querySelector('[data-w-controller="task-error-test"]');

      const errorCalls = [];
      const controllerDef = defineController({
        name: 'task-error-test',
        onError: (err, ctx, meta) => {
          errorCalls.push({ err, meta });
        },
        tasks: {
          fetchData: () => ({
            run: async () => {
              throw new Error('Task computation failed');
            },
          }),
        },
      });

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      runtime.register('task-error-test', controllerDef);

      const instance = runtime.mountControllerOnElement(rootEl, 'task-error-test');

      await expect(instance.ctx.tasks.fetchData.run()).rejects.toThrow('Task computation failed');

      expect(errorCalls.length).toBe(1);
      expect(errorCalls[0].err.message).toBe('Task computation failed');
      expect(errorCalls[0].meta.task).toBe('fetchData');
      expect(errorCalls[0].meta.phase).toBe('task');
      expect(instance.ctx.lastError.message).toBe('Task computation failed');

      instance.destroy();
      env.restore();
    });
  });

  describe('6. Multi-Fragment Dynamics, Parent-Child Deduplication & Inter-Fragment Communication', () => {
    it('coalesces multiple sibling fragments into a single batch request matching invalidated tags', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-fragment="summary" data-w-fragment-id="summary-1" data-w-depends-on="orders,users">
            <span id="sum">0</span>
          </div>
          <div data-w-fragment="ordersList" data-w-fragment-id="orders-1" data-w-depends-on="orders">
            <span id="ord">0</span>
          </div>
          <div data-w-fragment="notifications" data-w-fragment-id="notif-1" data-w-depends-on="notifications">
            <span id="not">0</span>
          </div>
        </div>
      `);

      let capturedPayload = null;
      let requestCount = 0;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        requestCount++;
        capturedPayload = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            fragments: {
              'summary-1': { html: '<span id="sum">5</span>' },
              'orders-1': { html: '<span id="ord">10</span>' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });

      coordinator.syncDomInstances();

      // Invalidate 'orders' - should match summary-1 and orders-1, but not notif-1
      const res = await coordinator.invalidate(['orders']);

      expect(requestCount).toBe(1);
      expect(res.refreshed).toEqual(['summary-1', 'orders-1']);
      expect(capturedPayload.fragments).toHaveLength(2);
      expect(capturedPayload.fragments.map((f) => f.instanceId)).toEqual(['summary-1', 'orders-1']);

      // DOM updated
      expect(env.document.getElementById('sum').textContent).toBe('5');
      expect(env.document.getElementById('ord').textContent).toBe('10');
      expect(env.document.getElementById('not').textContent).toBe('0');

      env.restore();
    });

    it('deduplicates child fragment when parent and child both match invalidated tag', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <!-- Parent Fragment -->
          <div data-w-fragment="projectDetail" data-w-fragment-id="proj-1" data-w-depends-on="tasks">
            <h2>Project</h2>
            <!-- Child Fragment nested inside Parent -->
            <div data-w-fragment="taskList" data-w-fragment-id="tasks-1" data-w-depends-on="tasks">
              <span id="task-count">1</span>
            </div>
          </div>
        </div>
      `);

      let capturedPayload = null;
      let requestCount = 0;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        requestCount++;
        capturedPayload = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            fragments: {
              'proj-1': {
                html: '<h2>Project Updated</h2><div data-w-fragment="taskList" data-w-fragment-id="tasks-1" data-w-depends-on="tasks"><span id="task-count">2</span></div>',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });

      coordinator.syncDomInstances();

      // Both proj-1 and tasks-1 depend on 'tasks'
      const res = await coordinator.invalidate(['tasks']);

      expect(requestCount).toBe(1);
      // Only the parent is requested!
      expect(capturedPayload.fragments).toHaveLength(1);
      expect(capturedPayload.fragments[0].instanceId).toBe('proj-1');
      expect(res.refreshed).toEqual(['proj-1']);

      env.restore();
    });

    it('enables programmatic fragment control via ctx.fragment and ctx.refresh', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-controller="search-toolbar">
            <button data-w-action="changePage">Next Page</button>
          </div>
          <div data-w-fragment="itemsList" data-w-fragment-id="items-1" data-w-fragment-input='{"page":1,"search":"test"}'>
            <span id="page-num">1</span>
          </div>
        </div>
      `);

      let capturedPayload = null;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedPayload = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            fragments: {
              'items-1': {
                html: '<span id="page-num">2</span>',
                input: { page: 2, search: 'test' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });
      coordinator.syncDomInstances();

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar, fragments: coordinator });

      let readInputBefore = null;

      const controllerDef = defineController({
        name: 'search-toolbar',
        actions: {
          async changePage(ctx) {
            readInputBefore = ctx.fragment('items-1').input;
            await ctx.refresh('items-1', { page: 2 });
          },
        },
      });

      runtime.register('search-toolbar', controllerDef);
      const rootEl = env.document.querySelector('[data-w-controller="search-toolbar"]');
      const instance = runtime.mountControllerOnElement(rootEl, 'search-toolbar');

      await instance.actions.changePage();

      expect(readInputBefore).toEqual({ page: 1, search: 'test' });
      expect(capturedPayload.fragments[0].input).toEqual({ page: 2, search: 'test' });
      expect(env.document.getElementById('page-num').textContent).toBe('2');

      instance.destroy();
      env.restore();
    });

    it('enables cross-fragment controller communication via CustomEvents (ctx.emit & ctx.on)', () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-controller="sidebar-ctrl"></div>
          <div data-w-controller="content-ctrl"></div>
        </div>
      `);

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });

      let contentReceivedCategory = null;

      const sidebarDef = defineController({
        name: 'sidebar-ctrl',
        actions: {
          selectCategory(ctx) {
            ctx.emit('category:selected', { category: 'hardware' });
          },
        },
      });

      const contentDef = defineController({
        name: 'content-ctrl',
        state: () => ({ activeCategory: 'all' }),
        connect(ctx) {
          return ctx.on(env.document, 'category:selected', (evt) => {
            ctx.state.activeCategory = evt.detail.category;
            contentReceivedCategory = evt.detail.category;
          });
        },
      });

      runtime.register('sidebar-ctrl', sidebarDef);
      runtime.register('content-ctrl', contentDef);

      const sidebarEl = env.document.querySelector('[data-w-controller="sidebar-ctrl"]');
      const contentEl = env.document.querySelector('[data-w-controller="content-ctrl"]');

      const sidebarInst = runtime.mountControllerOnElement(sidebarEl, 'sidebar-ctrl');
      const contentInst = runtime.mountControllerOnElement(contentEl, 'content-ctrl');

      expect(contentInst.state.activeCategory).toBe('all');

      // Sidebar emits event
      sidebarInst.actions.selectCategory();

      expect(contentReceivedCategory).toBe('hardware');
      expect(contentInst.state.activeCategory).toBe('hardware');

      sidebarInst.destroy();
      contentInst.destroy();
      env.restore();
    });

    it('coalesces multiple synchronous invalidate calls into a single network batch', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-fragment="fragA" data-w-fragment-id="frag-a" data-w-depends-on="tagA">
            <span>A</span>
          </div>
          <div data-w-fragment="fragB" data-w-fragment-id="frag-b" data-w-depends-on="tagB">
            <span>B</span>
          </div>
        </div>
      `);

      let requestCount = 0;
      let capturedPayload = null;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        requestCount++;
        capturedPayload = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            fragments: {
              'frag-a': { html: '<span>A updated</span>' },
              'frag-b': { html: '<span>B updated</span>' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });
      coordinator.syncDomInstances();

      // Trigger two separate invalidations in the same event tick
      await Promise.all([
        coordinator.invalidate(['tagA']),
        coordinator.invalidate(['tagB']),
      ]);

      // Exactly 1 network request fired
      expect(requestCount).toBe(1);
      expect(capturedPayload.fragments).toHaveLength(2);
      expect(capturedPayload.fragments.map((f) => f.instanceId).sort()).toEqual(['frag-a', 'frag-b']);

      env.restore();
    });
  });
});
