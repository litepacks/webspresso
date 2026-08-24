/**
 * Realtime Core Client
 * @module core/realtime/core
 */

const { EventEmitter } = require('./emitter');
const { AuthManager } = require('./auth-manager');
const { SubscriptionRegistry } = require('./registry');
const { ReconnectManager } = require('./reconnect-manager');
const { RealtimeError, normalizeRealtimeError } = require('./errors');

const DEFAULT_CAPABILITIES = Object.freeze({
  send: true,
  perform: true,
  multiplexing: true,
  serverEvents: true,
  binary: false,
});

/**
 * Check whether the current execution context is in a browser environment
 * @returns {boolean}
 */
function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

class RealtimeClient {
  /**
   * @param {Object} options
   * @param {Object} options.adapter - Realtime transport adapter (e.g. websocket, sse, socketIo)
   * @param {Object|boolean} [options.auth=false] - Auth strategy configuration
   * @param {boolean} [options.autoConnect=true] - Auto-connect when browser is ready
   * @param {Object} [options.reconnect] - Reconnection options
   * @param {boolean} [options.isBrowser] - Force browser environment flag for testing
   */
  constructor(options = {}) {
    if (!options.adapter || typeof options.adapter !== 'object') {
      throw new RealtimeError('INVALID_ARGUMENT', 'RealtimeClient requires a valid adapter');
    }

    this.options = options;
    this.adapter = options.adapter;
    this.auth = new AuthManager(options.auth);
    this.registry = new SubscriptionRegistry();
    this.reconnectManager = new ReconnectManager(options.reconnect);
    this.emitter = new EventEmitter();

    this._autoConnect = options.autoConnect !== false;
    this._isBrowserOverride = typeof options.isBrowser === 'boolean' ? options.isBrowser : null;
    this._isConnecting = false;
    this._isDestroyed = false;
    this._hasConnectedBefore = false;

    // Wire up adapter low-level events
    this._wireAdapterEvents();

    // Auto-connect if in browser environment
    if (this._autoConnect && this.isBrowser()) {
      Promise.resolve().then(() => {
        if (!this._isDestroyed && !this.isConnected()) {
          this.connect().catch(() => {});
        }
      });
    }
  }

  isBrowser() {
    if (this._isBrowserOverride !== null) {
      return this._isBrowserOverride;
    }
    return isBrowserEnvironment();
  }

  get capabilities() {
    if (this.adapter && this.adapter.capabilities && typeof this.adapter.capabilities === 'object') {
      return { ...DEFAULT_CAPABILITIES, ...this.adapter.capabilities };
    }
    return { ...DEFAULT_CAPABILITIES };
  }

  isConnected() {
    if (this._isDestroyed) return false;
    if (this.adapter && typeof this.adapter.isConnected === 'function') {
      return this.adapter.isConnected();
    }
    return false;
  }

  on(event, handler) {
    return this.emitter.on(event, handler);
  }

  once(event, handler) {
    return this.emitter.once(event, handler);
  }

  off(event, handler) {
    this.emitter.off(event, handler);
  }

  async connect(overrideAuth = null) {
    if (this._isDestroyed) {
      throw new RealtimeError('DESTROYED', 'Cannot connect on a destroyed Realtime instance');
    }

    // SSR Guard: Never open network connections during server-side rendering
    if (!this.isBrowser()) {
      return;
    }

    if (this.isConnected() || this._isConnecting) {
      return;
    }

    this._isConnecting = true;

    try {
      let authMetadata = overrideAuth;
      if (!authMetadata) {
        authMetadata = await this.auth.resolveAuthMetadata();
      }

      const connectionContext = {
        auth: authMetadata,
        client: this,
      };

      await this.adapter.connect(connectionContext);

      this._isConnecting = false;
      const isReconnection = this._hasConnectedBefore;
      this._hasConnectedBefore = true;

      this.reconnectManager.reset();

      this.registry.restoreAll((sub) => {
        return this._adapterSubscribe(sub);
      });

      if (isReconnection) {
        this.emitter.emit('reconnected');
      }
      this.emitter.emit('connected');
    } catch (err) {
      this._isConnecting = false;
      const error = normalizeRealtimeError(err, 'CONNECTION_FAILED', 'Realtime connection failed');

      if (error.code === 'UNAUTHORIZED') {
        this.auth.handleUnauthorized(error);
        this.emitter.emit('unauthorized', error);
      }

      this.emitter.emit('error', error);
      throw error;
    }
  }

  disconnect() {
    if (this._isDestroyed) return;

    this.reconnectManager.reset();

    if (this.adapter && typeof this.adapter.disconnect === 'function') {
      try {
        this.adapter.disconnect();
      } catch (err) {
        console.error('[realtime] Error during adapter disconnect:', err);
      }
    }

    this.registry.notifyAllDisconnected();
    this.emitter.emit('disconnected');
  }

  async reconnect() {
    if (this._isDestroyed) {
      throw new RealtimeError('DESTROYED', 'Cannot reconnect on a destroyed Realtime instance');
    }

    this.disconnect();
    return this.connect();
  }

