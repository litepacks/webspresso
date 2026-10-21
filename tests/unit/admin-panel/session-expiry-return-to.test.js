/**
 * Admin Panel Session Expiry, Return-To Redirection & Toast/Confirm UX Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load client parts once at module scope
const codePart1 = fs.readFileSync(
  path.join(__dirname, '../../../plugins/admin-panel/client/parts/01-state-api-breadcrumb.js'),
  'utf8'
);
const codePart6 = fs.readFileSync(
  path.join(__dirname, '../../../plugins/admin-panel/client/parts/06-login-setup-forms.js'),
  'utf8'
);
const clientBundleScript = new vm.Script(
  codePart1 + '\n' + codePart6 + `
    globalThis.state = state;
    globalThis.isSafeIntendedRoute = isSafeIntendedRoute;
    globalThis.saveIntendedRoute = saveIntendedRoute;
    globalThis.consumeIntendedRoute = consumeIntendedRoute;
    globalThis.redirectToLogin = redirectToLogin;
    globalThis.toastState = toastState;
    globalThis.notify = notify;
    globalThis.confirmState = confirmState;
    globalThis.confirmModal = confirmModal;
    globalThis.confirmAction = confirmAction;
    globalThis.ToastContainer = ToastContainer;
    globalThis.ConfirmModalContainer = ConfirmModalContainer;
    globalThis.LoginForm = LoginForm;
  `
);

describe('Session Expiry & Toast/Confirm Notification UX', () => {
  let context;
  let sessionStorageStore = {};

  beforeEach(() => {
    sessionStorageStore = {};

    const mockSessionStorage = {
      getItem: (k) => sessionStorageStore[k] || null,
      setItem: (k, v) => { sessionStorageStore[k] = String(v); },
      removeItem: (k) => { delete sessionStorageStore[k]; },
      clear: () => { sessionStorageStore = {}; },
    };

    const redrawCalls = [];
    const routeCalls = [];
    let currentRoute = '/';
    let routeParams = {};

    const mockM = {
      redraw: () => {
        redrawCalls.push(Date.now());
      },
      route: {
        get: () => currentRoute,
        set: (p) => {
          routeCalls.push(p);
          currentRoute = p;
        },
        param: (k) => routeParams[k],
      },
    };

    const m = (selector, attrsOrChildren, maybeChildren) => {
      let attrs = {};
      let children = [];
      if (attrsOrChildren && typeof attrsOrChildren === 'object' && !Array.isArray(attrsOrChildren) && !attrsOrChildren.tag) {
        attrs = attrsOrChildren;
        children = Array.isArray(maybeChildren) ? maybeChildren : (maybeChildren !== undefined ? [maybeChildren] : []);
      } else if (Array.isArray(attrsOrChildren)) {
        children = attrsOrChildren;
      } else if (attrsOrChildren !== undefined) {
        children = [attrsOrChildren];
      }

      return {
        tag: selector,
        attrs,
        children: children.flat ? children.flat() : children,
      };
    };
    m.redraw = mockM.redraw;
    m.route = mockM.route;

    const mockApi = {
      post: async (endpoint, data) => ({ user: { id: 1, email: data.email } }),
      get: async () => ({}),
      request: async () => ({}),
    };

    const state = {
      user: null,
      error: null,
      notice: null,
      loading: false,
    };

    const windowObj = {
      location: {
        search: '',
      },
    };

    context = {
      m,
      state,
      api: mockApi,
      sessionStorage: mockSessionStorage,
      window: windowObj,
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout: (id) => clearTimeout(id),
      Date,
      Math,
      String,
      encodeURIComponent,
      decodeURIComponent,
      redrawCalls,
      routeCalls,
      setRoute: (r) => { currentRoute = r; },
      setRouteParams: (p) => { routeParams = p; },
      setSearch: (s) => { windowObj.location.search = s; },
      fetch: async (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 1, email: 'admin@test.com' } }),
      }),
      FormData: class MockFormData {
        constructor(form) {
          this._data = form._data || {};
        }
        get(key) {
          return this._data[key] || '';
        }
      },
    };

    vm.createContext(context);
    clientBundleScript.runInContext(context);
  });

  function findNode(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNode(child, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  describe('isSafeIntendedRoute', () => {
    it('allows valid internal admin routes', () => {
      expect(context.isSafeIntendedRoute('/')).toBe(true);
      expect(context.isSafeIntendedRoute('/models/Product')).toBe(true);
      expect(context.isSafeIntendedRoute('/models/Product/records/42')).toBe(true);
      expect(context.isSafeIntendedRoute('/settings')).toBe(true);
      expect(context.isSafeIntendedRoute('/custom?tab=1')).toBe(true);
    });

    it('rejects open-redirect attack vectors and auth paths', () => {
      // Protocol-relative URLs
      expect(context.isSafeIntendedRoute('//evil.com')).toBe(false);
      expect(context.isSafeIntendedRoute('/\\evil.com')).toBe(false);
      expect(context.isSafeIntendedRoute('/\\\\evil.com')).toBe(false);

      // External schemes
      expect(context.isSafeIntendedRoute('http://evil.com')).toBe(false);
      expect(context.isSafeIntendedRoute('https://evil.com')).toBe(false);
      expect(context.isSafeIntendedRoute('javascript:alert(1)')).toBe(false);

      // Loops into login or setup
      expect(context.isSafeIntendedRoute('/login')).toBe(false);
      expect(context.isSafeIntendedRoute('/setup')).toBe(false);

      // Invalid / non-string types
      expect(context.isSafeIntendedRoute('')).toBe(false);
      expect(context.isSafeIntendedRoute(null)).toBe(false);
      expect(context.isSafeIntendedRoute(undefined)).toBe(false);
      expect(context.isSafeIntendedRoute(123)).toBe(false);
    });
  });

  describe('saveIntendedRoute and consumeIntendedRoute', () => {
    it('saves and consumes intended route from sessionStorage', () => {
      context.saveIntendedRoute('/models/User');
      const consumed = context.consumeIntendedRoute('/');
      expect(consumed).toBe('/models/User');

      // Subsequent call should fallback to default since storage was cleared
      const secondCall = context.consumeIntendedRoute('/');
      expect(secondCall).toBe('/');
    });

    it('prioritizes route parameter returnTo over sessionStorage', () => {
      context.saveIntendedRoute('/models/Stored');
      context.setRouteParams({ returnTo: '/models/Param' });

      const consumed = context.consumeIntendedRoute('/');
      expect(consumed).toBe('/models/Param');
    });

    it('prioritizes search query returnTo over sessionStorage', () => {
      context.saveIntendedRoute('/models/Stored');
      context.setSearch('?returnTo=%2Fmodels%2FSearch');

      const consumed = context.consumeIntendedRoute('/');
      expect(consumed).toBe('/models/Search');
    });

    it('ignores unsafe returnTo values and falls back to default', () => {
      context.setRouteParams({ returnTo: '//malicious.com' });
      const consumed = context.consumeIntendedRoute('/default');
      expect(consumed).toBe('/default');
    });
  });

  describe('redirectToLogin', () => {
    it('appends returnTo and reason=expired when redirecting', () => {
      context.setRoute('/models/Article');
      context.redirectToLogin('expired');

      expect(context.routeCalls.length).toBeGreaterThan(0);
      const lastRoute = context.routeCalls[context.routeCalls.length - 1];
      expect(lastRoute).toContain('/login?');
      expect(lastRoute).toContain('returnTo=%2Fmodels%2FArticle');
      expect(lastRoute).toContain('reason=expired');
    });
  });

  describe('LoginForm with session expiry reason', () => {
    it('sets state.notice when reason is expired', () => {
      context.setRouteParams({ reason: 'expired' });
      context.LoginForm.oninit();

      expect(context.state.notice).toBe('Your session has expired. Please sign in again.');
      expect(context.state.error).toBeNull();
    });

    it('renders the session expiration notice banner in view()', () => {
      context.state.notice = 'Your session has expired. Please sign in again.';
      const tree = context.LoginForm.view();

      const jsonStr = JSON.stringify(tree);
      expect(jsonStr).toContain('Your session has expired. Please sign in again.');
      expect(jsonStr).toContain('bg-amber-50');
    });

    it('clears state.notice on successful login and redirects to intended route', async () => {
      context.state.notice = 'Your session has expired. Please sign in again.';
      context.setRouteParams({ returnTo: '/models/Orders' });

      const mockEvent = {
        preventDefault: () => {},
        target: {
          _data: {
            email: 'admin@test.com',
            password: 'secret',
          },
        },
      };

      const formNode = findNode(context.LoginForm.view(), c => c && c.tag === 'form');
      expect(formNode).not.toBeNull();
      await formNode.attrs.onsubmit(mockEvent);

      expect(context.state.notice).toBeNull();
      const lastRoute = context.routeCalls[context.routeCalls.length - 1];
      expect(lastRoute).toBe('/models/Orders');
    });
  });

  describe('Toast Notifications (notify)', () => {
    it('supports notify.success, error, warning, info', () => {
      const sId = context.notify.success('Saved successfully');
      const eId = context.notify.error('Save failed');
      const wId = context.notify.warning('Check input');
      const iId = context.notify.info('Updating...');

      expect(context.toastState.items.length).toBe(4);
      expect(context.toastState.items[0].type).toBe('success');
      expect(context.toastState.items[0].message).toBe('Saved successfully');
      expect(context.toastState.items[1].type).toBe('error');

      context.notify.remove(sId);
      expect(context.toastState.items.length).toBe(3);

      context.notify.clear();
      expect(context.toastState.items.length).toBe(0);
    });

    it('renders ToastContainer with active toast elements', () => {
      context.notify.success('Action complete');
      const tree = context.ToastContainer.view();

      expect(tree).not.toBeNull();
      const jsonStr = JSON.stringify(tree);
      expect(jsonStr).toContain('Action complete');
    });
  });

  describe('Confirm Modal (confirmModal / confirmAction)', () => {
    it('opens modal and resolves promise with true on confirm', async () => {
      let resolvedValue = null;
      const promise = context.confirmAction({
        title: 'Delete Item',
        message: 'Are you sure?',
        danger: true,
      }).then(val => { resolvedValue = val; });

      expect(context.confirmState.current).not.toBeNull();
      expect(context.confirmState.current.title).toBe('Delete Item');

      // User confirms
      context.confirmState.close(true);
      await promise;
      expect(resolvedValue).toBe(true);
      expect(context.confirmState.current).toBeNull();
    });

    it('opens modal and resolves promise with false on cancel', async () => {
      let resolvedValue = null;
      const promise = context.confirmAction('Cancel this action?').then(val => { resolvedValue = val; });

      expect(context.confirmState.current).not.toBeNull();
      expect(context.confirmState.current.title).toBe('Confirmation');

      // User cancels
      context.confirmState.close(false);
      await promise;
      expect(resolvedValue).toBe(false);
      expect(context.confirmState.current).toBeNull();
    });

    it('renders ConfirmModalContainer when confirm dialog is open', () => {
      context.confirmAction({ title: 'Danger Confirmation', message: 'Proceed?', danger: true });
      const tree = context.ConfirmModalContainer.view();

      expect(tree).not.toBeNull();
      const jsonStr = JSON.stringify(tree);
      expect(jsonStr).toContain('Danger Confirmation');
      expect(jsonStr).toContain('Proceed?');
      expect(jsonStr).toContain('bg-red-600');
    });
  });
});
