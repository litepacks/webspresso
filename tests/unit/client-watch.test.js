import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defineController,
  createControllerRuntime,
  watch,
} from '../../core/client/controller.js';
import { createDatastarAdapter } from '../../core/client/adapter/datastar.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client Watch API (`core/client/controller.js`)', () => {
  let domEnv = null;
  let datastar = null;

  beforeEach(() => {
    domEnv = createMiniDomEnvironment();
    datastar = createDatastarAdapter();
  });

  afterEach(() => {
    if (domEnv) {
      domEnv.restore();
      domEnv = null;
    }
  });

  function setupRuntime() {
    return createControllerRuntime({
      root: domEnv.document.body,
      datastar,
    });
  }

  describe('1. Basic Getter Function Watching', () => {
    it('does not fire on initialization when immediate is false (default)', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-basic',
        state: () => ({ count: 0 }),
        connect({ state, watch }) {
          watch(
            () => state.count,
            (newVal, oldVal) => {
              calls.push({ newVal, oldVal });
            }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-basic', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-basic');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-basic');

      expect(calls).toEqual([]);

      inst.state.count = 1;
      expect(calls).toEqual([{ newVal: 1, oldVal: 0 }]);

      inst.state.count = 5;
      expect(calls).toEqual([
        { newVal: 1, oldVal: 0 },
        { newVal: 5, oldVal: 1 },
      ]);
    });

    it('fires immediately on initialization when { immediate: true }', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-immediate',
        state: () => ({ status: 'pending' }),
        connect({ state, watch }) {
          watch(
            () => state.status,
            (newVal, oldVal) => {
              calls.push({ newVal, oldVal });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-immediate', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-immediate');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-immediate');

      // Immediate call receives undefined for oldValue
      expect(calls).toEqual([{ newVal: 'pending', oldVal: undefined }]);

      inst.state.status = 'running';
      expect(calls).toEqual([
        { newVal: 'pending', oldVal: undefined },
        { newVal: 'running', oldVal: 'pending' },
      ]);
    });

    it('faithfully matches the user-requested format: watch(() => cond, fn, { immediate: true })', () => {
      const RaceStatus = { Idle: 'idle', Running: 'running', Finished: 'finished' };
      let stepCount = 0;
      let stopCount = 0;

      const controller = defineController({
        name: 'test-user-format',
        state: () => ({ status: RaceStatus.Idle }),
        connect({ state, watch }) {
          function stop() {
            stopCount++;
          }
          function step() {
            stepCount++;
          }

          watch(
            () => state.status === RaceStatus.Running,
            (running) => {
              stop();
              if (running) {
                step();
              }
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-user-format', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-user-format');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-user-format');

      // Initial run: running is false, stop() called once, step() not called
      expect(stopCount).toBe(1);
      expect(stepCount).toBe(0);

      // Transition to Running
      inst.state.status = RaceStatus.Running;
      expect(stopCount).toBe(2);
      expect(stepCount).toBe(1);

      // Transition to Finished
      inst.state.status = RaceStatus.Finished;
      expect(stopCount).toBe(3);
      expect(stepCount).toBe(1);
    });
  });

  describe('2. State Dot-Path Source Strings', () => {
    it('watches root and nested properties via dot-path string', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-dotpath',
        state: () => ({
          filters: {
            priority: 'all',
          },
        }),
        connect({ state, watch }) {
          watch(
            'filters.priority',
            (newVal, oldVal) => {
              calls.push({ newVal, oldVal });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-dotpath', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-dotpath');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-dotpath');

      expect(calls).toEqual([{ newVal: 'all', oldVal: undefined }]);

      inst.state.filters.priority = 'urgent';
      expect(calls).toEqual([
        { newVal: 'all', oldVal: undefined },
        { newVal: 'urgent', oldVal: 'all' },
      ]);
    });
  });

  describe('3. Array of Sources', () => {
    it('watches multiple reactive sources simultaneously', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-array-sources',
        state: () => ({
          page: 1,
          search: '',
        }),
        connect({ state, watch }) {
          watch(
            [() => state.page, () => state.search],
            (newVals, oldVals) => {
              calls.push({ newVals, oldVals });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-array-sources', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-array-sources');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-array-sources');

      expect(calls).toEqual([{ newVals: [1, ''], oldVals: undefined }]);

      inst.state.page = 2;
      expect(calls).toEqual([
        { newVals: [1, ''], oldVals: undefined },
        { newVals: [2, ''], oldVals: [1, ''] },
      ]);

      inst.state.search = 'apple';
      expect(calls).toEqual([
        { newVals: [1, ''], oldVals: undefined },
        { newVals: [2, ''], oldVals: [1, ''] },
        { newVals: [2, 'apple'], oldVals: [2, ''] },
      ]);
    });
  });

  describe('4. Deep Watching ({ deep: true })', () => {
    it('detects nested mutations and snapshots previous values', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-deep',
        state: () => ({
          user: {
            profile: {
              name: 'Alice',
              tags: ['admin'],
            },
          },
        }),
        connect({ state, watch }) {
          watch(
            () => state.user,
            (newVal, oldVal) => {
              calls.push({
                newName: newVal.profile.name,
                oldName: oldVal ? oldVal.profile.name : undefined,
              });
            },
            { deep: true, immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-deep', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-deep');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-deep');

      expect(calls).toEqual([{ newName: 'Alice', oldName: undefined }]);

      inst.state.user.profile.name = 'Bob';
      expect(calls).toEqual([
        { newName: 'Alice', oldName: undefined },
        { newName: 'Bob', oldName: 'Alice' },
      ]);
    });
  });

  describe('5. Side-Effect Cleanup with onCleanup', () => {
    it('invokes onCleanup before the next run and on teardown', () => {
      const cleanedUp = [];
      const runs = [];

      const controller = defineController({
        name: 'test-cleanup',
        state: () => ({ query: 'a' }),
        connect({ state, watch }) {
          watch(
            () => state.query,
            (newQuery, _old, onCleanup) => {
              runs.push(newQuery);
              onCleanup(() => {
                cleanedUp.push(newQuery);
              });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-cleanup', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-cleanup');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-cleanup');

      expect(runs).toEqual(['a']);
      expect(cleanedUp).toEqual([]);

      inst.state.query = 'b';
      expect(runs).toEqual(['a', 'b']);
      expect(cleanedUp).toEqual(['a']);

      inst.state.query = 'c';
      expect(runs).toEqual(['a', 'b', 'c']);
      expect(cleanedUp).toEqual(['a', 'b']);

      // Disconnect/destroy instance should trigger final cleanup
      inst.destroy();
      expect(cleanedUp).toEqual(['a', 'b', 'c']);
    });
  });

  describe('6. One-Shot Watching ({ once: true })', () => {
    it('executes only once on the first change and unregisters', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-once',
        state: () => ({ val: 0 }),
        connect({ state, watch }) {
          watch(
            () => state.val,
            (newVal, oldVal) => {
              calls.push({ newVal, oldVal });
            },
            { once: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-once', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-once');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-once');

      expect(calls).toEqual([]);

      inst.state.val = 10;
      expect(calls).toEqual([{ newVal: 10, oldVal: 0 }]);

      // Subsequent changes are ignored
      inst.state.val = 20;
      inst.state.val = 30;
      expect(calls).toEqual([{ newVal: 10, oldVal: 0 }]);
    });

    it('executes once on immediate run when { once: true, immediate: true }', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-once-immediate',
        state: () => ({ val: 5 }),
        connect({ state, watch }) {
          watch(
            () => state.val,
            (newVal, oldVal) => {
              calls.push({ newVal, oldVal });
            },
            { once: true, immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-once-immediate', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-once-immediate');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-once-immediate');

      expect(calls).toEqual([{ newVal: 5, oldVal: undefined }]);

      inst.state.val = 15;
      expect(calls).toEqual([{ newVal: 5, oldVal: undefined }]);
    });
  });

  describe('7. Manual Cancellation via returned unwatch()', () => {
    it('stops watching and invokes cleanup when unwatch() is called', () => {
      const calls = [];
      let cleanupInvoked = false;
      let unwatchFn = null;

      const controller = defineController({
        name: 'test-unwatch',
        state: () => ({ count: 1 }),
        connect({ state, watch }) {
          unwatchFn = watch(
            () => state.count,
            (newVal, oldVal, onCleanup) => {
              calls.push({ newVal, oldVal });
              onCleanup(() => {
                cleanupInvoked = true;
              });
            }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-unwatch', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-unwatch');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-unwatch');

      inst.state.count = 2;
      expect(calls).toEqual([{ newVal: 2, oldVal: 1 }]);
      expect(cleanupInvoked).toBe(false);

      expect(typeof unwatchFn).toBe('function');
      unwatchFn();
      expect(cleanupInvoked).toBe(true);

      inst.state.count = 3;
      expect(calls).toEqual([{ newVal: 2, oldVal: 1 }]);
    });
  });

  describe('8. Declarative `watch` in defineController', () => {
    it('registers function handlers and descriptor objects from controller definition', () => {
      const callsA = [];
      const callsB = [];
      let handlerThisRef = null;

      const controller = defineController({
        name: 'test-declarative',
        state: () => ({
          status: 'initial',
          nested: { score: 10 },
        }),
        watch: {
          status(newVal, oldVal, onCleanup, ctx) {
            handlerThisRef = this;
            callsA.push({ newVal, oldVal, hasCtx: Boolean(ctx) });
          },
          'nested.score': {
            handler(newVal, oldVal) {
              callsB.push({ newVal, oldVal });
            },
            immediate: true,
          },
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-declarative', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-declarative');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-declarative');

      // callsB has immediate: true
      expect(callsB).toEqual([{ newVal: 10, oldVal: undefined }]);
      // callsA is non-immediate
      expect(callsA).toEqual([]);

      inst.state.status = 'active';
      expect(callsA).toEqual([{ newVal: 'active', oldVal: 'initial', hasCtx: true }]);
      expect(handlerThisRef).toBe(inst.ctx);

      inst.state.nested.score = 25;
      expect(callsB).toEqual([
        { newVal: 10, oldVal: undefined },
        { newVal: 25, oldVal: 10 },
      ]);
    });
  });

  describe('9. Standalone watch() and Ambient Controller Binding', () => {
    it('standalone watch() inside connect() automatically binds to controller lifecycle', () => {
      let cleanedUp = false;
      const calls = [];

      const controller = defineController({
        name: 'test-standalone-ambient',
        state: () => ({ active: false }),
        connect({ state }) {
          // Calling the imported standalone watch() inside connect()
          watch(
            () => state.active,
            (newVal, oldVal, onCleanup) => {
              calls.push({ newVal, oldVal });
              onCleanup(() => {
                cleanedUp = true;
              });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-standalone-ambient', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-standalone-ambient');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-standalone-ambient');

      expect(calls).toEqual([{ newVal: false, oldVal: undefined }]);

      inst.state.active = true;
      expect(calls).toEqual([
        { newVal: false, oldVal: undefined },
        { newVal: true, oldVal: false },
      ]);

      // Unmounting controller cleans up the ambient watcher
      inst.destroy();
      expect(cleanedUp).toBe(true);
    });

    it('untracked callback isolation prevents accidental reactive loops or subscriptions', () => {
      const calls = [];
      const controller = defineController({
        name: 'test-untracked',
        state: () => ({
          watchedKey: 1,
          otherKey: 100,
        }),
        connect({ state, watch }) {
          watch(
            () => state.watchedKey,
            (newVal) => {
              // Reading otherKey inside the callback MUST NOT subscribe the watcher to otherKey
              calls.push({ watched: newVal, other: state.otherKey });
            },
            { immediate: true }
          );
        },
      });

      const runtime = setupRuntime();
      runtime.register('test-untracked', controller);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'test-untracked');
      domEnv.document.body.appendChild(el);
      const inst = runtime.mountControllerOnElement(el, 'test-untracked');

      expect(calls).toEqual([{ watched: 1, other: 100 }]);

      // Mutating otherKey should NOT trigger the watcher!
      inst.state.otherKey = 200;
      expect(calls).toEqual([{ watched: 1, other: 100 }]);

      // Mutating watchedKey SHOULD trigger the watcher
      inst.state.watchedKey = 2;
      expect(calls).toEqual([
        { watched: 1, other: 100 },
        { watched: 2, other: 200 },
      ]);
    });
  });
});
