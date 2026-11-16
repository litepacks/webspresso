import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defineController,
  createControllerRuntime,
} from '../../core/client/controller.js';
import { createDatastarAdapter } from '../../core/client/adapter/datastar.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client Behavior Directives, ctx.locals & Real-World Edge Cases', () => {
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

  function mountHtml(html, controllers) {
    domEnv.document.body.innerHTML = html;
    const runtime = createControllerRuntime({
      root: domEnv.document.body,
      datastar,
    });
    for (const [name, ctrl] of Object.entries(controllers)) {
      runtime.register(name, ctrl);
    }
    const el = domEnv.document.body.firstElementChild;
    const ctrlName = el.getAttribute('data-w-controller') || el.getAttribute('data-controller');
    runtime.mountControllerOnElement(el, ctrlName);
    return runtime;
  }

  it('supports data-w-submit with automatic preventDefault() and action dispatch', () => {
    const submitted = [];
    const formCtrl = defineController({
      state: () => ({ prompt: 'hello' }),
      actions: {
        submitPrompt(ctx, event) {
          submitted.push({
            prompt: ctx.state.prompt,
            defaultPrevented: event.defaultPrevented,
          });
        },
      },
    });

    const runtime = mountHtml(
      `<div data-w-controller="formCtrl">
        <form id="prompt-form" data-w-submit="submitPrompt">
          <button type="submit">Go</button>
        </form>
      </div>`,
      { formCtrl }
    );

    const form = domEnv.document.getElementById('prompt-form');
    const evt = new domEnv.window.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(evt);

    expect(submitted).toEqual([{ prompt: 'hello', defaultPrevented: true }]);
    runtime.unmountAll?.();
  });

  it('supports reactive data-w-style:<prop> and data-w-attr:<name> bindings', () => {
    const previewCtrl = defineController({
      state: () => ({ width: 1280, isOpen: false, accent: 'red' }),
      actions: {
        resize(ctx) {
          ctx.state.width = 390;
          ctx.state.isOpen = true;
          ctx.state.accent = '';
        },
      },
    });

    const runtime = mountHtml(
      `<div data-w-controller="previewCtrl">
        <div id="frame"
             data-w-style:width="width + 'px'"
             data-w-style:color="accent"
             data-w-attr:aria-expanded="isOpen ? 'true' : 'false'"
             data-w-attr:data-open="isOpen">
        </div>
        <button id="btn" data-w-click="resize">Resize</button>
      </div>`,
      { previewCtrl }
    );

    const frame = domEnv.document.getElementById('frame');
    expect(frame.style.width).toBe('1280px');
    expect(frame.style.color).toBe('red');
    expect(frame.getAttribute('aria-expanded')).toBe('false');
    expect(frame.hasAttribute('data-open')).toBe(false);

    domEnv.document.getElementById('btn').click();

    expect(frame.style.width).toBe('390px');
    expect(frame.style.color).toBe('');
    expect(frame.getAttribute('aria-expanded')).toBe('true');
    expect(frame.getAttribute('data-open')).toBe('');

    runtime.unmountAll?.();
  });

  it('keeps ctx frozen while allowing mutable per-instance helpers on ctx.locals', () => {
    let calls = 0;
    const editorCtrl = defineController({
      state: () => ({ open: false }),
      connect(ctx) {
        expect(Object.isFrozen(ctx)).toBe(true);
        ctx.locals.ensureLoaded = () => {
          calls += 1;
          return 'loaded';
        };
      },
      actions: {
        toggle(ctx) {
          ctx.state.open = !ctx.state.open;
          return ctx.locals.ensureLoaded();
        },
      },
    });

    const runtime = mountHtml(
      `<div data-w-controller="editorCtrl">
        <button id="toggle" data-w-click="toggle">Toggle</button>
      </div>`,
      { editorCtrl }
    );

    domEnv.document.getElementById('toggle').click();
    domEnv.document.getElementById('toggle').click();
    expect(calls).toBe(2);
    runtime.unmountAll?.();
  });

  it('catches async action errors without unhandled rejections and records ctx.lastError', async () => {
    const errors = [];
    const failingCtrl = defineController({
      state: () => ({ count: 0 }),
      connect(ctx) {
        ctx.onError((err) => errors.push(err.message));
      },
      actions: {
        async boom() {
          throw new Error('async-boom');
        },
      },
    });

    const runtime = mountHtml(
      `<div data-w-controller="failingCtrl">
        <button id="boom" data-w-click="boom">Boom</button>
      </div>`,
      { failingCtrl }
    );

    domEnv.document.getElementById('boom').click();
    await new Promise((r) => setTimeout(r, 20));

    expect(errors).toEqual(['async-boom']);
    runtime.unmountAll?.();
  });
});
