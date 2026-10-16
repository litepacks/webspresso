/**
 * Targeted Unit Tests for Branch & Function Coverage Across Missing Paths
 *
 * Targets:
 * - core/auth/hash.js
 * - core/events/discovery.js
 * - core/events/signal.js
 * - core/forms/flash.js
 * - plugins/api-key/middleware.js
 * - plugins/admin-panel/core/api-extensions.js
 * - core/queue/manager.js
 * - core/content/service.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 1. Auth Hash Tests
import { hash, verify, needsRehash, generateToken, hashToken } from '../../core/auth/hash.js';

describe('core/auth/hash.js edge cases and branches', () => {
  it('throws on non-string or empty password in hash()', async () => {
    await expect(hash('')).rejects.toThrow('Password must be a non-empty string');
    await expect(hash(null)).rejects.toThrow('Password must be a non-empty string');
    await expect(hash(undefined)).rejects.toThrow('Password must be a non-empty string');
    await expect(hash(12345)).rejects.toThrow('Password must be a non-empty string');
  });

  it('hashes a valid password with custom rounds', async () => {
    const hashed = await hash('mySecurePassword123!', 4);
    expect(hashed).toBeDefined();
    expect(typeof hashed).toBe('string');
    expect(hashed.startsWith('$2')).toBe(true);

    const match = await verify('mySecurePassword123!', hashed);
    expect(match).toBe(true);
  });

  it('returns false for falsy or invalid password/hash in verify()', async () => {
    expect(await verify('', '$2b$04$somevalidlookinghash')).toBe(false);
    expect(await verify('password', '')).toBe(false);
    expect(await verify(null, null)).toBe(false);
    // Invalid hash format caught by try/catch block
    expect(await verify('password', 'not-a-valid-bcrypt-hash')).toBe(false);
  });

  it('checks needsRehash() edge cases', async () => {
    expect(needsRehash('')).toBe(true);
    expect(needsRehash(null)).toBe(true);
    expect(needsRehash('not-a-valid-hash')).toBe(true);

    const hashedRounds4 = await hash('testpass', 4);
    // DESIRED rounds 6 > 4 -> needs rehash
    expect(needsRehash(hashedRounds4, 6)).toBe(true);
    // DESIRED rounds 4 <= 4 -> does not need rehash
    expect(needsRehash(hashedRounds4, 4)).toBe(false);
  });

  it('generates random hex tokens of default and custom byte length', () => {
    const tokenDefault = generateToken();
    expect(typeof tokenDefault).toBe('string');
    expect(tokenDefault.length).toBe(64); // 32 bytes * 2 hex chars

    const token16 = generateToken(16);
    expect(token16.length).toBe(32); // 16 bytes * 2 hex chars
  });

  it('hashes lookup token with sha256', () => {
    const digest1 = hashToken('secret-remember-me-token');
    const digest2 = hashToken('secret-remember-me-token');
    expect(digest1).toBe(digest2);
    expect(digest1.length).toBe(64);
  });
});

// 2. Events Discovery Tests
import { defineListener, filePathToEventName, loadListeners } from '../../core/events/discovery.js';
import { createEventDispatcher } from '../../core/events/dispatcher.js';

describe('core/events/discovery.js edge cases and branches', () => {
  it('throws on invalid event name or non-function handler in defineListener()', () => {
    expect(() => defineListener()).toThrow(TypeError);
    expect(() => defineListener('', () => {})).toThrow(TypeError);
    expect(() => defineListener('order.created', 'not-a-function')).toThrow(TypeError);
  });

  it('creates listener object with options pass-through in defineListener()', () => {
    const fn = (data) => data;
    const def = defineListener('order.created', fn, { sender: 'OrderService', priority: 5, once: true });
    expect(def.event).toBe('order.created');
    expect(def.handle).toBe(fn);
    expect(def.sender).toBe('OrderService');
    expect(def.priority).toBe(5);
    expect(def.once).toBe(true);
  });

  it('converts file path to dot-notation event name in filePathToEventName()', () => {
    expect(filePathToEventName(path.join('order', 'created.js'))).toBe('order.created');
    expect(filePathToEventName(path.join('billing', 'invoices', 'paid.cjs'))).toBe('billing.invoices.paid');
    expect(filePathToEventName('standalone.js')).toBe('standalone');
  });

  it('loadListeners() validates dispatcher and handles non-existent dir', () => {
    expect(() => loadListeners('/some/path', null)).toThrow(TypeError);
    expect(() => loadListeners('/some/path', {})).toThrow(TypeError);

    const dispatcher = createEventDispatcher();
    const result = loadListeners('/non/existent/path/for/sure', dispatcher);
    expect(result).toEqual([]);
  });

  it('loadListeners() loads functions, arrays, multiple events, and skips _ files and test files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-discovery-test-'));
    try {
      const subDir = path.join(tmpDir, 'users');
      fs.mkdirSync(subDir, { recursive: true });

      // 1. Single object with handle
      fs.writeFileSync(
        path.join(tmpDir, 'single.js'),
        `module.exports = {
          event: 'single.event',
          handle: (data) => 'single:' + data
        };`
      );

      // 2. Array of listeners with handler and array of events
      fs.writeFileSync(
        path.join(tmpDir, 'array.js'),
        `module.exports = [
          {
            event: ['multi.one', 'multi.two'],
            handler: (data) => 'multi:' + data,
            priority: 20
          },
          null
        ];`
      );

      // 3. Direct function export (uses filePathToEventName)
      fs.writeFileSync(
        path.join(subDir, 'created.js'),
        `module.exports = function(data) { return 'user-created:' + data; };`
      );

      // 4. Ignored files: prefixed with _ or ending with .test.js
      fs.writeFileSync(path.join(tmpDir, '_ignored.js'), `throw new Error('Should not load');`);
      fs.writeFileSync(path.join(tmpDir, 'example.test.js'), `throw new Error('Should not load');`);

      // 5. Syntax error file with logger option
      fs.writeFileSync(path.join(tmpDir, 'broken.js'), `module.exports = { invalid syntax here`);

      const dispatcher = createEventDispatcher();
      const warnMock = vi.fn();

      const loaded = loadListeners(tmpDir, dispatcher, {
        logger: { warn: warnMock },
      });

      expect(loaded.length).toBeGreaterThanOrEqual(4);
      expect(warnMock).toHaveBeenCalled();

      // Test invoking the loaded handlers through dispatcher
      const received = [];
      dispatcher.on('single.event', (data) => received.push(data));
      dispatcher.emit('single.event', 'test1');
      expect(received).toContain('test1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// 3. Events Signal Tests
import { Signal, defineSignal } from '../../core/events/signal.js';

describe('core/events/signal.js edge cases and branches', () => {
  it('throws on invalid Signal name', () => {
    const dispatcher = createEventDispatcher();
    expect(() => new Signal('', dispatcher)).toThrow(TypeError);
    expect(() => new Signal(null, dispatcher)).toThrow(TypeError);
    expect(() => new Signal(123, dispatcher)).toThrow(TypeError);
  });

  it('supports connect, send, disconnect, sendAsync, and sendSerial', async () => {
    const dispatcher = createEventDispatcher();
    const sig = new Signal('order_completed', dispatcher);

    const calls = [];
    const receiver1 = (data) => {
      calls.push(`r1:${data}`);
      return 'val1';
    };
    const receiver2 = async (data) => {
      calls.push(`r2:${data}`);
      return 'val2';
    };

    sig.connect(receiver1);
    sig.connect(receiver2);

    // Sync send
    const sent = sig.send('order#1');
    expect(sent).toBe(true);
    expect(calls).toContain('r1:order#1');
    expect(calls).toContain('r2:order#1');

    // Async send
    const asyncResults = await sig.sendAsync('order#2');
    expect(asyncResults).toHaveLength(2);

    // Serial send
    const serialResults = await sig.sendSerial('order#3');
    expect(serialResults).toHaveLength(2);

    // Disconnect receiver1
    sig.disconnect(receiver1);
    calls.length = 0;
    sig.send('order#4');
    expect(calls).not.toContain('r1:order#4');
    expect(calls).toContain('r2:order#4');
  });

  it('defineSignal() initializes a Signal instance', () => {
    const sig = defineSignal('custom_signal');
    expect(sig).toBeInstanceOf(Signal);
    expect(sig.name).toBe('custom_signal');
  });
});

// 4. Forms Flash Tests
import {
  normalizeErrors,
  createFlashMiddleware,
  FLASH_SESSION_KEY,
  FLASH_COOKIE_NAME,
} from '../../core/forms/flash.js';

describe('core/forms/flash.js edge cases and branches', () => {
  it('normalizeErrors() covers all error shapes', () => {
    expect(normalizeErrors(null)).toEqual({});
    expect(normalizeErrors(undefined)).toEqual({});

    // ZodError issues array
    const zodIssues = {
      issues: [
        { path: ['user', 'name'], message: 'Name is required' },
        { path: [], message: 'General form issue' },
      ],
    };
    expect(normalizeErrors(zodIssues)).toEqual({
      'user.name': ['Name is required'],
      _form: ['General form issue'],
    });

    // Object with flatten()
    const flattener = {
      flatten: () => ({
        fieldErrors: { email: ['Invalid format'] },
        formErrors: ['Global error'],
      }),
    };
    expect(normalizeErrors(flattener)).toEqual({
      email: ['Invalid format'],
      _form: ['Global error'],
    });

    // Simple string
    expect(normalizeErrors('Database timeout')).toEqual({
      _form: ['Database timeout'],
    });

    // Array of strings and error objects
    expect(normalizeErrors(['Error 1', { message: 'Error 2' }, new Error('Error 3')])).toEqual({
      _form: ['Error 1', 'Error 2', 'Error 3'],
    });

    // Plain object with various value types
    const objErrors = {
      title: ['Title too short'],
      code: 'Code required',
      nested: { message: 'Nested error' },
      num: 404,
    };
    expect(normalizeErrors(objErrors)).toEqual({
      title: ['Title too short'],
      code: ['Code required'],
      nested: ['Nested error'],
      num: ['404'],
    });

    // Non-object primitive fallback
    expect(normalizeErrors(999)).toEqual({
      _form: ['999'],
    });
  });

  it('createFlashMiddleware() with session backend and old inputs sanitization', () => {
    const middleware = createFlashMiddleware();

    const req = {
      session: {
        [FLASH_SESSION_KEY]: {
          old: { username: 'johndoe', email: 'john@example.com' },
          notice: 'Welcome back!',
        },
      },
      body: {
        username: 'newuser',
        password: 'supersecretpassword',
        password_confirmation: 'supersecretpassword',
        confirmPassword: 'supersecretpassword',
        _csrf: 'token123',
        bio: 'Hello world',
      },
    };

    const res = {
      headers: {},
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    const next = vi.fn();
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // Incoming flash consumed from session
    expect(req.session[FLASH_SESSION_KEY]).toBeUndefined();

    // req.flash()
    expect(req.flash()).toEqual({
      old: { username: 'johndoe', email: 'john@example.com' },
      notice: 'Welcome back!',
    });
    expect(req.flash('notice')).toBe('Welcome back!');

    // req.old()
    expect(req.old('username')).toBe('johndoe');
    expect(req.old('missing', 'defaultVal')).toBe('defaultVal');
    expect(req.old()).toEqual({ username: 'johndoe', email: 'john@example.com' });

    // res.withInput() sanitizes passwords and csrf
    res.withInput();
    expect(req.session[FLASH_SESSION_KEY].old).toEqual({
      username: 'newuser',
      bio: 'Hello world',
    });

    // res.withErrors()
    res.withErrors('Invalid submission');
    expect(req.session[FLASH_SESSION_KEY].errors).toEqual({
      _form: ['Invalid submission'],
    });

    // res.withFlash()
    res.withFlash('success', 'Profile updated');
    expect(req.session[FLASH_SESSION_KEY].success).toBe('Profile updated');
  });

  it('createFlashMiddleware() with cookie backend and header deduplication', () => {
    const middleware = createFlashMiddleware({ cookieName: '__custom_flash' });

    // Base64url encoded JSON: {"welcome":"hello"}
    const rawCookie = Buffer.from(JSON.stringify({ welcome: 'hello' })).toString('base64url');

    const req = {
      cookies: {
        __custom_flash: rawCookie,
      },
    };

    let setCookieHeader = [`__custom_flash=old; Path=/`, `other=1; Path=/`];
    const res = {
      headers: {},
      setHeader: vi.fn((k, v) => {
        setCookieHeader = v;
      }),
      getHeader: vi.fn((k) => (k === 'Set-Cookie' ? setCookieHeader : null)),
      removeHeader: vi.fn(),
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    const next = vi.fn();
    middleware(req, res, next);

    expect(res.clearCookie).toHaveBeenCalledWith('__custom_flash', { path: '/' });
    expect(req.flash('welcome')).toBe('hello');

    // Setting outgoing flash on cookie mode
    res.withFlash('alert', 'Warning message');
    expect(res.cookie).toHaveBeenCalledWith(
      '__custom_flash',
      expect.any(String),
      expect.objectContaining({ path: '/', httpOnly: true })
    );
  });
});

// 5. API Key Middleware Tests
import {
  shouldApplyToRoute,
  isSkipped,
  extractApiKey,
  createApiKeyMiddleware,
  sendUnauthorized,
  sendForbidden,
} from '../../plugins/api-key/middleware.js';

describe('plugins/api-key/middleware.js edge cases and branches', () => {
  it('shouldApplyToRoute() checks prefix matches and defaults', () => {
    expect(shouldApplyToRoute('/api/test', true)).toBe(true);
    expect(shouldApplyToRoute('/api/test', null)).toBe(true);
    expect(shouldApplyToRoute('/api/test', '/api')).toBe(true);
    expect(shouldApplyToRoute('/web/test', '/api')).toBe(false);
    expect(shouldApplyToRoute('/v1/test', ['/api', '/v1'])).toBe(true);
    expect(shouldApplyToRoute('/v2/test', ['/api', '/v1'])).toBe(false);
  });

  it('isSkipped() handles predicate function and string prefixes', () => {
    const req1 = { path: '/health', url: '/health' };
    expect(isSkipped(req1, [], (r) => r.path === '/health')).toBe(true);
    expect(isSkipped(req1, ['/health'])).toBe(true);
    expect(isSkipped(req1, ['/api'])).toBe(false);
  });

  it('extractApiKey() handles all header variants and query param', () => {
    // 1. Custom extractKey
    expect(extractApiKey({}, { extractKey: () => ' custom-extracted ' })).toBe('custom-extracted');

    // 2. Custom header
    expect(
      extractApiKey(
        { headers: { 'x-my-token': ' header-val ' } },
        { headerName: 'X-My-Token' }
      )
    ).toBe('header-val');

    // 3. x-api-key header
    expect(extractApiKey({ headers: { 'x-api-key': 'key-1' } })).toBe('key-1');

    // 4. api-key header
    expect(extractApiKey({ headers: { 'api-key': 'key-2' } })).toBe('key-2');

    // 5. Authorization Bearer
    expect(extractApiKey({ headers: { authorization: 'Bearer tok-bearer' } })).toBe('tok-bearer');

    // 6. Authorization ApiKey
    expect(extractApiKey({ headers: { authorization: 'ApiKey tok-apikey' } })).toBe('tok-apikey');

    // 7. Authorization Api-Key
    expect(extractApiKey({ headers: { authorization: 'Api-Key tok-api-key' } })).toBe('tok-api-key');

    // 8. Query parameter
    expect(
      extractApiKey(
        { query: { apiKey: 'query-key' } },
        { allowQueryParam: true }
      )
    ).toBe('query-key');

    expect(
      extractApiKey(
        { query: { token: 'query-token' } },
        { allowQueryParam: true, queryParamName: 'token' }
      )
    ).toBe('query-token');

    // 9. None
    expect(extractApiKey({})).toBe(null);
  });

  it('sendUnauthorized() and sendForbidden() handle custom fn, object, string, json, and plain text', () => {
    const makeRes = () => {
      let body = '';
      return {
        statusCode: 200,
        headers: {},
        setHeader: vi.fn(),
        end: vi.fn((b) => {
          body = b;
        }),
        getBody: () => body,
      };
    };

    // sendUnauthorized with custom fn
    const res1 = makeRes();
    const customFn = vi.fn();
    sendUnauthorized({}, res1, { unauthorizedResponse: customFn }, 'Custom msg');
    expect(customFn).toHaveBeenCalled();

    // sendUnauthorized with custom object
    const res2 = makeRes();
    sendUnauthorized({}, res2, { unauthorizedResponse: { error: 'denied' } });
    expect(res2.statusCode).toBe(401);
    expect(JSON.parse(res2.getBody())).toEqual({ error: 'denied' });

    // sendUnauthorized with custom string
    const res3 = makeRes();
    sendUnauthorized({}, res3, { unauthorizedResponse: 'Please login' });
    expect(res3.getBody()).toBe('Please login');

    // sendForbidden with json request
    const res4 = makeRes();
    sendForbidden({ path: '/api/resource' }, res4, {}, 'No permission', { requiredScopes: ['admin'] });
    expect(res4.statusCode).toBe(403);
    const jsonParsed = JSON.parse(res4.getBody());
    expect(jsonParsed.error).toBe('Forbidden');
    expect(jsonParsed.requiredScopes).toEqual(['admin']);
  });

  it('createApiKeyMiddleware() handles optional keys, revoked, expired, scopes, and user lookup', async () => {
    // 1. Optional key pass-through
    const optionalMw = createApiKeyMiddleware({ optional: true });
    const next1 = vi.fn();
    await optionalMw({ path: '/api/public' }, {}, next1);
    expect(next1).toHaveBeenCalled();

    // 2. Static keys with revoked key
    const revokedMw = createApiKeyMiddleware({
      keys: [{ key: 'revoked-key', is_active: false }],
    });
    const resRevoked = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    await revokedMw({ path: '/api/test', headers: { 'x-api-key': 'revoked-key' } }, resRevoked, vi.fn());
    expect(resRevoked.statusCode).toBe(401);

    // 3. Expired key
    const expiredMw = createApiKeyMiddleware({
      keys: [{ key: 'expired-key', expires_at: new Date(Date.now() - 60000).toISOString() }],
    });
    const resExpired = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    await expiredMw({ path: '/api/test', headers: { 'x-api-key': 'expired-key' } }, resExpired, vi.fn());
    expect(resExpired.statusCode).toBe(401);

    // 4. Missing required scopes
    const scopedMw = createApiKeyMiddleware({
      keys: [{ key: 'scoped-key', scopes: 'read' }],
      scopes: ['write', 'admin'],
      requireAllScopes: true,
    });
    const resScoped = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    await scopedMw({ path: '/api/test', headers: { 'x-api-key': 'scoped-key' } }, resScoped, vi.fn());
    expect(resScoped.statusCode).toBe(403);

    // 5. Successful authentication with user and onAuthenticated hook
    const onAuth = vi.fn();
    const successMw = createApiKeyMiddleware({
      keys: [{ key: 'valid-key', scopes: ['read', 'write'], user: { id: 42, role: 'admin' } }],
      scopes: 'read',
      onAuthenticated: onAuth,
    });
    const reqSuccess = { path: '/api/test', headers: { 'x-api-key': 'valid-key' } };
    const nextSuccess = vi.fn();
    await successMw(reqSuccess, {}, nextSuccess);

    expect(nextSuccess).toHaveBeenCalled();
    expect(onAuth).toHaveBeenCalled();
    expect(reqSuccess.apiKey).toBeDefined();
    expect(reqSuccess.user).toEqual({ id: 42, role: 'admin' });
  });
});

// 6. Admin Panel API Extensions Tests
import {
  compareSemver,
  formatUptime,
  formatBytes,
  buildFilteredQuery,
} from '../../plugins/admin-panel/core/api-extensions.js';

describe('plugins/admin-panel/core/api-extensions.js edge cases and branches', () => {
  it('compareSemver() compares semantic version strings correctly', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
    expect(compareSemver('1.1.9', '1.2.0')).toBe(-1);
    expect(compareSemver('v2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver(null, '1.0.0')).toBe(0);
  });

  it('formatUptime() formats durations into human-readable strings', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptime(3665)).toBe('1h 1m 5s');
    expect(formatUptime(90065)).toBe('1d 1h 1m 5s');
  });

  it('formatBytes() formats byte counts to MB', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(null)).toBe('0 MB');
    expect(formatBytes(10485760)).toBe('10.0 MB');
  });

  it('buildFilteredQuery() applies filter operators to query builder', () => {
    const mockQuery = {
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      onlyTrashed: vi.fn().mockReturnThis(),
    };
    const mockRepo = { query: () => mockQuery };

    // onlyTrashed
    buildFilteredQuery(mockRepo, {}, { onlyTrashed: true });
    expect(mockQuery.onlyTrashed).toHaveBeenCalled();

    // Empty filters returns query directly
    const resEmpty = buildFilteredQuery(mockRepo, null);
    expect(resEmpty).toBe(mockQuery);

    // Various filter operators
    const filters = {
      f1: { op: 'is_null' },
      f2: { op: 'is_not_null' },
      f3: { op: 'contains', value: 'needle' },
      f4: { op: 'equals', value: 'exact' },
      f5: { op: 'starts_with', value: 'prefix' },
      f6: { op: 'ends_with', value: 'suffix' },
      f7: { op: 'eq', value: 'val' },
      f8: { op: 'gt', value: 10 },
      f9: { op: 'gte', value: 20 },
      f10: { op: 'lt', value: 30 },
      f11: { op: 'lte', value: 40 },
      f12: { op: 'between', from: 5, to: 15 },
      f13: { op: 'in', value: ['a', 'b', 'c'] },
      f14: { op: 'contains', value: '' }, // Should be skipped
    };

    buildFilteredQuery(mockRepo, filters);

    expect(mockQuery.whereNull).toHaveBeenCalledWith('f1');
    expect(mockQuery.whereNotNull).toHaveBeenCalledWith('f2');
    expect(mockQuery.where).toHaveBeenCalledWith('f3', 'like', '%needle%');
    expect(mockQuery.where).toHaveBeenCalledWith('f4', '=', 'exact');
    expect(mockQuery.where).toHaveBeenCalledWith('f5', 'like', 'prefix%');
    expect(mockQuery.where).toHaveBeenCalledWith('f6', 'like', '%suffix');
    expect(mockQuery.where).toHaveBeenCalledWith('f7', '=', 'val');
    expect(mockQuery.where).toHaveBeenCalledWith('f8', '>', 10);
    expect(mockQuery.where).toHaveBeenCalledWith('f9', '>=', 20);
    expect(mockQuery.where).toHaveBeenCalledWith('f10', '<', 30);
    expect(mockQuery.where).toHaveBeenCalledWith('f11', '<=', 40);
    expect(mockQuery.where).toHaveBeenCalledWith('f12', '>=', 5);
    expect(mockQuery.where).toHaveBeenCalledWith('f12', '<=', 15);
    expect(mockQuery.whereIn).toHaveBeenCalledWith('f13', ['a', 'b', 'c']);
  });
});

// 7. Queue Manager Tests
import { QueueManager } from '../../core/queue/manager.js';

describe('core/queue/manager.js edge cases and branches', () => {
  it('validates define() input parameters', () => {
    const qm = new QueueManager({ autoStart: false });
    expect(() => qm.define('', () => {})).toThrow('Job name must be a non-empty string');
    expect(() => qm.define('test', 'not-a-fn')).toThrow('Job handler for \'test\' must be a function');

    qm.define('email.send', async () => 'sent');
    expect(qm.has('email.send')).toBe(true);
    expect(qm.has('email.unknown')).toBe(false);
  });

  it('handles pause, resume, stop, drain and retention config', async () => {
    const qm = new QueueManager({
      autoStart: false,
      retentionDays: 14,
      autoCleanup: false,
    });

    const retentionConfig = qm.getRetentionConfig();
    expect(retentionConfig.days).toBe(14);
    expect(retentionConfig.enabled).toBe(false);

    qm.start();
    expect(qm.isRunning).toBe(true);

    qm.pause();
    expect(qm.isPaused).toBe(true);

    qm.resume();
    expect(qm.isPaused).toBe(false);

    await qm.drain();
    expect(qm.isDraining).toBe(false);

    await qm.stop();
    expect(qm.isRunning).toBe(false);
  });

  it('dispatches jobs with delay, priority, attempts, and timeout', async () => {
    const qm = new QueueManager({ autoStart: false });
    qm.define('task.heavy', async (job) => job.data, {
      attempts: 5,
      timeout: 10000,
      priority: 2,
    });

    const job = await qm.dispatch('task.heavy', { file: 'data.csv' }, {
      delay: 500,
      priority: 1,
    });

    expect(job).toBeDefined();
    expect(job.name).toBe('task.heavy');
    expect(job.data).toEqual({ file: 'data.csv' });
    expect(job.priority).toBe(1);

    const stats = await qm.getStats();
    expect(stats.registeredJobs).toContain('task.heavy');
    expect(stats.concurrency).toBe(qm.concurrency);
  });

  it('manages cron schedules, triggers, clean, and auto-cleanup lifecycle', async () => {
    const qm = new QueueManager({ autoStart: false });
    qm.define('backup.daily', async () => 'done');

    // schedule & cron alias
    const sched = qm.schedule('0 0 * * *', 'backup.daily', { db: 'prod' });
    expect(sched).toBeDefined();
    expect(qm.getSchedules()).toHaveLength(1);
    expect(qm.getSchedule('backup.daily')).toBeDefined();

    // triggerSchedule & triggerCron alias
    const triggered = await qm.triggerSchedule('backup.daily');
    expect(triggered).toBeDefined();

    const triggeredAlias = await qm.triggerCron('backup.daily');
    expect(triggeredAlias).toBeDefined();

    // unschedule
    const removed = qm.unschedule('backup.daily');
    expect(removed).toBe(true);
    expect(qm.getSchedules()).toHaveLength(0);

    // clean() delegating to adapter
    const cleaned = await qm.clean({ days: 30 });
    expect(typeof cleaned).toBe('number');

    // runCleanup()
    const cleanedCount = await qm.runCleanup();
    expect(typeof cleanedCount).toBe('number');

    // startCleanup() and stopCleanup()
    qm.startCleanup(1000);
    qm.stopCleanup();
  });

  it('loadJobsFromDirectory() discovers recursive job and cron files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jobs-dir-'));
    try {
      const subDir = path.join(tmpDir, 'reports');
      fs.mkdirSync(subDir, { recursive: true });

      // Regular job file
      fs.writeFileSync(
        path.join(tmpDir, 'send-email.js'),
        `module.exports = async function(job) { return 'sent'; };`
      );

      // Job with handler and schedule
      fs.writeFileSync(
        path.join(subDir, 'weekly.js'),
        `module.exports = {
          handler: async function(job) { return 'weekly report'; },
          schedule: '0 9 * * 1',
          options: { attempts: 2 }
        };`
      );

      // .cron.js file
      fs.writeFileSync(
        path.join(subDir, 'daily.cron.js'),
        `module.exports = {
          handler: async function(job) { return 'daily sync'; },
          expression: '0 0 * * *'
        };`
      );

      const qm = new QueueManager({ autoStart: false, jobsDir: tmpDir });
      expect(qm.has('send-email')).toBe(true);
      expect(qm.has('reports.weekly')).toBe(true);
      expect(qm.has('reports.daily')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// 8. API Key Middleware Helper Tests
import { resolveKnex } from '../../plugins/api-key/middleware.js';

describe('plugins/api-key/middleware.js resolveKnex and custom hooks', () => {
  it('resolveKnex() checks knex, db function, db.knex, and req.db', () => {
    const fakeKnex = { select: vi.fn() };

    expect(resolveKnex({ knex: fakeKnex })).toBe(fakeKnex);
    expect(resolveKnex({ db: () => fakeKnex })).toBeInstanceOf(Function);
    expect(resolveKnex({ db: { knex: fakeKnex } })).toBe(fakeKnex);

    const reqKnex = { reqKnex: true };
    expect(resolveKnex({}, { db: () => reqKnex })).toBeInstanceOf(Function);
    expect(resolveKnex({}, { db: { knex: reqKnex } })).toBe(reqKnex);
    expect(resolveKnex({}, {})).toBe(null);
  });

  it('createApiKeyMiddleware() handles custom verify, custom findKeyByHash, and skip predicate', async () => {
    // 1. Skip predicate returns true
    const skipMw = createApiKeyMiddleware({
      skip: (req) => req.url === '/skip-me',
    });
    const nextSkip = vi.fn();
    await skipMw({ url: '/skip-me', path: '/skip-me' }, {}, nextSkip);
    expect(nextSkip).toHaveBeenCalled();

    // 2. Custom verify function
    const customVerifyMw = createApiKeyMiddleware({
      verify: async (rawKey) => {
        if (rawKey === 'super-secret') {
          return { id: 10, scopes: ['read'] };
        }
        return null;
      },
    });
    const reqCustom = { path: '/api/v1', headers: { 'x-api-key': 'super-secret' } };
    const nextCustom = vi.fn();
    await customVerifyMw(reqCustom, {}, nextCustom);
    expect(nextCustom).toHaveBeenCalled();
    expect(reqCustom.apiKey.id).toBe(10);

    // 3. Custom findKeyByHash function
    const customHashMw = createApiKeyMiddleware({
      findKeyByHash: async (hash) => {
        if (hash) {
          return { id: 20, scopes: ['admin'] };
        }
        return null;
      },
    });
    const reqHash = { path: '/api/v1', headers: { 'x-api-key': 'any-key' } };
    const nextHash = vi.fn();
    await customHashMw(reqHash, {}, nextHash);
    expect(nextHash).toHaveBeenCalled();
    expect(reqHash.apiKey.id).toBe(20);
  });
});

// 9. Content Service Tests
import { createContentService } from '../../core/content/service.js';

function createMockContentDb() {
  const types = [];
  let nextTypeId = 1;
  const entries = [];
  let nextEntryId = 1;

  const typeRepo = {
    findById: vi.fn(async (id) => types.find((t) => t.id === Number(id)) || null),
    findOne: vi.fn(async (crit) => types.find((t) => Object.entries(crit).every(([k, v]) => t[k] === v)) || null),
    create: vi.fn(async (data) => {
      const row = { id: nextTypeId++, ...data };
      types.push(row);
      return row;
    }),
    update: vi.fn(async (id, patch) => {
      const idx = types.findIndex((t) => t.id === Number(id));
      if (idx !== -1) {
        types[idx] = { ...types[idx], ...patch };
        return types[idx];
      }
      return null;
    }),
    delete: vi.fn(async (id) => {
      const idx = types.findIndex((t) => t.id === Number(id));
      if (idx !== -1) {
        types.splice(idx, 1);
        return 1;
      }
      return 0;
    }),
  };

  const entryRepo = {
    findById: vi.fn(async (id) => entries.find((e) => e.id === Number(id)) || null),
    findOne: vi.fn(async (crit) => entries.find((e) => Object.entries(crit).every(([k, v]) => e[k] === v)) || null),
    create: vi.fn(async (data) => {
      const row = { id: nextEntryId++, updated_at: new Date(), ...data };
      entries.push(row);
      return row;
    }),
    update: vi.fn(async (id, patch) => {
      const idx = entries.findIndex((e) => e.id === Number(id));
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], ...patch, updated_at: new Date() };
        return entries[idx];
      }
      return null;
    }),
    delete: vi.fn(async (id) => {
      const idx = entries.findIndex((e) => e.id === Number(id));
      if (idx !== -1) {
        entries.splice(idx, 1);
        return 1;
      }
      return 0;
    }),
  };

  return {
    getRepository: vi.fn((name) => {
      if (name === 'ContentType') return typeRepo;
      if (name === 'ContentEntry') return entryRepo;
      return null;
    }),
    query: vi.fn((name) => {
      let filtered = name === 'ContentType' ? [...types] : [...entries];
      return {
        where: vi.fn(function (crit, op, val) {
          if (typeof crit === 'object') {
            filtered = filtered.filter((item) => Object.entries(crit).every(([k, v]) => item[k] === v));
          } else if (op === '=' || op === undefined) {
            filtered = filtered.filter((item) => item[crit] === val);
          }
          return this;
        }),
        orderBy: vi.fn(function () {
          return this;
        }),
        list: vi.fn(async () => filtered),
      };
    }),
  };
}

describe('core/content/service.js comprehensive coverage', () => {
  it('throws when initialized without a database', () => {
    expect(() => createContentService(null)).toThrow('createContentService requires a database instance');
  });

  it('manages content types CRUD and caching', async () => {
    const db = createMockContentDb();
    const service = createContentService(db);

    // 1. Create content type with invalid slug throws
    await expect(service.createType({ slug: 'Invalid Slug!', name: 'Article', schema: { fields: [] } })).rejects.toThrow(
      'Invalid content type slug'
    );

    // 2. Create valid content type
    const articleType = await service.createType({
      slug: 'articles',
      name: 'Articles',
      schema: { fields: [{ name: 'content', type: 'text', required: true }] },
    });
    expect(articleType).toBeDefined();
    expect(articleType.slug).toBe('articles');

    // 3. Duplicate slug throws
    await expect(
      service.createType({ slug: 'articles', name: 'Articles 2', schema: { fields: [] } })
    ).rejects.toThrow('Content type "articles" already exists');

    // 4. listTypes() and cache hit
    const typesList = await service.listTypes();
    expect(typesList).toHaveLength(1);
    const typesListCached = await service.listTypes();
    expect(typesListCached).toHaveLength(1);

    // 5. getTypeById with number and string id
    const byId = await service.getTypeById(articleType.id);
    expect(byId.name).toBe('Articles');
    const byStrId = await service.getTypeById(String(articleType.id));
    expect(byStrId.name).toBe('Articles');

    // 6. getTypeBySlug
    const bySlug = await service.getTypeBySlug('articles');
    expect(bySlug.id).toBe(articleType.id);

    // 7. updateType() non-existent throws
    await expect(service.updateType(999, { name: 'Non-existent' })).rejects.toThrow('Content type not found');

    // 8. updateType() invalid slug throws
    await expect(service.updateType(articleType.id, { slug: 'Bad Slug!' })).rejects.toThrow(
      'Invalid content type slug'
    );

    // 9. updateType() valid update
    const updatedType = await service.updateType(articleType.id, {
      name: 'Published Articles',
      description: 'News and blog posts',
    });
    expect(updatedType.name).toBe('Published Articles');
  });

  it('manages content entries CRUD, validation, and status', async () => {
    const db = createMockContentDb();
    const service = createContentService(db);

    const postType = await service.createType({
      slug: 'posts',
      name: 'Posts',
      schema: { fields: [{ name: 'summary', type: 'text', required: false }] },
    });

    // 1. Create entry for non-existent type throws
    await expect(
      service.createEntry('unknown-type', { slug: 'my-post', title: 'My Post' })
    ).rejects.toThrow('Content type "unknown-type" not found');

    // 2. Create entry with invalid slug throws
    await expect(
      service.createEntry('posts', { slug: 'Invalid Slug!', title: 'My Post' })
    ).rejects.toThrow('Invalid entry slug');

    // 3. Create valid entry
    const entry = await service.createEntry('posts', {
      slug: 'first-post',
      title: 'First Post',
      data: { summary: 'A short summary' },
      status: 'draft',
    });
    expect(entry).toBeDefined();
    expect(entry.slug).toBe('first-post');
    expect(entry.status).toBe('draft');

    // 4. Duplicate entry slug throws
    await expect(
      service.createEntry('posts', { slug: 'first-post', title: 'First Post Duplicate' })
    ).rejects.toThrow('Entry "first-post" already exists for this content type');

    // 5. listEntries()
    const entriesList = await service.listEntries('posts', { status: 'draft' });
    expect(entriesList).toHaveLength(1);

    // 6. getEntry() with includeDraft: false -> null (since status is draft)
    const published = await service.getEntry('posts', 'first-post', { includeDraft: false });
    expect(published).toBe(null);

    // 7. getEntry() with includeDraft: true
    const draft = await service.getEntry('posts', 'first-post', { includeDraft: true });
    expect(draft).toBeDefined();
    expect(draft.meta.title).toBe('First Post');

    // 8. getEntryById()
    const entryById = await service.getEntryById(entry.id);
    expect(entryById).toBeDefined();
    expect(entryById.entry.slug).toBe('first-post');

    // 9. updateEntry()
    const updatedEntry = await service.updateEntry(entry.id, {
      title: 'Updated Post Title',
      status: 'published',
    });
    expect(updatedEntry.title).toBe('Updated Post Title');
    expect(updatedEntry.status).toBe('published');

    // 10. deleteEntry()
    const deleted = await service.deleteEntry(entry.id);
    expect(deleted).toEqual({ success: true });

    // 11. deleteType() cascade
    const deletedType = await service.deleteType(postType.id);
    expect(deletedType).toEqual({ success: true });
  });
});

// 10. Content Field Types Tests
import {
  isValidFieldType,
  normalizeFieldValue,
  toAdminCustomField,
} from '../../core/content/field-types.js';

describe('core/content/field-types.js edge cases and branches', () => {
  it('isValidFieldType() verifies valid and invalid types', () => {
    expect(isValidFieldType('text')).toBe(true);
    expect(isValidFieldType('repeater')).toBe(true);
    expect(isValidFieldType('invalid-type')).toBe(false);
  });

  it('normalizeFieldValue() handles required and null defaults', () => {
    expect(() => normalizeFieldValue(null, { name: 'title', required: true })).toThrow('Field "title" is required');
    expect(normalizeFieldValue(null, { name: 'bio', type: 'text' })).toBe(null);
    expect(normalizeFieldValue(undefined, { name: 'items', type: 'repeater' })).toEqual([]);
  });

  it('normalizeFieldValue() validates and normalizes all field types', () => {
    // text / textarea
    expect(normalizeFieldValue('hello', { name: 't', type: 'text' })).toBe('hello');
    expect(() => normalizeFieldValue(123, { name: 't', type: 'text' })).toThrow('Field "t" must be a string');

    // rich-text with sanitize option
    const sanitizer = (html) => html.replace(/<script.*?>.*?<\/script>/gi, '');
    expect(
      normalizeFieldValue('<p>hi</p><script>alert(1)</script>', { name: 'rt', type: 'rich-text' }, { sanitizeRichHtml: sanitizer })
    ).toBe('<p>hi</p>');

    // number
    expect(normalizeFieldValue('42', { name: 'n', type: 'number' })).toBe(42);
    expect(() => normalizeFieldValue('not-a-number', { name: 'n', type: 'number' })).toThrow('Field "n" must be a number');

    // boolean
    expect(normalizeFieldValue('true', { name: 'b', type: 'boolean' })).toBe(true);
    expect(normalizeFieldValue('0', { name: 'b', type: 'boolean' })).toBe(false);
    expect(() => normalizeFieldValue('invalid', { name: 'b', type: 'boolean' })).toThrow('Field "b" must be a boolean');

    // image / url
    expect(normalizeFieldValue('https://example.com/pic.png', { name: 'u', type: 'url' })).toBe('https://example.com/pic.png');
    expect(() => normalizeFieldValue('invalid-url', { name: 'u', type: 'url' })).toThrow('Field "u" must be a valid URL');

    // date
    expect(normalizeFieldValue('2026-10-16', { name: 'd', type: 'date' })).toBe('2026-10-16');
    expect(() => normalizeFieldValue('16/10/2026', { name: 'd', type: 'date' })).toThrow('must be a valid date');

    // select
    expect(normalizeFieldValue('draft', { name: 's', type: 'select', options: ['draft', 'published'] })).toBe('draft');
    expect(() => normalizeFieldValue('archived', { name: 's', type: 'select', options: ['draft', 'published'] })).toThrow('must be one of: draft, published');

    // repeater
    expect(() => normalizeFieldValue('not-array', { name: 'rep', type: 'repeater' })).toThrow('must be an array');
    const repeaterRes = normalizeFieldValue(
      [{ title: 'Row 1' }],
      { name: 'rep', type: 'repeater', fields: [{ name: 'title', type: 'text' }] }
    );
    expect(repeaterRes).toEqual([{ title: 'Row 1' }]);

    // unknown type throws
    expect(() => normalizeFieldValue('val', { name: 'x', type: 'unknown_xyz' })).toThrow('Unknown field type');
  });

  it('toAdminCustomField() maps types to admin UI fields', () => {
    expect(toAdminCustomField({ type: 'rich-text' })).toEqual({ type: 'rich-text' });
    expect(toAdminCustomField({ type: 'image' })).toEqual({ type: 'file-upload' });
    expect(toAdminCustomField({ type: 'textarea' })).toEqual({ type: 'text' });
    expect(toAdminCustomField({ type: 'select', options: ['a', 'b'] })).toEqual({ type: 'enum', options: ['a', 'b'] });
    expect(toAdminCustomField({ type: 'unknown' })).toBe(null);
  });
});

// 11. Realtime Errors Tests
import {
  RealtimeError,
  normalizeRealtimeError,
  sanitizeErrorMessage,
} from '../../core/realtime/errors.js';

describe('core/realtime/errors.js edge cases and branches', () => {
  it('sanitizeErrorMessage() strips query tokens, Bearer, and Basic credentials', () => {
    expect(sanitizeErrorMessage(null)).toBe('');
    expect(sanitizeErrorMessage('https://api.test?token=secret123&other=val')).toContain('token=***');
    expect(sanitizeErrorMessage('Authorization: Bearer mySecretToken12345')).toBe('Authorization: Bearer ***');
    expect(sanitizeErrorMessage('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic ***');
  });

  it('RealtimeError creates sanitized error with optional cause and toJSON', () => {
    const errWithCause = new RealtimeError('AUTH_FAILED', 'Failed with ?key=secret', new Error('Underlying socket error'));
    expect(errWithCause.code).toBe('AUTH_FAILED');
    expect(errWithCause.message).toContain('?key=***');
    expect(errWithCause.cause).toBeDefined();

    const json = errWithCause.toJSON();
    expect(json.code).toBe('AUTH_FAILED');
    expect(json.cause).toBe('Underlying socket error');
  });

  it('normalizeRealtimeError() handles RealtimeError, Error, string, and unknown objects', () => {
    const custom = new RealtimeError('CODE_1', 'msg');
    expect(normalizeRealtimeError(custom)).toBe(custom);

    const standardErr = new Error('Database disconnected');
    standardErr.code = 'DB_DISCONNECT';
    const normalized = normalizeRealtimeError(standardErr);
    expect(normalized.code).toBe('DB_DISCONNECT');
    expect(normalized.message).toBe('Database disconnected');

    const strNorm = normalizeRealtimeError('Something broke');
    expect(strNorm.code).toBe('REALTIME_ERROR');
    expect(strNorm.message).toBe('Something broke');

    const objNorm = normalizeRealtimeError(null);
    expect(objNorm.code).toBe('REALTIME_ERROR');
  });
});

// 12. Realtime Emitter Tests
import { EventEmitter as RealtimeEmitter } from '../../core/realtime/emitter.js';

describe('core/realtime/emitter.js edge cases and branches', () => {
  it('validates on/once handler parameters and manages subscriptions', () => {
    const emitter = new RealtimeEmitter();

    expect(() => emitter.on('test', null)).toThrow(TypeError);
    expect(() => emitter.once('test', null)).toThrow(TypeError);

    const calls = [];
    const unsub = emitter.on('event1', (data) => calls.push(data));
    emitter.emit('event1', 'first');
    expect(calls).toEqual(['first']);

    unsub();
    emitter.emit('event1', 'second');
    expect(calls).toEqual(['first']); // Not called after unsub

    // once() listener
    const onceCalls = [];
    emitter.once('event2', (data) => onceCalls.push(data));
    emitter.emit('event2', 'once-1');
    emitter.emit('event2', 'once-2');
    expect(onceCalls).toEqual(['once-1']);

    // clear()
    emitter.on('event3', () => {});
    emitter.clear();
    expect(emitter._listeners.size).toBe(0);
  });

  it('emit() propagates errors to error listener or logs to console', () => {
    const emitter = new RealtimeEmitter();
    const errorCalls = [];

    emitter.on('error', (err) => errorCalls.push(err.message));
    emitter.on('faulty', () => {
      throw new Error('Listener crash');
    });

    emitter.emit('faulty');
    expect(errorCalls).toEqual(['Listener crash']);

    // When no error listener is attached, error is logged to console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lonelyEmitter = new RealtimeEmitter();
    lonelyEmitter.on('bad', () => {
      throw new Error('Console error expected');
    });
    lonelyEmitter.emit('bad');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});


