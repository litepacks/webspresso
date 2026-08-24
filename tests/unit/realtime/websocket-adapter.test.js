/**
 * Tests for Generic WebSocket Adapter
 */

const {
  createWebSocketAdapter,
  resolveWebSocketUrl,
} = require('../../../core/realtime/adapters/websocket');

class MockWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.sent = [];
    this.readyState = 0; // CONNECTING

    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.({});
    }, 5);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  mockMessage(data) {
    this.onmessage?.({ data });
  }

  mockError(err) {
    this.onerror?.(err);
  }
}

describe('WebSocket Adapter', () => {
  it('resolveWebSocketUrl handles string and function with query token', async () => {
    const url1 = await resolveWebSocketUrl(
      '/realtime',
      { auth: { token: 'secret token 123' } },
      'query',
      'token'
    );
    expect(url1).toBe('/realtime?token=secret%20token%20123');

    const url2 = await resolveWebSocketUrl(
      async (ctx) => `wss://api.example.com/v1/rt?env=prod`,
      { auth: { token: 'tok_abc' } },
      'query',
      'auth_key'
    );
    expect(url2).toBe('wss://api.example.com/v1/rt?env=prod&auth_key=tok_abc');
  });

  it('connects using injected MockWebSocket and handles messages', async () => {
    const adapter = createWebSocketAdapter({
      url: 'wss://test.local/realtime',
      WebSocket: MockWebSocket,
    });

    await adapter.connect({ auth: { token: 'jwt123' } });
    expect(adapter.isConnected()).toBe(true);

    const received = [];
    adapter.subscribe('chat:100', {}, {
      received: (data) => received.push(data),
    });

    adapter.socket.mockMessage(JSON.stringify({
      identifier: 'chat:100',
      data: { text: 'Welcome!' },
    }));

    expect(received).toEqual([{ text: 'Welcome!' }]);
  });

  it('formats custom messages and sends over socket', async () => {
    const adapter = createWebSocketAdapter({
      url: 'wss://test.local/realtime',
      WebSocket: MockWebSocket,
      messages: {
        subscribe: ({ identifier, params }) => ({ cmd: 'SUB', id: identifier, ...params }),
        send: ({ identifier, data }) => ({ cmd: 'MSG', id: identifier, payload: data }),
      },
    });

    await adapter.connect({ auth: { type: 'none' } });

    adapter.subscribe('room:lobby', { private: false }, {});
    expect(adapter.socket.sent).toContain(JSON.stringify({ cmd: 'SUB', id: 'room:lobby', private: false }));

    adapter.send('room:lobby', { hello: 'world' });
    expect(adapter.socket.sent).toContain(JSON.stringify({ cmd: 'MSG', id: 'room:lobby', payload: { hello: 'world' } }));
  });

  it('supports initial message auth transport', async () => {
    const adapter = createWebSocketAdapter({
      url: 'wss://test.local/realtime',
      authTransport: 'message',
      WebSocket: MockWebSocket,
    });

    await adapter.connect({ auth: { token: 'init_msg_token' } });
    expect(adapter.socket.sent).toContain(JSON.stringify({ type: 'auth', token: 'init_msg_token' }));
  });

  it('emits unauthorized when close code is 4001 or 4401', async () => {
    const adapter = createWebSocketAdapter({
      url: 'wss://test.local/realtime',
      WebSocket: MockWebSocket,
    });

    await adapter.connect({ auth: { type: 'none' } });

    let unauthFired = false;
    adapter.on('unauthorized', () => {
      unauthFired = true;
    });

    adapter.socket.close(4001, 'Unauthorized');
    expect(unauthFired).toBe(true);
  });
});
