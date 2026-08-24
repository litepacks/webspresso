/**
 * Generic WebSocket Adapter for Webspresso Realtime
 * @module core/realtime/adapters/websocket
 */

/**
 * Resolve target WebSocket URL with optional auth query parameters
 * 
 * @param {string|Function} urlOption
 * @param {Object} context
 * @param {string} [authTransport='query']
 * @param {string} [queryParamName='token']
 * @returns {Promise<string>}
 */
async function resolveWebSocketUrl(urlOption, context, authTransport = 'query', queryParamName = 'token') {
  let resolved = '';
  if (typeof urlOption === 'function') {
    resolved = await urlOption(context);
  } else if (typeof urlOption === 'string') {
    resolved = urlOption;
  } else {
    throw new Error('WebSocket adapter requires a valid url string or async resolver function');
  }

  // Handle query parameter auth transport if token exists
  if (authTransport === 'query' && context.auth && context.auth.token) {
    const separator = resolved.includes('?') ? '&' : '?';
    const encodedToken = encodeURIComponent(context.auth.token);
    resolved = `${resolved}${separator}${queryParamName}=${encodedToken}`;
  }

  return resolved;
}

/**
 * Default WebSocket message formatters
 */
const DEFAULT_MESSAGE_FORMATTERS = {
  subscribe: ({ identifier, params }) => ({
    type: 'subscribe',
    identifier,
    params,
  }),
  unsubscribe: ({ identifier, params }) => ({
    type: 'unsubscribe',
    identifier,
    params,
  }),
  perform: ({ identifier, action, data }) => ({
    type: 'perform',
    identifier,
    action,
    data,
  }),
  send: ({ identifier, data }) => ({
    type: 'message',
    identifier,
    data,
  }),
  auth: ({ token, metadata }) => ({
    type: 'auth',
    token,
    ...metadata,
  }),
};

