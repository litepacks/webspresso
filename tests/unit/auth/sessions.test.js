import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const knex = require('knex');
const {
  createAuth,
  quickAuth,
  createAuthMiddleware,
  createUserSessionsTable,
  dropUserSessionsTable,
  createKnexSessionTracker,
  createMemorySessionTracker,
  getClientIp,
  parseUserAgent,
  SessionManager,
  createListSessionsHandler,
  createRevokeSessionHandler,
} = require('../../../core/auth');

describe('Active Devices & Session Management (core/auth/sessions)', () => {
  let db;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await createUserSessionsTable(db);
  });

  afterEach(async () => {
    if (db) {
      await dropUserSessionsTable(db);
      await db.destroy();
    }
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. User-Agent & Client IP Parser
  // ==========================================
  describe('User-Agent & IP Detection', () => {
    it('getClientIp extracts IP correctly from various headers and fallbacks', () => {
      expect(getClientIp(null)).toBe('127.0.0.1');

      // Direct x-forwarded-for single IP
      expect(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.195' } })).toBe('203.0.113.195');

      // Comma-separated x-forwarded-for
      expect(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' } }))
        .toBe('203.0.113.195');

      // Array format x-forwarded-for
      expect(getClientIp({ headers: { 'x-forwarded-for': ['198.51.100.1', '192.168.1.1'] } }))
        .toBe('198.51.100.1');

      // x-real-ip
      expect(getClientIp({ headers: { 'x-real-ip': '198.51.100.42' } })).toBe('198.51.100.42');

      // req.ip
      expect(getClientIp({ ip: '10.0.0.5' })).toBe('10.0.0.5');

      // socket remoteAddress
      expect(getClientIp({ socket: { remoteAddress: '172.16.0.1' } })).toBe('172.16.0.1');
    });

    it('parseUserAgent handles empty or missing user agents', () => {
      const parsed = parseUserAgent('');
      expect(parsed.browser).toBe('Unknown');
      expect(parsed.os).toBe('Unknown');
      expect(parsed.device).toBe('unknown');
      expect(parsed.isDesktop).toBe(false);
      expect(parsed.isMobile).toBe(false);
      expect(parsed.isTablet).toBe(false);
      expect(parsed.isBot).toBe(false);
    });

    it('parseUserAgent detects macOS Chrome desktop', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Chrome 128');
      expect(parsed.os).toBe('macOS 10.15.7');
      expect(parsed.device).toBe('desktop');
      expect(parsed.isDesktop).toBe(true);
      expect(parsed.isMobile).toBe(false);
      expect(parsed.isTablet).toBe(false);
    });

    it('parseUserAgent detects iPhone Safari mobile', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Safari 17');
      expect(parsed.os).toBe('iOS 17.4');
      expect(parsed.device).toBe('mobile');
      expect(parsed.isMobile).toBe(true);
      expect(parsed.isDesktop).toBe(false);
    });

    it('parseUserAgent detects iPad tablet', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Safari 16');
      expect(parsed.os).toBe('iPadOS 16.5');
      expect(parsed.device).toBe('tablet');
      expect(parsed.isTablet).toBe(true);
      expect(parsed.isMobile).toBe(false);
    });

    it('parseUserAgent detects Windows Edge desktop', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Edge 122');
      expect(parsed.os).toBe('Windows 10/11');
      expect(parsed.device).toBe('desktop');
    });

    it('parseUserAgent detects Linux Firefox', () => {
      const ua = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Firefox 125');
      expect(parsed.os).toBe('Ubuntu Linux');
      expect(parsed.device).toBe('desktop');
    });

    it('parseUserAgent detects Android mobile Chrome', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Chrome 126');
      expect(parsed.os).toBe('Android 14');
      expect(parsed.device).toBe('mobile');
      expect(parsed.isMobile).toBe(true);
    });

    it('parseUserAgent detects Android tablet', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';
      const parsed = parseUserAgent(ua);
      expect(parsed.browser).toBe('Chrome 115');
      expect(parsed.os).toBe('Android 13');
      expect(parsed.device).toBe('tablet');
      expect(parsed.isTablet).toBe(true);
    });

    it('parseUserAgent detects bots and web crawlers', () => {
      const googlebot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      const parsedGoogle = parseUserAgent(googlebot);
      expect(parsedGoogle.isBot).toBe(true);
      expect(parsedGoogle.device).toBe('bot');

      const curl = 'curl/8.4.0';
      const parsedCurl = parseUserAgent(curl);
      expect(parsedCurl.isBot).toBe(true);
      expect(parsedCurl.device).toBe('bot');
    });
  });

  // ==========================================
  // 2. Table Creation & Drop Migration
  // ==========================================
  describe('Migration Helpers', () => {
    it('createUserSessionsTable creates table idempotently', async () => {
      const hasTableFirst = await db.schema.hasTable('user_sessions');
      expect(hasTableFirst).toBe(true);

      // Re-running should be a no-op without errors
      await createUserSessionsTable(db);
      const hasTableSecond = await db.schema.hasTable('user_sessions');
      expect(hasTableSecond).toBe(true);
    });

    it('dropUserSessionsTable removes user_sessions table', async () => {
      await dropUserSessionsTable(db);
      const exists = await db.schema.hasTable('user_sessions');
      expect(exists).toBe(false);

      // Re-create for afterEach
      await createUserSessionsTable(db);
    });
  });

  // ==========================================
  // 3. Knex Session Tracker Adapter
  // ==========================================
  describe('createKnexSessionTracker', () => {
    let tracker;

    beforeEach(() => {
      tracker = createKnexSessionTracker(db);
    });

    it('track creates a new session record and updates on duplicate', async () => {
      const session = await tracker.track('sess-1', 42, {
        ip: '198.51.100.1',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      });

      expect(session).toBeDefined();
      expect(session.session_id).toBe('sess-1');
      expect(session.user_id).toBe(42);
      expect(session.ip_address).toBe('198.51.100.1');
      expect(session.browser).toBe('Chrome 128');
      expect(session.os).toContain('macOS');
      expect(session.device).toBe('desktop');

      // Update existing session
      const updated = await tracker.track('sess-1', 42, {
        ip: '198.51.100.99',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
      });
      expect(updated.session_id).toBe('sess-1');
      expect(updated.ip_address).toBe('198.51.100.99');
      expect(updated.device).toBe('mobile');

      // Ensure no duplicate rows were inserted
      const count = await db('user_sessions').where({ session_id: 'sess-1' }).count('id as count');
      expect(Number(count[0].count)).toBe(1);
    });

    it('returns null when sessionId or userId is missing', async () => {
      expect(await tracker.track('', 42)).toBeNull();
      expect(await tracker.track('sess-x', null)).toBeNull();
    });

    it('touch updates last_active_at', async () => {
      await tracker.track('sess-touch', 10);
      const before = await tracker.get('sess-touch');

      // Small sleep to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));
      const touched = await tracker.touch('sess-touch');
      expect(touched).toBe(true);

      const after = await tracker.get('sess-touch');
      expect(new Date(after.last_active_at).getTime()).toBeGreaterThanOrEqual(new Date(before.last_active_at).getTime());
    });

    it('list returns sessions ordered by last_active_at and marks is_current', async () => {
      await tracker.track('sess-a', 99, { ip: '1.1.1.1' });
      await tracker.track('sess-b', 99, { ip: '2.2.2.2' });
      await tracker.track('sess-c', 88, { ip: '3.3.3.3' }); // Different user

      const sessions = await tracker.list(99, 'sess-b');
      expect(sessions.length).toBe(2);
      expect(sessions.find((s) => s.session_id === 'sess-b').is_current).toBe(true);
      expect(sessions.find((s) => s.session_id === 'sess-a').is_current).toBe(false);
    });

    it('isSessionValid validates session existence and user ownership', async () => {
      await tracker.track('sess-valid', 7);
      expect(await tracker.isSessionValid('sess-valid')).toBe(true);
      expect(await tracker.isSessionValid('sess-valid', 7)).toBe(true);
      expect(await tracker.isSessionValid('sess-valid', 8)).toBe(false);
      expect(await tracker.isSessionValid('sess-nonexistent')).toBe(false);
    });

    it('revoke removes single session', async () => {
      await tracker.track('sess-rev', 7);
      expect(await tracker.isSessionValid('sess-rev')).toBe(true);

      const revoked = await tracker.revoke('sess-rev');
      expect(revoked).toBe(true);
      expect(await tracker.isSessionValid('sess-rev')).toBe(false);
    });

    it('revokeOthers keeps current session and deletes all others', async () => {
      await tracker.track('sess-current', 10);
      await tracker.track('sess-other-1', 10);
      await tracker.track('sess-other-2', 10);
      await tracker.track('sess-different-user', 20);

      const count = await tracker.revokeOthers(10, 'sess-current');
      expect(count).toBe(2);

      const remaining = await tracker.list(10);
      expect(remaining.length).toBe(1);
      expect(remaining[0].session_id).toBe('sess-current');

      // Different user should still be untouched
      expect(await tracker.isSessionValid('sess-different-user')).toBe(true);
    });

    it('revokeAll removes all sessions for user', async () => {
      await tracker.track('sess-1', 30);
      await tracker.track('sess-2', 30);
      await tracker.track('sess-other-user', 40);

      const count = await tracker.revokeAll(30);
      expect(count).toBe(2);
      expect(await tracker.isSessionValid('sess-1')).toBe(false);
      expect(await tracker.isSessionValid('sess-2')).toBe(false);
      expect(await tracker.isSessionValid('sess-other-user')).toBe(true);
    });

    it('purgeExpired removes stale sessions', async () => {
      await tracker.track('sess-stale', 50);
      // Manually backdate session
      const past = new Date(Date.now() - 100000);
      await db('user_sessions').where({ session_id: 'sess-stale' }).update({ last_active_at: past });

      await tracker.track('sess-fresh', 50);

      const purged = await tracker.purgeExpired(50000);
      expect(purged).toBe(1);
      expect(await tracker.isSessionValid('sess-stale')).toBe(false);
      expect(await tracker.isSessionValid('sess-fresh')).toBe(true);
    });
  });

  // ==========================================
  // 4. In-Memory Session Tracker
  // ==========================================
  describe('createMemorySessionTracker', () => {
    let memTracker;

    beforeEach(() => {
      memTracker = createMemorySessionTracker();
    });

    it('supports all tracker operations without a database', async () => {
      await memTracker.track('mem-1', 101, { ip: '10.0.0.1' });
      await memTracker.track('mem-2', 101, { ip: '10.0.0.2' });

      expect(await memTracker.isSessionValid('mem-1', 101)).toBe(true);
      expect(await memTracker.isSessionValid('mem-1', 999)).toBe(false);

      const list = await memTracker.list(101, 'mem-2');
      expect(list.length).toBe(2);
      expect(list.find((s) => s.session_id === 'mem-2').is_current).toBe(true);

      await memTracker.touch('mem-1');
      const item = await memTracker.get('mem-1');
      expect(item.ip_address).toBe('10.0.0.1');

      const count = await memTracker.revokeOthers(101, 'mem-2');
      expect(count).toBe(1);
      expect(await memTracker.isSessionValid('mem-1')).toBe(false);
      expect(await memTracker.isSessionValid('mem-2')).toBe(true);

      await memTracker.revoke('mem-2');
      expect(await memTracker.isSessionValid('mem-2')).toBe(false);
    });

    it('purgeExpired cleans expired memory sessions', async () => {
      await memTracker.track('mem-old', 200);
      const record = await memTracker.get('mem-old');
      record.last_active_at = new Date(Date.now() - 50000);

      await memTracker.track('mem-new', 200);

      const purged = await memTracker.purgeExpired(20000);
      expect(purged).toBe(1);
      expect(await memTracker.isSessionValid('mem-old')).toBe(false);
      expect(await memTracker.isSessionValid('mem-new')).toBe(true);
    });
  });

  // ==========================================
  // 5. SessionManager & Event Dispatching
  // ==========================================
  describe('SessionManager', () => {
    it('throttles touch calls to avoid frequent database updates', async () => {
      const tracker = createMemorySessionTracker();
      const manager = new SessionManager({
        tracker,
        touchThrottleMs: 1000,
      });

      const req = {
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36' },
        ip: '127.0.0.1',
      };

      await manager.track('sess-throttle', 1, req);

      // Immediately touching should be throttled (returns false)
      const touchedImmediate = await manager.touch('sess-throttle');
      expect(touchedImmediate).toBe(false);

      // Advance lastTouch map manually
      manager._lastTouchMap.set('sess-throttle', Date.now() - 2000);
      const touchedAfterWindow = await manager.touch('sess-throttle');
      expect(touchedAfterWindow).toBe(true);
    });

    it('emits events on session creation and revocation', async () => {
      const emitter = new (require('events').EventEmitter)();
      const createdEvents = [];
      const revokedEvents = [];
      const revokedOthersEvents = [];
      const revokedAllEvents = [];

      emitter.on('session:created', (e) => createdEvents.push(e));
      emitter.on('session:revoked', (e) => revokedEvents.push(e));
      emitter.on('sessions:revoked_others', (e) => revokedOthersEvents.push(e));
      emitter.on('sessions:revoked_all', (e) => revokedAllEvents.push(e));

      const manager = new SessionManager({
        tracker: createMemorySessionTracker(),
        emitter,
      });

      await manager.track('sess-ev', 10, { headers: {}, ip: '1.2.3.4' });
      expect(createdEvents.length).toBe(1);
      expect(createdEvents[0].sessionId).toBe('sess-ev');

      await manager.track('sess-ev-2', 10, { headers: {}, ip: '1.2.3.4' });

      await manager.revokeOtherSessions(10, 'sess-ev');
      expect(revokedOthersEvents.length).toBe(1);
      expect(revokedOthersEvents[0].count).toBe(1);

      await manager.revokeSession('sess-ev', { userId: 10 });
      expect(revokedEvents.length).toBe(1);
      expect(revokedEvents[0].sessionId).toBe('sess-ev');

      await manager.revokeAllSessions(10);
      expect(revokedAllEvents.length).toBe(1);
    });

    it('destroys physical express-session in sessionStore when revoked', async () => {
      const destroyedSessions = [];
      const mockSessionStore = {
        destroy: (sid, cb) => {
          destroyedSessions.push(sid);
          cb();
        },
      };

      const manager = new SessionManager({
        tracker: createMemorySessionTracker(),
        sessionStore: mockSessionStore,
      });

      await manager.track('sess-store-test', 5);
      await manager.revokeSession('sess-store-test');

      expect(destroyedSessions).toContain('sess-store-test');
    });
  });

  // ==========================================
  // 6. AuthManager Integration & req.auth
  // ==========================================
  describe('AuthManager & req.auth Session Methods', () => {
    let auth;
    let mockUsers;

    beforeEach(() => {
      mockUsers = [
        { id: 1, email: 'john@example.com', name: 'John Doe', role: 'user' },
        { id: 2, email: 'jane@example.com', name: 'Jane Admin', role: 'admin' },
      ];

      auth = createAuth({
        findUserById: async (id) => mockUsers.find((u) => u.id === Number(id)) || null,
        findUserByCredentials: async (email) => mockUsers.find((u) => u.email === email) || null,
        session: { secret: 'test-session-secret' },
        sessionTracking: true,
        db,
      });
    });

    it('login tracks session and req.auth provides sessions list and revocation', async () => {
      const mockReq = {
        sessionID: 'user-session-1',
        session: { userId: null },
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0 Safari/537.36',
          'x-forwarded-for': '198.51.100.77',
        },
        user: null,
      };
      const mockRes = {
        clearCookie: vi.fn(),
      };

      // Login
      await auth.createRequestAuth(mockReq, mockRes).login(mockUsers[0]);
      expect(mockReq.user).toEqual(mockUsers[0]);

      // Verify session was tracked in DB
      const sessions = await auth.createRequestAuth(mockReq, mockRes).sessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].session_id).toBe('user-session-1');
      expect(sessions[0].is_current).toBe(true);
      expect(sessions[0].ip_address).toBe('198.51.100.77');
      expect(sessions[0].browser).toBe('Chrome 128');

      // Login a second device for same user
      const mockReq2 = {
        sessionID: 'user-session-2',
        session: { userId: null },
        headers: {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
          'x-real-ip': '203.0.113.88',
        },
        user: null,
      };
      await auth.createRequestAuth(mockReq2, mockRes).login(mockUsers[0]);

      const req1Auth = auth.createRequestAuth(mockReq, mockRes);
      const multiSessions = await req1Auth.sessions();
      expect(multiSessions.length).toBe(2);

      // Revoke all other sessions from device 1
      const revokedCount = await req1Auth.revokeOtherSessions();
      expect(revokedCount).toBe(1);

      const afterRevoke = await req1Auth.sessions();
      expect(afterRevoke.length).toBe(1);
      expect(afterRevoke[0].session_id).toBe('user-session-1');

      // Device 2 session is now invalid
      expect(await auth.isSessionValid('user-session-2', 1)).toBe(false);
    });

    it('login tracks session when session.regenerate is used', async () => {
      let currentSessionId = 'pre-regen-sid';
      const mockReq = {
        get sessionID() {
          return currentSessionId;
        },
        session: {
          regenerate(cb) {
            currentSessionId = 'post-regen-sid';
            cb(null);
          },
        },
        headers: { 'user-agent': 'curl/8.4.0' },
      };
      const mockRes = {};

      await auth.createRequestAuth(mockReq, mockRes).login(mockUsers[0]);

      // Newly generated session ID should be the one tracked
      expect(await auth.isSessionValid('post-regen-sid', 1)).toBe(true);
      expect(await auth.isSessionValid('pre-regen-sid', 1)).toBe(false);
    });

    it('revokeSession logs out user if current session is revoked', async () => {
      const mockReq = {
        sessionID: 'my-own-session',
        session: {
          userId: 1,
          destroy: vi.fn((cb) => cb()),
        },
        headers: {},
        user: mockUsers[0],
      };
      const mockRes = {};

      await auth.sessionManager.track('my-own-session', 1, mockReq);
      const reqAuth = auth.createRequestAuth(mockReq, mockRes);

      const revoked = await reqAuth.revokeSession('my-own-session');
      expect(revoked).toBe(true);
      expect(mockReq.user).toBeNull();
      expect(mockReq.session.destroy).toHaveBeenCalled();
    });

    it('revokeAllSessions revokes all sessions and logs out current user', async () => {
      const mockReq = {
        sessionID: 'active-session-1',
        session: {
          userId: 1,
          destroy: vi.fn((cb) => cb()),
        },
        headers: {},
        user: mockUsers[0],
      };
      const mockRes = {};

      await auth.sessionManager.track('active-session-1', 1, mockReq);
      await auth.sessionManager.track('active-session-2', 1, mockReq);

      const reqAuth = auth.createRequestAuth(mockReq, mockRes);
      const count = await reqAuth.revokeAllSessions();

      expect(count).toBe(2);
      expect(mockReq.user).toBeNull();
      expect(mockReq.session.destroy).toHaveBeenCalled();
      expect(await auth.isSessionValid('active-session-1')).toBe(false);
      expect(await auth.isSessionValid('active-session-2')).toBe(false);
    });

    it('logout revokes the session automatically', async () => {
      const mockReq = {
        sessionID: 'logout-sess',
        session: {
          userId: 1,
          destroy: vi.fn((cb) => cb()),
        },
        headers: {},
        user: mockUsers[0],
      };
      const mockRes = {};

      await auth.sessionManager.track('logout-sess', 1, mockReq);
      expect(await auth.isSessionValid('logout-sess')).toBe(true);

      await auth.createRequestAuth(mockReq, mockRes).logout();
      expect(await auth.isSessionValid('logout-sess')).toBe(false);
    });
  });

  // ==========================================
  // 7. Middleware Revocation Enforcement
  // ==========================================
  describe('Middleware Session Revocation Enforcement', () => {
    let auth;
    let middleware;
    let mockUsers;

    beforeEach(() => {
      mockUsers = [
        { id: 1, email: 'active@example.com', name: 'Active User', role: 'user' },
      ];

      auth = createAuth({
        findUserById: async (id) => mockUsers.find((u) => u.id === Number(id)) || null,
        findUserByCredentials: async (email) => mockUsers.find((u) => u.email === email) || null,
        session: { secret: 'middleware-test-secret' },
        sessionTracking: true,
        db,
      });

      middleware = createAuthMiddleware(auth);
    });

    it('authenticates user when session is valid and touches last_active_at', async () => {
      const req = {
        sessionID: 'valid-sess-token',
        session: { userId: 1 },
        headers: {},
      };
      const res = {};
      const next = vi.fn();

      await auth.sessionManager.track('valid-sess-token', 1, req);

      await middleware.authenticate(req, res, next);
      expect(req.user).toEqual(mockUsers[0]);
      expect(next).toHaveBeenCalled();
    });

    it('invalidates and clears session when session was revoked remotely', async () => {
      const destroyMock = vi.fn((cb) => cb());
      const req = {
        sessionID: 'revoked-sess-token',
        session: {
          userId: 1,
          destroy: destroyMock,
        },
        headers: {},
      };
      const res = {};
      const next = vi.fn();

      // Track then revoke
      await auth.sessionManager.track('revoked-sess-token', 1, req);
      await auth.sessionManager.revokeSession('revoked-sess-token');

      await middleware.authenticate(req, res, next);

      // req.user should be null and session destroyed
      expect(req.user).toBeNull();
      expect(req.session.userId).toBeUndefined();
      expect(destroyMock).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  // ==========================================
  // 8. Express Route Handlers
  // ==========================================
  describe('Express Session Route Handlers', () => {
    let auth;
    let listHandler;
    let revokeHandler;

    beforeEach(() => {
      const mockUsers = [
        { id: 10, email: 'alice@example.com', role: 'user' },
        { id: 20, email: 'bob@example.com', role: 'user' },
        { id: 99, email: 'admin@example.com', role: 'admin' },
      ];

      auth = createAuth({
        findUserById: async (id) => mockUsers.find((u) => u.id === Number(id)) || null,
        findUserByCredentials: async (email) => mockUsers.find((u) => u.email === email) || null,
        session: { secret: 'handler-secret' },
        sessionTracking: true,
        db,
      });

      listHandler = createListSessionsHandler(auth);
      revokeHandler = createRevokeSessionHandler(auth);
    });

    it('listSessionsHandler returns active sessions list for logged-in user', async () => {
      await auth.sessionManager.track('sess-h-1', 10, { headers: {}, ip: '1.1.1.1' });

      const req = {
        user: { id: 10 },
        sessionID: 'sess-h-1',
      };
      let jsonResult;
      const res = {
        json: (val) => {
          jsonResult = val;
          return res;
        },
        status: vi.fn().mockReturnThis(),
      };

      await listHandler(req, res);
      expect(jsonResult.ok).toBe(true);
      expect(jsonResult.sessions.length).toBe(1);
      expect(jsonResult.sessions[0].session_id).toBe('sess-h-1');
      expect(jsonResult.sessions[0].is_current).toBe(true);
    });

    it('listSessionsHandler returns 401 when unauthenticated', async () => {
      const req = { user: null };
      let statusCode;
      let jsonResult;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (val) => {
          jsonResult = val;
          return res;
        },
      };

      await listHandler(req, res);
      expect(statusCode).toBe(401);
      expect(jsonResult.error).toBe('Authentication required');
    });

    it('revokeSessionHandler revokes all other sessions when allOthers is true', async () => {
      await auth.sessionManager.track('sess-a', 10, { headers: {} });
      await auth.sessionManager.track('sess-b', 10, { headers: {} });

      const req = {
        user: { id: 10 },
        sessionID: 'sess-a',
        body: { allOthers: true },
      };
      let jsonResult;
      const res = {
        json: (val) => {
          jsonResult = val;
          return res;
        },
        status: vi.fn().mockReturnThis(),
      };

      await revokeHandler(req, res);
      expect(jsonResult.ok).toBe(true);
      expect(jsonResult.revokedCount).toBe(1);
      expect(await auth.isSessionValid('sess-a')).toBe(true);
      expect(await auth.isSessionValid('sess-b')).toBe(false);
    });

    it('revokeSessionHandler prevents non-admins from revoking other users sessions', async () => {
      // User 20 owns sess-bob
      await auth.sessionManager.track('sess-bob', 20, { headers: {} });

      // User 10 tries to revoke sess-bob
      const req = {
        user: { id: 10, role: 'user' },
        sessionID: 'sess-alice',
        body: { sessionId: 'sess-bob' },
      };
      let statusCode;
      let jsonResult;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (val) => {
          jsonResult = val;
          return res;
        },
      };

      await revokeHandler(req, res);
      expect(statusCode).toBe(403);
      expect(jsonResult.error).toContain('Cannot revoke session belonging to another user');
      expect(await auth.isSessionValid('sess-bob')).toBe(true);
    });

    it('revokeSessionHandler allows admin to revoke any session', async () => {
      await auth.sessionManager.track('sess-target', 20, { headers: {} });

      const req = {
        user: { id: 99, role: 'admin' },
        sessionID: 'sess-admin',
        body: { sessionId: 'sess-target' },
      };
      let jsonResult;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: (val) => {
          jsonResult = val;
          return res;
        },
      };

      await revokeHandler(req, res);
      expect(jsonResult.ok).toBe(true);
      expect(await auth.isSessionValid('sess-target')).toBe(false);
    });
  });

  // ==========================================
  // 9. quickAuth Integration
  // ==========================================
  describe('quickAuth with sessionTracking', () => {
    it('initializes session tracking seamlessly when sessionTracking: true', async () => {
      const mockUsers = [
        { id: 1, email: 'test@example.com', password: 'plain', role: 'user' },
      ];

      const mockDb = {
        getRepository: (name) => ({
          findById: async (id) => mockUsers.find((u) => u.id === Number(id)) || null,
          findOne: async (q) => mockUsers.find((u) => u.email === q.email) || null,
        }),
        knex: db,
      };

      const quick = quickAuth({
        db: mockDb,
        sessionTracking: true,
        session: { secret: 'quick-auth-secret' },
      });

      expect(quick.sessionManager).toBeDefined();

      const mockReq = {
        sessionID: 'quick-sess-id',
        session: {},
        headers: { 'user-agent': 'curl/8.4.0' },
      };
      await quick.createRequestAuth(mockReq, {}).login(mockUsers[0]);

      const active = await quick.listSessions(1);
      expect(active.length).toBe(1);
      expect(active[0].session_id).toBe('quick-sess-id');
      expect(active[0].device).toBe('bot');
    });
  });
});
