'use strict';

const fs = require('fs');
const path = require('path');
const { createTempDir, cleanupDir } = require('../utils/fs');
const { createMiniDomEnvironment } = require('../utils/mini-dom');
const {
  createClientRuntime,
  bootClient,
  defineController,
  defineClientService,
  createClientServiceRegistry,
} = require('../../core/client');
const { buildBundle } = require('../../src/bundle');

describe('Webspresso Client Services & Lazy UI Host Infrastructure', () => {
  let domEnv;

  beforeEach(() => {
    domEnv = createMiniDomEnvironment();
  });

  afterEach(() => {
    if (domEnv) {
      domEnv.restore();
    }
  });

  it('1. shares a single initialization promise across concurrent services.get() calls', async () => {
    let loadCount = 0;
    let createCount = 0;
    let resolveGate;
    const gatePromise = new Promise((resolve) => {
      resolveGate = resolve;
    });

    const runtime = createClientRuntime({
      services: {
        analytics: defineClientService({
          load: async () => {
            loadCount += 1;
            await gatePromise;
            return {
              default: () => {
                createCount += 1;
                return {
                  track: (evt) => `tracked:${evt}`,
                };
              },
            };
          },
        }),
      },
    });

    // Not eagerly loaded at registration time
    expect(loadCount).toBe(0);
    expect(createCount).toBe(0);

    const p1 = runtime.services.get('analytics');
    const p2 = runtime.services.get('analytics');
    const p3 = runtime.services.get('analytics');

    expect(loadCount).toBe(1);
    resolveGate();

    const [s1, s2, s3] = await Promise.all([p1, p2, p3]);
    expect(loadCount).toBe(1);
    expect(createCount).toBe(1);
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
    expect(s1.track('click')).toBe('tracked:click');

    runtime.destroy();
  });

  it('2. returns the same service instance across different controllers in the same runtime', async () => {
    document.body.innerHTML = `
      <div id="ctrl-a" data-w-controller="alpha">
        <button id="btn-a" data-w-on:click="notify">Notify A</button>
      </div>
      <div id="ctrl-b" data-w-controller="beta">
        <button id="btn-b" data-w-on:click="notify">Notify B</button>
      </div>
    `;

    let initCount = 0;
    const seenInstances = [];

    const toastService = defineClientService({
      create({ mountHost }) {
        initCount += 1;
        const host = mountHost('toast');
        const messages = [];
        return {
          hostEl: host.el,
          messages,
          success(msg) {
            messages.push(msg);
            const item = document.createElement('span');
            item.textContent = msg;
            host.el.appendChild(item);
          },
        };
      },
    });

    const alphaController = defineController({
      actions: {
        async notify({ services }) {
          const toast = await services.get('toast');
          seenInstances.push(toast);
          toast.success('From Alpha');
        },
      },
    });

    const betaController = defineController({
      actions: {
        async notify({ services }) {
          const toast = await services.get('toast');
          seenInstances.push(toast);
          toast.success('From Beta');
        },
      },
    });

    const runtime = createClientRuntime({
      services: { toast: toastService },
      controllers: {
        alpha: alphaController,
        beta: betaController,
      },
    });

    await runtime.mount();
    expect(initCount).toBe(0);
    expect(document.querySelectorAll('[data-w-host="toast"]').length).toBe(0);

    const instA = runtime.getController(document.getElementById('ctrl-a'), 'alpha');
    const instB = runtime.getController(document.getElementById('ctrl-b'), 'beta');

    await instA.invokeAction('notify');
    await instB.invokeAction('notify');

    expect(initCount).toBe(1);
    expect(seenInstances.length).toBe(2);
    expect(seenInstances[0]).toBe(seenInstances[1]);
    expect(seenInstances[0].messages).toEqual(['From Alpha', 'From Beta']);
    expect(document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);

    runtime.destroy();
  });

  it('3. isolates service instances across separate client runtimes', async () => {
    const root1 = document.createElement('div');
    const root2 = document.createElement('div');
    document.body.appendChild(root1);
    document.body.appendChild(root2);

    let seq = 0;
    const serviceDef = defineClientService({
      create() {
        const id = ++seq;
        const items = [];
        return {
          id,
          push: (val) => items.push(val),
          items,
        };
      },
    });

    const runtime1 = createClientRuntime({
      root: root1,
      services: { store: serviceDef },
    });

    const runtime2 = createClientRuntime({
      root: root2,
      services: { store: serviceDef },
    });

    const s1 = await runtime1.services.get('store');
    const s2 = await runtime2.services.get('store');

    expect(s1).not.toBe(s2);
    expect(s1.id).toBe(1);
    expect(s2.id).toBe(2);

    s1.push('only-in-1');
    expect(s1.items).toEqual(['only-in-1']);
    expect(s2.items).toEqual([]);

    runtime1.destroy();
    // Disposing runtime1 does not affect runtime2
    const s2Again = await runtime2.services.get('store');
    expect(s2Again).toBe(s2);

    runtime2.destroy();
  });

  it('4. evicts failed initialization from cache, cleans up partial resources/hosts, and allows subsequent retry', async () => {
    let attempts = 0;
    let partialCleanupRan = 0;

    const flakyService = defineClientService({
      async create({ mountHost, onCleanup }) {
        attempts += 1;
        // Mount a host and register cleanup BEFORE failing on first attempt
        mountHost('flaky-ui', { className: `attempt-${attempts}` });
        onCleanup(() => {
          partialCleanupRan += 1;
        });

        if (attempts === 1) {
          throw new Error('Network chunk load failed on attempt 1');
        }

        return {
          ready: true,
          attempt: attempts,
        };
      },
    });

    const runtime = createClientRuntime({
      debug: true,
      services: { flaky: flakyService },
    });

    // First attempt fails
    await expect(runtime.services.get('flaky')).rejects.toThrow('Network chunk load failed on attempt 1');
    expect(attempts).toBe(1);
    expect(partialCleanupRan).toBe(1);
    // Partial host created during failed attempt must be removed from DOM
    expect(document.querySelector('[data-w-host="flaky-ui"]')).toBeNull();
    expect(runtime.services.isInitialized('flaky')).toBe(false);

    // Second attempt succeeds cleanly
    const resolved = await runtime.services.get('flaky');
    expect(resolved).toEqual({ ready: true, attempt: 2 });
    expect(attempts).toBe(2);
    expect(document.querySelectorAll('[data-w-host="flaky-ui"]').length).toBe(1);

    // Debugger recorded init, error, and ready events without sensitive data leakage
    const snapshot = runtime.debug.getSnapshot();
    const serviceEventTypes = snapshot.events
      .filter((e) => e.type.startsWith('service:'))
      .map((e) => e.type);
    expect(serviceEventTypes).toContain('service:init');
    expect(serviceEventTypes).toContain('service:error');
    expect(serviceEventTypes).toContain('service:ready');

    runtime.destroy();
    expect(document.querySelector('[data-w-host="flaky-ui"]')).toBeNull();
  });

  it('5. unmounting a controller does NOT dispose shared runtime services or their UI hosts', async () => {
    document.body.innerHTML = `
      <div id="first-ctrl" data-w-controller="first"></div>
      <div id="second-ctrl" data-w-controller="second"></div>
    `;

    let disposedCount = 0;
    const toastDef = defineClientService({
      create({ mountHost, onCleanup }) {
        const host = mountHost('toast');
        onCleanup(() => {
          disposedCount += 1;
        });
        return {
          success(msg) {
            const el = document.createElement('div');
            el.className = 'toast-msg';
            el.textContent = msg;
            host.el.appendChild(el);
          },
        };
      },
    });

    const runtime = createClientRuntime({
      services: { toast: toastDef },
      controllers: {
        first: defineController({
          actions: {
            async notify({ services }) {
              const t = await services.get('toast');
              t.success('Hello from First');
            },
          },
        }),
        second: defineController({
          actions: {
            async notify({ services }) {
              const t = await services.get('toast');
              t.success('Hello from Second');
            },
          },
        }),
      },
    });

    await runtime.mount();
    const firstEl = document.getElementById('first-ctrl');
    const secondEl = document.getElementById('second-ctrl');

    await runtime.getController(firstEl, 'first').invokeAction('notify');
    expect(document.querySelectorAll('[data-w-host="toast"] .toast-msg').length).toBe(1);

    // Unmount and remove the first controller
    runtime.controllers.unmountSubtree(firstEl);
    firstEl.remove();

    // Shared service and its host must remain active for the second controller
    expect(disposedCount).toBe(0);
    expect(document.querySelector('[data-w-host="toast"]')).not.toBeNull();

    await runtime.getController(secondEl, 'second').invokeAction('notify');
    expect(document.querySelectorAll('[data-w-host="toast"] .toast-msg').length).toBe(2);

    runtime.destroy();
    expect(disposedCount).toBe(1);
    expect(document.querySelector('[data-w-host="toast"]')).toBeNull();
  });

  it('6. runtime.destroy() is idempotent, isolates cleanup errors across services, and rejects post-dispose resolution', async () => {
    const cleanupOrder = [];

    const runtime = createClientRuntime({
      debug: true,
      services: {
        first: defineClientService({
          create({ mountHost, onCleanup }) {
            mountHost('first-host');
            onCleanup(() => {
              cleanupOrder.push('first:cleanup');
            });
            return { name: 'first' };
          },
        }),
        brokenCleanup: defineClientService({
          create({ mountHost, onCleanup }) {
            mountHost('broken-host');
            onCleanup(() => {
              cleanupOrder.push('broken:cleanup');
              throw new Error('Cleanup explosion in brokenCleanup');
            });
            return { name: 'broken' };
          },
        }),
        third: defineClientService({
          create({ mountHost }) {
            mountHost('third-host');
            return {
              name: 'third',
              dispose() {
                cleanupOrder.push('third:dispose');
              },
            };
          },
        }),
      },
    });

    await runtime.services.get('first');
    await runtime.services.get('brokenCleanup');
    await runtime.services.get('third');

    expect(document.querySelectorAll('[data-w-host]').length).toBe(3);

    // Destroy runtime: brokenCleanup error must NOT prevent first or third or their hosts from cleaning up
    expect(() => runtime.destroy()).not.toThrow();
    expect(cleanupOrder).toEqual(['third:dispose', 'broken:cleanup', 'first:cleanup']);
    expect(document.querySelectorAll('[data-w-host]').length).toBe(0);

    // Idempotent second call
    expect(() => runtime.destroy()).not.toThrow();
    expect(cleanupOrder.length).toBe(3);

    // Resolving after dispose must reject with a clear error
    await expect(runtime.services.get('first')).rejects.toMatchObject({
      code: 'CLIENT_RUNTIME_DISPOSED',
    });

    // Cleanup error was recorded in debug telemetry
    const snapshot = runtime.debug.getSnapshot();
    expect(snapshot.cleanupErrors.some((e) => e.message.includes('Cleanup explosion'))).toBe(true);
  });

  it('7. late-completing initialization after runtime.destroy() cleans up immediately and leaves no active service or DOM host', async () => {
    let finishLoad;
    const loadGate = new Promise((resolve) => {
      finishLoad = resolve;
    });
    let lateCleanupCalled = 0;

    const runtime = createClientRuntime({
      services: {
        slowModal: defineClientService({
          load: async () => {
            await loadGate;
            return {
              default: ({ mountHost, onCleanup }) => {
                mountHost('slow-modal-host');
                onCleanup(() => {
                  lateCleanupCalled += 1;
                });
                return { open: () => {} };
              },
            };
          },
        }),
      },
    });

    const pendingGet = runtime.services.get('slowModal');

    // Dispose runtime BEFORE slowModal finishes loading
    runtime.destroy();

    // Now let the dynamic import finish
    finishLoad();

    await expect(pendingGet).rejects.toMatchObject({
      code: 'CLIENT_RUNTIME_DISPOSED',
    });

    // Must not leave any initialized service or DOM host behind
    expect(runtime.services.isInitialized('slowModal')).toBe(false);
    expect(document.querySelector('[data-w-host="slow-modal-host"]')).toBeNull();
  });

  it('8. DOM-less services never allocate a host manager or create DOM nodes', async () => {
    const initialChildCount = document.body.children.length;

    const runtime = createClientRuntime({
      services: {
        clipboard: defineClientService({
          create() {
            let copied = null;
            return {
              async copy(text) {
                copied = String(text);
                return true;
              },
              lastCopied: () => copied,
            };
          },
        }),
      },
    });

    const clipboard = await runtime.services.get('clipboard');
    await clipboard.copy('webspresso-token');

    expect(clipboard.lastCopied()).toBe('webspresso-token');
    expect(runtime.services.hostManager).toBeNull();
    expect(document.body.children.length).toBe(initialChildCount);
    expect(document.querySelectorAll('[data-w-host]').length).toBe(0);

    runtime.destroy();
  });

  it('9. fragment refresh and repeated mountHost calls never duplicate or strip active UI hosts', async () => {
    document.body.innerHTML = `
      <div
        id="notes-frag"
        data-w-fragment="notes-list"
        data-w-fragment-id="notes-frag"
      >
        <ul class="notes">
          <li>Note 1</li>
        </ul>
      </div>
    `;

    const fetchMock = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        fragments: {
          'notes-frag': {
            html: `<div id="notes-frag" data-w-fragment="notes-list" data-w-fragment-id="notes-frag"><ul class="notes"><li>Note 1</li><li>Note 2</li></ul></div>`,
          },
        },
      }),
    });

    const runtime = createClientRuntime({
      fetch: fetchMock,
      services: {
        toast: defineClientService({
          create({ mountHost }) {
            // Call mountHost twice with the same key to verify idempotency
            const h1 = mountHost('toast');
            const h2 = mountHost('toast');
            expect(h1).toBe(h2);

            // Also mount a host inside the fragment root to verify morphDomTrees protection
            const fragEl = document.getElementById('notes-frag');
            const inlineHost = mountHost('inline-status', {
              container: fragEl,
            });
            inlineHost.el.textContent = 'Persistent Host Content';

            return {
              host: h1,
              inlineHost,
              notify(text) {
                const badge = document.createElement('div');
                badge.className = 'toast-badge';
                badge.textContent = text;
                h1.el.appendChild(badge);
              },
            };
          },
        }),
      },
    });

    await runtime.mount();
    const toast = await runtime.services.get('toast');
    toast.notify('Saved Note');

    expect(document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);
    expect(document.querySelectorAll('[data-w-host="inline-status"]').length).toBe(1);

    // Refresh the SSR fragment
    const refreshRes = await runtime.refresh('notes-frag');
    expect(refreshRes.ok).toBe(true);
    expect(document.querySelectorAll('#notes-frag li').length).toBe(2);

    // Neither the body-level host nor the inline host inside the morphed container is duplicated or lost
    expect(document.querySelectorAll('[data-w-host="toast"]').length).toBe(1);
    expect(document.querySelector('[data-w-host="toast"] .toast-badge').textContent).toBe('Saved Note');
    expect(document.querySelectorAll('[data-w-host="inline-status"]').length).toBe(1);
    expect(document.querySelector('[data-w-host="inline-status"]').textContent).toBe('Persistent Host Content');

    runtime.destroy();
  });

  it('10. form.onSuccess can invoke client services and side-effect service errors do not mark completed mutations as failed', async () => {
    document.body.innerHTML = `
      <form id="note-form" action="/api/notes" method="post" data-w-form="create-note" data-w-clear="true">
        <input name="title" value="Ship Client Services" />
        <span data-w-error="title" hidden></span>
        <p data-w-form-error hidden></p>
        <button type="submit">Save</button>
      </form>
    `;

    const fetchMock = async () => ({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 99, title: 'Ship Client Services' }),
    });

    const notified = [];
    const runtime = createClientRuntime({
      fetch: fetchMock,
      services: {
        toast: defineClientService({
          create() {
            return {
              success(msg) {
                notified.push(msg);
              },
            };
          },
        }),
        failingSideEffect: defineClientService({
          create() {
            throw new Error('Telemetry service offline');
          },
        }),
      },
    });

    await runtime.mount();
    const formEl = document.getElementById('note-form');
    const formHandle = runtime.forms.create(formEl);

    formHandle.onSuccess(async (data, { services, values }) => {
      const toast = await services.get('toast');
      toast.success(`Saved "${values.title}" (#${data.id})`);

      // Even if a side-effect service throws inside onSuccess, the completed form mutation
      // must remain succeeded (ok: true) and must not populate formError.
      const broken = await services.get('failingSideEffect');
      broken.ping();
    });

    const submitOutcome = await formHandle.submit();
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.submitted).toBe(true);
    expect(submitOutcome.data).toEqual({ id: 99, title: 'Ship Client Services' });
    expect(notified).toEqual(['Saved "Ship Client Services" (#99)']);
    expect(formHandle.formError).toBeNull();
    expect(formEl.querySelector('[data-w-form-error]').hasAttribute('hidden')).toBe(true);
    expect(submitOutcome.hookError).toBeInstanceOf(Error);
    expect(submitOutcome.hookError.message).toBe('Telemetry service offline');

    runtime.destroy();
  });

  it('11. production build code-splits lazy service dynamic imports and excludes unused services from initial entry bundle', async () => {
    const tempDir = createTempDir('webspresso-client-services-build-');
    try {
      const clientDir = path.join(tempDir, 'src', 'client');
      const servicesDir = path.join(clientDir, 'services');
      fs.mkdirSync(servicesDir, { recursive: true });

      fs.writeFileSync(
        path.join(servicesDir, 'toast.ts'),
        `export const TOAST_IMPLEMENTATION_MARKER = 'LAZY_TOAST_CHUNK_PAYLOAD_7788';
         export default function createToast() {
           return { marker: TOAST_IMPLEMENTATION_MARKER, success(m: string) { return m; } };
         }`
      );

      fs.writeFileSync(
        path.join(servicesDir, 'clipboard.ts'),
        `export const CLIPBOARD_IMPLEMENTATION_MARKER = 'LAZY_CLIPBOARD_CHUNK_PAYLOAD_9900';
         export default function createClipboard() {
           return { marker: CLIPBOARD_IMPLEMENTATION_MARKER, copy(t: string) { return t; } };
         }`
      );

      fs.writeFileSync(
        path.join(servicesDir, 'unused-heavy.ts'),
        `export const UNUSED_HEAVY_MARKER = 'UNUSED_HEAVY_SERVICE_MARKER_0000';`
      );

      fs.writeFileSync(
        path.join(clientDir, 'main.ts'),
        `const services = {
           toast: { load: () => import('./services/toast') },
           clipboard: { load: () => import('./services/clipboard') },
         };
         console.log('Registered service keys:', Object.keys(services));`
      );

      const outdir = path.join(tempDir, 'public', 'dist');
      const { manifest, result } = await buildBundle({
        cwd: tempDir,
        entryPoints: { main: path.join(clientDir, 'main.ts') },
        outdir,
        publicDir: path.join(tempDir, 'public'),
        logger: null,
      });

      expect(manifest['main.ts'] || manifest['main']).toBeDefined();
      const mainRecord = manifest['main.ts'] || manifest['main'];
      const mainBundlePath = path.join(tempDir, 'public', mainRecord.file);
      const mainBundleContent = fs.readFileSync(mainBundlePath, 'utf8');

      // 1. Entry bundle must NOT inline lazy service implementations or unreferenced service files
      expect(mainBundleContent).not.toContain('LAZY_TOAST_CHUNK_PAYLOAD_7788');
      expect(mainBundleContent).not.toContain('LAZY_CLIPBOARD_CHUNK_PAYLOAD_9900');
      expect(mainBundleContent).not.toContain('UNUSED_HEAVY_SERVICE_MARKER_0000');

      // 2. Entry bundle keeps dynamic `import(...)` pointing to split chunks
      expect(mainBundleContent).toMatch(/import\(\s*['"]\.\/chunks\/toast\.[A-F0-9]+\.js['"]\s*\)/);
      expect(mainBundleContent).toMatch(/import\(\s*['"]\.\/chunks\/clipboard\.[A-F0-9]+\.js['"]\s*\)/);

      // 3. Separate chunk files exist on disk for the lazy services, and NOT for unused-heavy.ts
      const chunksDir = path.join(outdir, 'chunks');
      const chunkFiles = fs.existsSync(chunksDir) ? fs.readdirSync(chunksDir) : [];
      expect(chunkFiles.some((f) => f.startsWith('toast.') && f.endsWith('.js'))).toBe(true);
      expect(chunkFiles.some((f) => f.startsWith('clipboard.') && f.endsWith('.js'))).toBe(true);
      expect(chunkFiles.some((f) => f.includes('unused-heavy'))).toBe(false);
      expect(Object.keys(result.metafile.outputs).length).toBe(3); // main + 2 lazy chunks
    } finally {
      cleanupDir(tempDir);
    }
  });

  it('12. works end-to-end with examples/client-behavior toast (with host) and clipboard (DOM-less) services across multiple controllers', async () => {
    const toastModule = (await import('../../examples/client-behavior/services/toast.ts')).default;
    const clipboardModule = (await import('../../examples/client-behavior/services/clipboard.ts')).default;
    const quickShareController = (await import('../../examples/client-behavior/components/quick-share.client.ts')).default;
    const todosController = (await import('../../examples/client-behavior/pages/todos.client.ts')).default;

    document.body.innerHTML = `
      <div id="todos-root" data-w-controller="todos">
        <form data-w-form="create-todo" action="/api/todos" method="post">
          <input name="title" value="Test Todo" />
        </form>
        <div id="share-root" data-w-controller="quick-share">
          <button id="share-btn" data-w-on:click="sharePage" data-share-text="Backlog Link">Share</button>
        </div>
      </div>
    `;

    const runtime = bootClient({
      services: {
        toast: defineClientService({ load: async () => toastModule }),
        clipboard: defineClientService({ load: async () => clipboardModule }),
      },
      controllers: {
        todos: todosController,
        'quick-share': quickShareController,
      },
    });

    await runtime.mount();

    // Before first service use: no toast host in DOM
    expect(document.querySelector('[data-w-host="toast"]')).toBeNull();

    // 1. Trigger quick-share controller action (uses both clipboard and toast)
    const shareEl = document.getElementById('share-root');
    const shareBtn = document.getElementById('share-btn');
    const shareInst = runtime.getController(shareEl, 'quick-share');
    await shareInst.invokeAction('sharePage', null, shareBtn);

    const clipboard = await runtime.services.get('clipboard');
    const toast = await runtime.services.get('toast');
    expect(clipboard.lastCopied()).toBe('Backlog Link');
    expect(toast.count()).toBe(1);
    expect(document.querySelectorAll('[data-w-host="toast"] .demo-toast-item').length).toBe(1);

    // 2. Trigger todos controller action (uses the exact same clipboard and toast instances)
    const todosEl = document.getElementById('todos-root');
    const todosInst = runtime.getController(todosEl, 'todos');
    await todosInst.invokeAction('copyFilterSummary');

    expect(clipboard.lastCopied()).toBe('Filter: all/all • Page 1');
    expect(toast.count()).toBe(2);
    expect(document.querySelectorAll('[data-w-host="toast"] .demo-toast-item').length).toBe(2);

    // 3. Dismiss one toast and then destroy runtime
    toast.dismiss();
    expect(toast.count()).toBe(0);

    runtime.destroy();
    expect(document.querySelector('[data-w-host="toast"]')).toBeNull();
  });
});
