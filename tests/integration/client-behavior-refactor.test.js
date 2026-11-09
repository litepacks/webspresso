'use strict';

const fs = require('fs');
const path = require('path');
const { createTempDir, cleanupDir } = require('../utils/fs');
const { createMiniDomEnvironment, MiniEvent } = require('../utils/mini-dom');
const {
  defineController,
  createClientRuntime,
  createApiClient,
  createFormHandle,
  createDatastarAdapter,
} = require('../../core/client');

describe('Datastar Client Behavior Layer — Refactored Infrastructure Tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-client-refactor-');
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  // =========================================================================
  // 1. Two-Way Data Binding (`data-w-model`)
  // =========================================================================
  describe('1. Two-Way Data Binding (data-w-model)', () => {
    it('synchronizes input -> state and state -> input with nested paths', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="filter-box">
          <input type="text" data-w-model="draft.search" data-w-target="searchInput">
          <select data-w-model="draft.status" data-w-target="statusSelect">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
          <span data-w-text="draft.search" data-w-target="searchEcho"></span>
          <span data-w-text="draft.status" data-w-target="statusEcho"></span>
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({
            draft: {
              search: 'initial text',
              status: 'all',
            },
          }),
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'filter-box': controller },
        });
        runtime.mount();

        const searchInput = env.document.querySelector('[data-w-target="searchInput"]');
        const statusSelect = env.document.querySelector('[data-w-target="statusSelect"]');
        const searchEcho = env.document.querySelector('[data-w-target="searchEcho"]');
        const statusEcho = env.document.querySelector('[data-w-target="statusEcho"]');

        // Initial state -> input
        expect(searchInput.value).toBe('initial text');
        expect(statusSelect.value).toBe('all');
        expect(searchEcho.textContent).toBe('initial text');
        expect(statusEcho.textContent).toBe('all');

        // Input -> state
        searchInput.value = 'hello webspresso';
        searchInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(capturedState.draft.search).toBe('hello webspresso');
        expect(searchEcho.textContent).toBe('hello webspresso');

        // Select -> state
        statusSelect.value = 'active';
        statusSelect.dispatchEvent(new MiniEvent('change', { bubbles: true }));
        expect(capturedState.draft.status).toBe('active');
        expect(statusEcho.textContent).toBe('active');

        // Programmatic state -> input (does not trigger loops)
        capturedState.draft.search = 'updated programmatically';
        expect(searchInput.value).toBe('updated programmatically');
        expect(searchEcho.textContent).toBe('updated programmatically');

        capturedState.draft.status = 'done';
        expect(statusSelect.value).toBe('done');
        expect(statusEcho.textContent).toBe('done');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('isolates nested model state between two instances of the same controller', () => {
      const env = createMiniDomEnvironment(`
        <div>
          <div id="inst-1" data-w-controller="search-widget">
            <input type="text" data-w-model="filter.query" data-w-target="queryInput">
            <span data-w-text="filter.query" data-w-target="echo"></span>
          </div>
          <div id="inst-2" data-w-controller="search-widget">
            <input type="text" data-w-model="filter.query" data-w-target="queryInput">
            <span data-w-text="filter.query" data-w-target="echo"></span>
          </div>
        </div>
      `);

      try {
        const controller = defineController({
          state: () => ({
            filter: { query: 'default' },
          }),
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'search-widget': controller },
        });
        runtime.mount();

        const inst1 = env.document.querySelector('#inst-1');
        const inst2 = env.document.querySelector('#inst-2');
        const input1 = inst1.querySelector('[data-w-target="queryInput"]');
        const input2 = inst2.querySelector('[data-w-target="queryInput"]');
        const echo1 = inst1.querySelector('[data-w-target="echo"]');
        const echo2 = inst2.querySelector('[data-w-target="echo"]');

        input1.value = 'query-for-1';
        input1.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        expect(echo1.textContent).toBe('query-for-1');
        expect(echo2.textContent).toBe('default');
        expect(input2.value).toBe('default');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('handles checkbox boolean and checkbox group array correctly', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="checkbox-form">
          <input type="checkbox" data-w-model="agree" data-w-target="agreeInput">
          <input type="checkbox" name="tags" value="alpha" data-w-model="selectedTags" data-w-target="tagAlpha">
          <input type="checkbox" name="tags" value="beta" data-w-model="selectedTags" data-w-target="tagBeta">
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({
            agree: false,
            selectedTags: ['alpha'],
          }),
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'checkbox-form': controller },
        });
        runtime.mount();

        const agreeInput = env.document.querySelector('[data-w-target="agreeInput"]');
        const tagAlpha = env.document.querySelector('[data-w-target="tagAlpha"]');
        const tagBeta = env.document.querySelector('[data-w-target="tagBeta"]');

        expect(agreeInput.checked).toBe(false);
        expect(tagAlpha.checked).toBe(true);
        expect(tagBeta.checked).toBe(false);

        // Toggle single checkbox
        agreeInput.checked = true;
        agreeInput.dispatchEvent(new MiniEvent('change', { bubbles: true }));
        expect(capturedState.agree).toBe(true);

        // Toggle checkbox group
        tagBeta.checked = true;
        tagBeta.dispatchEvent(new MiniEvent('change', { bubbles: true }));
        expect(capturedState.selectedTags).toEqual(['alpha', 'beta']);

        tagAlpha.checked = false;
        tagAlpha.dispatchEvent(new MiniEvent('change', { bubbles: true }));
        expect(capturedState.selectedTags).toEqual(['beta']);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('converts empty number field to null (never silent 0) and non-empty to number', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="num-form">
          <input type="number" data-w-model="age" data-w-target="ageInput">
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({ age: 25 }),
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'num-form': controller },
        });
        runtime.mount();

        const ageInput = env.document.querySelector('[data-w-target="ageInput"]');
        expect(ageInput.value).toBe('25');

        // Type number
        ageInput.value = '42';
        ageInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(capturedState.age).toBe(42);

        // Clear input to empty string -> MUST be null, not 0!
        ageInput.value = '';
        ageInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
        expect(capturedState.age).toBeNull();

        // State set to null -> input becomes empty
        capturedState.age = null;
        expect(ageInput.value).toBe('');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('ignores IME input during composition until compositionend', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="ime-form">
          <input type="text" data-w-model="text" data-w-target="textInput">
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({ text: '' }),
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'ime-form': controller },
        });
        runtime.mount();

        const textInput = env.document.querySelector('[data-w-target="textInput"]');

        // Start IME composition (e.g. Japanese/Chinese input)
        textInput.dispatchEvent(new MiniEvent('compositionstart', { bubbles: true }));
        textInput.value = 'nihon';
        textInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        // State must NOT be updated during active composition
        expect(capturedState.text).toBe('');

        // End IME composition
        textInput.value = '日本';
        textInput.dispatchEvent(new MiniEvent('compositionend', { bubbles: true }));

        // Now state reflects final composed text
        expect(capturedState.text).toBe('日本');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('never binds file input elements to programmatic value binding', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="file-box">
          <input type="file" data-w-model="avatar" data-w-target="fileInput">
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({ avatar: 'should-not-set' }),
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'file-box': controller },
        });
        runtime.mount();

        const fileInput = env.document.querySelector('[data-w-target="fileInput"]');
        // File input value is protected by browser security; data-w-model must not touch it
        expect(fileInput.value).toBe('');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('preserves target() API for focus, scroll, and measurement', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="focus-widget">
          <input type="text" data-w-target="titleInput">
        </div>
      `);

      try {
        let titleInputRef = null;
        const controller = defineController({
          actions: {
            focusTitle({ target }) {
              titleInputRef = target('titleInput');
              titleInputRef.focus();
            },
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'focus-widget': controller },
        });
        runtime.mount();

        const rootEl = env.document.querySelector('[data-w-controller="focus-widget"]');
        const input = rootEl.querySelector('[data-w-target="titleInput"]');

        const inst = runtime.getControllerInstance(rootEl, 'focus-widget');
        inst.actions.focusTitle();

        expect(titleInputRef).toBe(input);
        expect(env.document.activeElement).toBe(input);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 2. Draft and Applied Filters
  // =========================================================================
  describe('2. Draft and Applied Filters', () => {
    it('maintains unshared object references between draft and applied, and paginates only with applied', async () => {
      let refreshPayload = null;
      let refreshSuccess = true;

      const controller = defineController({
        state: () => ({
          draft: { search: '', status: 'all' },
          applied: { search: '', status: 'all' },
          page: 1,
        }),
        actions: {
          async applyFilters({ state, refresh }) {
            const next = { ...state.draft };
            const res = await refresh('list', { ...next, page: 1 });
            if (res && res.ok !== false) {
              state.applied = next;
              state.page = 1;
            }
          },
          async nextPage({ state, refresh }) {
            const nextPageNum = state.page + 1;
            const res = await refresh('list', { ...state.applied, page: nextPageNum });
            if (res && res.ok !== false) {
              state.page = nextPageNum;
            }
          },
          async resetFilters({ state, refresh }) {
            const initial = { search: '', status: 'all' };
            const res = await refresh('list', { ...initial, page: 1 });
            if (res && res.ok !== false) {
              state.draft = { ...initial };
              state.applied = { ...initial };
              state.page = 1;
            }
          },
        },
      });

      const env = createMiniDomEnvironment(`
        <div data-w-controller="todos-filter">
          <input data-w-model="draft.search" data-w-target="search">
        </div>
      `);

      try {
        let capturedState = null;
        let instActions = null;

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'todos-filter': controller },
        });

        // Mock fragment refresh
        runtime.fragments.refresh = async (id, input) => {
          refreshPayload = input;
          return { ok: refreshSuccess, refreshed: [id] };
        };

        runtime.mount();
        const rootEl = env.document.querySelector('[data-w-controller="todos-filter"]');
        const inst = runtime.getControllerInstance(rootEl, 'todos-filter');
        capturedState = inst.state;
        instActions = inst.actions;

        // 1. Initial invariant: draft and applied are distinct object instances
        expect(capturedState.draft).not.toBe(capturedState.applied);

        // 2. User edits draft
        capturedState.draft.search = 'pending draft keyword';
        expect(capturedState.applied.search).toBe('');

        // 3. User navigates page WITHOUT applying filters -> pagination must use `applied`, not `draft`!
        await instActions.nextPage();
        expect(refreshPayload.search).toBe('');
        expect(refreshPayload.page).toBe(2);
        expect(capturedState.page).toBe(2);

        // 4. User applies filters -> applied updated and page reset to 1
        await instActions.applyFilters();
        expect(refreshPayload.search).toBe('pending draft keyword');
        expect(refreshPayload.page).toBe(1);
        expect(capturedState.applied.search).toBe('pending draft keyword');
        expect(capturedState.page).toBe(1);

        // 5. If refresh fails, draft changes are not claimed as applied
        refreshSuccess = false;
        capturedState.draft.search = 'failed search';
        await instActions.applyFilters();
        expect(capturedState.applied.search).toBe('pending draft keyword'); // Unchanged!

        // 6. Reset restores both draft and applied to defaults
        refreshSuccess = true;
        await instActions.resetFilters();
        expect(capturedState.draft.search).toBe('');
        expect(capturedState.applied.search).toBe('');
        expect(capturedState.page).toBe(1);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 3. Derived Values (Computed Properties)
  // =========================================================================
  describe('3. Derived Values (Computed Properties)', () => {
    it('provides readonly, reactive computed properties backed by Datastar signals', () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="comp-demo">
          <input type="text" data-w-model="firstName" data-w-target="fn">
          <input type="text" data-w-model="lastName" data-w-target="ln">
          <span data-w-text="fullName" data-w-target="fullEcho"></span>
        </div>
      `);

      try {
        let capturedState = null;
        const controller = defineController({
          state: () => ({
            firstName: 'Ada',
            lastName: 'Lovelace',
          }),
          computed: {
            fullName: ({ state }) => `${state.firstName} ${state.lastName}`.trim(),
          },
          connect({ state }) {
            capturedState = state;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'comp-demo': controller },
        });
        runtime.mount();

        const fullEcho = env.document.querySelector('[data-w-target="fullEcho"]');
        expect(fullEcho.textContent).toBe('Ada Lovelace');
        expect(capturedState.fullName).toBe('Ada Lovelace');

        // Computed properties are read-only: assigning throws TypeError
        expect(() => {
          capturedState.fullName = 'Grace Hopper';
        }).toThrow(/Cannot assign to read-only computed property/);

        // Updating reactive dependencies triggers computed update
        capturedState.firstName = 'Alan';
        capturedState.lastName = 'Turing';
        expect(fullEcho.textContent).toBe('Alan Turing');
        expect(capturedState.fullName).toBe('Alan Turing');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('prohibits state mutations inside computed getters', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="bad-comp">
          <span data-w-text="badProp"></span>
        </div>
      `);

      try {
        const controller = defineController({
          state: () => ({ count: 1 }),
          computed: {
            badProp: ({ state }) => {
              state.count += 1; // Side-effect mutation!
              return 'invalid';
            },
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'bad-comp': controller },
        });

        await expect(async () => {
          await runtime.mount();
        }).rejects.toThrow(/Cannot mutate state property .* inside computed property/);
      } finally {
        env.restore();
      }
    });

    it('prohibits name collision between state and computed', () => {
      expect(() => {
        defineController({
          state: () => ({ title: 'initial' }),
          computed: {
            title: () => 'derived',
          },
        });
      }).toThrow(/Cannot define "title" as both a state and computed property/);
    });
  });

  // =========================================================================
  // 4. Typed Form Handle (fill, baseline, dirty, reset)
  // =========================================================================
  describe('4. Typed Form Handle (fill, baseline, dirty, reset)', () => {
    it('supports fill with baseline: true (resets dirty & errors) vs baseline: false (marks dirty)', () => {
      const env = createMiniDomEnvironment(`
        <form data-w-form="todo-form" action="/api/todos/1" method="patch">
          <input name="title" value="Initial Title">
          <select name="priority">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
          <span data-w-error="title">Initial Error</span>
        </form>
      `);

      try {
        const formEl = env.document.querySelector('form');
        const handle = createFormHandle(formEl);

        expect(handle.dirty).toBe(false);
        expect(handle.values).toEqual({ title: 'Initial Title', priority: 'medium' });

        // 1. Regular fill: modifies inputs and marks form as dirty, keeps initial baseline
        handle.fill({ title: 'Draft In Progress' });
        expect(handle.dirty).toBe(true);
        expect(handle.values.title).toBe('Draft In Progress');

        // Reset returns to baseline
        handle.reset();
        expect(handle.dirty).toBe(false);
        expect(handle.values.title).toBe('Initial Title');

        // 2. Baseline fill (loading record from API): updates baseline, clears dirty and errors
        handle.fill({ title: 'Loaded From Server', priority: 'high' }, { baseline: true });
        expect(handle.dirty).toBe(false);
        expect(handle.values).toEqual({ title: 'Loaded From Server', priority: 'high' });
        expect(handle.errors).toEqual({});

        // Subsequent edit marks dirty relative to new baseline
        handle.fill({ title: 'User Modified After Load' });
        expect(handle.dirty).toBe(true);

        // Reset reverts to new baseline, NOT original HTML values
        handle.reset();
        expect(handle.dirty).toBe(false);
        expect(handle.values.title).toBe('Loaded From Server');

        // 3. Partial fill leaves unspecified fields intact
        handle.fill({ title: 'Only Title Changed' });
        expect(handle.values.priority).toBe('high');

        // 4. setAction and disabled management
        handle.setAction('/api/todos/42');
        expect(formEl.getAttribute('action')).toBe('/api/todos/42');

        handle.disabled = true;
        expect(handle.disabled).toBe(true);
        expect(formEl.hasAttribute('disabled')).toBe(true);

        handle.disabled = false;
        expect(handle.disabled).toBe(false);
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 5. Client-Driven Record Selection & Stale Response Guard
  // =========================================================================
  describe('5. Client-Driven Record Selection & Stale Response Guard', () => {
    it('discards stale response when rapidly switching between records A -> B', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="edit-mgr">
          <form data-w-form="edit-todo" action="/api/todos/1" method="patch">
            <input name="title" value="Default Title">
            <input name="priority" value="low">
          </form>
          <button data-w-on:click="selectRecord" data-todo-id="1" data-w-target="btnA">Edit A</button>
          <button data-w-on:click="selectRecord" data-todo-id="2" data-w-target="btnB">Edit B</button>
        </div>
      `);

      try {
        let resolveA = null;
        let resolveB = null;

        const controller = defineController({
          actions: {
            async selectRecord({ forms, api }, _event, actionEl) {
              const id = actionEl.getAttribute('data-todo-id');
              const form = forms.get('edit-todo');
              if (form.dirty) return;

              // Use latest concurrency
              const record = await api.get(`/api/todos/${id}`, {
                key: 'edit-fetch',
                concurrency: 'latest',
              });

              if (!record || form.dirty) return;
              form.setAction(`/api/todos/${record.id}`);
              form.fill(record, { baseline: true });
            },
          },
        });

        const customFetch = async (url) => {
          if (url.includes('/api/todos/1')) {
            return new Promise((resolve) => {
              resolveA = () =>
                resolve({
                  ok: true,
                  status: 200,
                  headers: { get: () => 'application/json' },
                  json: async () => ({ id: 1, title: 'Record A', priority: 'high' }),
                });
            });
          }
          if (url.includes('/api/todos/2')) {
            return new Promise((resolve) => {
              resolveB = () =>
                resolve({
                  ok: true,
                  status: 200,
                  headers: { get: () => 'application/json' },
                  json: async () => ({ id: 2, title: 'Record B', priority: 'medium' }),
                });
            });
          }
          return { ok: false, status: 404 };
        };

        const runtime = createClientRuntime({
          document: env.document,
          fetch: customFetch,
          controllers: { 'edit-mgr': controller },
        });
        runtime.mount();

        const btnA = env.document.querySelector('[data-w-target="btnA"]');
        const btnB = env.document.querySelector('[data-w-target="btnB"]');
        const formEl = env.document.querySelector('form');
        const titleInput = formEl.querySelector('input[name="title"]');

        // Click A, then immediately click B before A resolves
        btnA.click();
        btnB.click();

        // Resolve B first, then late-resolving A
        resolveB();
        await new Promise((r) => setTimeout(r, 10));

        expect(titleInput.value).toBe('Record B');
        expect(formEl.getAttribute('action')).toBe('/api/todos/2');

        // Late-resolving A must NOT overwrite B
        resolveA();
        await new Promise((r) => setTimeout(r, 10));

        expect(titleInput.value).toBe('Record B');
        expect(formEl.getAttribute('action')).toBe('/api/todos/2');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('protects dirty draft from being overwritten by in-flight fetch', async () => {
      const env = createMiniDomEnvironment(`
        <div data-w-controller="edit-mgr">
          <form data-w-form="edit-todo" action="/api/todos/1" method="patch">
            <input name="title" value="Default Title">
          </form>
          <button data-w-on:click="selectRecord" data-todo-id="10" data-w-target="btnLoad">Load 10</button>
        </div>
      `);

      try {
        let resolveFetch = null;

        const controller = defineController({
          actions: {
            async selectRecord({ forms, api }, _event, actionEl) {
              const id = actionEl.getAttribute('data-todo-id');
              const form = forms.get('edit-todo');

              const record = await api.get(`/api/todos/${id}`);
              // Dirty guard: if user began editing form while fetch was in flight, do not overwrite!
              if (form.dirty) return;
              form.fill(record, { baseline: true });
            },
          },
        });

        const customFetch = async () => {
          return new Promise((resolve) => {
            resolveFetch = () =>
              resolve({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ id: 10, title: 'Server Record 10' }),
              });
          });
        };

        const runtime = createClientRuntime({
          document: env.document,
          fetch: customFetch,
          controllers: { 'edit-mgr': controller },
        });
        runtime.mount();

        const btnLoad = env.document.querySelector('[data-w-target="btnLoad"]');
        const formEl = env.document.querySelector('form');
        const titleInput = formEl.querySelector('input[name="title"]');

        btnLoad.click();

        // While fetch is in flight, user types unsaved edits
        titleInput.value = 'User Edited While Waiting';
        titleInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

        // Now fetch completes
        resolveFetch();
        await new Promise((r) => setTimeout(r, 10));

        // Form title must NOT be overwritten!
        expect(titleInput.value).toBe('User Edited While Waiting');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 6. Lifecycle-Bound Async Task
  // =========================================================================
  describe('6. Lifecycle-Bound Async Task', () => {
    it('manages pending, data, error, stale, and latest cancellation without leaking pending state', async () => {
      let resolveRun1 = null;
      let resolveRun2 = null;

      const env = createMiniDomEnvironment(`
        <div data-w-controller="task-demo">
          <button data-w-on:click="triggerTask" data-w-target="runBtn">Run</button>
        </div>
      `);

      try {
        let capturedTasks = null;
        let callCount = 0;

        const controller = defineController({
          tasks: {
            calc: () => ({
              run: async () => {
                callCount += 1;
                const cur = callCount;
                return new Promise((resolve) => {
                  if (cur === 1) resolveRun1 = resolve;
                  if (cur === 2) resolveRun2 = resolve;
                });
              },
              concurrency: 'latest',
            }),
          },
          connect({ tasks }) {
            capturedTasks = tasks;
          },
          actions: {
            triggerTask({ tasks }) {
              tasks.calc.run();
            },
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'task-demo': controller },
        });
        runtime.mount();

        const runBtn = env.document.querySelector('[data-w-target="runBtn"]');
        const task = capturedTasks.calc;

        expect(task.pending).toBe(false);
        expect(task.data).toBeNull();
        expect(task.stale).toBe(false);

        // Run 1 begins
        runBtn.click();
        expect(task.pending).toBe(true);

        // Run 2 begins before Run 1 finishes -> latest policy supersedes Run 1
        runBtn.click();
        expect(task.pending).toBe(true);

        // Resolving Run 1 must NOT reset pending or overwrite data!
        resolveRun1('result-from-1');
        await new Promise((r) => setTimeout(r, 10));
        expect(task.pending).toBe(true);
        expect(task.data).toBeNull();

        // Resolving Run 2 completes the task
        resolveRun2('result-from-2');
        await new Promise((r) => setTimeout(r, 10));
        expect(task.pending).toBe(false);
        expect(task.data).toBe('result-from-2');

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('blocks late async task writes after controller disconnect', async () => {
      let resolveLate = null;

      const env = createMiniDomEnvironment(`
        <div id="target-root" data-w-controller="disposed-task"></div>
      `);

      try {
        let taskRef = null;
        const controller = defineController({
          tasks: {
            load: () => ({
              run: () => new Promise((resolve) => { resolveLate = resolve; }),
            }),
          },
          connect({ tasks }) {
            taskRef = tasks.load;
          },
        });

        const runtime = createClientRuntime({
          document: env.document,
          controllers: { 'disposed-task': controller },
        });
        runtime.mount();

        taskRef.run();
        expect(taskRef.pending).toBe(true);

        // Unmount controller
        runtime.destroy();

        // Resolving promise after disconnect
        resolveLate('late-data');
        await new Promise((r) => setTimeout(r, 10));

        // State remains pristine and pending was cancelled on destroy
        expect(taskRef.pending).toBe(false);
      } finally {
        env.restore();
      }
    });
  });

  // =========================================================================
  // 7. Lightweight Modular Runtime & Optimization Utilities
  // =========================================================================
  describe('7. Lightweight Modular Runtime & Optimization Utilities', () => {
    it('boots lite client runtime and handles forms and invalidation without signals overhead', async () => {
      const { createLiteClientRuntime } = require('../../core/client/lite');
      const env = createMiniDomEnvironment(`
        <div>
          <div data-w-fragment="contact-list" data-w-depends-on="contacts">
            <span>List</span>
          </div>
          <form data-w-form="contact" action="/api/contact" method="post">
            <input type="text" name="name" value="Jane">
            <button type="submit">Send</button>
          </form>
        </div>
      `);

      try {
        let refreshTriggered = false;
        const fakeFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, fragments: {} }),
          headers: { get: () => 'application/json' },
        });

        const lite = createLiteClientRuntime({
          document: env.document,
          fetch: fakeFetch,
        });

        lite.boot(env.document);

        const form = lite.forms.get('contact');
        expect(form).not.toBeNull();
        expect(form.values.name).toBe('Jane');

        // Test invalidation batching
        await lite.invalidate(['contacts']);
        expect(fakeFetch).toHaveBeenCalledTimes(1);
      } finally {
        env.restore();
      }
    });

    it('provides zero-allocation no-op debugger when debug is disabled', () => {
      const { createClientDebugger } = require('../../core/client');
      const debug = createClientDebugger();

      expect(debug.enabled).toBe(false);
      // Calls should be safe no-ops
      debug.trackControllerMount('inst-1', 'test');
      debug.trackRequestStart({ requestId: 'r1' });
      debug.trackRequestEnd('r1');
      debug.recordChainRefresh('c1', {});
      debug.recordChainPatch('c1', {});

      const snap = debug.getSnapshot();
      expect(snap.activeControllers).toHaveLength(0);
      expect(snap.events).toHaveLength(0);
    });

    it('verifies shared micro-utilities (getByPath, setByPath, isPlainObject)', () => {
      const { getByPath, setByPath, isPlainObject, isPromise } = require('../../core/client/utils');

      const target = { user: { profile: { age: 30 } } };
      expect(getByPath(target, 'user.profile.age')).toBe(30);
      expect(getByPath(target, 'user.unknown.val')).toBeUndefined();

      setByPath(target, 'user.profile.age', 31);
      expect(target.user.profile.age).toBe(31);

      setByPath(target, 'user.settings.theme', 'dark');
      expect(target.user.settings.theme).toBe('dark');

      // Security check: prototype pollution ignored
      setByPath(target, '__proto__.polluted', true);
      expect(({}).polluted).toBeUndefined();

      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(null)).toBe(false);
      expect(isPromise(Promise.resolve(1))).toBe(true);
      expect(isPromise({})).toBe(false);
    });
  });
});
