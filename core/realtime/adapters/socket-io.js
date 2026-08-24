/**
 * Socket.IO Adapter for Webspresso Realtime
 * @module core/realtime/adapters/socket-io
 */

class SocketIoAdapter {
  /**
   * @param {Object} options
   * @param {string|Function} options.url - Target URL
   * @param {string} [options.path='/socket.io'] - Socket.IO path
   * @param {Function} [options.io] - Socket.IO client factory injection
   * @param {Object} [options.socketOptions] - Custom Socket.IO client options
   * @param {Object} [options.capabilities] - Custom capabilities override
   */
  constructor(options = {}) {
    this.options = options;
    this.capabilities = {
      send: true,
      perform: true,
      multiplexing: true,
      serverEvents: true,
      binary: true,
      ...(options.capabilities || {}),
    };

    this.ioFactory = options.io || (typeof globalThis.io === 'function' ? globalThis.io : null);
    this.socket = null;
    this._listeners = new Map();
    this._subscriptions = new Map();
    this._isOpen = false;
  }

  isConnected() {
    return Boolean(this.socket && (this.socket.connected || this._isOpen));
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => {
      const set = this._listeners.get(event);
      if (set) set.delete(handler);
    };
  }

  _emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[socket-io-adapter] Error in event listener for "${event}":`, err);
      }
    }
  }

  async connect(context) {
    if (!this.ioFactory) {
      throw new Error('Socket.IO client implementation not found. Inject options.io or install socket.io-client.');
    }

    let url = typeof this.options.url === 'function' ? await this.options.url(context) : (this.options.url || '');

    const clientOpts = {
      path: this.options.path || '/socket.io',
      auth: context.auth ? { token: context.auth.token, ...context.auth } : {},
      autoConnect: true,
      ...(this.options.socketOptions || {}),
    };

    return new Promise((resolve, reject) => {
      let isSettled = false;

      try {
        this.socket = this.ioFactory(url, clientOpts);
      } catch (err) {
        return reject(err);
      }

      this.socket.on('connect', () => {
        this._isOpen = true;
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      });

      this.socket.on('disconnect', (reason) => {
        this._isOpen = false;
        this._emit('disconnected', reason);
      });

      this.socket.on('connect_error', (err) => {
        this._isOpen = false;
        const msg = err && err.message ? err.message.toLowerCase() : '';
        if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('auth')) {
          this._emit('unauthorized', err);
        } else {
          this._emit('error', err);
        }

        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });
    });
  }

  subscribe(identifier, params, callbacks) {
    if (!this._subscriptions.has(identifier)) {
      this._subscriptions.set(identifier, new Map());
    }

    const subId = Symbol('socketio-sub');
    this._subscriptions.get(identifier).set(subId, callbacks);

    if (this.isConnected()) {
      this.socket.emit('subscribe', { identifier, params }, (response) => {
        if (response && response.error) {
          callbacks.rejected?.(new Error(response.error));
        } else {
          callbacks.connected?.();
        }
      });
    }

    const eventHandler = (data) => {
      callbacks.received?.(data);
    };

    if (this.socket) {
      this.socket.on(identifier, eventHandler);
    }

    return {
      send: (data) => this.send(identifier, data),
      perform: (action, data) => this.perform(identifier, action, data),
      unsubscribe: () => this.unsubscribe(identifier, params, subId, eventHandler),
    };
  }

  unsubscribe(identifier, params, subId, eventHandler) {
    if (this._subscriptions.has(identifier)) {
      const subs = this._subscriptions.get(identifier);
      if (subId) subs.delete(subId);
      if (subs.size === 0 || !subId) {
        this._subscriptions.delete(identifier);
        if (this.socket) {
          this.socket.emit('unsubscribe', { identifier, params });
          if (eventHandler) {
            this.socket.off(identifier, eventHandler);
          }
        }
      }
    }
  }

  send(identifier, data) {
    if (!this.isConnected()) {
      throw new Error('Socket.IO is not connected');
    }
    this.socket.emit('message', { identifier, data });
  }

  perform(identifier, action, data) {
    if (!this.isConnected()) {
      throw new Error('Socket.IO is not connected');
    }
    this.socket.emit('perform', { identifier, action, data });
  }

  disconnect() {
    this._isOpen = false;
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (e) {
        // Disconnected
      }
      this.socket = null;
    }
  }

  destroy() {
    this.disconnect();
    this._subscriptions.clear();
    this._listeners.clear();
  }
}

function createSocketIoAdapter(options = {}) {
  return new SocketIoAdapter(options);
}

module.exports = {
  createSocketIoAdapter,
  socketIo: createSocketIoAdapter,
  SocketIoAdapter,
};
