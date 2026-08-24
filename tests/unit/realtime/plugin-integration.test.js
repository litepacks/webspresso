/**
 * Realtime Webspresso Plugin Integration Tests
 */

const path = require('path');
const { createApp } = require('../../../src/server');
const {
  realtimePlugin,
  websocket,
  realtime,
} = require('../../../plugins/realtime');

const pagesDir = path.join(__dirname, '../../fixtures/pages');
const viewsDir = path.join(__dirname, '../../fixtures/views');

class MockWebSocket {
  constructor(url) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 5);
  }
  send() {}
  close() {}
}

describe('Realtime Plugin Integration', () => {
  it('registers realtime on app and preserves SSR safety', async () => {
    const { app, shutdownManager } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      plugins: [
        realtimePlugin({
          adapter: websocket({
            url: '/realtime',
            WebSocket: MockWebSocket,
          }),
          auth: {
            strategy: 'cookie',
          },
          autoConnect: true,
          isBrowser: false, // SSR mode
        }),
      ],
    });

    expect(app.realtime).toBeDefined();
    expect(typeof app.realtime.subscribe).toBe('function');
    expect(typeof app.realtime.connect).toBe('function');

    // In SSR, no connection is opened
    expect(app.realtime.isConnected()).toBe(false);

    // Manual subscribe works without throwing
    const sub = app.realtime.subscribe('notifications');
    expect(sub.identifier).toBe('notifications');

    // App close disposes realtime cleanly
    if (typeof app.close === 'function') {
      await app.close();
    }
    expect(app.realtime.isConnected()).toBe(false);
  });

  it('universal realtime() helper can create standalone client or plugin', () => {
    const instance = realtime({
      adapter: websocket({
        url: '/realtime',
        WebSocket: MockWebSocket,
      }),
      auth: false,
    });

    expect(instance).toBeDefined();
    expect(instance.plugin).toBeDefined();
    expect(instance.plugin.name).toBe('realtime');
    expect(typeof instance.subscribe).toBe('function');

    instance.destroy();
  });
});
