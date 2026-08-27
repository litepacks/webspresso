/**
 * Webspresso Realtime Plugin
 * Realtime plugin for Webspresso applications
 * @module plugins/realtime
 */

const {
  createRealtime,
  RealtimeClient,
  RealtimeSubscription,
  SubscriptionRegistry,
  createSubscriptionKey,
  AuthManager,
  ReconnectManager,
  RealtimeError,
  normalizeRealtimeError,
  sanitizeErrorMessage,
  EventEmitter,
  DEFAULT_CAPABILITIES,

  // Adapters
  websocket,
  createWebSocketAdapter,
  WebSocketAdapter,
  resolveWebSocketUrl,

  sse,
  createSseAdapter,
  SseAdapter,
  resolveSseUrl,

  socketIo,
  createSocketIoAdapter,
  SocketIoAdapter,

  redis,
  createRedisAdapter,
  RedisAdapter,
} = require('../../core/realtime');

/**
 * Webspresso Realtime Plugin Factory
 * 
 * @param {Object} options
 * @returns {Object} Webspresso plugin definition
 */
function realtimePlugin(options = {}) {
  let clientInstance = null;

  return {
    name: 'realtime',
    version: '1.0.0',
    description: 'Framework-agnostic, plugin-based realtime layer for Webspresso',
    _options: options,

    api: {
      getClient: () => clientInstance,
    },

    setup(app) {
      if (!clientInstance) {
        clientInstance = createRealtime(options);
      }

      if (app) {
        app.realtime = clientInstance;
      }

      return () => {
        if (clientInstance) {
          clientInstance.destroy();
        }
      };
    },

    register(ctx) {
      if (!clientInstance) {
        clientInstance = createRealtime(options);
      }

      if (ctx.app) {
        ctx.app.realtime = clientInstance;
      }

      if (typeof ctx.onDispose === 'function') {
        ctx.onDispose(() => {
          if (clientInstance) {
            clientInstance.destroy();
          }
        });
      }
    },

    browserReady(app) {
      if (clientInstance) {
        clientInstance.browserReady();
      }
    },

    destroy(app) {
      if (clientInstance) {
        clientInstance.destroy();
        clientInstance = null;
      }
    },
  };
}

function realtime(options = {}) {
  const client = createRealtime(options);
  client.plugin = realtimePlugin(options);
  return client;
}

module.exports = {
  realtimePlugin,
  realtime,
  createRealtime,
  RealtimeClient,
  RealtimeSubscription,
  SubscriptionRegistry,
  createSubscriptionKey,
  AuthManager,
  ReconnectManager,
  RealtimeError,
  normalizeRealtimeError,
  sanitizeErrorMessage,
  EventEmitter,
  DEFAULT_CAPABILITIES,

  // Adapters
  websocket,
  createWebSocketAdapter,
  WebSocketAdapter,
  resolveWebSocketUrl,

  sse,
  createSseAdapter,
  SseAdapter,
  resolveSseUrl,

  socketIo,
  createSocketIoAdapter,
  SocketIoAdapter,

  redis,
  createRedisAdapter,
  RedisAdapter,
};

