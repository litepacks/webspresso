/**
 * Webspresso Distributed Redis Session Store & Tracker
 * Zero-dependency express-session store and device management tracker for stateless scale-out
 * (Google Cloud Run, AWS ECS/Fargate, Kubernetes, PM2 Cluster)
 * @module core/auth/redis-session
 */

'use strict';

const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');
const { parseUserAgent } = require('./user-agent');

/**
 * In-Memory Redis Simulation Client
 * Useful for development, testing, and offline fallback without an active Redis instance.
 */
class InMemoryRedisClient extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { value: string, expiresAt: number | null }>} */
    this._data = new Map();
    /** @type {Map<string, Set<string>>} */
    this._sets = new Map();
    this.status = 'ready';
  }

  _isExpired(item) {
    if (!item || item.expiresAt === null) return false;
    return Date.now() > item.expiresAt;
  }

  async get(key) {
    const item = this._data.get(String(key));
    if (!item) return null;
    if (this._isExpired(item)) {
      this._data.delete(String(key));
      return null;
    }
    return item.value;
  }

  async set(key, val, ...args) {
    const k = String(key);
    const v = String(val);
    let ttlSeconds = null;

    if (args.length >= 2 && String(args[0]).toUpperCase() === 'EX') {
      ttlSeconds = Number(args[1]);
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      if (args[0].ex || args[0].EX) {
        ttlSeconds = Number(args[0].ex || args[0].EX);
      }
    }

    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : null;
    this._data.set(k, { value: v, expiresAt });
    return 'OK';
  }

  async del(...keys) {
    const flatKeys = keys.flat();
    let count = 0;
    for (const k of flatKeys) {
      const sk = String(k);
      if (this._data.delete(sk)) count++;
      if (this._sets.delete(sk)) count++;
    }
    return count;
  }

  async expire(key, seconds) {
    const k = String(key);
    const item = this._data.get(k);
    if (!item || this._isExpired(item)) return 0;
    item.expiresAt = Date.now() + (Number(seconds) * 1000);
    return 1;
  }

  async ttl(key) {
    const k = String(key);
    const item = this._data.get(k);
    if (!item) return -2;
    if (this._isExpired(item)) {
      this._data.delete(k);
      return -2;
    }
    if (item.expiresAt === null) return -1;
    const remaining = Math.ceil((item.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async sadd(key, ...members) {
    const k = String(key);
    let set = this._sets.get(k);
    if (!set) {
      set = new Set();
      this._sets.set(k, set);
    }
    let added = 0;
    for (const m of members.flat()) {
      const sm = String(m);
      if (!set.has(sm)) {
        set.add(sm);
        added++;
      }
    }
    return added;
  }

  async srem(key, ...members) {
    const k = String(key);
    const set = this._sets.get(k);
    if (!set) return 0;
    let removed = 0;
    for (const m of members.flat()) {
      if (set.delete(String(m))) removed++;
    }
    if (set.size === 0) {
      this._sets.delete(k);
    }
    return removed;
  }

  async smembers(key) {
    const k = String(key);
    const set = this._sets.get(k);
    if (!set) return [];
    return Array.from(set);
  }

  async sismember(key, member) {
    const k = String(key);
    const set = this._sets.get(k);
    if (!set) return 0;
    return set.has(String(member)) ? 1 : 0;
  }

  async keys(pattern = '*') {
    const results = [];
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const [k, item] of this._data.entries()) {
      if (!this._isExpired(item) && regex.test(k)) {
        results.push(k);
      }
    }
    for (const k of this._sets.keys()) {
      if (regex.test(k) && !results.includes(k)) {
        results.push(k);
      }
    }
    return results;
  }

  async ping() {
    return 'PONG';
  }

  async quit() {
    this._data.clear();
    this._sets.clear();
    this.status = 'end';
    return 'OK';
  }

  async disconnect() {
    return this.quit();
  }
}

/**
 * Lightweight Zero-Dependency RESP Redis Client over Node.js TCP/TLS Socket
 */
class MiniRedisClient extends EventEmitter {
  /**
   * @param {string|Object} urlOrOptions
   */
  constructor(urlOrOptions = {}) {
    super();

    let host = '127.0.0.1';
    let port = 6379;
    let password = null;
    let db = 0;
    let useTls = false;

    if (typeof urlOrOptions === 'string') {
      try {
        const u = new URL(urlOrOptions);
        host = u.hostname || '127.0.0.1';
        port = u.port ? Number(u.port) : 6379;
        password = u.password ? decodeURIComponent(u.password) : null;
        useTls = u.protocol === 'rediss:';
        if (u.pathname && u.pathname.length > 1) {
          const parsedDb = parseInt(u.pathname.slice(1), 10);
          if (!isNaN(parsedDb)) db = parsedDb;
        }
      } catch {
        // Fallback to default host/port
      }
    } else if (typeof urlOrOptions === 'object') {
      host = urlOrOptions.host || '127.0.0.1';
      port = urlOrOptions.port ? Number(urlOrOptions.port) : 6379;
      password = urlOrOptions.password || null;
      db = urlOrOptions.db || 0;
      useTls = Boolean(urlOrOptions.tls);
      if (typeof urlOrOptions.tls === 'object' && urlOrOptions.tls !== null) {
        this.tlsOptions = { ...urlOrOptions.tls };
      } else {
        this.tlsOptions = {};
      }
    } else {
      this.tlsOptions = {};
    }

    this.host = host;
    this.port = port;
    this.password = password;
    this.db = db;
    this.useTls = useTls;

    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this._queue = [];
    this._buffer = '';
    this.status = 'init';
  }

  /**
   * Ensure TCP/TLS connection to Redis server
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected && this.socket) return;
    if (this.connecting) {
      return new Promise((resolve, reject) => {
        this.once('ready', resolve);
        this.once('error', reject);
      });
    }

    this.connecting = true;
    this.status = 'connecting';

    return new Promise((resolve, reject) => {
      const onConnect = async () => {
        this.connected = true;
        this.connecting = false;
        this.status = 'ready';

        try {
          if (this.password) {
            await this.sendCommand(['AUTH', this.password]);
          }
          if (this.db > 0) {
            await this.sendCommand(['SELECT', String(this.db)]);
          }
          this.emit('ready');
          resolve();
        } catch (err) {
          this.destroy();
          reject(err);
        }
      };

      const onError = (err) => {
        this.connecting = false;
        this.connected = false;
        this.status = 'error';
        this.emit('error', err);
        // Reject all queued commands
        while (this._queue.length > 0) {
          const item = this._queue.shift();
          item.reject(err);
        }
        reject(err);
      };

      try {
        if (this.useTls) {
          const tlsConnectOpts = {
            host: this.host,
            port: this.port,
            rejectUnauthorized: this.tlsOptions?.rejectUnauthorized !== undefined
              ? Boolean(this.tlsOptions.rejectUnauthorized)
              : true,
            ...(this.tlsOptions || {}),
          };
          this.socket = tls.connect(tlsConnectOpts, onConnect);
        } else {
          this.socket = net.createConnection({ host: this.host, port: this.port }, onConnect);
        }
      } catch (err) {
        return onError(err);
      }

      this.socket.setNoDelay(true);
      this.socket.setKeepAlive(true, 10000);

      this.socket.on('data', (chunk) => {
        this._buffer += chunk.toString('utf8');
        this._processBuffer();
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.connecting = false;
        this.status = 'close';
        this.emit('close');
      });
    });
  }

  /**
   * Parse RESP stream response
   * @private
   */
  _processBuffer() {
    while (this._queue.length > 0 && this._buffer.length > 0) {
      const parsed = this._parseResp(this._buffer);
      if (!parsed) break; // Incomplete response in buffer, wait for more data

      this._buffer = this._buffer.slice(parsed.bytesRead);
      const pending = this._queue.shift();

      if (parsed.isError) {
        pending.reject(new Error(parsed.value));
      } else {
        pending.resolve(parsed.value);
      }
    }
  }

  /**
   * Parse a single RESP token
   * @param {string} str
   * @returns {{ value: any, bytesRead: number, isError?: boolean }|null}
   * @private
   */
  _parseResp(str) {
    if (!str || str.length === 0) return null;
    const type = str[0];
    const crlf = str.indexOf('\r\n');
    if (crlf === -1) return null;

    if (type === '+') {
      // Simple string
      return { value: str.slice(1, crlf), bytesRead: crlf + 2 };
    }

    if (type === '-') {
      // Error string
      return { value: str.slice(1, crlf), bytesRead: crlf + 2, isError: true };
    }

    if (type === ':') {
      // Integer
      return { value: parseInt(str.slice(1, crlf), 10), bytesRead: crlf + 2 };
    }

    if (type === '$') {
      // Bulk string
      const len = parseInt(str.slice(1, crlf), 10);
      if (len === -1) {
        return { value: null, bytesRead: crlf + 2 };
      }
      const start = crlf + 2;
      const end = start + len;
      if (str.length < end + 2) return null; // Not enough data yet
      return { value: str.slice(start, end), bytesRead: end + 2 };
    }

    if (type === '*') {
      // Array
      const count = parseInt(str.slice(1, crlf), 10);
      if (count === -1) {
        return { value: null, bytesRead: crlf + 2 };
      }
      let offset = crlf + 2;
      const arr = [];
      for (let i = 0; i < count; i++) {
        const item = this._parseResp(str.slice(offset));
        if (!item) return null;
        arr.push(item.value);
        offset += item.bytesRead;
      }
      return { value: arr, bytesRead: offset };
    }

    // Unrecognized protocol fallback
    return { value: str.slice(0, crlf), bytesRead: crlf + 2 };
  }

  /**
   * Send a raw Redis command
   * @param {Array<string|number>} args
   * @returns {Promise<any>}
   */
  async sendCommand(args) {
    if (!this.connected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      // Encode command in RESP format: *<len>\r\n$<l1>\r\n<arg1>\r\n...
      let payload = `*${args.length}\r\n`;
      for (const arg of args) {
        const s = String(arg ?? '');
        payload += `$${Buffer.byteLength(s, 'utf8')}\r\n${s}\r\n`;
      }

      this._queue.push({ resolve, reject });
      this.socket.write(payload);
    });
  }

  async get(key) {
    return await this.sendCommand(['GET', key]);
  }

  async set(key, val, ...args) {
    const cmd = ['SET', key, val];
    if (args.length >= 2 && String(args[0]).toUpperCase() === 'EX') {
      cmd.push('EX', args[1]);
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const ex = args[0].ex || args[0].EX;
      if (ex) cmd.push('EX', ex);
    }
    return await this.sendCommand(cmd);
  }

  async del(...keys) {
    return await this.sendCommand(['DEL', ...keys.flat()]);
  }

  async expire(key, seconds) {
    return await this.sendCommand(['EXPIRE', key, seconds]);
  }

  async ttl(key) {
    return await this.sendCommand(['TTL', key]);
  }

  async sadd(key, ...members) {
    return await this.sendCommand(['SADD', key, ...members.flat()]);
  }

  async srem(key, ...members) {
    return await this.sendCommand(['SREM', key, ...members.flat()]);
  }

  async smembers(key) {
    const res = await this.sendCommand(['SMEMBERS', key]);
    return Array.isArray(res) ? res : [];
  }

  async sismember(key, member) {
    return await this.sendCommand(['SISMEMBER', key, member]);
  }

  async keys(pattern = '*') {
    const res = await this.sendCommand(['KEYS', pattern]);
    return Array.isArray(res) ? res : [];
  }

  async ping() {
    return await this.sendCommand(['PING']);
  }

  async quit() {
    try {
      if (this.connected && this.socket) {
        await this.sendCommand(['QUIT']);
      }
    } catch {
      // Ignore quit error
    } finally {
      this.destroy();
    }
    return 'OK';
  }

  destroy() {
    this.connected = false;
    this.connecting = false;
    this.status = 'end';
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  async disconnect() {
    return this.quit();
  }
}

/**
 * Factory helper for Redis client creation
 * @param {string|Object} [urlOrOptions]
 * @returns {MiniRedisClient|InMemoryRedisClient}
 */
function createMiniRedisClient(urlOrOptions = {}) {
  if (urlOrOptions?.inMemory || urlOrOptions === 'memory') {
    return new InMemoryRedisClient();
  }
  return new MiniRedisClient(urlOrOptions);
}

/**
 * Standardize call to any Redis client (ioredis, node-redis v4/v3, mini client, or in-memory)
 * @param {Object} client
 * @param {string} method
 * @param {Array<any>} args
 * @returns {Promise<any>}
 */
async function invokeRedis(client, method, args) {
  if (!client) {
    throw new Error(`[invokeRedis] Redis client instance is required.`);
  }

  let fn = client[method];
  if (typeof fn !== 'function') {
    const lower = method.toLowerCase();
    if (typeof client[lower] === 'function') {
      fn = client[lower];
    } else {
      throw new Error(`[invokeRedis] Redis client does not support method "${method}"`);
    }
  }

  // Handle callback vs Promise-based clients
  return new Promise((resolve, reject) => {
    let result;
    try {
      result = fn.call(client, ...args, (err, val) => {
        if (err) return reject(err);
        resolve(val);
      });
    } catch (err) {
      return reject(err);
    }

    if (result && typeof result.then === 'function') {
      result.then(resolve, reject);
    }
  });
}

/**
 * Get express-session Store class
 */
function getExpressSessionStoreClass() {
  try {
    const s = require('express-session');
    if (s && s.Store) return s.Store;
  } catch {
    // express-session not installed or running in standalone test
  }
  return EventEmitter;
}

const BaseStore = getExpressSessionStoreClass();

/**
 * Zero-Dependency Redis Session Store for Express-Session
 * Implements express-session Store contract: get, set, destroy, touch, all, length, clear
 */
class RedisSessionStore extends BaseStore {
  /**
   * @param {Object} options
   * @param {Object} [options.client] - Redis client (ioredis, @redis/client, or MiniRedisClient)
   * @param {string} [options.url] - Redis URL (auto-instantiates MiniRedisClient if client omitted)
   * @param {string} [options.prefix='sess:'] - Session key prefix
   * @param {number} [options.ttl=86400] - Default TTL in seconds (24h)
   * @param {boolean} [options.disableTouch=false] - Disable touch TTL renewal
   * @param {boolean} [options.inMemory=false] - Use in-memory client
   * @param {Object} [options.serializer=JSON] - Custom JSON serializer { parse, stringify }
   */
  constructor(options = {}) {
    super();

    this.prefix = options.prefix || 'sess:';
    this.ttl = Number(options.ttl || 86400);
    this.disableTouch = Boolean(options.disableTouch);
    this.serializer = options.serializer || JSON;

    if (options.client) {
      this.client = options.client;
    } else if (options.inMemory || (!options.url && !process.env.REDIS_URL)) {
      this.client = new InMemoryRedisClient();
    } else {
      const redisUrl = options.url || process.env.REDIS_URL;
      this.client = new MiniRedisClient(redisUrl);
    }

    this.emit('connect');
  }

  _getKey(sid) {
    return `${this.prefix}${sid}`;
  }

  /**
   * Calculate session TTL in seconds from express-session cookie
   * @param {Object} sess
   * @returns {number}
   */
  _getTtl(sess) {
    if (sess?.cookie?.maxAge) {
      const sec = Math.ceil(Number(sess.cookie.maxAge) / 1000);
      if (sec > 0) return sec;
    }
    return this.ttl;
  }

  /**
   * express-session get(sid, callback)
   */
  get(sid, callback = () => {}) {
    const key = this._getKey(sid);
    invokeRedis(this.client, 'get', [key])
      .then((raw) => {
        if (!raw) return callback(null, null);
        try {
          const sess = this.serializer.parse(raw);
          return callback(null, sess);
        } catch (err) {
          return callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  /**
   * express-session set(sid, sess, callback)
   */
  set(sid, sess, callback = () => {}) {
    const key = this._getKey(sid);
    const ttl = this._getTtl(sess);

    let serialized;
    try {
      serialized = this.serializer.stringify(sess);
    } catch (err) {
      return callback(err);
    }

    invokeRedis(this.client, 'set', [key, serialized, 'EX', ttl])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  /**
   * express-session destroy(sid, callback)
   */
  destroy(sid, callback = () => {}) {
    const key = this._getKey(sid);
    invokeRedis(this.client, 'del', [key])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  /**
   * express-session touch(sid, sess, callback)
   */
  touch(sid, sess, callback = () => {}) {
    if (this.disableTouch) {
      return callback(null);
    }

    const key = this._getKey(sid);
    const ttl = this._getTtl(sess);

    invokeRedis(this.client, 'expire', [key, ttl])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  /**
   * Fetch all active sessions
   * @param {Function} [callback]
   */
  all(callback = () => {}) {
    const pattern = `${this.prefix}*`;
    invokeRedis(this.client, 'keys', [pattern])
      .then(async (keys) => {
        if (!Array.isArray(keys) || keys.length === 0) {
          return callback(null, []);
        }
        const rawResults = await Promise.all(
          keys.map((k) => invokeRedis(this.client, 'get', [k]).catch(() => null))
        );
        const sessions = [];
        for (const raw of rawResults) {
          if (raw) {
            try {
              sessions.push(this.serializer.parse(raw));
            } catch {
              // ignore invalid JSON
            }
          }
        }
        return callback(null, sessions);
      })
      .catch((err) => callback(err));
  }

  /**
   * Active sessions count
   * @param {Function} [callback]
   */
  length(callback = () => {}) {
    const pattern = `${this.prefix}*`;
    invokeRedis(this.client, 'keys', [pattern])
      .then((keys) => callback(null, Array.isArray(keys) ? keys.length : 0))
      .catch((err) => callback(err));
  }

  /**
   * Delete all sessions
   * @param {Function} [callback]
   */
  clear(callback = () => {}) {
    const pattern = `${this.prefix}*`;
    invokeRedis(this.client, 'keys', [pattern])
      .then(async (keys) => {
        if (Array.isArray(keys) && keys.length > 0) {
          await invokeRedis(this.client, 'del', keys);
        }
        return callback(null);
      })
      .catch((err) => callback(err));
  }

  /**
   * Graceful close
   */
  async close() {
    if (this.client && typeof this.client.quit === 'function') {
      try {
        await this.client.quit();
      } catch {
        // Ignore close error
      }
    }
  }
}

/**
 * Factory for RedisSessionStore
 * @param {Object} [options]
 * @returns {RedisSessionStore}
 */
function createRedisSessionStore(options = {}) {
  return new RedisSessionStore(options);
}

/**
 * Distributed Redis Session Tracker Adapter for Webspresso Active Sessions & Devices
 * Manages active user sessions, device metadata, and remote session revocation across multiple container replicas.
 * @param {Object} [options]
 * @param {Object} [options.client] - Redis client instance
 * @param {string} [options.url] - Redis connection URL
 * @param {string} [options.prefix='sess:'] - Key prefix
 * @param {number} [options.ttlSeconds=2592000] - Default TTL in seconds (30 days)
 * @returns {Object} Session tracker adapter
 */
function createRedisSessionTracker(options = {}) {
  const prefix = options.prefix || 'sess:';
  const defaultTtl = options.ttlSeconds || 2592000;

  let client = options.client;
  if (!client) {
    if (options.inMemory || (!options.url && !process.env.REDIS_URL)) {
      client = new InMemoryRedisClient();
    } else {
      const redisUrl = options.url || process.env.REDIS_URL;
      client = new MiniRedisClient(redisUrl);
    }
  }

  const deviceKey = (sid) => `${prefix}device:${sid}`;
  const userKey = (uid) => `${prefix}user:${uid}`;

  return {
    client,

    /**
     * Record or update an active session for a user
     * @param {string} sessionId
     * @param {string|number} userId
     * @param {Object} [metadata]
     * @returns {Promise<Object>}
     */
    track: async (sessionId, userId, metadata = {}) => {
      if (!sessionId || !userId) return null;

      const ua = metadata.userAgent || '';
      const parsed = parseUserAgent(ua);
      const ip = metadata.ip || '127.0.0.1';
      const browser = metadata.browser || parsed.browser;
      const os = metadata.os || parsed.os;
      const device = metadata.device || parsed.device;
      const now = new Date();

      const existingRaw = await invokeRedis(client, 'get', [deviceKey(sessionId)]);
      let existing = null;
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw); } catch {}
      }

      const record = {
        id: existing?.id || sessionId,
        session_id: sessionId,
        user_id: userId,
        ip_address: ip,
        user_agent: ua ? ua.slice(0, 1000) : null,
        browser,
        os,
        device,
        last_active_at: now.toISOString(),
        created_at: existing?.created_at || now.toISOString(),
      };

      // Store device record with TTL
      await invokeRedis(client, 'set', [deviceKey(sessionId), JSON.stringify(record), 'EX', defaultTtl]);
      // Add sessionId to user active set
      await invokeRedis(client, 'sadd', [userKey(userId), sessionId]);

      return record;
    },

    /**
     * Touch session to update last_active_at and refresh TTL
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    touch: async (sessionId) => {
      if (!sessionId) return false;
      const raw = await invokeRedis(client, 'get', [deviceKey(sessionId)]);
      if (!raw) return false;

      try {
        const record = JSON.parse(raw);
        record.last_active_at = new Date().toISOString();
        await invokeRedis(client, 'set', [deviceKey(sessionId), JSON.stringify(record), 'EX', defaultTtl]);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get a session record by session_id
     * @param {string} sessionId
     * @returns {Promise<Object|null>}
     */
    get: async (sessionId) => {
      if (!sessionId) return null;
      const raw = await invokeRedis(client, 'get', [deviceKey(sessionId)]);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    /**
     * List all active sessions for a user, marking the current session
     * @param {string|number} userId
     * @param {string} [currentSessionId]
     * @returns {Promise<Array<Object>>}
     */
    list: async (userId, currentSessionId = null) => {
      if (!userId) return [];
      const sids = await invokeRedis(client, 'smembers', [userKey(userId)]);
      if (!Array.isArray(sids) || sids.length === 0) return [];

      const rawResults = await Promise.all(
        sids.map((sid) =>
          invokeRedis(client, 'get', [deviceKey(sid)])
            .then((raw) => ({ sid, raw }))
            .catch(() => ({ sid, raw: null }))
        )
      );

      const list = [];
      const expiredSids = [];

      for (const { sid, raw } of rawResults) {
        if (!raw) {
          expiredSids.push(sid);
          continue;
        }
        try {
          const rec = JSON.parse(raw);
          list.push({
            ...rec,
            is_current: Boolean(currentSessionId && rec.session_id === currentSessionId),
          });
        } catch {
          expiredSids.push(sid);
        }
      }

      // Cleanup any expired session references from user set
      if (expiredSids.length > 0) {
        await invokeRedis(client, 'srem', [userKey(userId), ...expiredSids]);
      }

      return list.sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime());
    },

    /**
     * Check if a session exists and belongs to the given user
     * @param {string} sessionId
     * @param {string|number} [userId]
     * @returns {Promise<boolean>}
     */
    isSessionValid: async (sessionId, userId = null) => {
      if (!sessionId) return false;
      const raw = await invokeRedis(client, 'get', [deviceKey(sessionId)]);
      if (!raw) return false;

      if (userId) {
        try {
          const rec = JSON.parse(raw);
          return String(rec.user_id) === String(userId);
        } catch {
          return false;
        }
      }
      return true;
    },

    /**
     * Revoke a single session
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    revoke: async (sessionId) => {
      if (!sessionId) return false;
      const raw = await invokeRedis(client, 'get', [deviceKey(sessionId)]);
      let userId = null;
      if (raw) {
        try {
          const rec = JSON.parse(raw);
          userId = rec.user_id;
        } catch {}
      }

      await invokeRedis(client, 'del', [deviceKey(sessionId)]);
      if (userId) {
        await invokeRedis(client, 'srem', [userKey(userId), sessionId]);
      }
      return true;
    },

    /**
     * Revoke all other sessions for user, keeping the current session active
     * @param {string|number} userId
     * @param {string} currentSessionId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeOthers: async (userId, currentSessionId) => {
      if (!userId) return 0;
      const sids = await invokeRedis(client, 'smembers', [userKey(userId)]);
      if (!Array.isArray(sids) || sids.length === 0) return 0;

      const toRemove = sids.filter((sid) => sid !== currentSessionId);
      if (toRemove.length === 0) return 0;

      const keysToDel = toRemove.map((sid) => deviceKey(sid));
      await invokeRedis(client, 'del', keysToDel);
      await invokeRedis(client, 'srem', [userKey(userId), ...toRemove]);

      return toRemove.length;
    },

    /**
     * Revoke all sessions for a user (force logout from all devices)
     * @param {string|number} userId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeAll: async (userId) => {
      if (!userId) return 0;
      const sids = await invokeRedis(client, 'smembers', [userKey(userId)]);
      if (!Array.isArray(sids) || sids.length === 0) return 0;

      const keysToDel = sids.map((sid) => deviceKey(sid));
      keysToDel.push(userKey(userId));
      await invokeRedis(client, 'del', keysToDel);

      return sids.length;
    },

    /**
     * Purge expired sessions (handled automatically by Redis TTL)
     * @returns {Promise<number>}
     */
    purgeExpired: async () => {
      return 0;
    },
  };
}

module.exports = {
  RedisSessionStore,
  createRedisSessionStore,
  createRedisSessionTracker,
  MiniRedisClient,
  InMemoryRedisClient,
  createMiniRedisClient,
  invokeRedis,
};
