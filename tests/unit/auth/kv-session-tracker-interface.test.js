const {
  wait
} = require('../../utils');

const {
  createKvSessionTracker,
  SessionManager,
} = require('../../../core/auth');

function createMockKv() {
  const store = new Map();
  return {
    get: async (k) => store.get(k) || null,
    put: async (k, v) => store.set(k, v),
    delete: async (k) => store.delete(k),
    list: async ({ prefix } = {}) => {
      const keys = [];
      for (const k of store.keys()) {
        if (!prefix || k.startsWith(prefix)) {
          keys.push({ name: k });
        }
      }
      return { keys };
    },
    _store: store,
  };
}

describe('createKvSessionTracker Interface Alignment & SessionManager Compatibility', () => {
  let mockKv;
  let tracker;

  beforeEach(() => {
    mockKv = createMockKv();
    tracker = createKvSessionTracker(mockKv, { prefix: 'sess:' });
  });

  describe('Full SessionTracker Contract Adherence', () => {
    it('implements touch, get, and refreshes last_active_at', async () => {
      const initial = await tracker.track('s1', 'u1', { ip: '1.2.3.4', userAgent: 'test-agent' });
      expect(initial).toBeDefined();
      expect(initial.session_id).toBe('s1');

      // get
      const fetched = await tracker.get('s1');
      expect(fetched).toEqual(initial);

      // get on non-existent
      expect(await tracker.get('non_existent')).toBeNull();

      // touch
      const touched = await tracker.touch('s1');
      expect(touched).toBe(true);

      const afterTouch = await tracker.get('s1');
      expect(new Date(afterTouch.last_active_at).getTime()).toBeGreaterThanOrEqual(
        new Date(initial.last_active_at).getTime()
      );

      // touch non-existent
      expect(await tracker.touch('non_existent')).toBe(false);
    });

    it('implements list() with sorting and is_current marking', async () => {
      await tracker.track('sess_old', 'user_abc', { ip: '10.0.0.1' });
      // Small pause to guarantee different timestamps
      await wait(10);
      await tracker.track('sess_new', 'user_abc', { ip: '10.0.0.2' });

      const list = await tracker.list('user_abc', 'sess_new');
      expect(list).toHaveLength(2);

      // Sorted descending: sess_new should be first
      expect(list[0].session_id).toBe('sess_new');
      expect(list[0].is_current).toBe(true);

      expect(list[1].session_id).toBe('sess_old');
      expect(list[1].is_current).toBe(false);

      // Empty user ID
      expect(await tracker.list('')).toEqual([]);
    });

    it('implements isSessionValid() and validate() alias', async () => {
      await tracker.track('valid_sid', 'user_42');

      expect(await tracker.isSessionValid('valid_sid')).toBe(true);
      expect(await tracker.isSessionValid('valid_sid', 'user_42')).toBe(true);
      expect(await tracker.isSessionValid('valid_sid', 'wrong_user')).toBe(false);
      expect(await tracker.isSessionValid('unknown_sid')).toBe(false);

      // Legacy validate alias
      expect(await tracker.validate('valid_sid', 'user_42')).toBe(true);
      expect(await tracker.validate('valid_sid', 'wrong_user')).toBe(false);
      expect(await tracker.validate('unknown_sid', 'user_42')).toBe(false);
    });

    it('implements revokeOthers and revokeAll in parallel', async () => {
      await tracker.track('s_1', 'u_shared');
      await tracker.track('s_2', 'u_shared');
      await tracker.track('s_3', 'u_shared');

      expect(await tracker.list('u_shared')).toHaveLength(3);

      // Revoke others keeping s_2
      const revokedCount = await tracker.revokeOthers('u_shared', 's_2');
      expect(revokedCount).toBe(2);

      const remaining = await tracker.list('u_shared');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].session_id).toBe('s_2');

      // Revoke all
      const allRevoked = await tracker.revokeAll('u_shared');
      expect(allRevoked).toBe(1);
      expect(await tracker.list('u_shared')).toHaveLength(0);
    });

    it('maintains listUserSessions() backward-compatible alias', async () => {
      await tracker.track('alias_s1', 'u_legacy');
      await tracker.track('alias_s2', 'u_legacy');

      const legacyList = await tracker.listUserSessions('u_legacy');
      expect(legacyList).toHaveLength(2);
      expect(legacyList.map((x) => x.session_id).sort()).toEqual(['alias_s1', 'alias_s2']);
    });
  });

  describe('Integration with SessionManager', () => {
    it('works seamlessly inside SessionManager for tracking, listing, and revocation', async () => {
      const sessionManager = new SessionManager({
        tracker,
        touchThrottleMs: 0, // Disable throttle for immediate touch verification
      });

      const mockReq = {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        ip: '192.168.0.50',
      };

      // Track through SessionManager
      const tracked = await sessionManager.track('sm_s1', 'user_sm', mockReq);
      expect(tracked).toBeDefined();
      expect(tracked.browser).toBe('Chrome');
      expect(tracked.os).toBe('Windows');

      // Second session
      await sessionManager.track('sm_s2', 'user_sm', mockReq);

      // List through SessionManager
      const sessions = await sessionManager.listSessions('user_sm', 'sm_s1');
      expect(sessions).toHaveLength(2);
      const current = sessions.find((s) => s.session_id === 'sm_s1');
      expect(current.is_current).toBe(true);

      // Validate through SessionManager
      expect(await sessionManager.isSessionValid('sm_s1', 'user_sm')).toBe(true);
      expect(await sessionManager.isSessionValid('sm_s1', 'other')).toBe(false);

      // Touch through SessionManager
      const touched = await sessionManager.touch('sm_s1');
      expect(touched).toBe(true);

      // Revoke others through SessionManager
      const revokedOthers = await sessionManager.revokeOtherSessions('user_sm', 'sm_s1');
      expect(revokedOthers).toBe(1);

      // Revoke single through SessionManager
      const revoked = await sessionManager.revokeSession('sm_s1');
      expect(revoked).toBe(true);

      expect(await sessionManager.listSessions('user_sm')).toHaveLength(0);
    });
  });
});
