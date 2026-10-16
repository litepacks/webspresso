const http = require('http');
const request = require('supertest');
const express = require('express');
const {
  createApiKeyMiddleware,
  generateKey,
  hashKey,
  maskKey,
  extractApiKey,
} = require('../../../plugins/api-key');

describe('API Key Middleware Scenarios', () => {
  describe('extractApiKey() Edge Cases & Extraction Methods', () => {
    it('uses custom extractKey function when provided', () => {
      const customExtract = (req) => req.headers['x-special-auth'];
      const req = { headers: { 'x-special-auth': 'custom_token_123' } };
      expect(extractApiKey(req, { extractKey: customExtract })).toBe('custom_token_123');
    });

    it('extracts from custom configured headerName', () => {
      const req = { headers: { 'x-corp-key': 'corp_val_999' } };
      expect(extractApiKey(req, { headerName: 'x-corp-key' })).toBe('corp_val_999');
    });

    it('extracts from standard x-api-key and api-key headers', () => {
      expect(extractApiKey({ headers: { 'x-api-key': 'x_key_1' } })).toBe('x_key_1');
      expect(extractApiKey({ headers: { 'api-key': 'plain_key_2' } })).toBe('plain_key_2');
    });

    it('extracts from Authorization header: Bearer, ApiKey, Api-Key', () => {
      expect(extractApiKey({ headers: { authorization: 'Bearer tok_bearer' } })).toBe('tok_bearer');
      expect(extractApiKey({ headers: { authorization: 'ApiKey tok_apikey' } })).toBe('tok_apikey');
      expect(extractApiKey({ headers: { authorization: 'Api-Key tok_dashkey' } })).toBe('tok_dashkey');
      expect(extractApiKey({ headers: { authorization: 'Basic user:pass' } })).toBeNull();
    });

    it('extracts from query parameter when allowed', () => {
      const req1 = { headers: {}, query: { apiKey: 'query_key_1' } };
      expect(extractApiKey(req1, { allowQueryParam: true })).toBe('query_key_1');

      const req2 = { headers: {}, query: { api_key: 'query_key_2' } };
      expect(extractApiKey(req2, { queryParam: true })).toBe('query_key_2');

      const req3 = { headers: {}, query: { token: 'custom_query_val' } };
      expect(extractApiKey(req3, { allowQueryParam: true, queryParamName: 'token' })).toBe('custom_query_val');

      // Not allowed by default
      expect(extractApiKey(req1, {})).toBeNull();
    });

    it('returns null when no key present in headers or query', () => {
      expect(extractApiKey({ headers: {} })).toBeNull();
      expect(extractApiKey({})).toBeNull();
    });
  });

  describe('Route Filtering & Skip Conditions', () => {
    it('skips middleware when request path does not match routes prefix', async () => {
      const app = express();
      const mw = createApiKeyMiddleware({ routes: ['/api/v1', '/protected'] });
      app.use(mw);
      app.get('/public/hello', (req, res) => res.json({ public: true }));
      app.get('/api/v1/data', (req, res) => res.json({ data: true }));

      // /public/hello is outside routes -> 200 without key
      const resPublic = await request(app).get('/public/hello').expect(200);
      expect(resPublic.body.public).toBe(true);

      // /api/v1/data matches routes -> 401 missing key
      await request(app).get('/api/v1/data').expect(401);
    });

    it('skips middleware when path is in skipPaths', async () => {
      const app = express();
      const mw = createApiKeyMiddleware({
        routes: true,
        skipPaths: ['/health', '/metrics'],
      });
      app.use(mw);
      app.get('/health', (req, res) => res.send('OK'));
      app.get('/secure', (req, res) => res.send('SECRET'));

      await request(app).get('/health').expect(200);
      await request(app).get('/secure').expect(401);
    });

    it('skips middleware when custom skip predicate returns true', async () => {
      const app = express();
      const mw = createApiKeyMiddleware({
        skip: (req) => req.headers['x-internal-bypass'] === 'true',
      });
      app.use(mw);
      app.get('/data', (req, res) => res.json({ data: 'ok' }));

      // With bypass header
      await request(app)
        .get('/data')
        .set('x-internal-bypass', 'true')
        .expect(200);

      // Without bypass header
      await request(app)
        .get('/data')
        .expect(401);
    });
  });

  describe('Missing Keys & Optional Authentication', () => {
    it('passes through when optional is true and no key is provided', async () => {
      const app = express();
      const mw = createApiKeyMiddleware({ optional: true });
      app.use(mw);
      app.get('/profile', (req, res) => {
        res.json({ authenticated: !!req.apiKey, user: req.user || null });
      });

      const res = await request(app).get('/profile').expect(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    it('formats 401 response as JSON when path is under /api/', async () => {
      const app = express();
      app.use(createApiKeyMiddleware());
      app.get('/api/test', (req, res) => res.send('OK'));

      const res = await request(app).get('/api/test').expect(401);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.error).toBe('Unauthorized');
      expect(res.body.message).toContain('missing');
    });

    it('formats 401 response as text/plain for non-JSON endpoints', async () => {
      const app = express();
      app.use(createApiKeyMiddleware());
      app.get('/web-page', (req, res) => res.send('OK'));

      const res = await request(app).get('/web-page').expect(401);
      expect(res.text).toBe('Unauthorized');
    });

    it('supports custom unauthorizedResponse as function, object, or string', async () => {
      // 1. Function
      const appFn = express();
      appFn.use(createApiKeyMiddleware({
        unauthorizedResponse: (req, res, err) => {
          res.status(401).json({ custom: true, reason: err.reason });
        },
      }));
      appFn.get('/test', (req, res) => res.send('OK'));
      const resFn = await request(appFn).get('/test').expect(401);
      expect(resFn.body.custom).toBe(true);

      // 2. Object
      const appObj = express();
      appObj.use(createApiKeyMiddleware({
        unauthorizedResponse: { status: 'DENIED', code: 40101 },
      }));
      appObj.get('/test', (req, res) => res.send('OK'));
      const resObj = await request(appObj).get('/test').expect(401);
      expect(resObj.body.status).toBe('DENIED');

      // 3. String
      const appStr = express();
      appStr.use(createApiKeyMiddleware({
        unauthorizedResponse: 'Access Denied: Please provide a valid API key.',
      }));
      appStr.get('/test', (req, res) => res.send('OK'));
      const resStr = await request(appStr).get('/test').expect(401);
      expect(resStr.text).toBe('Access Denied: Please provide a valid API key.');
    });
  });

  describe('Key Lookup Strategies', () => {
    it('uses custom verify function', async () => {
      const app = express();
      const mockVerify = vi.fn().mockImplementation(async (rawKey) => {
        if (rawKey === 'magic-key-777') {
          return { id: 777, name: 'Magic Service', scopes: ['read', 'write'] };
        }
        return null;
      });

      app.use(createApiKeyMiddleware({ verify: mockVerify }));
      app.get('/verify-test', (req, res) => res.json({ name: req.apiKey.name }));

      // Valid
      const resValid = await request(app)
        .get('/verify-test')
        .set('x-api-key', 'magic-key-777')
        .expect(200);
      expect(resValid.body.name).toBe('Magic Service');

      // Invalid
      await request(app)
        .get('/verify-test')
        .set('x-api-key', 'wrong-key')
        .expect(401);
    });

    it('uses custom findKeyByHash function', async () => {
      const secret = 'hash-lookup-secret';
      const expectedHash = hashKey(secret);

      const app = express();
      const mockFind = vi.fn().mockImplementation(async (hash) => {
        if (hash === expectedHash) {
          return { id: 88, name: 'Hashed Service', key_hash: expectedHash };
        }
        return null;
      });

      app.use(createApiKeyMiddleware({ findKeyByHash: mockFind }));
      app.get('/hash-test', (req, res) => res.json({ id: req.apiKey.id }));

      await request(app)
        .get('/hash-test')
        .set('x-api-key', secret)
        .expect(200);

      await request(app)
        .get('/hash-test')
        .set('x-api-key', 'incorrect-key')
        .expect(401);
    });

    it('matches against static keys array and dictionary object', async () => {
      const generated = generateKey({ prefix: 'static_' });

      // Array format
      const appArray = express();
      appArray.use(createApiKeyMiddleware({
        keys: [
          { key: generated.key, name: 'Static Key 1', scopes: ['read'] },
          { key_hash: hashKey('other-key'), name: 'Static Key 2' },
        ],
      }));
      appArray.get('/keys-array', (req, res) => res.json({ name: req.apiKey.name }));

      const resArr = await request(appArray)
        .get('/keys-array')
        .set('x-api-key', generated.key)
        .expect(200);
      expect(resArr.body.name).toBe('Static Key 1');

      // Object map format
      const appObj = express();
      appObj.use(createApiKeyMiddleware({
        keys: {
          'direct-secret-key': { name: 'Direct Key' },
        },
      }));
      appObj.get('/keys-obj', (req, res) => res.json({ name: req.apiKey.name }));

      const resObj = await request(appObj)
        .get('/keys-obj')
        .set('x-api-key', 'direct-secret-key')
        .expect(200);
      expect(resObj.body.name).toBe('Direct Key');
    });
  });

  describe('Revocation, Expiration & Timing Attacks', () => {
    it('rejects revoked keys (revoked_at, is_active: false, revoked: true)', async () => {
      const k1 = generateKey();
      const k2 = generateKey();
      const k3 = generateKey();

      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [
          { key: k1.key, revoked_at: new Date().toISOString() },
          { key: k2.key, is_active: false },
          { key: k3.key, revoked: true },
        ],
      }));
      app.get('/api/revoked-test', (req, res) => res.send('OK'));

      const r1 = await request(app).get('/api/revoked-test').set('x-api-key', k1.key).expect(401);
      expect(r1.body.message).toContain('revoked');

      const r2 = await request(app).get('/api/revoked-test').set('x-api-key', k2.key).expect(401);
      expect(r2.body.message).toContain('revoked');

      const r3 = await request(app).get('/api/revoked-test').set('x-api-key', k3.key).expect(401);
      expect(r3.body.message).toContain('revoked');
    });

    it('rejects expired keys and allows non-expired keys', async () => {
      const expiredKey = generateKey();
      const validKey = generateKey();

      const past = new Date(Date.now() - 3600000).toISOString();
      const future = new Date(Date.now() + 3600000).toISOString();

      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [
          { key: expiredKey.key, expires_at: past },
          { key: validKey.key, expires_at: future },
        ],
      }));
      app.get('/api/exp-test', (req, res) => res.send('OK'));

      const rExpired = await request(app).get('/api/exp-test').set('x-api-key', expiredKey.key).expect(401);
      expect(rExpired.body.message).toContain('expired');

      await request(app).get('/api/exp-test').set('x-api-key', validKey.key).expect(200);
    });

    it('handles key_hash mismatch in timing-safe comparison', async () => {
      const key = generateKey();
      const app = express();
      // Record has mismatching key_hash
      app.use(createApiKeyMiddleware({
        keys: [
          { key: key.key, key_hash: '0000000000000000000000000000000000000000000000000000000000000000' },
        ],
      }));
      app.get('/timing-test', (req, res) => res.send('OK'));

      await request(app).get('/timing-test').set('x-api-key', key.key).expect(401);
    });
  });

  describe('Scopes & Granular Access Control', () => {
    it('enforces requireAllScopes: true with wildcard support', async () => {
      const key = generateKey();
      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [{ key: key.key, scopes: ['orders:*', 'users:read'] }],
        scopes: ['orders:create', 'users:read'],
        requireAllScopes: true,
      }));
      app.get('/api/orders', (req, res) => res.json({ success: true }));

      // Matches both orders:* (matches orders:create) and users:read
      await request(app)
        .get('/api/orders')
        .set('x-api-key', key.key)
        .expect(200);
    });

    it('enforces requireAllScopes: false (any scope suffices)', async () => {
      const key = generateKey();
      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [{ key: key.key, scopes: ['reports:view'] }],
        scopes: ['admin:full', 'reports:view'],
        requireAllScopes: false,
      }));
      app.get('/api/reports', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/api/reports')
        .set('x-api-key', key.key)
        .expect(200);
    });

    it('returns 403 Forbidden with details and custom forbiddenResponse', async () => {
      const key = generateKey();

      // Default JSON forbidden response
      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [{ key: key.key, scopes: ['read:public'] }],
        scopes: ['admin:write'],
      }));
      app.get('/api/admin', (req, res) => res.send('OK'));

      const res = await request(app)
        .get('/api/admin')
        .set('x-api-key', key.key)
        .expect(403);
      expect(res.body.error).toBe('Forbidden');
      expect(res.body.requiredScopes).toEqual(['admin:write']);

      // Custom forbiddenResponse object
      const appCustom = express();
      appCustom.use(createApiKeyMiddleware({
        keys: [{ key: key.key, scopes: ['guest'] }],
        scopes: ['member'],
        forbiddenResponse: { error: 'NO_PERMISSION', level: 'restricted' },
      }));
      appCustom.get('/member-zone', (req, res) => res.send('OK'));

      const resCustom = await request(appCustom)
        .get('/member-zone')
        .set('x-api-key', key.key)
        .expect(403);
      expect(resCustom.body.error).toBe('NO_PERMISSION');
    });
  });

  describe('Usage Tracking, User Resolution & Lifecycle Hooks', () => {
    it('executes custom updateLastUsed when trackUsage is enabled and throttles updates', async () => {
      const key = generateKey();
      const updateMock = vi.fn();

      const record = {
        id: 42,
        key: key.key,
        last_used_at: new Date(Date.now() - 120000), // 2 mins ago
      };

      const app = express();
      app.use(createApiKeyMiddleware({
        keys: [record],
        trackUsage: true,
        updateLastUsedThrottleMs: 60000, // 1 min throttle
        updateLastUsed: updateMock,
      }));
      app.get('/ping', (req, res) => res.send('PONG'));

      await request(app).get('/ping').set('x-api-key', key.key).expect(200);

      // Wait a tick for setImmediate
      await new Promise((r) => setTimeout(r, 20));
      expect(updateMock).toHaveBeenCalledWith(42, expect.objectContaining({ id: 42 }));
    });

    it('resolves user via getUser hook and attaches req.apiKey and req.auth', async () => {
      const key = generateKey();
      const mockUser = { id: 99, email: 'dev@corp.com', role: 'developer' };

      const app = express();
      const onAuthMock = vi.fn();

      app.use(createApiKeyMiddleware({
        keys: [{ key: key.key, name: 'DevKey' }],
        getUser: async (rec) => mockUser,
        onAuthenticated: onAuthMock,
      }));

      app.get('/whoami', (req, res) => {
        res.json({
          apiKeyName: req.apiKey.name,
          authApiKeyName: req.auth.apiKey.name,
          user: req.user,
          authUser: req.auth.user,
        });
      });

      const res = await request(app)
        .get('/whoami')
        .set('x-api-key', key.key)
        .expect(200);

      expect(res.body.apiKeyName).toBe('DevKey');
      expect(res.body.authApiKeyName).toBe('DevKey');
      expect(res.body.user).toEqual(mockUser);
      expect(res.body.authUser).toEqual(mockUser);
      expect(onAuthMock).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ name: 'DevKey' }));
    });

    it('propagates internal errors to next(err)', async () => {
      const app = express();
      app.use(createApiKeyMiddleware({
        verify: async () => {
          throw new Error('Database connection exploded');
        },
      }));
      app.get('/error-test', (req, res) => res.send('OK'));
      app.use((err, req, res, next) => {
        res.status(500).json({ caught: true, message: err.message });
      });

      const res = await request(app)
        .get('/error-test')
        .set('x-api-key', 'any-key')
        .expect(500);

      expect(res.body.caught).toBe(true);
      expect(res.body.message).toBe('Database connection exploded');
    });
  });
});
