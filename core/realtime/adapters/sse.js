/**
 * Server-Sent Events (SSE) Adapter for Webspresso Realtime
 * @module core/realtime/adapters/sse
 */

/**
 * Resolve target SSE URL with auth query parameters
 * 
 * @param {string|Function} urlOption
 * @param {Object} context
 * @param {string} [queryParamName='token']
 * @returns {Promise<string>}
 */
async function resolveSseUrl(urlOption, context, queryParamName = 'token') {
  let resolved = '';
  if (typeof urlOption === 'function') {
    resolved = await urlOption(context);
  } else if (typeof urlOption === 'string') {
    resolved = urlOption;
  } else {
    throw new Error('SSE adapter requires a valid url string or async resolver function');
  }

  if (context.auth && context.auth.token) {
    const separator = resolved.includes('?') ? '&' : '?';
    const encodedToken = encodeURIComponent(context.auth.token);
    resolved = `${resolved}${separator}${queryParamName}=${encodedToken}`;
  }

  return resolved;
}

class SseAdapter {
  /**
   * @param {Object} options
   * @param {string|Function} options.url - SSE endpoint URL or async resolver
   * @param {string} [options.queryParamName='token'] - Query parameter name for token
   * @param {Function} [options.EventSource] - EventSource constructor injection
   * @param {Object} [options.capabilities] - Custom capabilities override
   */
  constructor(options = {}) {
    this.options = options;
    this.capabilities = {
      send: false,
      perform: false,
      multiplexing: true,
      serverEvents: true,
      binary: false,
      ...(options.capabilities || {}),
    };

    this.EventSourceClass = options.EventSource || (typeof EventSource !== 'undefined' ? EventSource : null);
    this.eventSource = null;
    this._listeners = new Map();
    this._subscriptions = new Map();
    this._isOpen = false;
  }

  isConnected() {
    return Boolean(this.eventSource && this._isOpen);
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
        console.error(`[sse-adapter] Error in event listener for "${event}":`, err);
      }
    }
  }

  async connect(context) {
    if (!this.EventSourceClass) {
      throw new Error('EventSource implementation not found. Inject options.EventSource or run in a browser environment.');
    }

    const queryParamName = this.options.queryParamName || 'token';
    const url = await resolveSseUrl(this.options.url, context, queryParamName);

    return new Promise((resolve, reject) => {
      let isSettled = false;

      try {
        this.eventSource = new this.EventSourceClass(url);
      } catch (err) {
        return reject(err);
      }

      this.eventSource.onopen = () => {
        this._isOpen = true;
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      };

      this.eventSource.onerror = (err) => {
        this._isOpen = false;
        this._emit('disconnected', err);
        if (!isSettled) {
          isSettled = true;
          reject(err || new Error('SSE connection failed'));
        }
      };

      this.eventSource.onmessage = (event) => {
        this._handleMessage(event.data);
      };
    });
  }

  _handleMessage(rawData) {
    let data = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // Raw string
    }

    const identifier = data && typeof data === 'object' ? data.identifier : null;

    if (identifier && this._subscriptions.has(identifier)) {
      const subs = this._subscriptions.get(identifier);
      for (const cb of subs) {
        cb.received?.(data.data !== undefined ? data.data : data);
      }
      return;
    }

    for (const subs of this._subscriptions.values()) {
      for (const cb of subs) {
        cb.received?.(data);
      }
    }
  }

  subscribe(identifier, params, callbacks) {
    if (!this._subscriptions.has(identifier)) {
      this._subscriptions.set(identifier, new Set());
    }

    this._subscriptions.get(identifier).add(callbacks);
    callbacks.connected?.();

    return {
      send: () => {
        throw new Error('SSE adapter is unidirectional and does not support send()');
      },
      perform: () => {
        throw new Error('SSE adapter is unidirectional and does not support perform()');
      },
      unsubscribe: () => this.unsubscribe(identifier, params, callbacks),
    };
  }

  unsubscribe(identifier, params, callbacks) {
    if (this._subscriptions.has(identifier)) {
      const subs = this._subscriptions.get(identifier);
      if (callbacks) {
        subs.delete(callbacks);
      }
      if (subs.size === 0 || !callbacks) {
        this._subscriptions.delete(identifier);
      }
    }
  }

  disconnect() {
    this._isOpen = false;
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch (err) {
        // Closed
      }
      this.eventSource = null;
    }
  }

  destroy() {
    this.disconnect();
    this._subscriptions.clear();
    this._listeners.clear();
  }
}

function createSseAdapter(options = {}) {
  return new SseAdapter(options);
}

module.exports = {
  createSseAdapter,
  sse: createSseAdapter,
  SseAdapter,
  resolveSseUrl,
};