class WebSocketAdapter {
  /**
   * @param {Object} options
   * @param {string|Function} options.url - WebSocket URL or async function
   * @param {string} [options.authTransport='query'] - 'query' | 'header' | 'protocol' | 'message'
   * @param {string} [options.queryParamName='token'] - Query parameter name for token
   * @param {string|string[]} [options.protocols] - Subprotocols
   * @param {Function} [options.WebSocket] - WebSocket constructor injection
   * @param {Object} [options.messages] - Message formatters
   * @param {Object} [options.capabilities] - Custom capabilities
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

    this.messages = {
      ...DEFAULT_MESSAGE_FORMATTERS,
      ...(options.messages || {}),
    };

    this.WebSocketClass = options.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.socket = null;
    this._listeners = new Map();
    this._activeSubscriptions = new Map();
    this._isOpen = false;
  }

  isConnected() {
    return Boolean(this.socket && this._isOpen);
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
        console.error(`[websocket-adapter] Error in event listener for "${event}":`, err);
      }
    }
  }

  async connect(context) {
    if (!this.WebSocketClass) {
      throw new Error('WebSocket implementation not found. Inject options.WebSocket or run in a browser environment.');
    }

    const authTransport = this.options.authTransport || 'query';
    const queryParamName = this.options.queryParamName || 'token';

    const url = await resolveWebSocketUrl(this.options.url, context, authTransport, queryParamName);

    let protocols = this.options.protocols;
    if (authTransport === 'protocol' && context.auth && context.auth.token) {
      const authProtocol = `token.${context.auth.token}`;
      protocols = Array.isArray(protocols) ? [...protocols, authProtocol] : [authProtocol];
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;

      try {
        this.socket = protocols ? new this.WebSocketClass(url, protocols) : new this.WebSocketClass(url);
      } catch (err) {
        return reject(err);
      }

      this.socket.onopen = () => {
        this._isOpen = true;
        isSettled = true;

        if (authTransport === 'message' && context.auth && context.auth.token) {
          try {
            const authMsg = this.messages.auth({
              token: context.auth.token,
              metadata: context.auth,
            });
            this.socket.send(typeof authMsg === 'string' ? authMsg : JSON.stringify(authMsg));
          } catch (e) {
            console.error('[websocket-adapter] Failed to send auth message:', e);
          }
        }

        resolve();
      };

      this.socket.onclose = (event) => {
        this._isOpen = false;
        const code = event ? event.code : null;
        const reason = event ? event.reason : '';

        if (code === 4001 || code === 4003 || code === 4401 || (typeof reason === 'string' && reason.toLowerCase().includes('unauthorized'))) {
          this._emit('unauthorized', new Error(reason || 'Unauthorized'));
        }

        this._emit('disconnected', { code, reason });

        if (!isSettled) {
          isSettled = true;
          reject(new Error(`WebSocket connection closed before opening: ${code} ${reason}`));
        }
      };

      this.socket.onerror = (err) => {
        this._emit('error', err);
        if (!isSettled) {
          isSettled = true;
          reject(err || new Error('WebSocket connection failed'));
        }
      };

      this.socket.onmessage = (event) => {
        this._handleMessage(event.data);
      };
    });
  }

  _handleMessage(rawData) {
    let message = rawData;
    if (typeof rawData === 'string') {
      try {
        message = JSON.parse(rawData);
      } catch {
        // Raw string message
      }
    }

    if (!message || typeof message !== 'object') {
      for (const subs of this._activeSubscriptions.values()) {
        for (const cb of subs.values()) {
          cb.received?.(message);
        }
      }
      return;
    }

    const { identifier, type, data, error } = message;

    if (type === 'unauthorized' || type === 'auth_error') {
      this._emit('unauthorized', new Error(message.message || 'Unauthorized'));
      return;
    }

    if (identifier && this._activeSubscriptions.has(identifier)) {
      const subs = this._activeSubscriptions.get(identifier);
      for (const cb of subs.values()) {
        if (type === 'rejected') {
          cb.rejected?.(error || new Error(message.message || 'Subscription rejected'));
        } else if (type === 'subscribed' || type === 'connected') {
          cb.connected?.();
        } else {
          cb.received?.(data !== undefined ? data : message);
        }
      }
      return;
    }

    for (const subs of this._activeSubscriptions.values()) {
      for (const cb of subs.values()) {
        cb.received?.(message);
      }
    }
  }

  subscribe(identifier, params, callbacks) {
    if (!this._activeSubscriptions.has(identifier)) {
      this._activeSubscriptions.set(identifier, new Map());
    }

    const subId = Symbol('sub');
    this._activeSubscriptions.get(identifier).set(subId, callbacks);

    if (this.isConnected()) {
      const msg = this.messages.subscribe({ identifier, params });
      this._sendRaw(msg);
      callbacks.connected?.();
    }

    return {
      send: (data) => this.send(identifier, data),
      perform: (action, data) => this.perform(identifier, action, data),
      unsubscribe: () => this.unsubscribe(identifier, params, subId),
    };
  }

  unsubscribe(identifier, params, subId) {
    if (this._activeSubscriptions.has(identifier)) {
      const subs = this._activeSubscriptions.get(identifier);
      if (subId) {
        subs.delete(subId);
      }
      if (subs.size === 0 || !subId) {
        this._activeSubscriptions.delete(identifier);
        if (this.isConnected()) {
          const msg = this.messages.unsubscribe({ identifier, params });
          this._sendRaw(msg);
        }
      }
    }
  }

  send(identifier, data) {
    const msg = this.messages.send({ identifier, data });
    this._sendRaw(msg);
  }

  perform(identifier, action, data) {
    const msg = this.messages.perform({ identifier, action, data });
    this._sendRaw(msg);
  }

  _sendRaw(msg) {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.socket.send(payload);
  }

  disconnect() {
    this._isOpen = false;
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.onmessage = null;
        this.socket.close();
      } catch (err) {
        // Socket close
      }
      this.socket = null;
    }
  }

  destroy() {
    this.disconnect();
    this._activeSubscriptions.clear();
    this._listeners.clear();
  }
}

function createWebSocketAdapter(options = {}) {
  return new WebSocketAdapter(options);
}

module.exports = {
  createWebSocketAdapter,
  websocket: createWebSocketAdapter,
  WebSocketAdapter,
  resolveWebSocketUrl,
};
