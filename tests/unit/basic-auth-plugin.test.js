/**
 * Tests for basicAuthPlugin & Basic Authentication Middleware
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const {
  basicAuthPlugin,
  createBasicAuthMiddleware,
  parseBasicAuthHeader,
  safeCompare,
} = require('../../plugins/basic-auth');
const { resolveMiddlewares } = require('../../src/file-router');

const viewsDir = path.join(__dirname, '../fixtures/views');
const pagesDir = path.join(__dirname, '../fixtures/pages');

describe('basicAuthPlugin', () => {
  describe('Utilities', () => {
    it('safeCompare returns true for identical strings and false for differing', () => {
      expect(safeCompare('secret123', 'secret123')).toBe(true);
      expect(safeCompare('secret123', 'secret124')).toBe(false);
      expect(safeCompare('secret123', 'short')).toBe(false);
      expect(safeCompare(null, 'secret')).toBe(false);
      expect(safeCompare('secret', undefined)).toBe(false);
      expect(safeCompare(123, 123)).toBe(false);
    });

    it('parseBasicAuthHeader extracts credentials from Basic header', () => {
      const encoded = Buffer.from('admin:secretpass').toString('base64');
      const parsed = parseBasicAuthHeader(`Basic ${encoded}`);
      expect(parsed).toEqual({ username: 'admin', password: 'secretpass' });
    });

    it('parseBasicAuthHeader handles passwords containing colons', () => {
      const encoded = Buffer.from('admin:pass:word:123').toString('base64');
      const parsed = parseBasicAuthHeader(`Basic ${encoded}`);
      expect(parsed).toEqual({ username: 'admin', password: 'pass:word:123' });
    });

    it('parseBasicAuthHeader returns null for invalid formats', () => {
      expect(parseBasicAuthHeader(null)).toBeNull();
      expect(parseBasicAuthHeader('')).toBeNull();
      expect(parseBasicAuthHeader('Bearer token123')).toBeNull();
      expect(parseBasicAuthHeader('Basic invalid_base64_without_colon')).toBeNull();
    });
  });

  describe('Plugin Registration & Named Middlewares', () => {
    it('registers factory into ctx.middlewares.basicAuth', () => {
      const p = basicAuthPlugin({ users: { user1: 'pass1' } });
      const middlewares = {};
      const app = { use: () => {} };
      p.register({ middlewares, app });

      expect(typeof middlewares.basicAuth).toBe('function');
      const mw = middlewares.basicAuth();
      expect(typeof mw).toBe('function');
    });

    it('resolveMiddlewares resolves basicAuth tuple with route-level options', () => {
      const p = basicAuthPlugin({ users: { root: 'secret' } });
      const middlewares = {};
      p.register({ middlewares, app: { use() {} } });

      const resolved = resolveMiddlewares(
        [['basicAuth', { users: { customUser: 'customPass' } }]],
        middlewares
      );
      expect(resolved).toHaveLength(1);
      expect(typeof resolved[0]).toBe('function');
    });
  });

  describe('Middleware Execution & Authentication', () => {
    it('rejects unauthenticated request with 401 and default WWW-Authenticate challenge', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'secret123' },
        realm: 'Control Center',
      });

      const req = { headers: {}, path: '/dashboard' };
      const res = {
        statusCode: null,
        headers: {},
        setHeader(name, val) {
          this.headers[name] = val;
        },
        end: vi.fn(),
      };
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBe('Basic realm="Control Center"');
      expect(next).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledWith('Unauthorized');
    });

    it('omits WWW-Authenticate when challenge: false', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'secret123' },
        challenge: false,
      });

      const req = { headers: {} };
      const res = {
        statusCode: null,
        headers: {},
        setHeader(name, val) {
          this.headers[name] = val;
        },
        end: vi.fn(),
      };
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toBeUndefined();
    });

    it('authenticates valid credentials and enriches req context', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'secret123' },
      });

      const token = Buffer.from('admin:secret123').toString('base64');
      const req = {
        headers: { authorization: `Basic ${token}` },
      };
      const res = { setHeader: vi.fn(), end: vi.fn() };
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.basicAuth).toEqual({ username: 'admin' });
      expect(req.auth.user).toEqual({ username: 'admin', type: 'basic' });
      expect(req.user).toEqual({ username: 'admin', type: 'basic' });
    });

    it('rejects incorrect password with 401', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'secret123' },
      });

      const token = Buffer.from('admin:wrongpass').toString('base64');
      const req = {
        headers: { authorization: `Basic ${token}` },
      };
      const res = {
        statusCode: null,
        headers: {},
        setHeader(name, val) {
          this.headers[name] = val;
        },
        end: vi.fn(),
      };
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('supports custom async verify function returning user object', async () => {
      const onAuthSpy = vi.fn();
      const mw = createBasicAuthMiddleware({
        async verify(username, password) {
          if (username === 'dbuser' && password === 'secure') {
            return { id: 42, username: 'dbuser', role: 'engineer' };
          }
          return false;
        },
        onAuthenticated: onAuthSpy,
      });

      const token = Buffer.from('dbuser:secure').toString('base64');
      const req = {
        headers: { authorization: `Basic ${token}` },
      };
      const res = { setHeader: vi.fn(), end: vi.fn() };
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.auth.user).toEqual({ id: 42, username: 'dbuser', role: 'engineer' });
      expect(onAuthSpy).toHaveBeenCalledWith(req, { id: 42, username: 'dbuser', role: 'engineer' });
    });

    it('handles custom unauthorizedResponse object or function', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'pass' },
        unauthorizedResponse: { status: 'failed', code: 'AUTH_REQUIRED' },
      });

      const req = { headers: {} };
      let body = '';
      const res = {
        statusCode: null,
        headers: {},
        setHeader(name, val) {
          this.headers[name] = val;
        },
        end(data) {
          body = data;
        },
      };

      await mw(req, res, vi.fn());

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(body)).toEqual({ status: 'failed', code: 'AUTH_REQUIRED' });
    });

    it('skips authentication for skipPaths and skip function', async () => {
      const mw = createBasicAuthMiddleware({
        users: { admin: 'pass' },
        skipPaths: ['/public', '/health'],
        skip: (req) => req.path === '/custom-bypass',
      });

      const next1 = vi.fn();
      await mw({ path: '/public/doc', headers: {} }, {}, next1);
      expect(next1).toHaveBeenCalled();

      const next2 = vi.fn();
      await mw({ path: '/health', headers: {} }, {}, next2);
      expect(next2).toHaveBeenCalled();

      const next3 = vi.fn();
      await mw({ path: '/custom-bypass', headers: {} }, {}, next3);
      expect(next3).toHaveBeenCalled();
    });
  });

  describe('Integration with createApp & File Routes', () => {
    it('protects routes globally when global: true', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir,
        logging: false,
        plugins: [
          basicAuthPlugin({
            global: true,
            users: { testuser: 'secretpassword' },
            realm: 'Staging Environment',
            skipPaths: ['/robots.txt'],
          }),
        ],
      });

      // Without auth -> 401
      const unauthRes = await request(app).get('/');
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.headers['www-authenticate']).toBe('Basic realm="Staging Environment"');

      // With auth -> 200
      const token = Buffer.from('testuser:secretpassword').toString('base64');
      const authRes = await request(app)
        .get('/')
        .set('Authorization', `Basic ${token}`);
      expect(authRes.status).toBe(200);
    });

    it('provides basicAuth named middleware to routes via registry', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir,
        logging: false,
        plugins: [
          basicAuthPlugin({
            users: { admin: 'adminsecret' },
          }),
        ],
        setupRoutes: (router, { middlewares }) => {
          // Mount an endpoint protected by the named middleware
          router.get('/protected-api', middlewares.basicAuth(), (req, res) => {
            res.json({ message: 'Welcome ' + req.basicAuth.username });
          });
        },
      });

      // 401 without auth
      const unauthRes = await request(app).get('/protected-api');
      expect(unauthRes.status).toBe(401);

      // 200 with valid basic auth
      const token = Buffer.from('admin:adminsecret').toString('base64');
      const authRes = await request(app)
        .get('/protected-api')
        .set('Authorization', `Basic ${token}`);
      expect(authRes.status).toBe(200);
      expect(authRes.body).toEqual({ message: 'Welcome admin' });
    });
  });
});
