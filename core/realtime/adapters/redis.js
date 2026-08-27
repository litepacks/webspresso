/**
 * Redis Pub/Sub Distributed Adapter for Webspresso Realtime
 * Enables cross-instance realtime broadcasting across PM2 clusters, Docker containers, and Kubernetes pods.
 * @module core/realtime/adapters/redis
 */

const crypto = require('crypto');

/**
 * Default Redis message envelope serializer
 */
function defaultSerialize(envelope) {
  return JSON.stringify(envelope);
}

/**
 * Default Redis message envelope deserializer
 */
function defaultDeserialize(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * In-memory distributed bus singleton for fallback / local multi-client simulation
 */
class InMemoryDistributedBus {
  constructor() {
    this._channels = new Map();
  }

  subscribe(channel, callback) {
    if (!this._channels.has(channel)) {
      this._channels.set(channel, new Set());
    }
    this._channels.get(channel).add(callback);
    return () => {
      const set = this._channels.get(channel);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this._channels.delete(channel);
        }
      }
    };
  }

  publish(channel, rawMessage) {
    const set = this._channels.get(channel);
    if (set) {
      for (const cb of Array.from(set)) {
        try {
          cb(channel, rawMessage);
        } catch {
          // ignore receiver errors
        }
      }
    }
  }

  clear() {
    this._channels.clear();
  }
}

const globalInMemoryBus = new InMemoryDistributedBus();

class RedisAdapter {
  /**
   * @param {Object} options
   * @param {Object} [options.pubClient] - Redis client for publishing
   * @param {Object} [options.subClient] - Dedicated Redis client for subscribing
   * @param {Object|Function} [options.redis] - Redis client instance with .duplicate() or factory
   * @param {string} [options.channelPrefix='webspresso:rt:'] - Redis channel prefix
   * @param {string} [options.nodeId] - Unique cluster node identifier
   * @param {Function} [options.serialize] - Custom serializer
   * @param {Function} [options.deserialize] - Custom deserializer
   * @param {boolean} [options.inMemory=false] - Force in-memory distributed bus fallback
   * @param {Object} [options.capabilities] - Custom capabilities override
   */
  constructor(options = {}) {
    this.options = options;
    this.capabilities = {
      send: true,
      perform: true,
      multiplexing: true,
      serverEvents: true,
      distributed: true,
      binary: false,
      ...(options.capabilities || {}),
    };

    this.channelPrefix = options.channelPrefix || 'webspresso:rt:';
    this.nodeId = options.nodeId || `node_${crypto.randomBytes(6).toString('hex')}`;
    this.serialize = options.serialize || defaultSerialize;
    this.deserialize = options.deserialize || defaultDeserialize;

    this.pubClient = options.pubClient || null;
    this.subClient = options.subClient || null;
    this._managedClients = false;

    this._isOpen = false;
    this._listeners = new Map();
    this._channelSubscriptions = new Map(); // fullChannelName -> Set<{ callbacks, params, identifier }>
    this._inMemoryBus = options.inMemoryBus || globalInMemoryBus;
    this._inMemoryUnsubscribers = new Map(); // fullChannelName -> unsubFn
    this._useInMemory = Boolean(options.inMemory || (!this.pubClient && !this.subClient && !options.redis));
  }

