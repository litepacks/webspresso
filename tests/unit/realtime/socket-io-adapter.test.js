/**
 * Tests for Socket.IO Adapter
 */

const {
  createSocketIoAdapter,
} = require('../../../core/realtime/adapters/socket-io');

function createMockSocket() {
  const listeners = new Map();
  const emitted = [];

  const socket = {
    connected: false,
    emitted,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return this;
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
      return this;
    },
    emit(event, ...args) {
      emitted.push({ event, args });
      // If last arg is callback function, call it
      const last = args[args.length - 1];
      if (typeof last === 'function') {
        last({ success: true });
      }
      return this;
    },
    disconnect() {
      this.connected = false;
      const set = listeners.get('disconnect');
      if (set) {
        for (const h of set) h('io client disconnect');
      }
    },
    mockTrigger(event, ...args) {
      const set = listeners.get(event);
      if (set) {
        for (const h of set) h(...args);
      }
    },
  };

  return socket;
}

describe('Socket.IO Adapter', () => {
  it('connects using mock io factory and sets auth token payload', async () => {
    let passedUrl = '';
    let passedOpts = null;
    const mockSocket = createMockSocket();

    const mockIo = (url, opts) => {
      passedUrl = url;
      passedOpts = opts;
      setTimeout(() => {
        mockSocket.connected = true;
        mockSocket.mockTrigger('connect');
      }, 5);
      return mockSocket;
    };

    const adapter = createSocketIoAdapter({
      url: 'https://socket.example.com',
      io: mockIo,
    });

    await adapter.connect({ auth: { token: 'io_jwt_token', type: 'token' } });

    expect(passedUrl).toBe('https://socket.example.com');
    expect(passedOpts.auth.token).toBe('io_jwt_token');
    expect(adapter.isConnected()).toBe(true);
  });

  it('subscribes, sends messages and receives channel events', async () => {
    const mockSocket = createMockSocket();
    const mockIo = () => {
      setTimeout(() => {
        mockSocket.connected = true;
        mockSocket.mockTrigger('connect');
      }, 5);
      return mockSocket;
    };

    const adapter = createSocketIoAdapter({
      url: 'https://socket.example.com',
      io: mockIo,
    });

    await adapter.connect({ auth: { type: 'none' } });

    const received = [];
    const sub = adapter.subscribe('room:lobby', { role: 'member' }, {
      received: (data) => received.push(data),
    });

    // Emitted subscribe event
    expect(mockSocket.emitted.some((e) => e.event === 'subscribe')).toBe(true);

    // Simulate incoming room:lobby event
    mockSocket.mockTrigger('room:lobby', { text: 'Hello socket.io' });
    expect(received).toEqual([{ text: 'Hello socket.io' }]);

    // Send on sub
    sub.send({ status: 'ready' });
    expect(mockSocket.emitted.some((e) => e.event === 'message' && e.args[0].data.status === 'ready')).toBe(true);
  });
});
