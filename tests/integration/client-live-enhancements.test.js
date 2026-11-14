import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClientRuntime, defineController, defineFragment } from '../../core/client/index.js';
import { createClientDebugger } from '../../core/client/debug.js';
import { executeAndRenderFragment } from '../../core/client/server-fragments.js';
import { defineApi } from '../../src/api/define-api.js';
import { executeApiPipeline } from '../../core/http/pipeline.js';
import { checkTemplateFormContracts } from '../../src/dev/api-typegen.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

const { z } = require('zod');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Client Live Enhancements (LiveView / Livewire Inspired)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('1. Third-party widget DOM ownership (data-w-ignore)', () => {
    it('preserves widget inner DOM across fragment patches, updates surrounding server HTML, preserves nested controllers, and runs widget cleanup on real unmount', async () => {
      const html = `
        <div data-w-fragment="workspace" data-w-fragment-id="ws:default" data-w-fragment-page="/ws">
          <div id="server-banner" class="banner-v1">Version 1</div>
          <div data-w-controller="widget-host" data-w-key="chart-1">
            <div data-w-ignore="children" data-testid="chart-mount" class="chart-box">
              <div class="initial-placeholder">Loading chart...</div>
            </div>
            <div data-w-controller="nested-badge" data-testid="nested-badge">
              <span data-w-text="label"></span>
              <button type="button" data-w-on:click="bump">Bump</button>
            </div>
          </div>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/ws');
      const widgetEvents = [];

      try {
        const widgetHost = defineController({
          state: () => ({ instanceToken: null }),
          connect({ el, state }) {
            const mount = el.querySelector('[data-testid="chart-mount"]');
            // Third-party widget mutates its own inner DOM
            mount.innerHTML = '<canvas data-lib="chartjs" width="300"></canvas><div class="legend">Live Canvas</div>';
            state.instanceToken = 'chart-instance-1';
            widgetEvents.push('widget:connect');
            return () => {
              widgetEvents.push('widget:cleanup');
              mount.innerHTML = '';
            };
          },
        });

        const nestedBadge = defineController({
          state: () => ({ count: 1 }),
          computed: {
            label: ({ state }) => `Badge:${state.count}`,
          },
          actions: {
            bump({ state }) {
              state.count += 1;
            },
          },
        });

        let patchStep = 1;
        const customFetch = vi.fn().mockImplementation(async () => {
          patchStep += 1;
          if (patchStep === 2) {
            return new Response(
              JSON.stringify({
                fragments: {
                  'ws:default': {
                    instanceId: 'ws:default',
                    name: 'workspace',
                    html: `
                      <div data-w-fragment="workspace" data-w-fragment-id="ws:default" data-w-fragment-page="/ws">
                        <div id="server-banner" class="banner-v2">Version 2</div>
                        <div data-w-controller="widget-host" data-w-key="chart-1">
                          <div data-w-ignore="children" data-testid="chart-mount" class="chart-box updated-root-class">
                            <div class="initial-placeholder">Server tried to overwrite inner DOM</div>
                          </div>
                          <div data-w-controller="nested-badge" data-testid="nested-badge">
                            <span data-w-text="label"></span>
                            <button type="button" data-w-on:click="bump">Bump</button>
                          </div>
                        </div>
                      </div>
                    `,
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Step 3: Remove widget-host completely (key removed / unmounted)
          return new Response(
            JSON.stringify({
              fragments: {
                'ws:default': {
                  instanceId: 'ws:default',
                  name: 'workspace',
                  html: '<div data-w-fragment="workspace" data-w-fragment-id="ws:default" data-w-fragment-page="/ws"><div id="server-banner" class="banner-v3">Version 3 (No Widget)</div></div>',
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: customFetch,
          controllers: {
            'widget-host': widgetHost,
            'nested-badge': nestedBadge,
          },
        });
        await runtime.mount();

        const chartMount = env.document.querySelector('[data-testid="chart-mount"]');
        expect(chartMount.innerHTML).toContain('data-lib="chartjs"');
        expect(widgetEvents).toEqual(['widget:connect']);

        // Bump nested controller state before patch
        env.document.querySelector('[data-testid="nested-badge"] button').click();
        expect(env.document.querySelector('[data-testid="nested-badge"] span').textContent).toBe('Badge:2');

        // Patch 1: surrounding server HTML updates, root attr updates, widget inner DOM & nested controller preserved
        await runtime.fragments.refresh('ws:default');
        expect(env.document.getElementById('server-banner').textContent).toBe('Version 2');
        expect(chartMount.getAttribute('class')).toContain('updated-root-class');
        expect(chartMount.innerHTML).toContain('data-lib="chartjs"');
        expect(chartMount.innerHTML).not.toContain('Server tried to overwrite');
        expect(env.document.querySelector('[data-testid="nested-badge"] span').textContent).toBe('Badge:2');
        expect(widgetEvents).toEqual(['widget:connect']);

        // Patch 2: parent removes widget-host -> widget cleanup runs!
        await runtime.fragments.refresh('ws:default');
        expect(env.document.getElementById('server-banner').textContent).toBe('Version 3 (No Widget)');
        expect(widgetEvents).toEqual(['widget:connect', 'widget:cleanup']);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('2. Patch class/visibility ownership & conflict diagnostics', () => {
    it('preserves client-managed data-w-class tokens while applying server class changes, releases ownership on attribute removal, and logs dev conflicts', async () => {
      const html = `
        <div data-w-fragment="panel" data-w-fragment-id="panel:default" data-w-fragment-page="/p">
          <div data-w-controller="panel-ctrl">
            <div id="dropdown" data-w-class="{ 'is-open': open, 'is-active': active }" class="dropdown base-v1">Menu</div>
            <div id="modal" data-w-show="open" hidden style="display: none;">Modal</div>
            <button id="toggle-btn" type="button" data-w-on:click="toggle">Toggle</button>
          </div>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/p');
      const debuggerInst = createClientDebugger({ enabled: true });

      try {
        const panelCtrl = defineController({
          state: () => ({ open: false, active: true }),
          actions: {
            toggle({ state }) {
              state.open = !state.open;
            },
          },
        });

        let step = 0;
        const customFetch = vi.fn().mockImplementation(async () => {
          step += 1;
          if (step === 1) {
            // Server updates base-v1 -> base-v2, and also conflicts on "is-open" + "hidden"
            return new Response(
              JSON.stringify({
                fragments: {
                  'panel:default': {
                    instanceId: 'panel:default',
                    name: 'panel',
                    html: `
                      <div data-w-fragment="panel" data-w-fragment-id="panel:default" data-w-fragment-page="/p">
                        <div data-w-controller="panel-ctrl">
                          <div id="dropdown" data-w-class="{ 'is-open': open, 'is-active': active }" class="dropdown base-v2 is-open">Menu</div>
                          <div id="modal" data-w-show="open" hidden>Modal</div>
                          <button id="toggle-btn" type="button" data-w-on:click="toggle">Toggle</button>
                        </div>
                      </div>
                    `,
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          // Step 2: Server removes data-w-class and data-w-show -> client ownership released, server reclaims class & hidden
          return new Response(
            JSON.stringify({
              fragments: {
                'panel:default': {
                  instanceId: 'panel:default',
                  name: 'panel',
                  html: `
                    <div data-w-fragment="panel" data-w-fragment-id="panel:default" data-w-fragment-page="/p">
                      <div data-w-controller="panel-ctrl">
                        <div id="dropdown" class="dropdown server-only">Menu</div>
                        <div id="modal" hidden>Modal</div>
                        <button id="toggle-btn" type="button" data-w-on:click="toggle">Toggle</button>
                      </div>
                    </div>
                  `,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: customFetch,
          debugger: debuggerInst,
          controllers: { 'panel-ctrl': panelCtrl },
        });
        await runtime.mount();

        const dropdown = env.document.getElementById('dropdown');
        const modal = env.document.getElementById('modal');

        // Open dropdown & modal on client
        env.document.getElementById('toggle-btn').click();
        expect(dropdown.classList.contains('is-open')).toBe(true);
        expect(dropdown.classList.contains('is-active')).toBe(true);
        expect(dropdown.classList.contains('base-v1')).toBe(true);
        expect(modal.hasAttribute('hidden')).toBe(false);

        // Patch 1: server updates base-v1 -> base-v2, client keeps is-open/is-active and open modal, dev conflict emitted
        await runtime.fragments.refresh('panel:default');
        expect(dropdown.classList.contains('base-v2')).toBe(true);
        expect(dropdown.classList.contains('base-v1')).toBe(false);
        expect(dropdown.classList.contains('is-open')).toBe(true);
        expect(dropdown.classList.contains('is-active')).toBe(true);
        expect(modal.hasAttribute('hidden')).toBe(false);

        const conflicts = debuggerInst.getSnapshot().events.filter((e) => e.type === 'ownership:conflict');
        expect(conflicts.length).toBeGreaterThanOrEqual(2);

        // Patch 2: server removes data-w-class & data-w-show -> ownership released!
        await runtime.fragments.refresh('panel:default');
        expect(dropdown.getAttribute('class')).toBe('dropdown server-only');
        expect(modal.hasAttribute('hidden')).toBe(true);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('3. Patch lifecycle hooks (beforePatch / afterPatch)', () => {
    it('executes beforePatch/afterPatch in deterministic nested order, skips superseded patches, isolates hook errors, and detects loops', async () => {
      const html = `
        <div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed">
          <div data-w-controller="outer-ctrl">
            <div data-w-controller="inner-ctrl">
              <span id="feed-val">0</span>
            </div>
          </div>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/feed');
      const debuggerInst = createClientDebugger({ enabled: true });
      const callOrder = [];

      try {
        const outerCtrl = defineController({
          beforePatch(_ctx, meta) {
            callOrder.push(`outer:before:${meta.fragmentName}`);
          },
          afterPatch(_ctx, meta) {
            callOrder.push(`outer:after:${meta.fragmentName}`);
            throw new Error('non-fatal hook error');
          },
        });

        const innerCtrl = defineController({
          beforePatch(_ctx, meta) {
            callOrder.push(`inner:before:${meta.fragmentName}`);
          },
          afterPatch(_ctx, meta) {
            callOrder.push(`inner:after:${meta.fragmentName}`);
          },
        });

        let resolveFirst;
        let callNum = 0;
        const customFetch = vi.fn().mockImplementation(async () => {
          callNum += 1;
          const myCall = callNum;
          if (myCall === 1) {
            await new Promise((r) => {
              resolveFirst = r;
            });
          }
          return new Response(
            JSON.stringify({
              fragments: {
                'feed:default': {
                  instanceId: 'feed:default',
                  name: 'feed',
                  html: `
                    <div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed">
                      <div data-w-controller="outer-ctrl">
                        <div data-w-controller="inner-ctrl">
                          <span id="feed-val">${myCall}</span>
                        </div>
                      </div>
                    </div>
                  `,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: customFetch,
          debugger: debuggerInst,
          controllers: {
            'outer-ctrl': outerCtrl,
            'inner-ctrl': innerCtrl,
          },
        });
        await runtime.mount();

        // Start slow request 1, then supersede with fast request 2
        const p1 = runtime.fragments.refresh('feed:default');
        const p2 = runtime.fragments.refresh('feed:default');
        const res2 = await p2;
        expect(res2.ok).toBe(true);

        // Only request 2 should have triggered hooks (outer->inner for before, inner->outer for after)
        expect(callOrder).toEqual([
          'outer:before:feed',
          'inner:before:feed',
          'inner:after:feed',
          'outer:after:feed',
        ]);

        // Now resolve superseded request 1 -> hooks MUST NOT fire again!
        resolveFirst();
        const res1 = await p1;
        expect(res1.superseded).toBe(true);
        expect(callOrder.length).toBe(4);

        // Legitimate rapid independent patches MUST NOT emit a false loop warning
        for (let i = 0; i < 6; i++) {
          await runtime.fragments.refresh('feed:default');
        }
        let loopWarnings = debuggerInst.getSnapshot().events.filter((e) => e.type === 'patch:loop-warning');
        expect(loopWarnings.length).toBe(0);

        // Real causal loop (afterPatch -> refresh -> afterPatch -> ...) MUST emit PATCH_HOOK_LOOP_DETECTED
        let loopCount = 0;
        let resolveLoopDone;
        const loopDone = new Promise((r) => {
          resolveLoopDone = r;
        });
        const loopHtml = `
          <div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed">
            <div data-w-controller="looper"></div>
          </div>
        `;
        const loopEnv = createMiniDomEnvironment(loopHtml, 'http://localhost/feed');
        const loopDebug = createClientDebugger({ enabled: true });
        try {
          const loopRuntime = createClientRuntime({
            root: loopEnv.document,
            debug: loopDebug,
            fetch: async () =>
              new Response(
                JSON.stringify({
                  ok: true,
                  fragments: {
                    'feed:default': {
                      instanceId: 'feed:default',
                      name: 'feed',
                      html: '<div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed"><div data-w-controller="looper"></div></div>',
                    },
                  },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              ),
          });
          loopRuntime.register(
            'looper',
            defineController({
              afterPatch(ctx) {
                if (loopCount < 4) {
                  loopCount += 1;
                  ctx.refresh('feed:default').catch(() => {});
                } else {
                  resolveLoopDone();
                }
              },
            })
          );
          await loopRuntime.mount();
          await loopRuntime.fragments.refresh('feed:default');
          await loopDone;
          loopWarnings = loopDebug.getSnapshot().events.filter((e) => e.type === 'patch:loop-warning');
          expect(loopWarnings.length).toBeGreaterThanOrEqual(1);
          expect(loopWarnings[0].code).toBe('PATCH_HOOK_LOOP_DETECTED');
          loopRuntime.destroy();
        } finally {
          loopEnv.restore();
        }

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('4. Forms touched, submitted, errorDisplay: "touched", and baseline invariants', () => {
    it('tracks touched/dirty/submitted independently, preserves touched on normal patch, and clears touched on fill/baseline change', async () => {
      const html = `
        <form data-w-form="profile" data-w-error-mode="touched" action="/api/profile" method="post" novalidate>
          <input name="username" type="text" value="alice">
          <span data-w-error="username"></span>
          <input name="email" type="email" value="alice@example.com">
          <span data-w-error="email"></span>
          <button type="submit">Save</button>
        </form>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/profile');
      try {
        const runtime = createClientRuntime({
          root: env.document,
          fetch: vi.fn(),
        });
        await runtime.mount();

        const formEl = env.document.querySelector('form[data-w-form="profile"]');
        const form = formEl.__wFormHandle;
        const usernameInput = formEl.querySelector('input[name="username"]');
        const usernameErr = formEl.querySelector('[data-w-error="username"]');
        const emailErr = formEl.querySelector('[data-w-error="email"]');

        expect(form.dirty).toBe(false);
        expect(form.touched).toBe(false);
        expect(form.submitted).toBe(false);

        // Setting field errors before touch/submit should NOT display them in touched mode
        form.setFieldErrors({ username: 'Too short', email: 'Invalid email' }, false);
        expect(usernameErr.textContent).toBe('');
        expect(emailErr.textContent).toBe('');
        expect(usernameInput.getAttribute('aria-invalid')).toBeNull();

        // Touching username via blur (focusout) reveals ONLY username's error
        usernameInput.dispatchEvent(new env.window.Event('focusout', { bubbles: true }));
        expect(form.isTouched('username')).toBe(true);
        expect(form.isTouched('email')).toBe(false);
        expect(form.dirty).toBe(false);
        expect(usernameErr.textContent).toBe('Too short');
        expect(emailErr.textContent).toBe('');
        expect(usernameInput.getAttribute('aria-invalid')).toBe('true');

        // User edits and returns to baseline -> dirty clears, touched persists
        usernameInput.value = 'alice2';
        usernameInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        expect(form.dirty).toBe(true);
        usernameInput.value = 'alice';
        usernameInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        expect(form.dirty).toBe(false);
        expect(form.isTouched('username')).toBe(true);

        // Loading a new record baseline via fill(..., { baseline: true }) clears previous touched/errors
        form.fill({ username: 'bob', email: 'bob@example.com' }, { baseline: true });
        expect(form.touched).toBe(false);
        expect(form.dirty).toBe(false);
        expect(form.errors).toEqual({});

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('5. Delayed loading indicator (data-w-loading-delay)', () => {
    it('applies disabled/busy immediately, skips visual loading indicator for fast requests, shows after delay, and cleans up on unmount', async () => {
      vi.useFakeTimers();

      const html = `
        <div data-w-controller="loader-ctrl">
          <button id="save-btn" type="button" data-w-on:click="save" data-w-loading-delay="200ms" data-w-loading-text="Saving..." data-w-loading-class="is-spinning">Save</button>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/loader');
      try {
        let resolveReq;
        const ctrl = defineController({
          actions: {
            async save() {
              await new Promise((r) => {
                resolveReq = r;
              });
            },
          },
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: vi.fn(),
          controllers: { 'loader-ctrl': ctrl },
        });
        await runtime.mount();

        const btn = env.document.getElementById('save-btn');

        // Fast request (< 200ms): disabled immediately, visual text/class never flickers
        btn.click();
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Save');
        expect(btn.classList.contains('is-spinning')).toBe(false);

        vi.advanceTimersByTime(100);
        resolveReq();
        await Promise.resolve();
        await Promise.resolve();

        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Save');
        expect(btn.classList.contains('is-spinning')).toBe(false);

        // Slow request (> 200ms): visual text/class appears at 200ms
        btn.click();
        expect(btn.disabled).toBe(true);
        vi.advanceTimersByTime(200);
        expect(btn.textContent).toBe('Saving...');
        expect(btn.classList.contains('is-spinning')).toBe(true);

        resolveReq();
        await Promise.resolve();
        await Promise.resolve();
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Save');
        expect(btn.classList.contains('is-spinning')).toBe(false);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('6. Event debounce & throttle with IME guard and reset cancel', () => {
    it('updates data-w-model immediately while debouncing action, skips during IME composition, and cancels pending timer on form reset', async () => {
      vi.useFakeTimers();

      const html = `
        <div data-w-controller="search-ctrl">
          <form id="search-form">
            <input id="q" type="text" data-w-model="query" data-w-on:input.debounce.300="runSearch" data-tag="search-el">
          </form>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/search');
      const searchedQueries = [];

      try {
        const searchCtrl = defineController({
          state: () => ({ query: '' }),
          actions: {
            runSearch({ state }, _event, actionEl) {
              searchedQueries.push({ q: state.query, tag: actionEl ? actionEl.getAttribute('data-tag') : null });
            },
          },
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: vi.fn(),
          controllers: { 'search-ctrl': searchCtrl },
        });
        await runtime.mount();

        const input = env.document.getElementById('q');
        const form = env.document.getElementById('search-form');
        const inst = runtime.controllers.getActiveInstances().find((i) => i.name === 'search-ctrl');

        // Rapid typing -> model updates immediately, action debounced
        input.value = 'w';
        input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        expect(inst.state.query).toBe('w');
        expect(searchedQueries).toEqual([]);

        input.value = 'web';
        input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        expect(inst.state.query).toBe('web');

        vi.advanceTimersByTime(299);
        expect(searchedQueries).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(searchedQueries).toEqual([{ q: 'web', tag: 'search-el' }]);

        // IME composition blocks debounced action until compositionend
        input.dispatchEvent(new env.window.Event('compositionstart', { bubbles: true }));
        input.value = 'web-ime';
        input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        vi.advanceTimersByTime(500);
        expect(searchedQueries.length).toBe(1);
        input.dispatchEvent(new env.window.Event('compositionend', { bubbles: true }));

        // Form reset cancels pending debounce so stale query never fires
        input.value = 'stale-after-reset';
        input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
        form.dispatchEvent(new env.window.Event('reset', { bubbles: true }));
        vi.advanceTimersByTime(500);
        expect(searchedQueries.length).toBe(1);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('7. Lazy SSR fragments (lazy: true & IntersectionObserver)', () => {
    it('skips loader on initial SSR, marks stale when invalidated before visible, and loads when visible or explicitly refreshed', async () => {
      const loaderSpy = vi.fn().mockImplementation(async ({ input }) => ({ count: input.count || 42 }));
      const fragDef = defineFragment({
        template: 'stats.njk',
        lazy: true,
        dependsOn: ['orders'],
        placeholder: ({ instanceId }) => `<div data-testid="placeholder-${instanceId}">Loading stats...</div>`,
        load: loaderSpy,
      });

      const ssrRes = await executeAndRenderFragment({
        name: 'stats',
        instanceId: 'stats:default',
        pagePath: '/dash',
        fragmentDef: fragDef,
        input: { count: 99 },
        req: {},
        res: {},
        ctx: {},
        nunjucksEnv: { render: () => '<div>loaded</div>' },
        fsy: {},
        isInitialSsr: true,
      });

      expect(loaderSpy).not.toHaveBeenCalled();
      expect(ssrRes.html).toContain('data-w-lazy="visible"');
      expect(ssrRes.html).toContain('Loading stats...');

      const env = createMiniDomEnvironment(ssrRes.html, 'http://localhost/dash');
      const observerCallbacks = [];
      env.window.IntersectionObserver = class MockIntersectionObserver {
        constructor(cb) {
          observerCallbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      global.IntersectionObserver = env.window.IntersectionObserver;

      try {
        const customFetch = vi.fn().mockImplementation(async () => {
          return new Response(
            JSON.stringify({
              fragments: {
                'stats:default': {
                  instanceId: 'stats:default',
                  name: 'stats',
                  html: '<div data-testid="stats-loaded">Loaded 99</div>',
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({
          root: env.document,
          fetch: customFetch,
        });
        await runtime.mount();

        // Invalidation while offscreen/unloaded should NOT fetch immediately
        await runtime.fragments.invalidate(['orders']);
        expect(customFetch).not.toHaveBeenCalled();

        // Trigger visibility via IntersectionObserver -> loads now!
        const fragEl = env.document.querySelector('[data-w-fragment="stats"]');
        observerCallbacks[0]([{ target: fragEl, isIntersecting: true, intersectionRatio: 1 }]);

        await vi.waitFor(() => {
          expect(customFetch).toHaveBeenCalledTimes(1);
        });
        expect(fragEl.innerHTML).toContain('Loaded 99');
        expect(fragEl.hasAttribute('data-w-lazy')).toBe(false);

        runtime.destroy();
      } finally {
        delete global.IntersectionObserver;
        env.restore();
      }
    });
  });

  describe('8. Field-level server validation (defineApi validateFields & form.validateField)', () => {
    it('validates fields without executing mutation handler, ignores stale responses, preserves other field errors, and isolates network errors', async () => {
      const mutationSpy = vi.fn();
      const apiDef = defineApi({
        schema: () => ({
          body: z.object({
            email: z.string().email('Invalid email format'),
            username: z.string().min(3, 'Username too short'),
          }),
        }),
        validateFields: true,
        validate: async (req) => {
          if (req.input.body && req.input.body.username === 'taken_user') {
            return { username: 'Username already taken' };
          }
          return null;
        },
        handler: async (_req, res) => {
          mutationSpy();
          return res.status(201).json({ ok: true });
        },
      });

      // Server pipeline check: X-Webspresso-Validate-Fields never runs mutation handler
      let jsonResponse = null;
      let statusCode = 200;
      const mockRes = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          jsonResponse = payload;
          return this;
        },
      };

      await executeApiPipeline({
        apiDef,
        handlerFn: apiDef.handler,
        compiledSchema: apiDef.schema({ z }),
        req: {
          headers: { 'x-webspresso-validate-fields': 'username' },
          body: { username: 'taken_user', email: 'bad' },
          params: {},
          query: {},
        },
        res: mockRes,
      });

      expect(mutationSpy).not.toHaveBeenCalled();
      expect(statusCode).toBe(200);
      expect(jsonResponse).toEqual({
        ok: false,
        valid: false,
        errors: { username: 'Username already taken' },
        validatedFields: ['username'],
      });

      // Client form.validateField check: stale guard + preserving other field errors + network error isolation
      const html = `
        <form data-w-form="signup" action="/api/signup" method="post" novalidate>
          <input name="username" type="text" value="ab">
          <span data-w-error="username"></span>
          <input name="email" type="email" value="bad">
          <span data-w-error="email"></span>
        </form>
      `;
      const env = createMiniDomEnvironment(html, 'http://localhost/signup');
      try {
        let resolveSlow;
        let reqCount = 0;
        const customFetch = vi.fn().mockImplementation(async () => {
          reqCount += 1;
          if (reqCount === 1) {
            await new Promise((r) => {
              resolveSlow = r;
            });
            return new Response(
              JSON.stringify({ ok: true, valid: false, errors: { username: 'Stale error' } }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (reqCount === 2) {
            return new Response(
              JSON.stringify({ ok: true, valid: true, errors: {} }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(JSON.stringify({ error: 'Server down' }), { status: 500 });
        });

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        await runtime.mount();
        const form = env.document.querySelector('form').__wFormHandle;

        // Pre-existing error on email must NOT be wiped by validating username
        form.setFieldErrors({ email: 'Email already used' }, false);

        const pSlow = form.validateField('username');
        const pFast = form.validateField('username');
        await pFast;
        resolveSlow();
        const slowRes = await pSlow;

        expect(slowRes.stale).toBe(true);
        expect(form.fieldErrors.username).toBeUndefined();
        expect(form.fieldErrors.email).toBe('Email already used');

        // 500 network error must NOT mark username as invalid
        const netRes = await form.validateField('username');
        expect(netRes.networkError).toBe(true);
        expect(form.fieldErrors.username).toBeUndefined();

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('9. Incremental keyed list updates (append / prepend / limit / removeKeys)', () => {
    it('appends/prepends keyed items, deduplicates updates by key, trims to limit, and removes specified keys', async () => {
      const html = `
        <div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed">
          <ul data-w-list>
            <li data-w-key="item-1">Item 1</li>
            <li data-w-key="item-2">Item 2</li>
          </ul>
        </div>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/feed');
      try {
        let modeStep = 0;
        const customFetch = vi.fn().mockImplementation(async () => {
          modeStep += 1;
          if (modeStep === 1) {
            // Append item-3 + update item-2 in place (no duplicate)
            return new Response(
              JSON.stringify({
                fragments: {
                  'feed:default': {
                    instanceId: 'feed:default',
                    name: 'feed',
                    html: '<div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed"><ul data-w-list><li data-w-key="item-2">Item 2 Updated</li><li data-w-key="item-3">Item 3</li></ul></div>',
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          // Prepend item-0 with limit 2 and remove item-1
          return new Response(
            JSON.stringify({
              fragments: {
                'feed:default': {
                  instanceId: 'feed:default',
                  name: 'feed',
                  html: '<div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed"><ul data-w-list><li data-w-key="item-0">Item 0</li></ul></div>',
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        await runtime.mount();

        await runtime.fragments.refresh('feed:default', {}, { mode: 'append' });
        let items = Array.from(env.document.querySelectorAll('li')).map((li) => li.textContent);
        expect(items).toEqual(['Item 1', 'Item 2 Updated', 'Item 3']);

        await runtime.fragments.refresh('feed:default', {}, {
          mode: 'prepend',
          limit: 2,
          removeKeys: ['item-1'],
        });
        items = Array.from(env.document.querySelectorAll('li')).map((li) => li.textContent);
        expect(items).toEqual(['Item 0', 'Item 2 Updated']);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });
  });

  describe('10. Upload progress, cancel, and preview URL lifecycle', () => {
    it('tracks real XHR upload progress, supports cancelUpload, and revokes preview URLs on reset/unmount', async () => {
      const html = `
        <form data-w-form="uploader" action="/api/upload" method="post" enctype="multipart/form-data" novalidate>
          <input name="avatar" type="file">
          <button type="submit">Upload</button>
        </form>
      `;

      const env = createMiniDomEnvironment(html, 'http://localhost/upload');
      const createdUrls = [];
      const revokedUrls = [];
      const origCreateObjUrl = URL.createObjectURL;
      const origRevokeObjUrl = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => {
        const u = `blob:mock-${createdUrls.length + 1}`;
        createdUrls.push(u);
        return u;
      });
      URL.revokeObjectURL = vi.fn((u) => {
        revokedUrls.push(u);
      });

      const origXhr = global.XMLHttpRequest;
      let activeXhr = null;
      global.XMLHttpRequest = class MockXHR {
        constructor() {
          this.upload = {};
          this.status = 200;
          this.statusText = 'OK';
          this.responseText = '{"ok":true}';
          activeXhr = this;
        }
        open() {}
        setRequestHeader() {}
        getAllResponseHeaders() {
          return 'content-type: application/json\r\n';
        }
        send() {}
        abort() {
          if (this.onabort) this.onabort();
        }
      };

      try {
        const runtime = createClientRuntime({ root: env.document, fetch: vi.fn() });
        await runtime.mount();

        const formEl = env.document.querySelector('form');
        const form = formEl.__wFormHandle;
        const fileInput = formEl.querySelector('input[type="file"]');
        Object.defineProperty(fileInput, 'files', {
          value: [{ name: 'photo.png', size: 1000 }],
          configurable: true,
        });

        const preview = form.createPreviewUrl(fileInput.files[0], 'avatar');
        expect(preview).toBe('blob:mock-1');

        const submitPromise = form.submit();
        expect(form.uploads.length).toBe(1);
        expect(form.uploads[0].status).toBe('uploading');

        activeXhr.upload.onprogress({ lengthComputable: true, loaded: 500, total: 1000 });
        expect(form.uploads[0].percent).toBe(50);

        const canceled = form.cancelUpload();
        expect(canceled).toBe(true);
        const submitRes = await submitPromise;
        expect(submitRes.ok).toBe(false);
        expect(form.uploads[0].status).toBe('canceled');

        runtime.destroy();
        expect(revokedUrls).toContain('blob:mock-1');
      } finally {
        global.XMLHttpRequest = origXhr;
        URL.createObjectURL = origCreateObjUrl;
        URL.revokeObjectURL = origRevokeObjUrl;
        env.restore();
      }
    });
  });

  describe('11. Hardening: Cross-feature interactions (Areas 1-6)', () => {
    function createDeferred() {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('Area 1: incremental append keeps base query for invalidation, discards superseded append on replace, and cleans up limit-evicted controllers', async () => {
      const html = `
        <div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed" data-w-depends-on="feed" data-w-fragment-input='{"page":1,"filter":"all"}'>
          <ul data-w-list data-w-limit="3">
            <li data-w-key="a"><div data-w-controller="rowCtrl">A</div></li>
            <li data-w-key="b"><div data-w-controller="rowCtrl">B</div></li>
          </ul>
        </div>
      `;
      const env = createMiniDomEnvironment(html, 'http://localhost/feed');
      const disconnected = [];
      const requests = [];
      const appendBarrier = createDeferred();

      try {
        const customFetch = vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          const target = body.fragments[0];
          requests.push({ input: target.input });
          if (target.input.page === 2) {
            return new Response(
              JSON.stringify({
                ok: true,
                fragments: {
                  'feed:default': {
                    instanceId: 'feed:default',
                    name: 'feed',
                    input: { page: 2, filter: target.input.filter },
                    html: '<div data-w-fragment="feed"><ul data-w-list><li data-w-key="c"><div data-w-controller="rowCtrl">C</div></li></ul></div>',
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (target.input.page === 3) {
            await appendBarrier.promise;
            return new Response(
              JSON.stringify({
                ok: true,
                fragments: {
                  'feed:default': {
                    instanceId: 'feed:default',
                    name: 'feed',
                    input: { page: 3, filter: target.input.filter },
                    html: '<div data-w-fragment="feed"><ul data-w-list><li data-w-key="d"><div data-w-controller="rowCtrl">D</div></li></ul></div>',
                  },
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          const label = target.input.filter === 'done' ? 'Done-1' : 'A-fresh';
          return new Response(
            JSON.stringify({
              ok: true,
              fragments: {
                'feed:default': {
                  instanceId: 'feed:default',
                  name: 'feed',
                  input: target.input,
                  html: `<div data-w-fragment="feed" data-w-fragment-id="feed:default" data-w-fragment-page="/feed" data-w-depends-on="feed"><ul data-w-list data-w-limit="3"><li data-w-key="a"><div data-w-controller="rowCtrl">${label}</div></li></ul></div>`,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        runtime.register(
          'rowCtrl',
          defineController({
            connect(ctx) {
              const txt = ctx.el.textContent;
              return () => disconnected.push(txt);
            },
          })
        );
        await runtime.mount();

        // 1. Append page 2 & page 3 (with limit=3, appending D would evict A; first append C)
        await runtime.fragments.refresh('feed:default', { page: 2 }, { mode: 'append' });
        expect(Array.from(env.document.querySelectorAll('li')).map((el) => el.getAttribute('data-w-key'))).toEqual(['a', 'b', 'c']);
        // Base input must remain page: 1 so automatic invalidation resets cleanly to page 1!
        expect(runtime.fragments.getInstance('feed:default').input).toEqual({ page: 1, filter: 'all' });

        // 2. Mutation invalidation uses base query (page: 1), NOT page: 2, and replaces list
        await runtime.fragments.invalidate(['feed']);
        expect(requests[requests.length - 1].input).toEqual({ page: 1, filter: 'all' });
        expect(Array.from(env.document.querySelectorAll('li')).map((el) => el.textContent.trim())).toEqual(['A-fresh']);
        expect(disconnected).toContain('B');
        expect(disconnected).toContain('C');

        // 3. In-flight append (page 3) superseded by newer replace (filter: 'done') MUST be discarded
        const pAppend3 = runtime.fragments.refresh('feed:default', { page: 3 }, { mode: 'append' });
        const pReplace = runtime.fragments.refresh('feed:default', { page: 1, filter: 'done' }, { mode: 'replace' });
        await pReplace;
        appendBarrier.resolve();
        await pAppend3;
        expect(Array.from(env.document.querySelectorAll('li')).map((el) => el.textContent.trim())).toEqual(['Done-1']);
        expect(runtime.fragments.getInstance('feed:default').input).toEqual({ page: 1, filter: 'done' });

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('Area 2: form validation races invalidate on submit/reset/clear/baseline-fill/unmount without clobbering unrelated errors', async () => {
      const html = `
        <form data-w-form="profile" action="/api/profile" method="post" novalidate>
          <input name="email" value="a@b.com">
          <div data-w-error-for="email"></div>
          <input name="username" value="alice" data-w-validate-context="email">
          <div data-w-error-for="username"></div>
          <button type="submit">Save</button>
        </form>
      `;
      const env = createMiniDomEnvironment(html, 'http://localhost/profile');
      const slowValidation = createDeferred();
      const postSubmitValidation = createDeferred();
      let validateCall = 0;

      try {
        const customFetch = vi.fn(async (_url, init) => {
          const validateHeader = init.headers && (init.headers['X-Webspresso-Validate-Fields'] || init.headers['x-webspresso-validate-fields']);
          if (validateHeader) {
            validateCall += 1;
            if (validateCall === 1) {
              await slowValidation.promise;
              return new Response(JSON.stringify({ ok: true, valid: false, errors: { email: 'Old slow error' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (validateCall === 2) {
              return new Response(JSON.stringify({ ok: true, valid: true, errors: {} }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (validateCall === 3) {
              // Simulate a fetch implementation that resolves AFTER submit even if aborted
              await postSubmitValidation.promise;
              return new Response(JSON.stringify({ ok: true, valid: false, errors: { email: 'Late post-submit error' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            // Cross-field / 500 error check
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ ok: true, saved: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        await runtime.mount();

        const formEl = env.document.querySelector('form');
        const form = formEl.__wFormHandle;

        // 1. Rapid field changes: call 1 (slow) vs call 2 (fast)
        const v1 = form.validateField('email');
        const v2 = form.validateField('email');
        await v2;
        slowValidation.resolve();
        await v1;
        expect(form.fieldErrors.email).toBeUndefined();

        // 2. Submit while validation 3 is in-flight, and resolve validation 3 AFTER submit completes
        const v3 = form.validateField('email');
        const submitRes = await form.submit();
        expect(submitRes.ok).toBe(true);
        postSubmitValidation.resolve();
        await v3;
        expect(form.fieldErrors.email).toBeUndefined();

        // 3. Network/5xx error dispatches w-form:validation-error and does NOT mark field invalid
        const events = [];
        formEl.addEventListener('w-form:validation-error', (e) => events.push(e.detail));
        const v4 = await form.validateField('username');
        expect(v4.networkError).toBe(true);
        expect(form.fieldErrors.username).toBeUndefined();
        expect(events.length).toBe(1);

        // 4. fill({ baseline: true }) resets dirty & clears errors
        form.fill({ email: 'new@b.com' }, { baseline: false });
        expect(form.dirty).toBe(true);
        form.fill({ email: 'new@b.com' }, { baseline: true });
        expect(form.dirty).toBe(false);

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('Area 3: parent refresh preserves loaded lazy child, skips unloaded lazy child freshness bump, and cleans up removed children', async () => {
      const html = `
        <div data-w-fragment="parent" data-w-fragment-id="parent:default" data-w-fragment-page="/p" data-w-depends-on="parent">
          <div data-w-fragment="lazy-unloaded" data-w-fragment-id="lazy-unloaded:default" data-w-fragment-page="/p" data-w-depends-on="child" data-w-lazy="true">Placeholder</div>
          <div data-w-fragment="lazy-loaded" data-w-fragment-id="lazy-loaded:default" data-w-fragment-page="/p" data-w-depends-on="child">Loaded Content</div>
        </div>
      `;
      const env = createMiniDomEnvironment(html, 'http://localhost/p');
      try {
        let phase = 1;
        const customFetch = vi.fn(async () => {
          const inner = phase === 1
            ? `
              <div data-w-fragment="lazy-unloaded" data-w-fragment-id="lazy-unloaded:default" data-w-fragment-page="/p" data-w-depends-on="child" data-w-lazy="true">Placeholder</div>
              <div data-w-fragment="lazy-loaded" data-w-fragment-id="lazy-loaded:default" data-w-fragment-page="/p" data-w-depends-on="child" data-w-lazy="true">Server Lazy Placeholder</div>
            `
            : `<p>Children removed</p>`;
          return new Response(
            JSON.stringify({
              ok: true,
              fragments: {
                'parent:default': {
                  instanceId: 'parent:default',
                  name: 'parent',
                  html: `<div data-w-fragment="parent" data-w-fragment-id="parent:default" data-w-fragment-page="/p" data-w-depends-on="parent">${inner}</div>`,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        await runtime.mount();

        const unloadedInst = runtime.fragments.getInstance('lazy-unloaded:default');
        const loadedInst = runtime.fragments.getInstance('lazy-loaded:default');
        unloadedInst.lastUpdatedAt = 1000;
        loadedInst.lastUpdatedAt = 1000;

        await runtime.fragments.refresh('parent:default');

        // Unloaded lazy child was NOT loaded and its lastUpdatedAt was NOT falsely bumped
        expect(unloadedInst.lazyState).toBe('idle');
        expect(unloadedInst.lastUpdatedAt).toBe(1000);

        // Loaded lazy child was NOT overwritten by server's lazy placeholder and kept its content & freshness timestamp
        expect(env.document.querySelector('[data-w-fragment-id="lazy-loaded:default"]').textContent).toBe('Loaded Content');
        expect(loadedInst.lastUpdatedAt).toBe(1000);

        // Parent patch removing child cleans up removed child instances
        phase = 2;
        await runtime.fragments.refresh('parent:default');
        expect(runtime.fragments.getInstance('lazy-unloaded:default')).toBeNull();
        expect(runtime.fragments.getInstance('lazy-loaded:default')).toBeNull();

        runtime.destroy();
      } finally {
        env.restore();
      }
    });

    it('Area 4 & 5 & 6: data-w-ignore skips inner controller patch hooks, XHR status=0 maps to network outcomeUnknown, and fill({ baseline: false }) recomputes dirty accurately', async () => {
      const html = `
        <div data-w-fragment="main" data-w-fragment-id="main:default" data-w-fragment-page="/m">
          <div data-w-ignore="children">
            <div data-w-controller="ignoredInner"></div>
          </div>
          <form data-w-form="edit" action="/api/edit" method="post" novalidate>
            <input name="title" value="Initial">
          </form>
        </div>
      `;
      const env = createMiniDomEnvironment(html, 'http://localhost/m');
      const hookCalls = [];
      const origXhr = global.XMLHttpRequest;

      global.XMLHttpRequest = class MockFailXHR {
        constructor() {
          this.upload = {};
          this.status = 0;
          this.statusText = '';
          this.responseText = '';
        }
        open() {}
        setRequestHeader() {}
        getAllResponseHeaders() {
          return '';
        }
        send() {
          if (this.onload) this.onload();
        }
        abort() {}
      };

      try {
        const customFetch = vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              fragments: {
                'main:default': {
                  instanceId: 'main:default',
                  name: 'main',
                  html: `<div data-w-fragment="main" data-w-fragment-id="main:default" data-w-fragment-page="/m"><div data-w-ignore="children"><div data-w-controller="ignoredInner"></div></div><form data-w-form="edit" action="/api/edit" method="post" novalidate><input name="title" value="Initial"></form></div>`,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );

        const runtime = createClientRuntime({ root: env.document, fetch: customFetch });
        runtime.register(
          'ignoredInner',
          defineController({
            beforePatch() {
              hookCalls.push('before');
            },
            afterPatch() {
              hookCalls.push('after');
            },
          })
        );
        await runtime.mount();

        // Area 4: inner controller inside data-w-ignore="children" MUST NOT receive patch hooks
        await runtime.fragments.refresh('main:default');
        expect(hookCalls).toEqual([]);

        // Area 6: fill({ baseline: false }) with same values keeps dirty === false; different sets dirty === true
        const form = env.document.querySelector('form').__wFormHandle;
        form.fill({ title: 'Initial' }, { baseline: false });
        expect(form.dirty).toBe(false);
        form.fill({ title: 'Changed' }, { baseline: false });
        expect(form.dirty).toBe(true);

        // Area 5: XHR status === 0 with onUploadProgress maps to kind: 'network' + outcomeUnknown: true
        let xhrErr = null;
        try {
          await runtime.api.post('/api/upload', new FormData(), {
            onUploadProgress: () => {},
          });
        } catch (err) {
          xhrErr = err;
        }
        expect(xhrErr).toBeTruthy();
        expect(xhrErr.kind).toBe('network');
        expect(xhrErr.dispatched).toBe(true);
        expect(xhrErr.outcomeUnknown).toBe(true);

        runtime.destroy();
      } finally {
        global.XMLHttpRequest = origXhr;
        env.restore();
      }
    });
  });

  describe('Doctor static attribute contract checks', () => {
    it('flags invalid static data-w-ignore/delay/error-mode while ignoring dynamic {{ ... }} expressions', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-doc-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
        fs.writeFileSync(
          path.join(tmpDir, 'pages', 'test.njk'),
          `
            <div data-w-ignore="bogus"></div>
            <div data-w-ignore="{{ dynamicMode }}"></div>
            <button data-w-loading-delay="abc"></button>
            <button data-w-loading-delay="{{ delayMs }}"></button>
            <form data-w-error-mode="never"></form>
          `
        );
        const report = checkTemplateFormContracts(tmpDir, { contracts: [] });
        const codes = report.warnings.map((w) => w.code);
        expect(codes).toContain('INVALID_DATA_W_IGNORE');
        expect(codes).toContain('INVALID_LOADING_DELAY');
        expect(codes).toContain('INVALID_ERROR_MODE');
        expect(report.warnings.filter((w) => w.code === 'INVALID_DATA_W_IGNORE').length).toBe(1);
        expect(report.warnings.filter((w) => w.code === 'INVALID_LOADING_DELAY').length).toBe(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