  get isInMemory() {
    return this._useInMemory;
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  _emit(event, ...args) {
    const set = this._listeners.get(event);
    if (set) {
      for (const handler of Array.from(set)) {
        try {
          handler(...args);
        } catch {
          // ignore handler errors
        }
      }
    }
  }

  _resolveChannel(identifier) {
    return `${this.channelPrefix}${identifier}`;
  }

  async connect(context = {}) {
    if (this._isOpen) {
      return;
    }

    try {
      if (!this._useInMemory) {
        // If a single redis instance with .duplicate() was passed
        if (!this.pubClient && !this.subClient && this.options.redis) {
          if (typeof this.options.redis === 'function') {
            this.pubClient = await this.options.redis('pub');
            this.subClient = await this.options.redis('sub');
            this._managedClients = true;
          } else if (typeof this.options.redis.duplicate === 'function') {
            this.pubClient = this.options.redis;
            this.subClient = this.options.redis.duplicate();
            this._managedClients = true;
          } else {
            this.pubClient = this.options.redis;
            this.subClient = this.options.redis;
          }
        }

        // Connect if clients have .connect() method (e.g. node-redis v4)
        if (this.pubClient && typeof this.pubClient.connect === 'function' && !this.pubClient.isOpen && !this.pubClient.isReady) {
          await this.pubClient.connect();
        }
        if (this.subClient && typeof this.subClient.connect === 'function' && !this.subClient.isOpen && !this.subClient.isReady) {
          await this.subClient.connect();
        }

        // Wire incoming messages from subClient
        this._wireSubClient();
      }

      this._isOpen = true;
      this._emit('open', { nodeId: this.nodeId, inMemory: this._useInMemory });
    } catch (err) {
      this._isOpen = false;
      this._emit('error', err);
      throw err;
    }
  }

  _wireSubClient() {
    if (!this.subClient) return;

    const messageHandler = (channel, rawMessage) => {
      this._handleIncomingRawMessage(channel, rawMessage);
    };

    // Standard EventEmitter / ioredis style (subClient.on('message'))
    if (typeof this.subClient.on === 'function') {
      this.subClient.on('message', messageHandler);
      this.subClient.on('error', (err) => this._emit('error', err));
      this.subClient.on('close', () => {
        this._isOpen = false;
        this._emit('close');
      });
    }
  }

  _handleIncomingRawMessage(channel, rawMessage) {
    const envelope = this.deserialize(rawMessage);
    if (!envelope || typeof envelope !== 'object') {
      return;
    }

    const subs = this._channelSubscriptions.get(channel);
    if (!subs || subs.size === 0) {
      return;
    }

    for (const sub of Array.from(subs)) {
      if (envelope.type === 'action') {
        if (typeof sub.callbacks.action === 'function') {
          sub.callbacks.action(envelope.action, envelope.data, envelope);
        } else if (typeof sub.callbacks.received === 'function') {
          sub.callbacks.received(envelope.data, envelope);
        }
      } else {
        if (typeof sub.callbacks.received === 'function') {
          sub.callbacks.received(envelope.data, envelope);
        }
      }
    }
  }

  isConnected() {
    return this._isOpen;
  }

  async disconnect() {
    this._isOpen = false;

    // Unsubscribe from in-memory bus
    for (const [, unsub] of this._inMemoryUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this._inMemoryUnsubscribers.clear();

    // Unsubscribe from Redis
    if (this.subClient) {
      for (const channel of this._channelSubscriptions.keys()) {
        try {
          if (typeof this.subClient.unsubscribe === 'function') {
            await this.subClient.unsubscribe(channel);
          }
        } catch {}
      }
    }

    this._channelSubscriptions.clear();

    // Close clients if managed
    if (this._managedClients) {
      if (this.subClient && typeof this.subClient.quit === 'function') {
        try { await this.subClient.quit(); } catch {}
      }
      if (this.pubClient && typeof this.pubClient.quit === 'function') {
        try { await this.pubClient.quit(); } catch {}
      }
    }

    this._emit('close');
  }

  async destroy() {
    await this.disconnect();
    this._listeners.clear();
  }

  /**
   * Low-level publish raw payload to Redis channel
   * @param {string} identifier
   * @param {Object} envelope
   */
  async _publishEnvelope(identifier, envelope) {
    const channel = this._resolveChannel(identifier);
    const raw = this.serialize(envelope);

    if (this._useInMemory) {
      this._inMemoryBus.publish(channel, raw);
      return;
    }

    if (this.pubClient) {
      if (typeof this.pubClient.publish === 'function') {
        await this.pubClient.publish(channel, raw);
      }
    }
  }

  /**
   * Broadcast message to all cluster nodes on given identifier
   * @param {string} identifier
   * @param {*} data
   */
  async publish(identifier, data) {
    const envelope = {
      type: 'message',
      identifier,
      data,
      senderId: this.nodeId,
      timestamp: Date.now(),
    };
    await this._publishEnvelope(identifier, envelope);
  }

  /**
   * Broadcast named RPC action to all cluster nodes on given identifier
   * @param {string} identifier
   * @param {string} action
   * @param {*} data
   */
  async perform(identifier, action, data) {
    const envelope = {
      type: 'action',
      identifier,
      action,
      data,
      senderId: this.nodeId,
      timestamp: Date.now(),
    };
    await this._publishEnvelope(identifier, envelope);
  }

  /**
   * Subscribe to a distributed channel identifier
   * @param {string} identifier
   * @param {Object} params
   * @param {Object} callbacks
   * @returns {Object} subscription handle
   */
  subscribe(identifier, params = {}, callbacks = {}) {
    const channel = this._resolveChannel(identifier);

    if (!this._channelSubscriptions.has(channel)) {
      this._channelSubscriptions.set(channel, new Set());

      if (this._useInMemory) {
        const unsub = this._inMemoryBus.subscribe(channel, (ch, raw) => {
          this._handleIncomingRawMessage(ch, raw);
        });
        this._inMemoryUnsubscribers.set(channel, unsub);
      } else if (this.subClient) {
        if (typeof this.subClient.subscribe === 'function') {
          // Supports node-redis v4 callback style or ioredis promise
          const res = this.subClient.subscribe(channel, (message) => {
            // node-redis v4 listener
            this._handleIncomingRawMessage(channel, message);
          });
          if (res && typeof res.catch === 'function') {
            res.catch((err) => this._emit('error', err));
          }
        }
      }
    }

    const subEntry = {
      identifier,
      params,
      callbacks,
    };

    this._channelSubscriptions.get(channel).add(subEntry);

    // Trigger connected callback
    if (typeof callbacks.connected === 'function') {
      Promise.resolve().then(() => {
        if (this._channelSubscriptions.get(channel)?.has(subEntry)) {
          callbacks.connected();
        }
      });
    }

    return {
      send: (data) => {
        return this.publish(identifier, data);
      },
      perform: (action, data) => {
        return this.perform(identifier, action, data);
      },
      unsubscribe: () => {
        const set = this._channelSubscriptions.get(channel);
        if (set) {
          set.delete(subEntry);
          if (set.size === 0) {
            this._channelSubscriptions.delete(channel);
            if (this._useInMemory) {
              const unsub = this._inMemoryUnsubscribers.get(channel);
              if (unsub) {
                unsub();
                this._inMemoryUnsubscribers.delete(channel);
              }
            } else if (this.subClient && typeof this.subClient.unsubscribe === 'function') {
              this.subClient.unsubscribe(channel);
            }
          }
        }
      },
    };
  }
}

/**
 * Factory for creating a Redis distributed adapter instance
 * @param {Object} options
 * @returns {RedisAdapter}
 */
function createRedisAdapter(options = {}) {
  return new RedisAdapter(options);
}

module.exports = {
  createRedisAdapter,
  redis: createRedisAdapter,
  RedisAdapter,
  InMemoryDistributedBus,
  globalInMemoryBus,
};
