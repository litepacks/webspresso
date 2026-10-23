const {
  createMockSpyRes
} = require('../../utils');

/**
 * Admin Panel Login and Setup Form Unit Tests
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createApiHandlers } = require('../../../plugins/admin-panel/api');

describe('Admin Panel Login & Setup Form Error Handling', () => {
  let context;

  beforeEach(() => {
    const state = {
      user: null,
      needsSetup: false,
      loading: false,
      error: null,
    };

    const redrawCalls = [];
    const routeCalls = [];
    const apiCalls = [];

    const mockM = {
      redraw: () => {
        redrawCalls.push(Date.now());
      },
      route: {
        set: (p) => {
          routeCalls.push(p);
        },
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
      post: async (endpoint, data) => {
        apiCalls.push({ endpoint, data });
        if (mockApi._rejectWith) {
          throw mockApi._rejectWith;
        }
        return mockApi._resolveWith || { user: { id: 1, email: data.email } };
      },
      _rejectWith: null,
      _resolveWith: null,
    };

    const code = fs.readFileSync(
      path.join(__dirname, '../../../plugins/admin-panel/client/parts/06-login-setup-forms.js'),
      'utf8'
    );

    context = {
      m,
      state,
      api: mockApi,
      consumeIntendedRoute: (def) => def,
      FormData: class MockFormData {
        constructor(form) {
          this._data = form._data || {};
        }
        get(key) {
          return this._data[key] || '';
        }
      },
      redrawCalls,
      routeCalls,
      apiCalls,
    };

    vm.createContext(context);
    vm.runInContext(
      code + '\n;globalThis.LoginForm = LoginForm; globalThis.SetupForm = SetupForm;',
      context
    );
  });

  describe('LoginForm', () => {
    it('initializes state.error and state.loading to clean values on oninit', () => {
      context.state.error = 'Old error from earlier';
      context.state.loading = true;

      context.LoginForm.oninit();

      expect(context.state.error).toBeNull();
      expect(context.state.loading).toBe(false);
    });

    it('renders error message container when state.error is present', () => {
      context.state.error = 'Invalid credentials';
      const tree = context.LoginForm.view();

      const jsonStr = JSON.stringify(tree);
      expect(jsonStr).toContain('Invalid credentials');
      expect(jsonStr).toContain('bg-red-50');
    });

    it('does not render error message container when state.error is null', () => {
      context.state.error = null;
      const tree = context.LoginForm.view();

      const jsonStr = JSON.stringify(tree);
      expect(jsonStr).not.toContain('bg-red-50');
      expect(jsonStr).not.toContain('Invalid credentials');
    });

    it('triggers m.redraw() and displays error on failed login attempt', async () => {
      context.api._rejectWith = new Error('Invalid email or password');

      const mockEvent = {
        preventDefault: () => {},
        target: {
          _data: {
            email: 'admin@example.com',
            password: 'wrongpassword',
          },
        },
      };

      const tree = context.LoginForm.view();
      function findForm(node) {
        if (!node) return null;
        if (node.tag === 'form') return node;
        if (node.children) {
          for (const child of node.children) {
            const f = findForm(child);
            if (f) return f;
          }
        }
        return null;
      }

      const formNode = findForm(tree);
      expect(formNode).toBeTruthy();

      await formNode.attrs.onsubmit(mockEvent);

      // Verify that state.error is set
      expect(context.state.error).toBe('Invalid email or password');
      expect(context.state.loading).toBe(false);

      // Verify that m.redraw() was called so the UI updates
      expect(context.redrawCalls.length).toBeGreaterThan(0);
      expect(context.routeCalls.length).toBe(0); // Did NOT redirect on error!
    });
  });

  describe('SetupForm', () => {
    it('initializes state.error and state.loading to clean values on oninit', () => {
      context.state.error = 'Old setup error';
      context.state.loading = true;

      context.SetupForm.oninit();

      expect(context.state.error).toBeNull();
      expect(context.state.loading).toBe(false);
    });

    it('triggers m.redraw() and displays error on failed setup attempt', async () => {
      context.api._rejectWith = new Error('Admin user already exists');

      const mockEvent = {
        preventDefault: () => {},
        target: {
          _data: {
            name: 'Super Admin',
            email: 'admin@example.com',
            password: 'password123',
          },
        },
      };

      const tree = context.SetupForm.view();
      function findForm(node) {
        if (!node) return null;
        if (node.tag === 'form') return node;
        if (node.children) {
          for (const child of node.children) {
            const f = findForm(child);
            if (f) return f;
          }
        }
        return null;
      }

      const formNode = findForm(tree);
      expect(formNode).toBeTruthy();

      await formNode.attrs.onsubmit(mockEvent);

      expect(context.state.error).toBe('Admin user already exists');
      expect(context.state.loading).toBe(false);
      expect(context.redrawCalls.length).toBeGreaterThan(0);
      expect(context.routeCalls.length).toBe(0);
    });
  });

  describe('Backend loginHandler error response (No redirect)', () => {
    it('returns status 401 with JSON error when credentials are wrong, without redirecting', async () => {
      const mockRepo = {
        query: () => ({
          where: () => ({
            first: async () => null,
          }),
        }),
      };

      const handlers = createApiHandlers({
        db: { getRepository: () => mockRepo },
        AdminUser: { name: 'AdminUser' },
        comparePassword: async () => false,
      });

      let responseCode = null;
      let responseBody = null;
      let redirectUrl = null;

      const req = {
        body: {
          email: 'wrong@example.com',
          password: 'badpassword',
        },
        session: {},
      };

      const res = {
        status(code) {
          responseCode = code;
          return this;
        },
        json(body) {
          responseBody = body;
          return this;
        },
        redirect(url) {
          redirectUrl = url;
          return this;
        },
      };

      await handlers.loginHandler(req, res);

      expect(responseCode).toBe(401);
      expect(responseBody).toEqual({ error: 'Invalid credentials' });
      expect(redirectUrl).toBeNull(); // No HTTP redirect!
    });

    it('returns status 400 with JSON error when email or password is missing', async () => {
      const handlers = createApiHandlers({
        db: { getRepository: () => ({}) },
        AdminUser: { name: 'AdminUser' },
        comparePassword: async () => false,
      });

      let responseCode = null;
      let responseBody = null;

      const req = {
        body: { email: '' },
        session: {},
      };

      const res = {
        status(code) {
          responseCode = code;
          return this;
        },
        json(body) {
          responseBody = body;
          return this;
        },
      };

      await handlers.loginHandler(req, res);

      expect(responseCode).toBe(400);
      expect(responseBody.error).toBe('Email and password are required');
    });
  });
});
