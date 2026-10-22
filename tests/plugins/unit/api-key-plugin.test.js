const {
  wait,
  createMockSpyRes
} = require('../../utils');

/**
 * Tests for apiKeyPlugin & API Key Authentication Middleware
 */

const path = require('path');
const request = require('supertest');
const knex = require('knex');
const { createApp } = require('../../../src/server');
const {
  apiKeyPlugin,
  createApiKeyMiddleware,
  generateKey,
  hashKey,
  maskKey,
  safeCompare,
  hasScope,
  hasRequiredScopes,
  normalizeScopes,
  matchScope,
  extractApiKey,
} = require('../../../plugins/api-key');
const { resolveMiddlewares } = require('../../../src/file-router');

const viewsDir = path.join(__dirname, '../../fixtures/views');
const pagesDir = path.join(__dirname, '../../fixtures/empty-pages');

describe('apiKeyPlugin', () => {
  describe('Cryptographic Utilities', () => {
    it('generateKey returns key with default prefix, hash, and masked hint', () => {
      const generated = generateKey();
      expect(generated.key).toMatch(/^wsp_live_[A-Za-z0-9_-]{32}$/);
      expect(generated.prefix).toBe('wsp_live_');
      expect(generated.hash).toHaveLength(64);
      expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(generated.hint).toMatch(/^wsp_live_\.\.\.[A-Za-z0-9_-]{4}$/);
      expect(generated.hint.endsWith(generated.key.slice(-4))).toBe(true);
    });

    it('generateKey respects custom prefix and byte length', () => {
      const generated = generateKey({ prefix: 'sk_test_', byteLength: 16 });
      expect(generated.key.startsWith('sk_test_')).toBe(true);
      expect(generated.prefix).toBe('sk_test_');
      expect(generated.hint.startsWith('sk_test_...')).toBe(true);
      expect(generated.hash).toHaveLength(64);
    });

    it('hashKey computes SHA-256 hex string and handles falsy input', () => {
      const h1 = hashKey('test-key-123');
      const h2 = hashKey('test-key-123');
      const h3 = hashKey('test-key-456');

      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
      expect(h1).toHaveLength(64);

      expect(hashKey('')).toBe('');
      expect(hashKey(null)).toBe('');
      expect(hashKey(undefined)).toBe('');
    });

    it('maskKey masks keys properly and handles edge cases', () => {
      expect(maskKey('wsp_live_1234567890abcdef', 'wsp_live_')).toBe('wsp_live_...cdef');
      expect(maskKey('sk_test_1234567890', 'sk_test_')).toBe('sk_test_...7890');
      expect(maskKey('short')).toBe('****');
      expect(maskKey('')).toBe('****');
      expect(maskKey(null)).toBe('****');
    });

    it('safeCompare returns constant-time comparison results', () => {
      expect(safeCompare('secret_hash_value', 'secret_hash_value')).toBe(true);
      expect(safeCompare('secret_hash_value_1', 'secret_hash_value_2')).toBe(false);
      expect(safeCompare('secret_hash_value', 'short')).toBe(false);
      expect(safeCompare(null, 'test')).toBe(false);
      expect(safeCompare('test', undefined)).toBe(false);
      expect(safeCompare(12345, 12345)).toBe(false);
    });
  });

  describe('Scopes & Authorization Logic', () => {
    it('normalizeScopes parses arrays, strings, and JSON arrays', () => {
      expect(normalizeScopes(['read', 'write'])).toEqual(['read', 'write']);
      expect(normalizeScopes('read, write , billing:admin')).toEqual(['read', 'write', 'billing:admin']);
      expect(normalizeScopes('["read", "write"]')).toEqual(['read', 'write']);
      expect(normalizeScopes('')).toEqual([]);
      expect(normalizeScopes(null)).toEqual([]);
    });

    it('matchScope checks exact match, global wildcard, and prefix wildcards', () => {
      expect(matchScope('reports:read', 'reports:read')).toBe(true);
      expect(matchScope('reports:read', 'reports:write')).toBe(false);
      expect(matchScope('*', 'anything:action')).toBe(true);
      expect(matchScope('reports:*', 'reports:read')).toBe(true);
      expect(matchScope('reports:*', 'reports:export:csv')).toBe(true);
      expect(matchScope('reports:*', 'users:read')).toBe(false);
      expect(matchScope(null, 'reports:read')).toBe(false);
    });

    it('hasScope checks if a scope is contained within granted scopes', () => {
      expect(hasScope(['users:read', 'reports:*'], 'reports:download')).toBe(true);
      expect(hasScope(['users:read'], 'users:write')).toBe(false);
    });

    it('hasRequiredScopes handles requireAll true and false', () => {
      const granted = ['users:read', 'reports:*'];

      // Empty required scopes -> true
      expect(hasRequiredScopes(granted, [])).toBe(true);
      expect(hasRequiredScopes(granted, null)).toBe(true);

      // requireAll = true (default)
      expect(hasRequiredScopes(granted, ['users:read', 'reports:daily'])).toBe(true);
      expect(hasRequiredScopes(granted, ['users:read', 'billing:view'])).toBe(false);

      // requireAll = false
      expect(hasRequiredScopes(granted, ['users:read', 'billing:view'], false)).toBe(true);
      expect(hasRequiredScopes(granted, ['billing:view', 'admin:super'], false)).toBe(false);

      // Granted is empty -> false
      expect(hasRequiredScopes([], ['users:read'])).toBe(false);
    });
  });

  describe('Request Extraction (extractApiKey)', () => {
    it('extracts from X-API-Key header', () => {
      const req = { headers: { 'x-api-key': 'wsp_live_key1' } };
      expect(extractApiKey(req)).toBe('wsp_live_key1');
    });

    it('extracts from api-key header', () => {
      const req = { headers: { 'api-key': 'wsp_live_key2' } };
      expect(extractApiKey(req)).toBe('wsp_live_key2');
    });

    it('extracts from Authorization: Bearer <key>', () => {
      const req = { headers: { authorization: 'Bearer wsp_live_bearer1' } };
      expect(extractApiKey(req)).toBe('wsp_live_bearer1');
    });

    it('extracts from Authorization: ApiKey <key>', () => {
      const req = { headers: { authorization: 'ApiKey wsp_live_apikey1' } };
      expect(extractApiKey(req)).toBe('wsp_live_apikey1');
    });

    it('extracts from custom configured header', () => {
      const req = { headers: { 'x-custom-token': 'wsp_live_custom' } };
      expect(extractApiKey(req, { headerName: 'X-Custom-Token' })).toBe('wsp_live_custom');
    });

    it('extracts from query parameter when allowQueryParam: true', () => {
      const req = { headers: {}, query: { apiKey: 'wsp_live_query1' } };
      expect(extractApiKey(req, { allowQueryParam: true })).toBe('wsp_live_query1');

      const req2 = { headers: {}, query: { customKey: 'wsp_live_query2' } };
      expect(extractApiKey(req2, { allowQueryParam: true, queryParamName: 'customKey' })).toBe('wsp_live_query2');
    });

    it('ignores query parameter when allowQueryParam: false', () => {
      const req = { headers: {}, query: { apiKey: 'wsp_live_query1' } };
      expect(extractApiKey(req, { allowQueryParam: false })).toBeNull();
    });

    it('uses custom extractKey function when supplied', () => {
      const req = { customKeyField: 'wsp_live_from_custom' };
      const key = extractApiKey(req, { extractKey: (r) => r.customKeyField });
      expect(key).toBe('wsp_live_from_custom');
    });

    it('returns null when no key header or param is provided', () => {
      expect(extractApiKey({ headers: {} })).toBeNull();
    });
  });

  describe('Middleware Execution & Authentication', () => {
    it('rejects unauthenticated requests with 401 when key is missing', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{ key: 'wsp_live_valid', name: 'Test Key' }],
      });

      const req = { headers: {}, path: '/api/v1/orders' };
      const res = createMockSpyRes({
        statusCode: null
      });
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Unauthorized', message: 'Authentication required: API key is missing.' })
      );
    });

    it('passes through when optional: true and key is missing', async () => {
      const mw = createApiKeyMiddleware({
        optional: true,
        keys: [{ key: 'wsp_live_valid' }],
      });

      const req = { headers: {}, path: '/api/v1/public-or-private' };
      const res = {};
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toBeUndefined();
    });

    it('rejects invalid API key with 401', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{ key: 'wsp_live_valid', name: 'Valid Key' }],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_invalid' }, path: '/api/v1/orders' };
      const res = createMockSpyRes({
        statusCode: null
      });
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid API key.' })
      );
    });

    it('rejects revoked API key with 401', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{
          key: 'wsp_live_revoked',
          name: 'Revoked Key',
          revoked_at: new Date(Date.now() - 10000),
        }],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_revoked' }, path: '/api/v1/orders' };
      const res = createMockSpyRes({
        statusCode: null
      });

      await mw(req, res, vi.fn());

      expect(res.statusCode).toBe(401);
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Unauthorized', message: 'API key has been revoked.' })
      );
    });

    it('rejects expired API key with 401', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{
          key: 'wsp_live_expired',
          name: 'Expired Key',
          expires_at: new Date(Date.now() - 60000), // Expired 1 min ago
        }],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_expired' }, path: '/api/v1/orders' };
      const res = createMockSpyRes({
        statusCode: null
      });

      await mw(req, res, vi.fn());

      expect(res.statusCode).toBe(401);
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Unauthorized', message: 'API key has expired.' })
      );
    });

    it('authenticates valid API key and attaches context to request', async () => {
      const keyRecord = {
        key: 'wsp_live_valid123',
        name: 'Zapier App',
        scopes: ['orders:read'],
        user: { id: 42, email: 'partner@example.com' },
      };

      const mw = createApiKeyMiddleware({
        keys: [keyRecord],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_valid123' }, path: '/api/v1/orders' };
      const res = {};
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.apiKey).toBeDefined();
      expect(req.apiKey.name).toBe('Zapier App');
      expect(req.auth.apiKey).toBe(req.apiKey);
      expect(req.auth.user).toEqual({ id: 42, email: 'partner@example.com' });
      expect(req.user).toEqual({ id: 42, email: 'partner@example.com' });
    });

    it('enforces required scopes with 403 Forbidden', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{
          key: 'wsp_live_read_only',
          name: 'Read Only Key',
          scopes: ['orders:read'],
        }],
        scopes: ['orders:write'],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_read_only' }, path: '/api/v1/orders' };
      const res = createMockSpyRes({
        statusCode: null
      });
      const next = vi.fn();

      await mw(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({
          error: 'Forbidden',
          message: 'Forbidden: Insufficient API key permissions.',
          requiredScopes: ['orders:write'],
        })
      );
    });

    it('allows access when required scopes match with wildcards', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{
          key: 'wsp_live_admin_key',
          name: 'Full Access Key',
          scopes: ['orders:*'],
        }],
        scopes: ['orders:write', 'orders:read'],
      });

      const req = { headers: { 'x-api-key': 'wsp_live_admin_key' }, path: '/api/v1/orders' };
      const res = {};
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('supports custom unauthorized and forbidden response handlers', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{ key: 'wsp_live_scope_fail', scopes: ['read'] }],
        scopes: ['write'],
        unauthorizedResponse: (req, res, info) => {
          res.statusCode = 401;
          res.end(`CUSTOM_UNAUTH: ${info.message}`);
        },
        forbiddenResponse: (req, res, info) => {
          res.statusCode = 403;
          res.end(`CUSTOM_FORBIDDEN: ${info.requiredScopes.join(',')}`);
        },
      });

      // Test custom 401
      const res1 = { statusCode: null, end: vi.fn() };
      await mw({ headers: {} }, res1, vi.fn());
      expect(res1.statusCode).toBe(401);
      expect(res1.end).toHaveBeenCalledWith(expect.stringContaining('CUSTOM_UNAUTH'));

      // Test custom 403
      const res2 = { statusCode: null, end: vi.fn() };
      await mw({ headers: { 'x-api-key': 'wsp_live_scope_fail' } }, res2, vi.fn());
      expect(res2.statusCode).toBe(403);
      expect(res2.end).toHaveBeenCalledWith('CUSTOM_FORBIDDEN: write');
    });

    it('skips authentication for skipPaths and custom skip predicate', async () => {
      const mw = createApiKeyMiddleware({
        keys: [{ key: 'wsp_live_key' }],
        skipPaths: ['/health', '/docs'],
        skip: (req) => req.path === '/webhook',
      });

      const next1 = vi.fn();
      await mw({ path: '/health', headers: {} }, {}, next1);
      expect(next1).toHaveBeenCalled();

      const next2 = vi.fn();
      await mw({ path: '/docs/v1', headers: {} }, {}, next2);
      expect(next2).toHaveBeenCalled();

      const next3 = vi.fn();
      await mw({ path: '/webhook', headers: {} }, {}, next3);
      expect(next3).toHaveBeenCalled();
    });

    it('triggers onAuthenticated hook on successful verification', async () => {
      const onAuth = vi.fn();
      const mw = createApiKeyMiddleware({
        keys: [{ key: 'wsp_live_authed_key', name: 'WebHook Producer' }],
        onAuthenticated: onAuth,
      });

      const req = { headers: { 'x-api-key': 'wsp_live_authed_key' } };
      await mw(req, {}, vi.fn());

      expect(onAuth).toHaveBeenCalledWith(req, expect.objectContaining({ name: 'WebHook Producer' }));
    });
  });

  describe('Database Integration & Knex Operations', () => {
    let db;
    const testTable = 'test_api_keys';

    beforeAll(async () => {
      db = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      // Run migration template schema
      await db.schema.createTable(testTable, (table) => {
        table.bigIncrements('id').primary();
        table.string('name', 255).notNullable();
        table.string('key_hash', 64).notNullable().unique();
        table.string('key_hint', 64).notNullable();
        table.string('prefix', 32).notNullable().defaultTo('wsp_live_');
        table.bigInteger('user_id').nullable();
        table.json('scopes').nullable();
        table.integer('rate_limit').nullable();
        table.json('metadata').nullable();
        table.timestamp('expires_at').nullable();
        table.timestamp('last_used_at').nullable();
        table.timestamp('revoked_at').nullable();
        table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
      });
    });

    afterAll(async () => {
      await db.destroy();
    });

    it('creates API key record in DB and stores only SHA-256 hash', async () => {
      const plugin = apiKeyPlugin({ db, tableName: testTable });

      const created = await plugin.api.createApiKey({
        name: 'Stripe Webhook Key',
        scopes: ['webhooks:process', 'payments:read'],
        userId: 101,
        metadata: { client: 'stripe-v2' },
      });

      expect(created.key).toMatch(/^wsp_live_/);
      expect(created.record.id).toBeDefined();
      expect(created.record.scopes).toEqual(['webhooks:process', 'payments:read']);

      // Check DB row: raw key MUST NOT be stored, only hash
      const dbRow = await db(testTable).where({ id: created.record.id }).first();
      expect(dbRow).toBeDefined();
      expect(dbRow.key_hash).toBe(hashKey(created.key));
      expect(dbRow.key_hash).not.toContain(created.key);
      expect(dbRow.key_hint.endsWith(created.key.slice(-4))).toBe(true);

      // Verify key via verifyApiKey
      const verified = await plugin.api.verifyApiKey(created.key);
      expect(verified).toBeDefined();
      expect(verified.name).toBe('Stripe Webhook Key');

      // Invalid key returns null
      const failed = await plugin.api.verifyApiKey('wsp_live_completely_fake_key');
      expect(failed).toBeNull();
    });

    it('authenticates request via DB lookup and updates last_used_at asynchronously', async () => {
      const plugin = apiKeyPlugin({ db, tableName: testTable, updateLastUsedThrottleMs: 0 });

      const created = await plugin.api.createApiKey({
        name: 'Mobile SDK Client',
        scopes: ['sync:read'],
      });

      const mw = plugin.api.createMiddleware();
      const req = { headers: { 'x-api-key': created.key }, path: '/api/v1/sync' };
      const next = vi.fn();

      await mw(req, {}, next);
      expect(next).toHaveBeenCalled();
      expect(req.apiKey.name).toBe('Mobile SDK Client');

      // Wait a tick for non-blocking setImmediate last_used_at write
      await wait(50);

      const updatedRow = await db(testTable).where({ id: created.record.id }).first();
      expect(updatedRow.last_used_at).not.toBeNull();
    });

    it('revokes an API key and blocks subsequent verification', async () => {
      const plugin = apiKeyPlugin({ db, tableName: testTable });

      const created = await plugin.api.createApiKey({
        name: 'Temporary Token',
      });

      // Verification before revoke succeeds
      expect(await plugin.api.verifyApiKey(created.key)).not.toBeNull();

      // Revoke by id
      const revoked = await plugin.api.revokeApiKey(created.record.id);
      expect(revoked).toBe(true);

      // Verification after revoke fails
      expect(await plugin.api.verifyApiKey(created.key)).toBeNull();

      // Middleware rejects revoked key with 401
      const mw = plugin.api.createMiddleware();
      const res = createMockSpyRes({
        statusCode: null
      });
      await mw({ headers: { 'x-api-key': created.key }, path: '/api/v1/test' }, res, vi.fn());
      expect(res.statusCode).toBe(401);
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('revoked'));
    });

    it('generates migration template matching table schema', () => {
      const plugin = apiKeyPlugin();
      const template = plugin.api.getMigrationTemplate('custom_keys');
      expect(template).toContain('custom_keys');
      expect(template).toContain("table.string('key_hash', 64).notNullable().unique()");
      expect(template).toContain("table.timestamp('revoked_at')");
    });
  });

  describe('Integration with createApp & File Routes', () => {
    it('registers apiKey factory into ctx.middlewares', () => {
      const p = apiKeyPlugin({ keys: [{ key: 'wsp_live_test' }] });
      const middlewares = {};
      p.register({ middlewares, app: { use: () => {} } });

      expect(typeof middlewares.apiKey).toBe('function');
      const mw = middlewares.apiKey();
      expect(typeof mw).toBe('function');
    });

    it('resolveMiddlewares resolves apiKey tuple with route-level scopes', () => {
      const p = apiKeyPlugin();
      const middlewares = {};
      p.register({ middlewares, app: { use: () => {} } });

      const resolved = resolveMiddlewares(
        [['apiKey', { scopes: ['billing:write'] }]],
        middlewares
      );
      expect(resolved).toHaveLength(1);
      expect(typeof resolved[0]).toBe('function');
    });

    it('protects routes in createApp setupRoutes with named middleware', async () => {
      const testKey = 'wsp_live_partner_integration_key_123';
      const scopedKey = 'wsp_live_readonly_key_456';

      const { app } = createApp({
        pagesDir,
        viewsDir,
        logging: false,
        cache: false,
        lazyRoutes: true,
        plugins: [
          apiKeyPlugin({
            keys: [
              {
                key: testKey,
                name: 'Partner System',
                scopes: ['orders:*', 'analytics:read'],
              },
              {
                key: scopedKey,
                name: 'Readonly Monitor',
                scopes: ['analytics:read'],
              },
            ],
          }),
        ],
        setupRoutes: (router, { middlewares }) => {
          // Standard API key protected route
          router.get('/api/v1/metrics', middlewares.apiKey(), (req, res) => {
            res.json({ success: true, client: req.apiKey.name });
          });

          // Scoped route requiring orders:write
          router.post(
            '/api/v1/orders',
            middlewares.apiKey({ scopes: ['orders:write'] }),
            (req, res) => {
              res.json({ orderCreated: true, by: req.apiKey.name });
            }
          );
        },
      });

      // 1. Without auth -> 401
      const resNoAuth = await request(app).get('/api/v1/metrics');
      expect(resNoAuth.status).toBe(401);

      // 2. With valid auth -> 200
      const resAuthed = await request(app)
        .get('/api/v1/metrics')
        .set('X-API-Key', testKey);
      expect(resAuthed.status).toBe(200);
      expect(resAuthed.body).toEqual({ success: true, client: 'Partner System' });

      // 3. Authorization: Bearer <key> header
      const resBearer = await request(app)
        .get('/api/v1/metrics')
        .set('Authorization', `Bearer ${testKey}`);
      expect(resBearer.status).toBe(200);
      expect(resBearer.body.client).toBe('Partner System');

      // 4. Partner key has orders:* scope -> can access POST /api/v1/orders
      const resOrderSuccess = await request(app)
        .post('/api/v1/orders')
        .set('X-API-Key', testKey);
      expect(resOrderSuccess.status).toBe(200);
      expect(resOrderSuccess.body.orderCreated).toBe(true);

      // 5. Readonly key lacks orders:write scope -> 403 Forbidden
      const resOrderForbidden = await request(app)
        .post('/api/v1/orders')
        .set('X-API-Key', scopedKey);
      expect(resOrderForbidden.status).toBe(403);
      expect(resOrderForbidden.body.error).toBe('Forbidden');
      expect(resOrderForbidden.body.requiredScopes).toEqual(['orders:write']);
    });

    it('protects routes globally when global: true', async () => {
      const globalKey = 'wsp_live_global_system_key';

      const { app } = createApp({
        pagesDir,
        viewsDir,
        logging: false,
        cache: false,
        lazyRoutes: true,
        plugins: [
          apiKeyPlugin({
            global: true,
            routes: ['/api'],
            skipPaths: ['/api/public-health'],
            keys: [{ key: globalKey, name: 'Root System' }],
          }),
        ],
        setupRoutes: (router) => {
          router.get('/api/data', (req, res) => {
            res.json({ ok: true, key: req.apiKey.name });
          });
          router.get('/api/public-health', (req, res) => {
            res.json({ status: 'up' });
          });
        },
      });

      // /api/data without key -> 401
      const resUnauth = await request(app).get('/api/data');
      expect(resUnauth.status).toBe(401);

      // /api/data with key -> 200
      const resAuth = await request(app)
        .get('/api/data')
        .set('X-API-Key', globalKey);
      expect(resAuth.status).toBe(200);
      expect(resAuth.body.key).toBe('Root System');

      // /api/public-health (skipped) -> 200 without key
      const resHealth = await request(app).get('/api/public-health');
      expect(resHealth.status).toBe(200);
      expect(resHealth.body.status).toBe('up');
    });
  });
});
