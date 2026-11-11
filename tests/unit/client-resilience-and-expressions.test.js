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
import { decorateElement } from '../../core/client/utils.js';
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

    it('invokes onSuccess and onSettled on successful refresh with res.ok === true', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-fragment="todos" data-w-fragment-id="todos:1" data-w-fragment-page="/todos">
          <p>Initial todos</p>
        </div>
      `);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            fragments: {
              'todos:1': {
                html: '<div data-w-fragment="todos" data-w-fragment-id="todos:1"><p>Updated todos</p></div>',
                loadMs: 5,
                renderMs: 2,
              },
            },
          }),
          { status: 200 }
        )
      );

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });

      coordinator.syncDomInstances();

      let successRes = null;
      let settledRes = null;
      let settledErr = undefined;

      const res = await coordinator.refresh(
        'todos',
        { page: 2 },
        {
          onSuccess(result) {
            successRes = result;
          },
          onSettled(result, error) {
            settledRes = result;
            settledErr = error;
          },
        }
      );

      expect(res.ok).toBe(true);
      expect(res.refreshed).toContain('todos:1');
      expect(successRes).not.toBeNull();
      expect(successRes.ok).toBe(true);
      expect(settledRes).not.toBeNull();
      expect(settledRes.ok).toBe(true);
      expect(settledErr).toBeNull();

      env.restore();
    });

    it('invokes onFailure / onError on refresh failure and suppresses rejection by default', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-fragment="todos" data-w-fragment-id="todos:1" data-w-fragment-page="/todos">
          <p>Initial todos</p>
        </div>
      `);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Database connection failed' } }),
          { status: 500 }
        )
      );

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });

      coordinator.syncDomInstances();

      let capturedError = null;
      let settledRes = undefined;
      let settledErr = null;

      // When onFailure is provided, refresh should NOT throw an unhandled rejection
      const res = await coordinator.refresh(
        'todos',
        { page: 2 },
        {
          onFailure(err) {
            capturedError = err;
          },
          onSettled(result, error) {
            settledRes = result;
            settledErr = error;
          },
        }
      );

      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
      expect(capturedError).not.toBeNull();
      expect(capturedError.message).toContain('Database connection failed');
      expect(capturedError.status).toBe(500);
      expect(settledRes).toBeNull();
      expect(settledErr).toBe(capturedError);

      env.restore();
    });

    it('invokes onFailure and rethrows when throwOnError: true is explicitly provided', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-fragment="todos" data-w-fragment-id="todos:1" data-w-fragment-page="/todos">
          <p>Initial todos</p>
        </div>
      `);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Server crash' } }),
          { status: 503 }
        )
      );

      const coordinator = createFragmentCoordinator({
        fetch: mockFetch,
        root: env.document,
      });

      coordinator.syncDomInstances();

      let callbackFired = false;
      let thrownError = null;

      try {
        await coordinator.refresh(
          'todos',
          { page: 2 },
          {
            throwOnError: true,
            onFailure(err) {
              callbackFired = true;
              expect(err.status).toBe(503);
            },
          }
        );
      } catch (e) {
        thrownError = e;
      }

      expect(callbackFired).toBe(true);
      expect(thrownError).not.toBeNull();
      expect(thrownError.status).toBe(503);

      env.restore();
    });

    it('calls onSuccess and onSettled when target fragment does not exist on page', async () => {
      const env = createMiniDomEnvironment(`<div>No fragments here</div>`);
      const coordinator = createFragmentCoordinator({ root: env.document });
      coordinator.syncDomInstances();

      let successFired = false;
      let settledFired = false;

      const res = await coordinator.refresh(
        'missing-fragment',
        {},
        {
          onSuccess(result) {
            successFired = true;
            expect(result.skipped).toBe(true);
          },
          onSettled(result, err) {
            settledFired = true;
            expect(result.skipped).toBe(true);
            expect(err).toBeNull();
          },
        }
      );

      expect(res.ok).toBe(true);
      expect(res.skipped).toBe(true);
      expect(successFired).toBe(true);
      expect(settledFired).toBe(true);

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

  describe('7. Enhanced Action & Target Elements with .data() API', () => {
    it('provides chainable and typed .data(key?, val?) access on DOM elements', () => {
      const env = createMiniDomEnvironment(`
        <button id="btn"
          data-priority="high"
          data-todo-id="42"
          data-is-active="true"
          data-code="0123"
          data-meta='{"author":"alex","views":100}'>
          Click
        </button>
      `);

      const btn = env.document.getElementById('btn');
      decorateElement(btn);

      // 1. Reading single attributes with automatic coercion
      expect(btn.data('priority')).toBe('high');
      expect(btn.data('todo-id')).toBe(42);
      expect(btn.data('todoId')).toBe(42); // CamelCase alias
      expect(btn.data('is-active')).toBe(true);
      expect(btn.data('isActive')).toBe(true);
      expect(btn.data('code')).toBe('0123'); // Leading zero preserved as string!
      expect(btn.data('meta')).toEqual({ author: 'alex', views: 100 });
      expect(btn.data('nonexistent')).toBeNull();

      // 2. Reading all attributes as a dictionary
      const allData = btn.data();
      expect(allData.priority).toBe('high');
      expect(allData.todoId).toBe(42);
      expect(allData.isActive).toBe(true);
      expect(allData.code).toBe('0123');
      expect(allData.meta).toEqual({ author: 'alex', views: 100 });

      // 3. Setting values
      const chained = btn.data('priority', 'urgent');
      expect(chained).toBe(btn);
      expect(btn.data('priority')).toBe('urgent');
      expect(btn.getAttribute('data-priority')).toBe('urgent');

      // 4. Batch setting
      btn.data({ status: 'done', count: 99 });
      expect(btn.data('status')).toBe('done');
      expect(btn.data('count')).toBe(99);

      // 5. Removing values via null
      btn.data('status', null);
      expect(btn.data('status')).toBeNull();

      env.restore();
    });

    it('injects decorated actionEl with .data() into controller actions and ctx.target', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="demo">
          <button id="action-btn" data-w-click="handleAction" data-priority="urgent" data-category="security">
            Action
          </button>
          <span data-w-target="badge" data-count="5">5</span>
        </div>
      `);

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });

      let capturedPriority = null;
      let capturedCategory = null;
      let capturedBadgeCount = null;
      let capturedParam = null;

      runtime.register(
        defineController({
          name: 'demo',
          state: () => ({}),
          actions: {
            handleAction(ctx, _evt, actionEl) {
              capturedPriority = actionEl.data('priority');
              capturedCategory = actionEl.data('category');
              capturedBadgeCount = ctx.target('badge').data('count');
              capturedParam = ctx.param('priority');
            },
          },
        })
      );

      const rootEl = env.document.querySelector('[data-w-controller="demo"]');
      await runtime.mountSubtree(rootEl);

      const btn = env.document.getElementById('action-btn');
      btn.dispatchEvent(new env.window.Event('click', { bubbles: true }));

      expect(capturedPriority).toBe('urgent');
      expect(capturedCategory).toBe('security');
      expect(capturedBadgeCount).toBe(5);
      expect(capturedParam).toBe('urgent');

      runtime.unmountSubtree(rootEl);
      env.restore();
    });
  });

  describe('8. React Query-Style Automatic Invalidation & Background Refetching', () => {
    it('refetches stale fragments on window focus / visibilitychange and respects staleTime', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-fragment="summary" data-w-fragment-id="summary-1" data-w-refetch-on-focus="true" data-w-stale-time="5000">
            <span id="sum-val">10</span>
          </div>
          <div data-w-fragment="feed" data-w-fragment-id="feed-1" data-w-refetch-on-focus="true" data-w-stale-time="0">
            <span id="feed-val">A</span>
          </div>
        </div>
      `);

      let requestBodies = [];
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        requestBodies.push(body);
        return new Response(
          JSON.stringify({
            fragments: {
              'summary-1': { html: '<span id="sum-val">20</span>' },
              'feed-1': { html: '<span id="feed-val">B</span>' },
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

      // 1. Immediately after mount, summary-1 is within its 5000ms staleTime, while feed-1 has staleTime=0
      env.window.dispatchEvent(new env.window.Event('focus'));
      await new Promise((r) => setTimeout(r, 40));

      expect(requestBodies).toHaveLength(1);
      expect(requestBodies[0].fragments.map((f) => f.instanceId)).toEqual(['feed-1']);
      expect(env.document.getElementById('feed-val').textContent).toBe('B');

      // 2. Expire summary-1's lastUpdatedAt and trigger focus again
      coordinator.getInstance('summary-1').lastUpdatedAt = Date.now() - 6000;
      env.window.dispatchEvent(new env.window.Event('focus'));
      await new Promise((r) => setTimeout(r, 40));

      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1].fragments.map((f) => f.instanceId).sort()).toEqual(['feed-1', 'summary-1']);
      expect(env.document.getElementById('sum-val').textContent).toBe('20');

      coordinator.dispose();
      env.restore();
    });

    it('refetches fragments on network reconnect (online) and periodic refetchInterval (pausing when hidden)', async () => {
      const env = createMiniDomEnvironment(`
        <div id="app">
          <div data-w-fragment="metrics" data-w-fragment-id="metrics-1" data-w-refetch-on-reconnect="true" data-w-refetch-interval="40">
            <span id="m-val">1</span>
          </div>
        </div>
      `);

      let count = 1;
      const mockFetch = vi.fn().mockImplementation(async () => {
        count += 1;
        return new Response(
          JSON.stringify({
            fragments: {
              'metrics-1': { html: `<span id="m-val">${count}</span>` },
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

      // Wait for at least 1 interval tick
      await new Promise((r) => setTimeout(r, 65));
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Hide document -> interval should pause
      env.document.visibilityState = 'hidden';
      const callsBeforeHiddenWait = mockFetch.mock.calls.length;
      await new Promise((r) => setTimeout(r, 90));
      expect(mockFetch.mock.calls.length).toBe(callsBeforeHiddenWait);

      // Trigger online reconnect event
      env.document.visibilityState = 'visible';
      env.window.dispatchEvent(new env.window.Event('online'));
      await new Promise((r) => setTimeout(r, 25));
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBeforeHiddenWait);

      coordinator.dispose();
      env.restore();
    });

    it('supports refetchOnMount, refetchOnWindowFocus, and refetchInterval on controller tasks', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="live-stats"></div>
      `);

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      let runCount = 0;

      runtime.register(
        defineController({
          name: 'live-stats',
          tasks: {
            poll: () => ({
              run: async () => {
                runCount += 1;
                return { count: runCount };
              },
              refetchOnMount: true,
              refetchOnWindowFocus: true,
              staleTime: 0,
            }),
          },
        })
      );

      const rootEl = env.document.querySelector('[data-w-controller="live-stats"]');
      const inst = runtime.mountControllerOnElement(rootEl, 'live-stats');

      // Wait microtask for refetchOnMount
      await new Promise((r) => setTimeout(r, 15));
      expect(runCount).toBe(1);
      expect(inst.tasks.poll.data).toEqual({ count: 1 });

      // Trigger window focus
      env.window.dispatchEvent(new env.window.Event('focus'));
      await new Promise((r) => setTimeout(r, 35));
      expect(runCount).toBe(2);
      expect(inst.tasks.poll.data).toEqual({ count: 2 });

      inst.destroy();
      env.restore();
    });
  });

  describe('9. Automatic Action & Task Busy States, Double-Click Guard & data-w-loading', () => {
    it('automatically sets data-w-busy, disabled, data-w-loading-text, data-w-loading-class, prevents double-clicks, and toggles data-w-loading indicators', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="busy-demo">
          <button id="save-btn" data-w-click="save" data-w-loading-text="Kaydediliyor..." data-w-loading-class="opacity-50 cursor-wait">Kaydet</button>
          <span id="global-spinner" data-w-loading>Yükleniyor...</span>
          <span id="save-spinner" data-w-loading="save" data-w-loading-class="animate-spin">Kaydediliyor Spinner</span>
          <span id="save-idle-label" data-w-loading-hide="save">Hazır</span>
          <span id="task-spinner" data-w-loading="syncData">Task Çalışıyor</span>
        </div>
      `);

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });

      let resolveSave;
      let resolveTask;
      let saveCallCount = 0;

      runtime.register(
        defineController({
          name: 'busy-demo',
          tasks: {
            syncData: () => () =>
              new Promise((r) => {
                resolveTask = r;
              }),
          },
          actions: {
            save() {
              saveCallCount += 1;
              return new Promise((r) => {
                resolveSave = r;
              });
            },
          },
        })
      );

      const rootEl = env.document.querySelector('[data-w-controller="busy-demo"]');
      const inst = runtime.mountControllerOnElement(rootEl, 'busy-demo');

      const saveBtn = env.document.getElementById('save-btn');
      const globalSpinner = env.document.getElementById('global-spinner');
      const saveSpinner = env.document.getElementById('save-spinner');
      const saveIdleLabel = env.document.getElementById('save-idle-label');
      const taskSpinner = env.document.getElementById('task-spinner');

      // Initial idle state
      expect(inst.ctx.isBusy).toBe(false);
      expect(inst.ctx.isActionBusy('save')).toBe(false);
      expect(globalSpinner.hasAttribute('hidden')).toBe(true);
      expect(saveSpinner.hasAttribute('hidden')).toBe(true);
      expect(saveIdleLabel.hasAttribute('hidden')).toBe(false);
      expect(taskSpinner.hasAttribute('hidden')).toBe(true);

      // Trigger save action on saveBtn
      const actionPromise = inst.invokeAction('save', null, saveBtn);
      expect(saveCallCount).toBe(1);
      expect(inst.ctx.isBusy).toBe(true);
      expect(inst.ctx.isActionBusy('save')).toBe(true);
      expect(saveBtn.getAttribute('data-w-busy')).toBe('true');
      expect(saveBtn.getAttribute('aria-busy')).toBe('true');
      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.textContent).toBe('Kaydediliyor...');
      expect(saveBtn.classList.contains('opacity-50')).toBe(true);
      expect(saveBtn.classList.contains('cursor-wait')).toBe(true);

      // Declarative indicators updated automatically
      expect(globalSpinner.hasAttribute('hidden')).toBe(false);
      expect(saveSpinner.hasAttribute('hidden')).toBe(false);
      expect(saveSpinner.classList.contains('animate-spin')).toBe(true);
      expect(saveIdleLabel.hasAttribute('hidden')).toBe(true);

      // Duplicate click while busy is ignored!
      const duplicateRes = inst.invokeAction('save', null, saveBtn);
      expect(duplicateRes).toBeUndefined();
      expect(saveCallCount).toBe(1);

      // Resolve save action
      resolveSave('done');
      await actionPromise;

      expect(inst.ctx.isBusy).toBe(false);
      expect(inst.ctx.isActionBusy('save')).toBe(false);
      expect(saveBtn.hasAttribute('data-w-busy')).toBe(false);
      expect(saveBtn.disabled).toBe(false);
      expect(saveBtn.textContent).toBe('Kaydet');
      expect(saveBtn.classList.contains('opacity-50')).toBe(false);
      expect(globalSpinner.hasAttribute('hidden')).toBe(true);
      expect(saveSpinner.hasAttribute('hidden')).toBe(true);
      expect(saveSpinner.classList.contains('animate-spin')).toBe(false);
      expect(saveIdleLabel.hasAttribute('hidden')).toBe(false);

      // Now run task and verify globalSpinner + taskSpinner react
      const taskPromise = inst.tasks.syncData.run();
      expect(inst.ctx.isBusy).toBe(true);
      expect(globalSpinner.hasAttribute('hidden')).toBe(false);
      expect(taskSpinner.hasAttribute('hidden')).toBe(false);

      resolveTask({ ok: true });
      await taskPromise;
      expect(inst.ctx.isBusy).toBe(false);
      expect(globalSpinner.hasAttribute('hidden')).toBe(true);
      expect(taskSpinner.hasAttribute('hidden')).toBe(true);

      inst.destroy();
      env.restore();
    });

    it('enforces data-w-confirm before executing an action', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="confirm-demo">
          <button id="del-btn" data-w-click="remove" data-w-confirm="Silmek istediğinize emin misiniz?">Sil</button>
        </div>
      `);

      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });
      let removed = false;

      runtime.register(
        defineController({
          name: 'confirm-demo',
          actions: {
            remove() {
              removed = true;
            },
          },
        })
      );

      const rootEl = env.document.querySelector('[data-w-controller="confirm-demo"]');
      const inst = runtime.mountControllerOnElement(rootEl, 'confirm-demo');
      const delBtn = env.document.getElementById('del-btn');

      // 1. User cancels confirmation
      env.window.confirm = vi.fn().mockReturnValue(false);
      global.window.confirm = env.window.confirm;
      inst.invokeAction('remove', null, delBtn);
      expect(env.window.confirm).toHaveBeenCalledWith('Silmek istediğinize emin misiniz?');
      expect(removed).toBe(false);

      // 2. User accepts confirmation
      env.window.confirm = vi.fn().mockReturnValue(true);
      global.window.confirm = env.window.confirm;
      inst.invokeAction('remove', null, delBtn);
      expect(removed).toBe(true);

      inst.destroy();
      env.restore();
    });
  });
});
