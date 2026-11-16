import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defineController,
  createControllerRuntime,
} from '../../core/client/controller.js';
import { createDatastarAdapter } from '../../core/client/adapter/datastar.js';
import { createFragmentCoordinator } from '../../core/client/fragments.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client Behavior Real-World Scenarios (Contracts & Edge-Case Discovery)', () => {
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

  function createRuntime(controllers = {}, extra = {}) {
    const runtime = createControllerRuntime({
      root: domEnv.document.body,
      datastar,
      ...extra,
    });
    for (const [name, def] of Object.entries(controllers)) {
      runtime.register(name, def);
    }
    return runtime;
  }

  function mountRoot(runtime) {
    const el = domEnv.document.body.querySelector('[data-w-controller], [data-controller]') || domEnv.document.body.firstElementChild;
    const name = el.getAttribute('data-w-controller') || el.getAttribute('data-controller');
    return runtime.mountControllerOnElement(el, name);
  }

  it('Scenario 1: AI Studio workspace (data-w-submit, interval polling, ctx.watch, ctx.locals, data-w-style/attr, clean unmount)', async () => {
    let editorLoads = 0;
    let pollTicks = 0;
    let stopPolling = null;

    const studioCtrl = defineController({
      state: () => ({
        prompt: '',
        status: 'idle',
        devicePreset: 'desktop',
        previewWidth: 1280,
        codeOpen: false,
        editorReady: false,
      }),
      connect(ctx) {
        ctx.locals.ensureEditorLoaded = async () => {
          if (ctx.locals.editorPromise) return ctx.locals.editorPromise;
          ctx.locals.editorPromise = Promise.resolve().then(() => {
            editorLoads += 1;
            ctx.state.editorReady = true;
          });
          return ctx.locals.editorPromise;
        };

        ctx.watch(
          () => ctx.state.devicePreset,
          (preset) => {
            ctx.state.previewWidth = preset === 'mobile' ? 390 : 1280;
          }
        );
      },
      actions: {
        submitPrompt(ctx) {
          ctx.state.status = 'generating';
          stopPolling = ctx.interval(() => {
            pollTicks += 1;
            if (pollTicks >= 2) {
              ctx.state.status = 'ready';
              if (stopPolling) stopPolling();
            }
          }, 15);
        },
        setMobile(ctx) {
          ctx.state.devicePreset = 'mobile';
        },
        async toggleCodePanel(ctx) {
          ctx.state.codeOpen = !ctx.state.codeOpen;
          if (ctx.state.codeOpen) {
            await ctx.locals.ensureEditorLoaded();
          }
        },
      },
    });

    domEnv.document.body.innerHTML = `
      <div data-w-controller="studio">
        <form id="prompt-form" data-w-submit="submitPrompt">
          <input id="prompt-input" data-w-model="prompt" />
          <button type="submit">Generate</button>
        </form>
        <span id="status-badge" data-w-text="status"></span>
        <iframe id="preview-frame"
          data-w-style:width="previewWidth + 'px'"
          data-w-attr:data-device="devicePreset"></iframe>
        <button id="mobile-btn" data-w-click="setMobile">Mobile</button>
        <button id="code-btn" data-w-click="toggleCodePanel" data-w-attr:aria-expanded="codeOpen ? 'true' : 'false'">Code</button>
      </div>
    `;

    const runtime = createRuntime({ studio: studioCtrl });
    const inst = mountRoot(runtime);

    // 1. Submit prompt via data-w-submit (must preventDefault and start polling)
    const form = domEnv.document.getElementById('prompt-form');
    const submitEvent = new domEnv.window.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
    expect(domEnv.document.getElementById('status-badge').textContent).toBe('generating');

    await new Promise((r) => setTimeout(r, 60));
    expect(inst.state.status).toBe('ready');
    expect(domEnv.document.getElementById('status-badge').textContent).toBe('ready');
    const ticksAfterReady = pollTicks;
    await new Promise((r) => setTimeout(r, 40));
    expect(pollTicks).toBe(ticksAfterReady);

    // 2. Switch device preset -> watch updates previewWidth -> data-w-style & data-w-attr update DOM
    domEnv.document.getElementById('mobile-btn').click();
    expect(domEnv.document.getElementById('preview-frame').style.width).toBe('390px');
    expect(domEnv.document.getElementById('preview-frame').getAttribute('data-device')).toBe('mobile');

    // 3. Open and close code panel twice -> lazy loader in ctx.locals runs only once
    domEnv.document.getElementById('code-btn').click();
    await new Promise((r) => setTimeout(r, 10));
    expect(domEnv.document.getElementById('code-btn').getAttribute('aria-expanded')).toBe('true');
    domEnv.document.getElementById('code-btn').click();
    domEnv.document.getElementById('code-btn').click();
    await new Promise((r) => setTimeout(r, 10));
    expect(editorLoads).toBe(1);
    expect(inst.state.editorReady).toBe(true);

    runtime.destroyAll();
  });

  it('Scenario 2: Numeric & checkbox array data-w-model coercion and client ownership preservation during fragment morph', async () => {
    const settingsCtrl = defineController({
      state: () => ({
        width: 1280,
        tags: ['ssr'],
      }),
    });

    domEnv.document.body.innerHTML = `
      <div id="settings-frag" data-w-fragment="settings" data-w-controller="settings">
        <input id="width-input" type="number" data-w-model="width" />
        <input id="tag-ssr" type="checkbox" value="ssr" data-w-model="tags" />
        <input id="tag-seo" type="checkbox" value="seo" data-w-model="tags" />
        <span id="server-note">v1</span>
      </div>
    `;

    const runtime = createRuntime({ settings: settingsCtrl });
    const inst = mountRoot(runtime);

    const widthInput = domEnv.document.getElementById('width-input');
    const tagSeo = domEnv.document.getElementById('tag-seo');

    // Clear numeric input -> must become null, never 0
    widthInput.value = '';
    widthInput.dispatchEvent(new domEnv.window.Event('input', { bubbles: true }));
    expect(inst.state.width).toBeNull();

    // Type 480 -> numeric 480
    widthInput.value = '480';
    widthInput.dispatchEvent(new domEnv.window.Event('input', { bubbles: true }));
    expect(inst.state.width).toBe(480);

    // Check seo -> ['ssr', 'seo']
    tagSeo.checked = true;
    tagSeo.dispatchEvent(new domEnv.window.Event('change', { bubbles: true }));
    expect(inst.state.tags).toEqual(['ssr', 'seo']);

    // Simulate fragment morph where server returns stale value="999" and updated #server-note
    const coordinator = createFragmentCoordinator({
      root: domEnv.document.body,
      datastar,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          fragments: {
            settings: {
              html: `
                <div id="settings-frag" data-w-fragment="settings" data-w-controller="settings">
                  <input id="width-input" type="number" value="999" data-w-model="width" />
                  <input id="tag-ssr" type="checkbox" value="ssr" data-w-model="tags" />
                  <input id="tag-seo" type="checkbox" value="seo" data-w-model="tags" />
                  <span id="server-note">v2</span>
                </div>
              `,
            },
          },
        }),
      }),
    });

    await coordinator.refresh('settings');
    expect(domEnv.document.getElementById('server-note').textContent).toBe('v2');
    expect(inst.state.width).toBe(480);
    expect(domEnv.document.getElementById('width-input').value).toBe('480');

    runtime.destroyAll();
  });

  it('Scenario 3: data-w-ignore="children" and "all" protect third-party widgets during fragment morphs', async () => {
    domEnv.document.body.innerHTML = `
      <div id="dash-frag" data-w-fragment="dash">
        <div id="chart-box" data-w-ignore="children" data-theme="light"><canvas id="third-party-canvas"></canvas></div>
        <div id="lock-box" data-w-ignore="all" data-theme="light"><span id="locked-child">keep</span></div>
        <p id="summary">old</p>
      </div>
    `;

    const originalCanvas = domEnv.document.getElementById('third-party-canvas');
    const originalLocked = domEnv.document.getElementById('locked-child');

    const coordinator = createFragmentCoordinator({
      root: domEnv.document.body,
      datastar,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          fragments: {
            dash: {
              html: `
                <div id="dash-frag" data-w-fragment="dash">
                  <div id="chart-box" data-w-ignore="children" data-theme="dark"><span>server-placeholder</span></div>
                  <div id="lock-box" data-w-ignore="all" data-theme="dark"><span>server-overwrite</span></div>
                  <p id="summary">new</p>
                </div>
              `,
            },
          },
        }),
      }),
    });

    await coordinator.refresh('dash');

    expect(domEnv.document.getElementById('summary').textContent).toBe('new');
    // children mode: attributes update, children preserved
    const chartBox = domEnv.document.getElementById('chart-box');
    expect(chartBox.getAttribute('data-theme')).toBe('dark');
    expect(chartBox.firstElementChild).toBe(originalCanvas);

    // all mode: neither attributes nor children change
    const lockBox = domEnv.document.getElementById('lock-box');
    expect(lockBox.getAttribute('data-theme')).toBe('light');
    expect(lockBox.firstElementChild).toBe(originalLocked);
  });

  it('Scenario 4: Async action failure resets busy state and allows clean retry after clearError()', async () => {
    let attempt = 0;
    const errors = [];

    const saveCtrl = defineController({
      state: () => ({ saved: false }),
      connect(ctx) {
        ctx.onError((err) => errors.push(err.message));
      },
      actions: {
        async save(ctx) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, 15));
          if (attempt === 1) {
            throw new Error('network-500');
          }
          ctx.state.saved = true;
        },
        resetErr(ctx) {
          ctx.clearError();
        },
      },
    });

    domEnv.document.body.innerHTML = `
      <div data-w-controller="saveCtrl">
        <button id="save-btn" data-w-click="save" data-w-disabled="$busy">Save</button>
        <button id="clear-btn" data-w-click="resetErr">Clear</button>
        <span id="saved-flag" data-w-text="saved ? 'yes' : 'no'"></span>
      </div>
    `;

    const runtime = createRuntime({ saveCtrl });
    const inst = mountRoot(runtime);
    const saveBtn = domEnv.document.getElementById('save-btn');

    // First click fails
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 40));

    expect(errors).toEqual(['network-500']);
    expect(inst.ctx.lastError?.message).toBe('network-500');
    expect(inst.ctx.isActionBusy('save')).toBe(false);
    expect(saveBtn.disabled).toBe(false);
    expect(domEnv.document.getElementById('saved-flag').textContent).toBe('no');

    // Clear error and retry -> succeeds
    domEnv.document.getElementById('clear-btn').click();
    expect(inst.ctx.lastError).toBeNull();

    saveBtn.click();
    await new Promise((r) => setTimeout(r, 40));
    expect(inst.state.saved).toBe(true);
    expect(domEnv.document.getElementById('saved-flag').textContent).toBe('yes');

    runtime.destroyAll();
  });

  it('Scenario 5: Debounced data-w-on:input coalescing and CSP-safe expression evaluation', async () => {
    const queries = [];

    const searchCtrl = defineController({
      state: () => ({
        query: '',
        itemsCount: 0,
        isLoading: false,
      }),
      actions: {
        onSearch(ctx) {
          queries.push(ctx.state.query);
          ctx.state.itemsCount = ctx.state.query.length * 2;
        },
      },
    });

    domEnv.document.body.innerHTML = `
      <div data-w-controller="search">
        <input id="q" data-w-model="query" data-w-on:input.debounce.30ms="onSearch" />
        <div id="results-banner" data-w-show="itemsCount > 0 && !isLoading">
          <span id="results-text" data-w-text="isLoading ? 'Loading...' : itemsCount + ' results'"></span>
        </div>
      </div>
    `;

    const runtime = createRuntime({ search: searchCtrl });
    mountRoot(runtime);

    const input = domEnv.document.getElementById('q');
    for (const val of ['w', 'we', 'web']) {
      input.value = val;
      input.dispatchEvent(new domEnv.window.Event('input', { bubbles: true }));
    }

    await new Promise((r) => setTimeout(r, 70));

    expect(queries).toEqual(['web']);
    expect(domEnv.document.getElementById('results-banner').hasAttribute('hidden')).toBe(false);
    expect(domEnv.document.getElementById('results-text').textContent).toBe('6 results');

    runtime.destroyAll();
  });

  it('Scenario 6: Declarative task stateKey/dataKey/errorKey auto-syncs idle -> pending -> failure -> success and ignores superseded runs', async () => {
    let callNum = 0;
    let resolveFirst;

    const profileCtrl = defineController({
      state: () => ({
        loadStatus: 'idle',
        profile: null,
        loadError: null,
      }),
      tasks: {
        fetchProfile: {
          stateKey: 'loadStatus',
          dataKey: 'profile',
          errorKey: 'loadError',
          concurrency: 'latest',
          run: async (ctx, id) => {
            callNum += 1;
            if (callNum === 1) {
              return new Promise((resolve) => { resolveFirst = resolve; });
            }
            if (callNum === 2) {
              throw new Error('server-500');
            }
            return { id, name: 'Ada' };
          },
        },
      },
      actions: {
        load(ctx, _ev, el) {
          return ctx.tasks.fetchProfile.run(Number(el.getAttribute('data-id') || 1));
        },
        resetLoad(ctx) {
          ctx.tasks.fetchProfile.reset();
        },
      },
    });

    domEnv.document.body.innerHTML = `
      <div data-w-controller="profile">
        <span id="status" data-w-text="loadStatus"></span>
        <span id="err" data-w-text="loadError || ''"></span>
        <span id="name" data-w-text="profile ? profile.name : ''"></span>
        <button id="load-1" data-id="1" data-w-click="load">Load 1</button>
        <button id="load-2" data-id="2" data-w-click="load">Load 2</button>
        <button id="reset-btn" data-w-click="resetLoad">Reset</button>
      </div>
    `;

    const runtime = createRuntime({ profile: profileCtrl });
    const inst = mountRoot(runtime);

    expect(domEnv.document.getElementById('status').textContent).toBe('idle');

    // Call 1 hangs (pending), Call 2 supersedes Call 1 and fails -> status becomes failure
    domEnv.document.getElementById('load-1').click();
    expect(inst.state.loadStatus).toBe('pending');
    domEnv.document.getElementById('load-2').click();
    await new Promise((r) => setTimeout(r, 20));

    expect(inst.state.loadStatus).toBe('failure');
    expect(inst.state.loadError).toBe('server-500');
    expect(domEnv.document.getElementById('status').textContent).toBe('failure');
    expect(domEnv.document.getElementById('err').textContent).toBe('server-500');

    // Late resolution of Call 1 must NOT overwrite failure state
    resolveFirst({ id: 1, name: 'Stale' });
    await new Promise((r) => setTimeout(r, 10));
    expect(inst.state.loadStatus).toBe('failure');
    expect(inst.state.profile).toBeNull();

    // Call 3 succeeds -> status becomes success, error cleared, profile set
    domEnv.document.getElementById('load-1').click();
    await new Promise((r) => setTimeout(r, 20));
    expect(inst.state.loadStatus).toBe('success');
    expect(inst.state.loadError).toBeNull();
    expect(domEnv.document.getElementById('name').textContent).toBe('Ada');

    // Reset returns to idle
    domEnv.document.getElementById('reset-btn').click();
    expect(inst.state.loadStatus).toBe('idle');

    runtime.destroyAll();
  });

  it('Scenario 7: ctx.request() automatically manages pending -> success / failure state keys in ad-hoc actions', async () => {
    let shouldFail = true;

    const checkoutCtrl = defineController({
      state: () => ({
        payStatus: 'idle',
        payError: null,
        receipt: null,
      }),
      actions: {
        async pay(ctx) {
          await ctx.request(
            { statusKey: 'payStatus', dataKey: 'receipt', errorKey: 'payError' },
            async () => {
              await new Promise((r) => setTimeout(r, 15));
              if (shouldFail) throw new Error('card-declined');
              return { txId: 'tx_99' };
            }
          );
        },
      },
    });

    domEnv.document.body.innerHTML = `
      <div data-w-controller="checkout">
        <span id="pay-status" data-w-text="payStatus"></span>
        <span id="pay-err" data-w-show="payStatus === 'failure'" data-w-text="payError || ''"></span>
        <span id="pay-ok" data-w-show="payStatus === 'success'" data-w-text="receipt ? receipt.txId : ''"></span>
        <button id="pay-btn" data-w-click="pay">Pay</button>
      </div>
    `;

    const runtime = createRuntime({ checkout: checkoutCtrl });
    const inst = mountRoot(runtime);

    domEnv.document.getElementById('pay-btn').click();
    expect(inst.state.payStatus).toBe('pending');
    expect(domEnv.document.getElementById('pay-status').textContent).toBe('pending');

    await new Promise((r) => setTimeout(r, 35));
    expect(inst.state.payStatus).toBe('failure');
    expect(domEnv.document.getElementById('pay-err').hasAttribute('hidden')).toBe(false);
    expect(domEnv.document.getElementById('pay-err').textContent).toBe('card-declined');

    shouldFail = false;
    domEnv.document.getElementById('pay-btn').click();
    expect(inst.state.payStatus).toBe('pending');

    await new Promise((r) => setTimeout(r, 35));
    expect(inst.state.payStatus).toBe('success');
    expect(inst.state.payError).toBeNull();
    expect(domEnv.document.getElementById('pay-ok').hasAttribute('hidden')).toBe(false);
    expect(domEnv.document.getElementById('pay-ok').textContent).toBe('tx_99');

    runtime.destroyAll();
  });

  it('Scenario 8: Centralizes runtime, timer, listener, effect, and cleanup errors through options.onError and debug', async () => {
    const tracked = [];
    const cleanupTracked = [];

    const buggyCtrl = defineController({
      state: () => ({ count: 0 }),
      connect(ctx) {
        ctx.timeout(() => {
          throw new Error('timeout-boom');
        }, 5);
        ctx.on(ctx.el, 'custom:ping', () => {
          throw new Error('listener-boom');
        });
        return () => {
          throw new Error('cleanup-boom');
        };
      },
    });

    domEnv.document.body.innerHTML = `<div data-w-controller="buggy"></div>`;

    const runtime = createRuntime(
      { buggy: buggyCtrl },
      {
        onError: (err, meta) => tracked.push({ message: err.message, phase: meta.phase, cleanup: Boolean(meta.cleanup) }),
        debug: {
          recordEvent: () => {},
          trackControllerMount: () => {},
          trackControllerUnmount: () => {},
          trackCleanupError: (_id, _name, phase, err) => cleanupTracked.push({ phase, message: err.message }),
        },
      }
    );

    const inst = mountRoot(runtime);
    inst.el.dispatchEvent(new domEnv.window.Event('custom:ping'));
    await new Promise((r) => setTimeout(r, 25));

    runtime.destroyAll();

    expect(tracked).toEqual([
      { message: 'listener-boom', phase: 'listener', cleanup: false },
      { message: 'timeout-boom', phase: 'timeout', cleanup: false },
      { message: 'cleanup-boom', phase: 'cleanup', cleanup: true },
    ]);
    expect(cleanupTracked).toEqual([{ phase: 'cleanup', message: 'cleanup-boom' }]);
  });

  it('Scenario 9: Provides safe, deep-frozen route & public context via fsy.clientContext({ allow/schema }) and boot/runtime provide()', () => {
    const { renderClientContextTag } = require('../../core/client/context');
    const { createHelpers } = require('../../src/helpers');

    const fsy = createHelpers({
      locale: 'tr',
      req: {
        path: '/studio/42',
        route: { path: '/studio/:id' },
        params: { id: '42' },
        query: { tab: 'code' },
      },
    });

    const tagHtml = fsy.clientContext(
      {
        publishOrigin: 'https://selfbuild.site',
        maxTokens: 4096,
        xssTest: '</script><img src=x onerror=alert(1)>',
        internalSecret: 'not-in-allowlist',
      },
      { allow: ['publishOrigin', 'maxTokens', 'xssTest'] }
    );

    expect(tagHtml).toContain('type="application/json"');
    expect(tagHtml).toContain('\\u003c/script\\u003e');
    expect(tagHtml).not.toContain('not-in-allowlist');

    // Also test prototype-pollution resistance directly
    const protoPayload = renderClientContextTag(JSON.parse('{"__proto__":{"polluted":true},"features":{"ai":true}}'));
    expect(protoPayload).not.toContain('__proto__');

    domEnv.document.body.innerHTML = `${tagHtml}<div data-w-controller="app"></div>`;

    let captured = null;
    const appCtrl = defineController({
      state: () => ({ ready: false }),
      connect(ctx) {
        captured = {
          route: ctx.route,
          publishOrigin: ctx.inject('publishOrigin'),
          maxTokens: ctx.inject('maxTokens'),
          locale: ctx.inject('locale'),
          aiFlag: ctx.inject('features.ai', false),
          missingFallback: ctx.inject('nonexistent.key', 'default-val'),
          notAllowed: ctx.inject('internalSecret', null),
          isRouteFrozen: Object.isFrozen(ctx.route),
          isContextFrozen: Object.isFrozen(ctx.context),
        };
        expect(() => {
          ctx.route.path = '/hacked';
        }).toThrow();
        expect(() => {
          ctx.context.publishOrigin = 'https://evil.com';
        }).toThrow();
      },
    });

    const runtime = createRuntime(
      { app: appCtrl },
      { context: { features: { ai: true } } }
    );
    mountRoot(runtime);

    expect(captured).toEqual({
      route: {
        path: '/studio/42',
        pattern: '/studio/:id',
        params: { id: '42' },
        query: { tab: 'code' },
      },
      publishOrigin: 'https://selfbuild.site',
      maxTokens: 4096,
      locale: 'tr',
      aiFlag: true,
      missingFallback: 'default-val',
      notAllowed: null,
      isRouteFrozen: true,
      isContextFrozen: true,
    });

    runtime.destroyAll();
  });

  it('Scenario 10: Syncs shared controller state, fragment invalidations, and custom broadcasts across tabs via BroadcastChannel', async () => {
    const { createClientRuntime } = require('../../core/client/index.js');

    // In-memory BroadcastChannel hub simulating two browser tabs
    const channelsByName = new Map();
    class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.listeners = new Set();
        this.closed = false;
        if (!channelsByName.has(name)) channelsByName.set(name, new Set());
        channelsByName.get(name).add(this);
      }
      addEventListener(type, fn) {
        if (type === 'message') this.listeners.add(fn);
      }
      removeEventListener(type, fn) {
        if (type === 'message') this.listeners.delete(fn);
      }
      postMessage(data) {
        const peers = channelsByName.get(this.name);
        if (!peers) return;
        for (const peer of peers) {
          if (peer === this || peer.closed) continue;
          for (const fn of peer.listeners) {
            fn({ data });
          }
        }
      }
      close() {
        this.closed = true;
        this.listeners.clear();
        const peers = channelsByName.get(this.name);
        if (peers) peers.delete(this);
      }
    }

    const envA = createMiniDomEnvironment(`
      <div id="frag-a" data-w-fragment="todos" data-w-fragment-id="todos-a" data-w-depends-on="todos">v1-a</div>
      <div id="ctrl-a" data-w-controller="prefs">
        <span id="theme-a" data-w-text="theme"></span>
      </div>
    `);
    const envB = createMiniDomEnvironment(`
      <div id="frag-b" data-w-fragment="todos" data-w-fragment-id="todos-b" data-w-depends-on="todos">v1-b</div>
      <div id="ctrl-b" data-w-controller="prefs">
        <span id="theme-b" data-w-text="theme"></span>
      </div>
    `);

    let fetchCallsA = 0;
    let fetchCallsB = 0;
    const tabBEvents = [];

    const prefsCtrl = defineController({
      state: () => ({ theme: 'light', localOnly: 'a' }),
      sync: { keys: ['theme'], channel: 'prefs' },
      connect(ctx) {
        ctx.onBroadcast('session:logout', (payload) => tabBEvents.push(payload));
      },
      actions: {
        setDark(ctx) {
          ctx.state.theme = 'dark';
          ctx.state.localOnly = 'changed-in-a';
        },
      },
    });

    const rtA = createClientRuntime({
      root: envA.document.body,
      BroadcastChannel: MockBroadcastChannel,
      syncChannel: 'app-sync',
      controllers: { prefs: prefsCtrl },
      fetch: async () => {
        fetchCallsA += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            fragments: {
              'todos-a': { html: '<div id="frag-a" data-w-fragment="todos" data-w-fragment-id="todos-a" data-w-depends-on="todos">v2-a</div>' },
            },
          }),
        };
      },
    });

    const rtB = createClientRuntime({
      root: envB.document.body,
      BroadcastChannel: MockBroadcastChannel,
      syncChannel: 'app-sync',
      controllers: { prefs: prefsCtrl },
      fetch: async () => {
        fetchCallsB += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            fragments: {
              'todos-b': { html: '<div id="frag-b" data-w-fragment="todos" data-w-fragment-id="todos-b" data-w-depends-on="todos">v2-b</div>' },
            },
          }),
        };
      },
    });

    rtA.mount();
    rtB.mount();

    const instA = rtA.getControllerInstance(envA.document.getElementById('ctrl-a'), 'prefs');
    const instB = rtB.getControllerInstance(envB.document.getElementById('ctrl-b'), 'prefs');

    // 1. State change in Tab A syncs only `theme` to Tab B (leaves `localOnly` isolated)
    instA.actions.setDark();
    expect(instB.state.theme).toBe('dark');
    expect(envB.document.getElementById('theme-b').textContent).toBe('dark');
    expect(instB.state.localOnly).toBe('a');

    // 2. Single invalidation in Tab A triggers fragment refresh in BOTH Tab A and Tab B
    await rtA.invalidate(['todos']);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchCallsA).toBe(1);
    expect(fetchCallsB).toBe(1);
    expect(envA.document.getElementById('frag-a').textContent).toBe('v2-a');
    expect(envB.document.getElementById('frag-b').textContent).toBe('v2-b');

    // 3. Custom cross-tab broadcast
    instA.ctx.broadcast('session:logout', { reason: 'manual' });
    expect(tabBEvents).toEqual([{ reason: 'manual' }]);

    // 4. Clean teardown closes BroadcastChannels
    rtA.destroy();
    rtB.destroy();
    expect(channelsByName.get('app-sync').size).toBe(0);

    envA.restore();
    envB.restore();
  });

  it('Scenario 11: Logs via ctx.log to console & DevTools Logs tab in dev, and returns NOOP_LOGGER in production', () => {
    const { createClientRuntime } = require('../../core/client/index.js');
    const { createClientLogger } = require('../../core/client/debug.js');
    const { NOOP_LOGGER } = require('../../core/client/utils.js');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = createMiniDomEnvironment('<div id="c" data-w-controller="loggerTest"></div>');
    try {
      const ctrl = defineController({
        state: () => ({ ok: true }),
        connect(ctx) {
          ctx.log.info('Mounted studio', { projectId: 7, apiSecret: 'hidden' });
          ctx.log.warn('Slow network');
        },
      });

      const rt = createClientRuntime({
        root: env.document.body,
        debug: { enabled: true },
        controllers: { loggerTest: ctrl },
      });
      rt.mount();

      expect(infoSpy).toHaveBeenCalledWith('[webspresso:loggerTest]', 'Mounted studio', { projectId: 7, apiSecret: 'hidden' });
      expect(warnSpy).toHaveBeenCalledWith('[webspresso:loggerTest]', 'Slow network');

      const snapshot = rt.debug.getSnapshot();
      expect(snapshot.logs).toHaveLength(2);
      expect(snapshot.logs[0]).toMatchObject({
        level: 'info',
        source: 'loggerTest',
        message: 'Mounted studio',
      });
      expect(snapshot.logs[0].data.apiSecret).toBe('[REDACTED]');

      // Production check: createClientLogger returns NOOP_LOGGER when NODE_ENV === 'production'
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const prodLogger = createClientLogger(rt.debug, 'prod');
        expect(prodLogger).toBe(NOOP_LOGGER);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }

      rt.destroy();
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      env.restore();
    }
  });
});

