const { SessionManager } = require('../../../core/auth/session-manager');
const { createMemorySessionTracker } = require('../../../core/auth/sessions');
const { createAuth } = require('../../../core/auth');

describe('SessionManager Bounded LRU Cache & Memory Leak Hardening', () => {
  it('initializes with default maxTouchEntries = 5000 and custom options', () => {
    const smDefault = new SessionManager();
    expect(smDefault.maxTouchEntries).toBe(5000);

    const smCustom = new SessionManager({ maxTouchEntries: 100 });
    expect(smCustom.maxTouchEntries).toBe(100);
  });

  it('bounds _lastTouchMap to maxTouchEntries and evicts oldest items', async () => {
    const tracker = createMemorySessionTracker();
    const sm = new SessionManager({
      tracker,
      maxTouchEntries: 5,
      touchThrottleMs: 10,
    });

    // Track 5 sessions
    for (let i = 1; i <= 5; i++) {
      await sm.track(`sess-${i}`, i, { headers: {}, ip: '127.0.0.1' });
    }
    expect(sm._lastTouchMap.size).toBe(5);
    expect(sm._lastTouchMap.has('sess-1')).toBe(true);
    expect(sm._lastTouchMap.has('sess-5')).toBe(true);

    // Track 6th session -> sess-1 (oldest) should be evicted
    await sm.track('sess-6', 6, { headers: {}, ip: '127.0.0.1' });
    expect(sm._lastTouchMap.size).toBe(5);
    expect(sm._lastTouchMap.has('sess-1')).toBe(false);
    expect(sm._lastTouchMap.has('sess-6')).toBe(true);

    // Track 7th session -> sess-2 should be evicted
    await sm.track('sess-7', 7, { headers: {}, ip: '127.0.0.1' });
    expect(sm._lastTouchMap.size).toBe(5);
    expect(sm._lastTouchMap.has('sess-2')).toBe(false);
    expect(sm._lastTouchMap.has('sess-7')).toBe(true);
  });

  it('refreshes LRU position when an existing session is touched or re-tracked', async () => {
    const tracker = createMemorySessionTracker();
    const sm = new SessionManager({
      tracker,
      maxTouchEntries: 3,
      touchThrottleMs: 10,
    });

    await sm.track('sess-A', 1, { headers: {}, ip: '127.0.0.1' });
    await sm.track('sess-B', 2, { headers: {}, ip: '127.0.0.1' });
    await sm.track('sess-C', 3, { headers: {}, ip: '127.0.0.1' });

    // Touch sess-A after throttle window so it becomes the most recently used
    await new Promise((r) => setTimeout(r, 20));
    await sm.touch('sess-A');

    // Adding sess-D should now evict sess-B (oldest), NOT sess-A
    await sm.track('sess-D', 4, { headers: {}, ip: '127.0.0.1' });

    expect(sm._lastTouchMap.size).toBe(3);
    expect(sm._lastTouchMap.has('sess-B')).toBe(false);
    expect(sm._lastTouchMap.has('sess-A')).toBe(true);
    expect(sm._lastTouchMap.has('sess-C')).toBe(true);
    expect(sm._lastTouchMap.has('sess-D')).toBe(true);
  });

  it('clearTouchCache() flushes the map completely', async () => {
    const tracker = createMemorySessionTracker();
    const sm = new SessionManager({ tracker });

    await sm.track('s1', 1, { headers: {}, ip: '127.0.0.1' });
    await sm.track('s2', 2, { headers: {}, ip: '127.0.0.1' });
    expect(sm._lastTouchMap.size).toBe(2);

    sm.clearTouchCache();
    expect(sm._lastTouchMap.size).toBe(0);
  });

  it('AuthManager passes sessionMaxTouchEntries to SessionManager', () => {
    const auth = createAuth({
      findUserById: async () => null,
      findUserByCredentials: async () => null,
      session: { secret: 'secret-123' },
      sessionTracking: true,
      sessionMaxTouchEntries: 750,
    });

    expect(auth.sessionManager).not.toBeNull();
    expect(auth.sessionManager.maxTouchEntries).toBe(750);
  });
});
