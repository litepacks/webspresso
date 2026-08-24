/**
 * Tests for Server-Sent Events (SSE) Adapter
 */

const {
  createSseAdapter,
  resolveSseUrl,
} = require('../../../core/realtime/adapters/sse');

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;

    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 5);
  }

  close() {
    this.readyState = 2;
  }

  mockMessage(data) {
    this.onmessage?.({ data });
  }

  mockError(err) {
    this.onerror?.(err);
  }
}

describe('SSE Adapter', () => {
  it('declares read-only capabilities and URL resolver', async () => {
    const adapter = createSseAdapter({
      url: '/events',
      EventSource: MockEventSource,
    });

    expect(adapter.capabilities.send).toBe(false);
    expect(adapter.capabilities.perform).toBe(false);
    expect(adapter.capabilities.serverEvents).toBe(true);

    const url = await resolveSseUrl('/events', { auth: { token: 'sse_tok' } });
    expect(url).toBe('/events?token=sse_tok');
  });

  it('connects via MockEventSource and receives messages', async () => {
    const adapter = createSseAdapter({
      url: '/api/sse',
      EventSource: MockEventSource,
    });

    await adapter.connect({ auth: { token: '123' } });
    expect(adapter.isConnected()).toBe(true);

    const received = [];
    adapter.subscribe('notifications', {}, {
      received: (data) => received.push(data),
    });

    adapter.eventSource.mockMessage(JSON.stringify({
      identifier: 'notifications',
      data: { id: 1, title: 'New alert' },
    }));

    expect(received).toEqual([{ id: 1, title: 'New alert' }]);
  });
});