  async reauthenticate() {
    if (this._isDestroyed) {
      throw new RealtimeError('DESTROYED', 'Cannot reauthenticate on a destroyed Realtime instance');
    }

    if (!this.isBrowser()) return;

    try {
      this.disconnect();
      const newAuth = await this.auth.refreshToken();
      await this.connect(newAuth);
    } catch (err) {
      const error = normalizeRealtimeError(err, 'TOKEN_REFRESH_FAILED', 'Reauthentication failed');
      this.emitter.emit('error', error);
      throw error;
    }
  }

  subscribe(identifier, params = {}, callbacks = {}) {
    if (this._isDestroyed) {
      throw new RealtimeError('DESTROYED', 'Cannot subscribe on a destroyed Realtime instance');
    }

    return this.registry.register({
      identifier,
      params,
      callbacks,
      onSend: (sub, data) => this._handleSubscriptionSend(sub, data),
      onPerform: (sub, action, data) => this._handleSubscriptionPerform(sub, action, data),
      onAdapterSubscribe: (sub) => {
        if (this.isConnected()) {
          return this._adapterSubscribe(sub);
        }
        return null;
      },
      onAdapterUnsubscribe: (sub) => {
        if (this.adapter && typeof this.adapter.unsubscribe === 'function') {
          try {
            this.adapter.unsubscribe(sub.identifier, sub.params, sub);
          } catch (err) {
            console.error(`[realtime] Error unsubscribing "${sub.identifier}":`, err);
          }
        }
      },
    });
  }

  _adapterSubscribe(sub) {
    if (!this.adapter || typeof this.adapter.subscribe !== 'function') {
      return null;
    }

    const adapterCallbacks = {
      connected: () => sub.notifyConnected(),
      disconnected: () => sub.notifyDisconnected(),
      rejected: (err) => {
        const error = normalizeRealtimeError(err, 'SUBSCRIPTION_REJECTED', `Subscription "${sub.identifier}" rejected`);
        sub.notifyRejected(error);
        this.emitter.emit('error', error);
      },
      received: (data) => sub.notifyReceived(data),
    };

    try {
      return this.adapter.subscribe(sub.identifier, sub.params, adapterCallbacks);
    } catch (err) {
      const error = normalizeRealtimeError(err, 'SUBSCRIPTION_REJECTED', `Failed to subscribe to "${sub.identifier}"`);
      sub.notifyRejected(error);
      this.emitter.emit('error', error);
      return null;
    }
  }

  _handleSubscriptionSend(sub, data) {
    if (!this.capabilities.send) {
      throw new RealtimeError('UNSUPPORTED_CAPABILITY', 'Active realtime adapter does not support send()');
    }

    if (this.adapter && typeof this.adapter.send === 'function') {
      this.adapter.send(sub.identifier, data, sub);
    } else if (sub._adapterSub && typeof sub._adapterSub.send === 'function') {
      sub._adapterSub.send(data);
    } else {
      throw new RealtimeError('UNSUPPORTED_CAPABILITY', 'Adapter does not implement send');
    }
  }

  _handleSubscriptionPerform(sub, action, data) {
    if (this.capabilities.perform) {
      if (this.adapter && typeof this.adapter.perform === 'function') {
        this.adapter.perform(sub.identifier, action, data, sub);
        return;
      }

      if (sub._adapterSub && typeof sub._adapterSub.perform === 'function') {
        sub._adapterSub.perform(action, data);
        return;
      }
    }

    // If perform is unsupported but send is available, map to generic action command
    if (this.capabilities.send) {
      this._handleSubscriptionSend(sub, { action, data });
      return;
    }

    throw new RealtimeError('UNSUPPORTED_CAPABILITY', 'Active realtime adapter does not support perform() or send()');
  }

  _wireAdapterEvents() {
    if (!this.adapter || typeof this.adapter.on !== 'function') return;

    this.adapter.on('disconnected', (reason) => {
      this.registry.notifyAllDisconnected();
      this.emitter.emit('disconnected', reason);

      if (!this._isDestroyed && this.reconnectManager.canReconnect()) {
        this.reconnectManager.schedule(
          async () => {
            await this.connect();
          },
          ({ attempt, delay, maxAttempts }) => {
            this.emitter.emit('reconnecting', { attempt, delay, maxAttempts });
          }
        );
      }
    });

    this.adapter.on('unauthorized', (err) => {
      const error = normalizeRealtimeError(err, 'UNAUTHORIZED', 'Realtime connection unauthorized');
      this.auth.handleUnauthorized(error);
      this.emitter.emit('unauthorized', error);
    });

    this.adapter.on('error', (err) => {
      const error = normalizeRealtimeError(err, 'CONNECTION_FAILED', 'Adapter error');
      this.emitter.emit('error', error);
    });
  }

  browserReady() {
    if (this._isDestroyed) return;
    if (this._autoConnect && !this.isConnected() && !this._isConnecting) {
      this.connect().catch(() => {});
    }
  }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    this.reconnectManager.cancel();
    this.registry.clear();

    if (this.adapter) {
      try {
        if (typeof this.adapter.disconnect === 'function') {
          this.adapter.disconnect();
        }
        if (typeof this.adapter.destroy === 'function') {
          this.adapter.destroy();
        }
      } catch (err) {
        console.error('[realtime] Error destroying adapter:', err);
      }
    }

    this.emitter.clear();
  }
}

module.exports = {
  RealtimeClient,
  DEFAULT_CAPABILITIES,
};
