/**
 * Realtime Subscription Registry & Subscription Handle
 * @module core/realtime/registry
 */

const { RealtimeError } = require('./errors');

/**
 * Generate a deterministic composite key for a subscription from identifier and params
 * 
 * @param {string} identifier
 * @param {Object} [params={}]
 * @returns {string}
 */
function createSubscriptionKey(identifier, params = {}) {
  if (!identifier || typeof identifier !== 'string') {
    throw new RealtimeError('INVALID_ARGUMENT', 'Subscription identifier must be a non-empty string');
  }

  let serializedParams = '';
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    const sortedKeys = Object.keys(params).sort();
    const sortedObj = {};
    for (const key of sortedKeys) {
      sortedObj[key] = params[key];
    }
    serializedParams = JSON.stringify(sortedObj);
  }

  return `${identifier}::${serializedParams}`;
}

/**
 * Realtime Subscription Handle
 */
class RealtimeSubscription {
  /**
   * @param {Object} options
   * @param {string} options.key - Unique subscription key
   * @param {string} options.identifier - Topic/Channel identifier (e.g. "project:123")
   * @param {Object} [options.params={}] - Parameters passed to subscription
   * @param {Object} [options.callbacks={}] - Callbacks { connected, disconnected, rejected, received }
   * @param {Function} options.onUnsubscribe - Internal unsubscribe callback
   * @param {Function} options.onSend - Internal send handler
   * @param {Function} options.onPerform - Internal perform handler
   */
  constructor({ key, identifier, params = {}, callbacks = {}, onUnsubscribe, onSend, onPerform }) {
    this.key = key;
    this.identifier = identifier;
    this.params = params;
    this.callbacks = {
      connected: typeof callbacks.connected === 'function' ? callbacks.connected : null,
      disconnected: typeof callbacks.disconnected === 'function' ? callbacks.disconnected : null,
      rejected: typeof callbacks.rejected === 'function' ? callbacks.rejected : null,
      received: typeof callbacks.received === 'function' ? callbacks.received : null,
    };
    this._onUnsubscribe = onUnsubscribe;
    this._onSend = onSend;
    this._onPerform = onPerform;
    this._isUnsubscribed = false;
    this._adapterSub = null;
  }

  /**
   * Send data to this subscription
   * @param {unknown} data
   */
  send(data) {
    if (this._isUnsubscribed) {
      throw new RealtimeError('SUBSCRIPTION_REJECTED', 'Cannot send data on an unsubscribed channel');
    }
    if (typeof this._onSend === 'function') {
      this._onSend(this, data);
    }
  }

  /**
   * Perform an action on this subscription
   * @param {string} action
   * @param {unknown} [data]
   */
  perform(action, data) {
    if (this._isUnsubscribed) {
      throw new RealtimeError('SUBSCRIPTION_REJECTED', 'Cannot perform action on an unsubscribed channel');
    }
    if (typeof this._onPerform === 'function') {
      this._onPerform(this, action, data);
    }
  }

  /**
   * Unsubscribe from this channel
   */
  unsubscribe() {
    if (this._isUnsubscribed) return;
    this._isUnsubscribed = true;
    if (typeof this._onUnsubscribe === 'function') {
      this._onUnsubscribe(this);
    }
  }

  notifyReceived(data) {
    if (this._isUnsubscribed) return;
    if (this.callbacks.received) {
      try {
        this.callbacks.received(data);
      } catch (err) {
        console.error(`[realtime] Error in received callback for "${this.identifier}":`, err);
      }
    }
  }

  notifyConnected() {
    if (this._isUnsubscribed) return;
    if (this.callbacks.connected) {
      try {
        this.callbacks.connected();
      } catch (err) {
        console.error(`[realtime] Error in connected callback for "${this.identifier}":`, err);
      }
    }
  }

  notifyDisconnected() {
    if (this._isUnsubscribed) return;
    if (this.callbacks.disconnected) {
      try {
        this.callbacks.disconnected();
      } catch (err) {
        console.error(`[realtime] Error in disconnected callback for "${this.identifier}":`, err);
      }
    }
  }

  notifyRejected(error) {
    if (this._isUnsubscribed) return;
    if (this.callbacks.rejected) {
      try {
        this.callbacks.rejected(error);
      } catch (err) {
        console.error(`[realtime] Error in rejected callback for "${this.identifier}":`, err);
      }
    }
  }
}

/**
 * Subscription Registry
 */
class SubscriptionRegistry {
  constructor() {
    /** @type {Map<string, RealtimeSubscription>} */
    this.subscriptions = new Map();
  }

  has(key) {
    return this.subscriptions.has(key);
  }

  get(key) {
    return this.subscriptions.get(key);
  }

  register({ identifier, params = {}, callbacks = {}, onSend, onPerform, onAdapterSubscribe, onAdapterUnsubscribe }) {
    const key = createSubscriptionKey(identifier, params);

    // If already registered and active, return existing subscription
    if (this.subscriptions.has(key)) {
      const existing = this.subscriptions.get(key);
      if (!existing._isUnsubscribed) {
        if (callbacks.received) existing.callbacks.received = callbacks.received;
        if (callbacks.connected) existing.callbacks.connected = callbacks.connected;
        if (callbacks.disconnected) existing.callbacks.disconnected = callbacks.disconnected;
        if (callbacks.rejected) existing.callbacks.rejected = callbacks.rejected;
        return existing;
      }
    }

    const subscription = new RealtimeSubscription({
      key,
      identifier,
      params,
      callbacks,
      onUnsubscribe: (sub) => {
        this.subscriptions.delete(key);
        if (typeof onAdapterUnsubscribe === 'function') {
          onAdapterUnsubscribe(sub);
        }
      },
      onSend,
      onPerform,
    });

    this.subscriptions.set(key, subscription);

    if (typeof onAdapterSubscribe === 'function') {
      subscription._adapterSub = onAdapterSubscribe(subscription);
    }

    return subscription;
  }

  restoreAll(onAdapterSubscribe) {
    if (typeof onAdapterSubscribe !== 'function') return;

    for (const [key, sub] of this.subscriptions.entries()) {
      if (!sub._isUnsubscribed) {
        try {
          sub._adapterSub = onAdapterSubscribe(sub);
        } catch (err) {
          console.error(`[realtime] Failed to restore subscription "${sub.identifier}":`, err);
        }
      } else {
        this.subscriptions.delete(key);
      }
    }
  }

  notifyAllDisconnected() {
    for (const sub of this.subscriptions.values()) {
      if (!sub._isUnsubscribed) {
        sub.notifyDisconnected();
      }
    }
  }

  clear() {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
  }

  getAll() {
    return Array.from(this.subscriptions.values()).filter((s) => !s._isUnsubscribed);
  }
}

module.exports = {
  createSubscriptionKey,
  RealtimeSubscription,
  SubscriptionRegistry,
};
