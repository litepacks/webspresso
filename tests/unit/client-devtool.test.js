import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  defineController,
  createControllerRuntime,
} from '../../core/client/controller.js';
import { createFragmentCoordinator } from '../../core/client/fragments.js';
import { createDatastarAdapter } from '../../core/client/adapter/datastar.js';
import { createClientDebugger } from '../../core/client/debug.js';
import { mountDevtool, highlightElement } from '../../core/client/devtool.js';
import { defaultStorage } from '../../core/client/storage.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client DevTools Dock & Inspector (`core/client/devtool.js`)', () => {
  let domEnv = null;
  let datastar = null;
  let runtime = null;
  let devtool = null;

  beforeEach(() => {
    domEnv = createMiniDomEnvironment();
    datastar = createDatastarAdapter();

    const debug = createClientDebugger({ enabled: true });

    const fragments = createFragmentCoordinator({
      root: domEnv.document.body,
      datastar,
      debug,
    });

    const controllers = createControllerRuntime({
      datastar,
      fragments,
      debug,
    });

    runtime = {
      controllers,
      fragments,
      datastar,
      debug,
      refresh: (name) => fragments.refresh(name),
    };
  });

  afterEach(() => {
    if (devtool) {
      devtool.destroy();
      devtool = null;
    }
    if (domEnv) {
      domEnv.restore();
      domEnv = null;
    }
  });

  describe('1. Mounting & Collapsed Pill', () => {
    it('mounts floating pill into DOM with controller and fragment counts', () => {
      const c1 = defineController({
        name: 'counter',
        state: () => ({ value: 10 }),
      });
      runtime.controllers.register('counter', c1);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'counter');
      domEnv.document.body.appendChild(el);
      runtime.controllers.mountControllerOnElement(el, 'counter');

      const fragEl = domEnv.document.createElement('div');
      fragEl.setAttribute('data-w-fragment', 'stats-frag');
      domEnv.document.body.appendChild(fragEl);
      runtime.fragments.syncDomInstances(domEnv.document.body);

      devtool = mountDevtool(runtime, { open: false });

      expect(devtool.isOpen()).toBe(false);

      const host = domEnv.document.getElementById('webspresso-client-devtools-host');
      expect(host).not.toBeNull();

      const shadow = host.shadowRoot || host;
      const pill = shadow.querySelector('.ws-pill') || shadow.querySelector('#ws-devtool-pill');
      expect(pill).not.toBeNull();
      expect(pill.textContent).toContain('Webspresso');
      expect(pill.textContent).toContain('1 ctrl');
      expect(pill.textContent).toContain('1 frag');
    });
  });

  describe('2. Open, Close, and Toggle Operations', () => {
    it('opens drawer on open() and minimizes on close()', () => {
      devtool = mountDevtool(runtime, { open: false });
      expect(devtool.isOpen()).toBe(false);

      devtool.open();
      expect(devtool.isOpen()).toBe(true);

      const host = domEnv.document.getElementById('webspresso-client-devtools-host');
      const shadow = host.shadowRoot || host;
      const drawer = shadow.querySelector('.ws-drawer') || shadow.querySelector('#ws-devtool-drawer');
      expect(drawer).not.toBeNull();
      expect(drawer.textContent).toContain('Webspresso DevTools');

      devtool.close();
      expect(devtool.isOpen()).toBe(false);

      devtool.toggle();
      expect(devtool.isOpen()).toBe(true);
    });
  });

  describe('3. Tab Switching & Controllers Inspection', () => {
    it('displays controller state and triggers tab switching', () => {
      const c1 = defineController({
        name: 'cart',
        state: () => ({ itemCount: 3, currency: 'USD' }),
      });
      runtime.controllers.register('cart', c1);

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-controller', 'cart');
      domEnv.document.body.appendChild(el);
      runtime.controllers.mountControllerOnElement(el, 'cart');

      devtool = mountDevtool(runtime, { open: true });

      const host = domEnv.document.getElementById('webspresso-client-devtools-host');
      const shadow = host.shadowRoot || host;

      // State is visible in formatted code block
      const content = shadow.querySelector('.ws-content');
      expect(content.textContent).toContain('cart');
      expect(content.textContent).toContain('itemCount');
      expect(content.textContent).toContain('3');

      // Global API getState works
      const state = devtool.getState('cart');
      expect(state).toEqual({ itemCount: 3, currency: 'USD' });
    });

    it('switches to storage tab and clears storage on click', () => {
      defaultStorage.local.set('cart_items', ['a', 'b']);
      devtool = mountDevtool(runtime, { open: true });

      const host = domEnv.document.getElementById('webspresso-client-devtools-host');
      const shadow = host.shadowRoot || host;

      // Find storage tab button and click it
      const storageTabBtn = shadow.querySelector('button[data-tab="storage"]');
      expect(storageTabBtn).not.toBeNull();
      storageTabBtn.dispatchEvent(new domEnv.window.Event('click', { bubbles: true }));

      const content = shadow.querySelector('.ws-content');
      expect(content.textContent).toContain('Storage Inspector');

      // Click clear storage
      const clearBtn = shadow.querySelector('#ws-btn-clear-storage');
      expect(clearBtn).not.toBeNull();
      clearBtn.dispatchEvent(new domEnv.window.Event('click', { bubbles: true }));

      expect(defaultStorage.local.get('cart_items')).toBeNull();
    });
  });

  describe('4. Element Highlighting', () => {
    it('applies pulsing outline when highlightElement is called', () => {
      const el = domEnv.document.createElement('div');
      domEnv.document.body.appendChild(el);

      const success = highlightElement(el);
      expect(success).toBe(true);
      expect(el.style.outline).toContain('3px solid');
    });
  });

  describe('5. Console Global API and Keyboard Shortcuts', () => {
    it('attaches window.__WEBSPRESSO_DEVTOOLS__ and responds to Alt+W', () => {
      devtool = mountDevtool(runtime, { open: false });
      expect(domEnv.window.__WEBSPRESSO_DEVTOOLS__).toBe(devtool);

      // Simulate Alt+W keydown
      const altWEvent = new domEnv.window.Event('keydown', { bubbles: true });
      altWEvent.altKey = true;
      altWEvent.key = 'w';
      domEnv.document.dispatchEvent(altWEvent);

      expect(devtool.isOpen()).toBe(true);

      // Destroy removes global
      devtool.destroy();
      expect(domEnv.window.__WEBSPRESSO_DEVTOOLS__).toBeUndefined();
      devtool = null;
    });

    it('only renders DB Studio and Admin Panel buttons in Studio tab when attached', () => {
      devtool = mountDevtool(runtime, { open: true });
      const host = domEnv.document.getElementById('webspresso-client-devtools-host');
      const shadow = host.shadowRoot || host;

      const studioTabBtn = shadow.querySelector('button[data-tab="studio"]');
      studioTabBtn.dispatchEvent(new domEnv.window.Event('click', { bubbles: true }));

      let content = shadow.querySelector('.ws-content');
      expect(content.textContent).toContain('Dev Live Reload Hub');
      expect(content.textContent).not.toContain('Open DB Studio');
      expect(content.textContent).not.toContain('Open /_admin');

      devtool.setMeta({ hasStudio: true, hasAdmin: true, adminPath: '/_admin' });
      content = shadow.querySelector('.ws-content');
      expect(content.textContent).toContain('Open DB Studio');
      expect(content.textContent).toContain('Open /_admin');
    });
  });
});

