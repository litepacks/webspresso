const { EventEmitter } = require('events');
const { createSocketIoAdapter, SocketIoAdapter } = require('../../core/realtime/adapters/socket-io');
const { createSseAdapter, SseAdapter, resolveSseUrl } = require('../../core/realtime/adapters/sse');

class MockSocket extends EventEmitter {
  constructor(url, opts) {
    super();
    this.url = url;
    this.opts = opts;
    this.connected = true;
    setTimeout(() => this.emit('connect'), 5);
  }

  emit(event, ...args) {
    if (event === 'subscribe') {
      const [payload, ack] = args;
      if (payload.identifier === 'forbidden-channel') {
        ack?.({ error: 'Access denied' });
      } else {
        ack?.({ ok: true });
      }
      return true;
    }
    return super.emit(event, ...args);
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnect', 'client-disconnect');
  }

  off(event, handler) {
    this.removeListener(event, handler);
  }
}

class MockEventSource extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1;
    setTimeout(() => {
      if (this.onopen) this.onopen();
      this.emit('open');
    }, 5);
  }

  close() {
    this.readyState = 2;
  }

  addEventListener(event, handler) {
    this.on(event, handler);
  }

  removeEventListener(event, handler) {
    this.removeListener(event, handler);
  }
}

describe('Realtime Adapters (core/realtime/adapters)', () => {
  describe('SocketIoAdapter', () => {
    it('should throw when ioFactory is missing', async () => {
      const adapter = createSocketIoAdapter({ url: 'http://localhost:3000' });
      await expect(adapter.connect({ auth: null })).rejects.toThrow('Socket.IO client implementation not found');
    });

    it('should connect, subscribe, send messages, and disconnect', async () => {
      const mockIo = (url, opts) => new MockSocket(url, opts);
      const adapter = createSocketIoAdapter({
        url: async (ctx) => `http://localhost:${ctx.port}`,
        io: mockIo,
      });

      expect(adapter.isConnected()).toBe(false);

      await adapter.connect({ port: 8080, auth: { token: 'jwt-123' } });
      expect(adapter.isConnected()).toBe(true);

      let connectedCalled = false;
      let receivedData = null;

      const sub = adapter.subscribe('chat:1', {}, {
        connected: () => { connectedCalled = true; },
        received: (data) => { receivedData = data; },
      });

      expect(connectedCalled).toBe(true);

      // Trigger incoming event on socket
      adapter.socket.emit('chat:1', { text: 'Hello!' });
      expect(receivedData).toEqual({ text: 'Hello!' });

      // Send & perform
      expect(() => sub.send({ text: 'Reply' })).not.toThrow();
      expect(() => sub.perform('typing', { isTyping: true })).not.toThrow();

      // Unsubscribe
      sub.unsubscribe();

      // Disconnect
      adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);

      // Operations after disconnect should throw
      expect(() => adapter.send('chat:1', {})).toThrow('not connected');
      expect(() => adapter.perform('chat:1', 'action', {})).toThrow('not connected');
    });

    it('should handle connect_error and unauthorized events', async () => {
      const failingIo = () => {
        const sock = new EventEmitter();
        setTimeout(() => sock.emit('connect_error', new Error('Unauthorized access')), 5);
        return sock;
      };

      const adapter = createSocketIoAdapter({
        url: 'http://localhost:3000',
        io: failingIo,
      });

      let unauthorizedErr = null;
      adapter.on('unauthorized', (err) => { unauthorizedErr = err; });

      await expect(adapter.connect({ auth: null })).rejects.toThrow('Unauthorized access');
      expect(unauthorizedErr).not.toBeNull();
    });
  });

  describe('SseAdapter', () => {
    it('resolveSseUrl should append query token to URL', async () => {
      expect(await resolveSseUrl('http://example.com/events', { auth: { token: 'abc' } }))
        .toBe('http://example.com/events?token=abc');
      expect(await resolveSseUrl('http://example.com/events?existing=1', { auth: { token: 'abc' } }))
        .toBe('http://example.com/events?existing=1&token=abc');
      await expect(resolveSseUrl(null, {})).rejects.toThrow('requires a valid url string');
    });

    it('should connect and dispatch server events to subscriptions', async () => {
      const adapter = createSseAdapter({
        url: 'http://localhost:3000/events',
        EventSource: MockEventSource,
      });

      let unauthCalled = false;
      const unsub = adapter.on('unauthorized', () => { unauthCalled = true; });

      await adapter.connect({ auth: null });
      expect(adapter.isConnected()).toBe(true);

      let msgData = null;
      const sub = adapter.subscribe('notifications', {}, {
        received: (data) => { msgData = data; },
      });

      // Emit event on EventSource
      adapter.eventSource.onmessage({
        data: JSON.stringify({ identifier: 'notifications', data: { alert: 'Ping' } }),
      });
      expect(msgData).toEqual({ alert: 'Ping' });

      // Clean up
      unsub();
      sub.unsubscribe();
      adapter.destroy();
      expect(adapter.isConnected()).toBe(false);
    });
  });
});
