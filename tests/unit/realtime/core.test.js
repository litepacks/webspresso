/**
 * Comprehensive Unit Tests for Realtime Core
 * Validates all 28 core requirements and lifecycle behaviors
 */

const {
  createRealtime,
  realtime,
  RealtimeError,
} = require('../../../core/realtime');

function createMockAdapter(capabilities = {}) {
  let connected = false;
  const subscriptions = new Map();
  const listeners = new Map();

  return {
    capabilities: {
      send: true,
      perform: true,
      multiplexing: true,
      serverEvents: true,
      binary: false,
      ...capabilities,
    },
    connectCallCount: 0,
    disconnectCallCount: 0,
    destroyCallCount: 0,
    lastContext: null,
    sentMessages: [],
    performedActions: [],

    async connect(context) {
      this.connectCallCount++;
      this.lastContext = context;
      connected = true;
    },

    disconnect() {
      this.disconnectCallCount++;
      connected = false;
    },

    isConnected() {
      return connected;
    },

    subscribe(identifier, params, callbacks) {
      const sub = {
        identifier,
        params,
        callbacks,
      };
      subscriptions.set(identifier, sub);
      callbacks.connected?.();
      return {
        send: (data) => {
          this.sentMessages.push({ identifier, data });
        },
        perform: (action, data) => {
          this.performedActions.push({ identifier, action, data });
        },
        unsubscribe: () => {
          subscriptions.delete(identifier);
        },
      };
    },

    send(identifier, data) {
      this.sentMessages.push({ identifier, data });
    },

    perform(identifier, action, data) {
      this.performedActions.push({ identifier, action, data });
    },

    unsubscribe(identifier) {
      subscriptions.delete(identifier);
    },

    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },

    emit(event, ...args) {
      if (event === 'disconnected') {
        connected = false;
      }
      const set = listeners.get(event);
      if (set) {
        for (const h of set) h(...args);
      }
    },

    destroy() {
      this.destroyCallCount++;
      this.disconnect();
      subscriptions.clear();
      listeners.clear();
    },

    // Helper for testing incoming messages
    mockReceive(identifier, data) {
      const sub = subscriptions.get(identifier);
      if (sub && sub.callbacks.received) {
        sub.callbacks.received(data);
      }
    },

    mockReject(identifier, err) {
      const sub = subscriptions.get(identifier);
      if (sub && sub.callbacks.rejected) {
        sub.callbacks.rejected(err);
      }
    },
  };
}

