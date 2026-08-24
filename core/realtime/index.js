/**
 * Webspresso Realtime Core
 * @module core/realtime
 */

const { RealtimeClient, DEFAULT_CAPABILITIES } = require('./core');
const { RealtimeSubscription, SubscriptionRegistry, createSubscriptionKey } = require('./registry');
const { AuthManager } = require('./auth-manager');
const { ReconnectManager } = require('./reconnect-manager');
const { RealtimeError, normalizeRealtimeError, sanitizeErrorMessage } = require('./errors');
const { EventEmitter } = require('./emitter');

// Adapters
const { createWebSocketAdapter, websocket, WebSocketAdapter, resolveWebSocketUrl } = require('./adapters/websocket');
const { createSseAdapter, sse, SseAdapter, resolveSseUrl } = require('./adapters/sse');
const { createSocketIoAdapter, socketIo, SocketIoAdapter } = require('./adapters/socket-io');

/**
 * Factory to create a RealtimeClient instance
 * 
 * @param {Object} options
 * @param {Object} options.adapter - Transport adapter (e.g. websocket, sse, socketIo)
 * @param {Object|boolean} [options.auth=false] - Auth strategy configuration
 * @param {boolean} [options.autoConnect=true] - Auto-connect when browser is ready
 * @param {Object} [options.reconnect] - Reconnection options
 * @returns {RealtimeClient}
 */
function createRealtime(options = {}) {
  return new RealtimeClient(options);
}

/**
 * Universal realtime helper
 * 
 * @param {Object} options
 * @returns {RealtimeClient}
 */
function realtime(options = {}) {
  const client = createRealtime(options);
  return client;
}

module.exports = {
  createRealtime,
  realtime,
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
};
