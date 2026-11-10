import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryStorage,
  StorageAdapter,
  createClientStorage,
  defaultStorage,
} from '../../core/client/storage.js';
import {
  defineController,
  createControllerRuntime,
} from '../../core/client/controller.js';
import { createFormHandle } from '../../core/client/forms.js';
import { createFragmentCoordinator } from '../../core/client/fragments.js';
import { createDatastarAdapter } from '../../core/client/adapter/datastar.js';
import { createMiniDomEnvironment } from '../utils/mini-dom.js';

describe('Client Storage & Persistence Layer (`core/client/storage.js`)', () => {
  let domEnv = null;

  beforeEach(() => {
    domEnv = createMiniDomEnvironment();
  });

  afterEach(() => {
    if (domEnv) {
      domEnv.restore();
      domEnv = null;
    }
  });

  describe('1. MemoryStorage Backend', () => {
    it('implements standard Storage interface in-memory', () => {
      const storage = new MemoryStorage();
      expect(storage.length).toBe(0);

      storage.setItem('user', 'Alice');
      storage.setItem('count', '42');
      expect(storage.length).toBe(2);
      expect(storage.getItem('user')).toBe('Alice');
      expect(storage.getItem('count')).toBe('42');
      expect(storage.getItem('missing')).toBeNull();

      expect(storage.key(0)).toBe('user');
      expect(storage.key(1)).toBe('count');
      expect(storage.key(5)).toBeNull();

      storage.removeItem('user');
      expect(storage.length).toBe(1);
      expect(storage.getItem('user')).toBeNull();

      storage.clear();
      expect(storage.length).toBe(0);
    });
  });

  describe('2. StorageAdapter Operations & Namespace Isolation', () => {
    it('serializes and deserializes values with prefix isolation', () => {
      const backend = new MemoryStorage();
      const adapter = new StorageAdapter('memory', { prefix: 'app:', backend });

      // get default when missing
      expect(adapter.get('theme', 'dark')).toBe('dark');
      expect(adapter.has('theme')).toBe(false);

      // JSON serialization
      adapter.set('theme', 'light');
      adapter.set('settings', { notifications: true, volume: 80 });
      adapter.set('tags', ['alpha', 'beta']);

      expect(adapter.has('theme')).toBe(true);
      expect(adapter.get('theme')).toBe('light');
      expect(adapter.get('settings')).toEqual({ notifications: true, volume: 80 });
      expect(adapter.get('tags')).toEqual(['alpha', 'beta']);

      // Underlying backend stores prefixed keys
      expect(backend.getItem('app:theme')).toBe(JSON.stringify('light'));
      expect(backend.getItem('app:settings')).toBe(JSON.stringify({ notifications: true, volume: 80 }));

      // keys() returns unprefixed keys
      expect(adapter.keys().sort()).toEqual(['settings', 'tags', 'theme']);

      // remove() deletes prefixed key
      adapter.remove('tags');
      expect(adapter.has('tags')).toBe(false);
      expect(adapter.keys().sort()).toEqual(['settings', 'theme']);
    });

    it('falls back to raw string when stored value is not valid JSON', () => {
      const backend = new MemoryStorage();
      backend.setItem('app:raw_data', 'plain text value (not json)');

      const adapter = new StorageAdapter('memory', { prefix: 'app:', backend });
      expect(adapter.get('raw_data')).toBe('plain text value (not json)');
    });

    it('clear() only removes keys matching adapter prefix, preserving external keys', () => {
      const backend = new MemoryStorage();
      backend.setItem('external:session_id', 'ext-123');
      backend.setItem('w:user', 'Alice');
      backend.setItem('w:token', 'tok-456');

      const adapter = new StorageAdapter('memory', { prefix: 'w:', backend });
      expect(adapter.keys().sort()).toEqual(['token', 'user']);

      adapter.clear();
      expect(adapter.keys()).toEqual([]);
      expect(backend.getItem('w:user')).toBeNull();
      expect(backend.getItem('w:token')).toBeNull();

      // Outside keys remain untouched!
      expect(backend.getItem('external:session_id')).toBe('ext-123');
    });

    it('creates nested scoped adapters with combined prefixes', () => {
      const backend = new MemoryStorage();
      const root = new StorageAdapter('memory', { prefix: 'w:', backend });
      const scoped = root.scoped('cart');

      expect(scoped.prefix).toBe('w:cart:');
      scoped.set('items', [{ id: 1, qty: 2 }]);

      expect(backend.getItem('w:cart:items')).toBe(JSON.stringify([{ id: 1, qty: 2 }]));
      expect(scoped.get('items')).toEqual([{ id: 1, qty: 2 }]);
      expect(scoped.keys()).toEqual(['items']);
    });

    it('handles QuotaExceededError or write exceptions safely without crashing', () => {
      const faultyBackend = {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }),
        removeItem: vi.fn(),
        key: vi.fn(),
        length: 0,
      };

      const adapter = new StorageAdapter('memory', { prefix: 'w:', backend: faultyBackend });
      const result = adapter.set('large_payload', { big: 'data' });
      expect(result).toBe(false); // Returns false gracefully without throwing!
    });
  });

  describe('3. createClientStorage Bundle', () => {
    it('provides local, session, memory, and scoped factories', () => {
      const storage = createClientStorage({ prefix: 'test:' });
      expect(storage.prefix).toBe('test:');
      expect(storage.local.prefix).toBe('test:');
      expect(storage.session.prefix).toBe('test:');
      expect(storage.memory.prefix).toBe('test:');

      const child = storage.scoped('feature');
      expect(child.prefix).toBe('test:feature:');
      expect(child.local.prefix).toBe('test:feature:');
    });
  });

  describe('4. Controller Declarative State Persistence (`persist`)', () => {
    it('validates persist option in defineController', () => {
      expect(() => {
        defineController({
          name: 'invalid',
          persist: 12345, // Invalid type
        });
      }).toThrow(TypeError);

      const valid1 = defineController({
        name: 'valid1',
        persist: ['search', 'page'],
      });
      expect(valid1.persist).toEqual(['search', 'page']);

      const valid2 = defineController({
        name: 'valid2',
        persist: { storage: 'session', keys: ['query'], debounce: 100 },
      });
      expect(valid2.persist).toEqual({ storage: 'session', keys: ['query'], debounce: 100 });
    });

    it('hydrates controller state on mount from stored values and auto-syncs changes', async () => {
      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });

      // Pre-populate storage for controller "filters" (scoped to filters:state)
      defaultStorage.scoped('filters').local.set('state', {
        search: 'webspresso',
        category: 'frameworks',
      });

      let capturedCtx = null;
      runtime.register(
        defineController({
          name: 'filters',
          state: () => ({
            search: '',
            category: 'all',
            untracked: 'initial',
          }),
          persist: {
            keys: ['search', 'category'],
            storage: 'local',
            debounce: 0, // immediate sync for testing
          },
          connect(ctx) {
            capturedCtx = ctx;
          },
        })
      );

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-w-controller', 'filters');
      domEnv.document.body.appendChild(el);

      await runtime.mountSubtree(el);

      // 1. Verify state was hydrated from storage on mount
      expect(capturedCtx.state.search).toBe('webspresso');
      expect(capturedCtx.state.category).toBe('frameworks');
      expect(capturedCtx.state.untracked).toBe('initial');

      // 2. Verify ctx.storage is available
      expect(capturedCtx.storage).toBeDefined();
      expect(capturedCtx.storage.local).toBeDefined();
      expect(capturedCtx.storage.session).toBeDefined();
      expect(capturedCtx.storage.global).toBeDefined();

      // 3. Mutate tracked state and verify auto-sync
      capturedCtx.state.search = 'advanced-node-framework';
      await new Promise((r) => setTimeout(r, 10));

      const updated = defaultStorage.scoped('filters').local.get('state');
      expect(updated).toEqual({
        search: 'advanced-node-framework',
        category: 'frameworks',
      });

      // 4. clearPersistedState()
      capturedCtx.clearPersistedState();
      expect(defaultStorage.scoped('filters').local.has('state')).toBe(false);

      runtime.unmountSubtree(el);
    });

    it('allows direct read/write via ctx.storage.local and ctx.storage.session in actions', async () => {
      const datastar = createDatastarAdapter();
      const runtime = createControllerRuntime({ datastar });

      runtime.register(
        defineController({
          name: 'account',
          state: () => ({ lastLogin: null }),
          actions: {
            savePrefs(ctx) {
              ctx.storage.local.set('recentTab', 'billing');
              ctx.storage.session.set('otpVerified', true);
              ctx.storage.global.local.set('global_theme', 'dark');
            },
          },
        })
      );

      const el = domEnv.document.createElement('div');
      el.setAttribute('data-w-controller', 'account');
      domEnv.document.body.appendChild(el);

      await runtime.mountSubtree(el);

      const inst = runtime.getInstanceForElement(el, 'account');
      inst.invokeAction('savePrefs');

      // Local scoped to controller
      expect(defaultStorage.scoped('account').local.get('recentTab')).toBe('billing');
      expect(defaultStorage.local.get('account:recentTab')).toBe('billing');
      // Global storage
      expect(defaultStorage.local.get('global_theme')).toBe('dark');

      runtime.unmountSubtree(el);
    });
  });

  describe('5. Form Draft Persistence (`data-w-persist-draft`)', () => {
    it('restores draft into form inputs on initialization and emits w-form:draft-restored event', () => {
      // Pre-populate sessionStorage with a draft for form "feedback"
      defaultStorage.session.set('form_draft:feedback', {
        title: 'Draft Bug Report',
        description: 'Steps to reproduce...',
        severity: 'high',
      });

      const form = domEnv.document.createElement('form');
      form.setAttribute('data-w-form', 'feedback');
      form.setAttribute('data-w-persist-draft', 'session');

      form.innerHTML = `
        <input name="title" type="text" value="" />
        <textarea name="description"></textarea>
        <select name="severity">
          <option value="low">Low</option>
          <option value="high">High</option>
        </select>
        <input name="password" type="password" value="" />
      `;
      domEnv.document.body.appendChild(form);

      let eventDetail = null;
      form.addEventListener('w-form:draft-restored', (e) => {
        eventDetail = e.detail;
      });

      const handle = createFormHandle(form, { api: { request: vi.fn() } });

      // Restored values
      expect(form.querySelector('[name="title"]').value).toBe('Draft Bug Report');
      expect(form.querySelector('[name="description"]').value).toBe('Steps to reproduce...');
      expect(form.querySelector('[name="severity"]').value).toBe('high');
      expect(handle.hasDraft).toBe(true);

      // Event detail
      expect(eventDetail).toBeDefined();
      expect(eventDetail.key).toBe('form_draft:feedback');
      expect(eventDetail.draft).toEqual({
        title: 'Draft Bug Report',
        description: 'Steps to reproduce...',
        severity: 'high',
      });
    });

    it('auto-saves form draft on input excluding sensitive password fields', async () => {
      defaultStorage.session.remove('form_draft:login');

      const form = domEnv.document.createElement('form');
      form.setAttribute('data-w-form', 'login');
      form.setAttribute('data-w-persist-draft', 'session');
      form.innerHTML = `
        <input name="email" type="email" value="" />
        <input name="password" type="password" value="" />
        <input name="sensitiveCode" type="text" data-w-no-draft="true" value="" />
      `;
      domEnv.document.body.appendChild(form);

      createFormHandle(form, { api: { request: vi.fn() } });

      const emailInput = form.querySelector('[name="email"]');
      const passInput = form.querySelector('[name="password"]');
      const codeInput = form.querySelector('[name="sensitiveCode"]');

      emailInput.value = 'user@example.com';
      passInput.value = 'SuperSecret123!';
      codeInput.value = '2FA-999';

      form.dispatchEvent(new domEnv.window.Event('input', { bubbles: true }));

      // Wait for 150ms debounce
      await new Promise((r) => setTimeout(r, 200));

      const savedDraft = defaultStorage.session.get('form_draft:login');
      expect(savedDraft).toBeDefined();
      expect(savedDraft.email).toBe('user@example.com');
      // Passwords and data-w-no-draft fields must NEVER be saved to draft!
      expect(savedDraft.password).toBeUndefined();
      expect(savedDraft.sensitiveCode).toBeUndefined();
    });

    it('automatically clears saved draft upon successful form submission', async () => {
      defaultStorage.session.set('form_draft:contact', {
        name: 'John',
        message: 'Hello!',
      });

      const form = domEnv.document.createElement('form');
      form.setAttribute('data-w-form', 'contact');
      form.setAttribute('data-w-persist-draft', 'session');
      form.innerHTML = `
        <input name="name" type="text" value="John" />
        <input name="message" type="text" value="Hello!" />
        <button type="submit">Send</button>
      `;
      domEnv.document.body.appendChild(form);

      const mockApi = {
        request: vi.fn().mockResolvedValue({ success: true }),
      };

      const handle = createFormHandle(form, { api: mockApi });
      expect(handle.hasDraft).toBe(true);

      const res = await handle.submit();
      expect(res.ok).toBe(true);
      expect(res.submitted).toBe(true);

      // Draft must be automatically deleted after successful submission
      expect(handle.hasDraft).toBe(false);
      expect(defaultStorage.session.has('form_draft:contact')).toBe(false);
    });
  });

  describe('6. Fragment Input Persistence (`data-w-persist-input`)', () => {
    it('hydrates initial fragment input from storage when element input attribute is empty', () => {
      // Pre-populate stored input
      defaultStorage.session.set('frag_input:items-list', {
        page: 3,
        sort: 'desc',
      });

      const coordinator = createFragmentCoordinator({
        root: domEnv.document,
        fetch: vi.fn(),
      });

      const fragEl = domEnv.document.createElement('div');
      fragEl.setAttribute('data-w-fragment', 'items-list');
      fragEl.setAttribute('data-w-persist-input', 'session');
      fragEl.innerHTML = '<p>List</p>';
      domEnv.document.body.appendChild(fragEl);

      const inst = coordinator.getInstance('items-list:default');
      expect(inst).toBeDefined();
      expect(inst.input).toEqual({
        page: 3,
        sort: 'desc',
      });
    });

    it('persists updated input to storage on coordinator.refresh and provides getStoredInput/clearStoredInput', async () => {
      defaultStorage.session.remove('frag_input:catalog');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          fragments: [
            {
              instanceId: 'catalog:default',
              name: 'catalog',
              html: '<div>Refreshed Catalog</div>',
              input: { category: 'electronics', page: 2 },
            },
          ],
        }),
      });

      const coordinator = createFragmentCoordinator({
        root: domEnv.document,
        fetch: mockFetch,
      });

      const fragEl = domEnv.document.createElement('div');
      fragEl.setAttribute('data-w-fragment', 'catalog');
      fragEl.setAttribute('data-w-persist-input', 'session');
      fragEl.innerHTML = '<div>Initial Catalog</div>';
      domEnv.document.body.appendChild(fragEl);

      await coordinator.refresh('catalog', { category: 'electronics', page: 2 });

      // Verify input saved in storage
      const stored = coordinator.getStoredInput('catalog');
      expect(stored).toEqual({ category: 'electronics', page: 2 });

      // Clear stored input
      coordinator.clearStoredInput('catalog');
      expect(coordinator.getStoredInput('catalog')).toBeNull();
    });
  });
});