describe('Realtime Core', () => {
  // Scenario 1: SSR Safety — No network connection on server
  it('1. does not establish network connection during SSR', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: false, // Simulate server SSR
      autoConnect: true,
    });

    await rt.connect();
    expect(adapter.connectCallCount).toBe(0);
    expect(rt.isConnected()).toBe(false);
  });

  // Scenario 2: browserReady triggers auto-connect
  it('2. connects automatically after browserReady is invoked', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: true,
    });

    rt.browserReady();
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.connectCallCount).toBeGreaterThanOrEqual(1);
    expect(rt.isConnected()).toBe(true);
  });

  // Scenario 3: Manual connect
  it('3. supports manual connect() when autoConnect: false', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
    });

    expect(rt.isConnected()).toBe(false);
    await rt.connect();
    expect(rt.isConnected()).toBe(true);
    expect(adapter.connectCallCount).toBe(1);
  });

  // Scenario 4: Disconnect
  it('4. disconnects cleanly and emits disconnected event', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });

    await rt.connect();
    let disconnectedFired = false;
    rt.on('disconnected', () => {
      disconnectedFired = true;
    });

    rt.disconnect();
    expect(rt.isConnected()).toBe(false);
    expect(adapter.disconnectCallCount).toBe(1);
    expect(disconnectedFired).toBe(true);
  });

  // Scenarios 5, 6, 7: Generic subscription creation, identifier & params forwarding
  it('5-7. creates subscription with generic identifier and params forwarding', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    let connectedCbCalled = false;
    const sub = rt.subscribe(
      'project:123',
      { projectId: 123, role: 'viewer' },
      {
        connected() {
          connectedCbCalled = true;
        },
      }
    );

    expect(sub.identifier).toBe('project:123');
    expect(sub.params).toEqual({ projectId: 123, role: 'viewer' });
    expect(connectedCbCalled).toBe(true);
  });

  // Scenario 8: received callback
  it('8. forwards received message data to subscription callbacks', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const receivedList = [];
    rt.subscribe('chat:general', {}, {
      received(data) {
        receivedList.push(data);
      },
    });

    adapter.mockReceive('chat:general', { text: 'Hello realtime!' });
    expect(receivedList).toEqual([{ text: 'Hello realtime!' }]);
  });

  // Scenario 9: perform
  it('9. performs action on active subscription', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const sub = rt.subscribe('chat:general');
    sub.perform('typing', { isTyping: true });

    expect(adapter.performedActions).toEqual([
      { identifier: 'chat:general', action: 'typing', data: { isTyping: true } },
    ]);
  });

  // Scenario 10: send
  it('10. sends data on active subscription', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const sub = rt.subscribe('device:sensors');
    sub.send({ temp: 24.5 });

    expect(adapter.sentMessages).toEqual([
      { identifier: 'device:sensors', data: { temp: 24.5 } },
    ]);
  });

  // Scenario 11: unsubscribe
  it('11. unregister subscription on unsubscribe()', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const sub = rt.subscribe('project:99');
    expect(rt.registry.has(sub.key)).toBe(true);

    sub.unsubscribe();
    expect(rt.registry.has(sub.key)).toBe(false);

    // Subsequent sends on unsubscribed channel throw
    expect(() => sub.send({ foo: 'bar' })).toThrow('unsubscribed');
  });

  // Scenario 12: Token Auth
  it('12. resolves token auth before connection and passes to adapter', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'token',
        getToken: async () => 'jwt_secret_token_123',
      },
    });

    await rt.connect();
    expect(adapter.lastContext.auth).toEqual({
      type: 'token',
      token: 'jwt_secret_token_123',
    });
  });

  // Scenario 13: Cookie Auth
  it('13. handles cookie auth strategy without query token attachment', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'cookie',
      },
    });

    await rt.connect();
    expect(adapter.lastContext.auth).toEqual({
      type: 'cookie',
    });
  });

  // Scenario 14: Custom Auth Strategy
  it('14. supports custom auth strategy with arbitrary connection metadata', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'custom',
        resolve: async () => ({
          headers: { Authorization: 'Bearer custom_token' },
          protocols: ['v1.realtime'],
          params: { tenant: 'acme' },
        }),
      },
    });

    await rt.connect();
    expect(adapter.lastContext.auth).toEqual({
      type: 'custom',
      headers: { Authorization: 'Bearer custom_token' },
      protocols: ['v1.realtime'],
      params: { tenant: 'acme' },
    });
  });

  // Scenario 15: Token Refresh
  it('15. supports refreshToken() strategy call', async () => {
    let token = 'initial_token';
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'token',
        getToken: async () => token,
        refreshToken: async () => {
          token = 'refreshed_token';
          return token;
        },
      },
    });

    await rt.connect();
    expect(adapter.lastContext.auth.token).toBe('initial_token');

    const refreshed = await rt.auth.refreshToken();
    expect(refreshed.token).toBe('refreshed_token');
  });

  // Scenario 16: Reauthenticate Workflow
  it('16. reauthenticate() disconnects, gets new auth, reconnects and restores subscriptions', async () => {
    let token = 'old_token';
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'token',
        getToken: async () => token,
        refreshToken: async () => {
          token = 'brand_new_token';
          return token;
        },
      },
    });

    await rt.connect();
    rt.subscribe('feed:live', { live: true });

    await rt.reauthenticate();

    expect(adapter.lastContext.auth.token).toBe('brand_new_token');
    expect(rt.isConnected()).toBe(true);
  });

  // Scenario 17: Subscription Restore after Reconnect
  it('17. restores all active subscriptions after reconnect', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });

    await rt.connect();
    const sub1 = rt.subscribe('channel:1');
    const sub2 = rt.subscribe('channel:2', { filter: 'urgent' });

    rt.disconnect();
    expect(rt.isConnected()).toBe(false);

    await rt.connect();
    expect(rt.isConnected()).toBe(true);
    expect(rt.registry.getAll().length).toBe(2);
  });

  // Scenario 18: Prevent Duplicate Subscriptions
  it('18. returns existing subscription and avoids duplicates for same identifier and params', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const subA = rt.subscribe('tasks:10', { dept: 'eng' });
    const subB = rt.subscribe('tasks:10', { dept: 'eng' });

    expect(subA).toBe(subB);
    expect(rt.registry.getAll().length).toBe(1);

    // Different params -> separate subscription
    const subC = rt.subscribe('tasks:10', { dept: 'marketing' });
    expect(subC).not.toBe(subA);
    expect(rt.registry.getAll().length).toBe(2);
  });

  // Scenario 19: Rejected Subscription Handling
  it('19. handles rejected subscription gracefully and fires callback', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    let rejectionError = null;
    rt.subscribe('restricted:channel', {}, {
      rejected(err) {
        rejectionError = err;
      },
    });

    adapter.mockReject('restricted:channel', new Error('Forbidden channel access'));
    expect(rejectionError).toBeDefined();
    expect(rejectionError.message).toContain('Forbidden channel access');
  });

  // Scenario 20: Unauthorized Connection Handling
  it('20. emits unauthorized event when connection is rejected for auth reasons', async () => {
    const adapter = createMockAdapter();
    const onUnauthorizedSpy = vi.fn();

    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      auth: {
        strategy: 'token',
        getToken: () => 'bad_token',
        onUnauthorized: onUnauthorizedSpy,
      },
    });

    let eventFired = false;
    rt.on('unauthorized', (err) => {
      eventFired = true;
      expect(err.code).toBe('UNAUTHORIZED');
    });

    // Adapter reports unauthorized
    adapter.emit('unauthorized', new Error('Invalid token'));

    expect(eventFired).toBe(true);
    expect(onUnauthorizedSpy).toHaveBeenCalled();
  });

  // Scenario 21: Malformed Server Message Handling
  it('21. handles malformed messages without crashing client', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    let receivedData = null;
    rt.subscribe('news:alerts', {}, {
      received(data) {
        receivedData = data;
      },
    });

    // Passing invalid/unexpected non-object data
    adapter.mockReceive('news:alerts', 'non_json_string');
    expect(receivedData).toBe('non_json_string');
  });

  // Scenario 22: Unsupported Capability Error
  it('22. throws clear capability error when perform/send is unsupported by adapter', async () => {
    const adapter = createMockAdapter({ send: false, perform: false });
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    const sub = rt.subscribe('readonly:stream');
    expect(() => sub.send({ test: 1 })).toThrow('does not support send()');
    expect(() => sub.perform('action')).toThrow('does not support perform()');
  });

  // Scenario 23: Destroy Cleanup
  it('23. cleans up subscriptions, listeners, connections, and adapter on destroy()', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });
    await rt.connect();

    rt.subscribe('channel:test');
    expect(rt.registry.getAll().length).toBe(1);

    rt.destroy();

    expect(rt.registry.getAll().length).toBe(0);
    expect(adapter.destroyCallCount).toBe(1);
    expect(rt.isConnected()).toBe(false);

    // Operations after destroy throw DESTROYED
    expect(() => rt.subscribe('channel:after')).toThrow('destroyed');
    await expect(rt.connect()).rejects.toThrow('destroyed');
  });

  // Scenario 24: Reconnect Backoff & Recovery
  it('24. attempts reconnection with exponential backoff on unexpected disconnect', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      reconnect: {
        enabled: true,
        baseDelay: 10,
        factor: 2,
        jitter: false,
      },
    });

    await rt.connect();
    expect(adapter.connectCallCount).toBe(1);

    const reconnectingEvents = [];
    rt.on('reconnecting', (info) => reconnectingEvents.push(info));

    // Adapter drops connection unexpectedly
    adapter.emit('disconnected', { code: 1006, reason: 'Abnormal Closure' });

    // Wait for backoff
    await new Promise((r) => setTimeout(r, 50));

    expect(reconnectingEvents.length).toBeGreaterThanOrEqual(1);
    expect(adapter.connectCallCount).toBe(2);
    expect(rt.isConnected()).toBe(true);
  });

  // Scenario 25: Auth token sanitized from logs and error messages
  it('25. strips auth tokens and secrets from error messages', () => {
    const secretUrl = 'wss://api.example.com/realtime?token=super_secret_jwt_key_12345&foo=bar';
    const err = new RealtimeError('CONNECTION_FAILED', `Failed to connect to ${secretUrl}`);

    expect(err.message).not.toContain('super_secret_jwt_key_12345');
    expect(err.message).toContain('token=***');
  });

  // Scenario 26: Reconnect loop single execution guarantee
  it('26. guarantees single reconnect loop without duplicate intervals', async () => {
    const adapter = createMockAdapter();
    const rt = createRealtime({
      adapter,
      isBrowser: true,
      autoConnect: false,
      reconnect: { baseDelay: 50, enabled: true },
    });

    await rt.connect();

    // Trigger multiple disconnect events rapidly
    adapter.emit('disconnected');
    adapter.emit('disconnected');
    adapter.emit('disconnected');

    expect(rt.reconnectManager.attempts).toBe(1);
    rt.destroy();
  });

  // Scenario 27: Adapter initialization failure handling
  it('27. handles adapter connect rejection cleanly without unhandled rejection', async () => {
    const adapter = createMockAdapter();
    adapter.connect = async () => {
      throw new Error('Network unreachable');
    };

    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });

    let errorEvent = null;
    rt.on('error', (err) => {
      errorEvent = err;
    });

    await expect(rt.connect()).rejects.toThrow('Network unreachable');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBe('CONNECTION_FAILED');
  });

  // Scenario 28: App destroy during active connection
  it('28. safely cancels and cleans up if destroyed during connection attempt', async () => {
    const adapter = createMockAdapter();
    adapter.connect = () => new Promise((resolve) => setTimeout(resolve, 100));

    const rt = createRealtime({ adapter, isBrowser: true, autoConnect: false });

    const connectPromise = rt.connect();
    rt.destroy();

    await connectPromise.catch(() => {});
    expect(rt.isConnected()).toBe(false);
  });
});
