/**
 * Webspresso Active Sessions & Device Management Store
 * Tracks active devices, last active timestamps, and handles remote session revocation
 * @module core/auth/sessions
 */

'use strict';

const { parseUserAgent, getClientIp } = require('./user-agent');

/**
 * Migration helper to create user_sessions table
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
async function createUserSessionsTable(knex) {
  const exists = await knex.schema.hasTable('user_sessions');
  if (exists) return;

  await knex.schema.createTable('user_sessions', (table) => {
    table.bigIncrements('id').primary();
    table.string('session_id', 128).notNullable().unique();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('ip_address', 64).nullable();
    table.text('user_agent').nullable();
    table.string('browser', 64).nullable();
    table.string('os', 64).nullable();
    table.string('device', 32).nullable();
    table.timestamp('last_active_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id', 'last_active_at']);
    table.index('session_id');
    table.index('last_active_at');
  });
}

/**
 * Migration helper to drop user_sessions table
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
async function dropUserSessionsTable(knex) {
  await knex.schema.dropTableIfExists('user_sessions');
}

/**
 * Create Knex session tracker adapter
 * @param {Object} db - Database with knex or knex instance
 * @param {Object} [options]
 * @param {string} [options.tableName='user_sessions']
 * @returns {Object} Session tracker adapter
 */
function createKnexSessionTracker(db, options = {}) {
  const knex = db.knex || db;
  const tableName = options.tableName || 'user_sessions';

  return {
    /**
     * Record or update an active session for a user
     * @param {string} sessionId - Express session ID
     * @param {string|number} userId - User ID
     * @param {Object} [metadata]
     * @param {string} [metadata.ip]
     * @param {string} [metadata.userAgent]
     * @param {string} [metadata.browser]
     * @param {string} [metadata.os]
     * @param {string} [metadata.device]
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

      const existing = await knex(tableName).where({ session_id: sessionId }).first();
      const now = new Date();

      if (existing) {
        await knex(tableName).where({ session_id: sessionId }).update({
          user_id: userId,
          ip_address: ip,
          user_agent: ua ? ua.slice(0, 1000) : null,
          browser,
          os,
          device,
          last_active_at: now,
        });
        return {
          ...existing,
          user_id: userId,
          ip_address: ip,
          browser,
          os,
          device,
          last_active_at: now,
        };
      }

      try {
        const [id] = await knex(tableName).insert({
          session_id: sessionId,
          user_id: userId,
          ip_address: ip,
          user_agent: ua ? ua.slice(0, 1000) : null,
          browser,
          os,
          device,
          last_active_at: now,
          created_at: now,
        });

        return {
          id,
          session_id: sessionId,
          user_id: userId,
          ip_address: ip,
          browser,
          os,
          device,
          last_active_at: now,
          created_at: now,
        };
      } catch (insertErr) {
        // Handle concurrent insert race condition gracefully across database engines
        const isUniqueConstraint =
          insertErr.code === 'SQLITE_CONSTRAINT' ||
          insertErr.code === '23505' || // PostgreSQL
          insertErr.code === 'ER_DUP_ENTRY' || // MySQL
          insertErr.errno === 19 || // SQLite
          insertErr.errno === 1062 || // MySQL
          (typeof insertErr.message === 'string' && /unique|duplicate|constraint/i.test(insertErr.message));

        if (!isUniqueConstraint) {
          throw insertErr;
        }

        await knex(tableName).where({ session_id: sessionId }).update({
          user_id: userId,
          ip_address: ip,
          user_agent: ua ? ua.slice(0, 1000) : null,
          browser,
          os,
          device,
          last_active_at: now,
        });

        const record = await knex(tableName).where({ session_id: sessionId }).first();
        return record || {
          session_id: sessionId,
          user_id: userId,
          ip_address: ip,
          browser,
          os,
          device,
          last_active_at: now,
        };
      }
    },

    /**
     * Touch session to update last_active_at
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    touch: async (sessionId) => {
      if (!sessionId) return false;
      const count = await knex(tableName).where({ session_id: sessionId }).update({
        last_active_at: new Date(),
      });
      return count > 0;
    },

    /**
     * Get a session record by session_id
     * @param {string} sessionId
     * @returns {Promise<Object|null>}
     */
    get: async (sessionId) => {
      if (!sessionId) return null;
      return await knex(tableName).where({ session_id: sessionId }).first() || null;
    },

    /**
     * List all active sessions for a user, marking the current session
     * @param {string|number} userId
     * @param {string} [currentSessionId]
     * @returns {Promise<Array<Object>>}
     */
    list: async (userId, currentSessionId = null) => {
      if (!userId) return [];
      const rows = await knex(tableName)
        .where({ user_id: userId })
        .orderBy('last_active_at', 'desc');

      return rows.map((row) => ({
        ...row,
        is_current: Boolean(currentSessionId && row.session_id === currentSessionId),
      }));
    },

    /**
     * Check if a session exists and belongs to the given user
     * @param {string} sessionId
     * @param {string|number} [userId]
     * @returns {Promise<boolean>}
     */
    isSessionValid: async (sessionId, userId = null) => {
      if (!sessionId) return false;
      const query = knex(tableName).where({ session_id: sessionId });
      if (userId) {
        query.andWhere({ user_id: userId });
      }
      const record = await query.first();
      return Boolean(record);
    },

    /**
     * Revoke a single session
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    revoke: async (sessionId) => {
      if (!sessionId) return false;
      const count = await knex(tableName).where({ session_id: sessionId }).delete();
      return count > 0;
    },

    /**
     * Revoke all other sessions for user, keeping the current session active
     * @param {string|number} userId
     * @param {string} currentSessionId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeOthers: async (userId, currentSessionId) => {
      if (!userId) return 0;
      let query = knex(tableName).where({ user_id: userId });
      if (currentSessionId) {
        query = query.whereNot({ session_id: currentSessionId });
      }
      return await query.delete();
    },

    /**
     * Revoke all sessions for a user (force logout from all devices)
     * @param {string|number} userId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeAll: async (userId) => {
      if (!userId) return 0;
      return await knex(tableName).where({ user_id: userId }).delete();
    },

    /**
     * Purge sessions older than maxAgeMs
     * @param {number} maxAgeMs
     * @returns {Promise<number>}
     */
    purgeExpired: async (maxAgeMs) => {
      const cutoff = new Date(Date.now() - maxAgeMs);
      return await knex(tableName).where('last_active_at', '<', cutoff).delete();
    },
  };
}

/**
 * In-memory session tracker for testing or development without a database table
 * @returns {Object} Session tracker adapter
 */
function createMemorySessionTracker() {
  /** @type {Map<string, Object>} */
  const sessions = new Map();

  return {
    track: async (sessionId, userId, metadata = {}) => {
      if (!sessionId || !userId) return null;

      const ua = metadata.userAgent || '';
      const parsed = parseUserAgent(ua);
      const ip = metadata.ip || '127.0.0.1';
      const browser = metadata.browser || parsed.browser;
      const os = metadata.os || parsed.os;
      const device = metadata.device || parsed.device;
      const now = new Date();

      const existing = sessions.get(sessionId);
      const record = {
        id: existing?.id || sessions.size + 1,
        session_id: sessionId,
        user_id: userId,
        ip_address: ip,
        user_agent: ua ? ua.slice(0, 1000) : null,
        browser,
        os,
        device,
        last_active_at: now,
        created_at: existing?.created_at || now,
      };

      sessions.set(sessionId, record);
      return record;
    },

    touch: async (sessionId) => {
      const record = sessions.get(sessionId);
      if (!record) return false;
      record.last_active_at = new Date();
      return true;
    },

    get: async (sessionId) => {
      return sessions.get(sessionId) || null;
    },

    list: async (userId, currentSessionId = null) => {
      const list = [];
      for (const row of sessions.values()) {
        if (String(row.user_id) === String(userId)) {
          list.push({
            ...row,
            is_current: Boolean(currentSessionId && row.session_id === currentSessionId),
          });
        }
      }
      return list.sort((a, b) => b.last_active_at.getTime() - a.last_active_at.getTime());
    },

    isSessionValid: async (sessionId, userId = null) => {
      const record = sessions.get(sessionId);
      if (!record) return false;
      if (userId && String(record.user_id) !== String(userId)) return false;
      return true;
    },

    revoke: async (sessionId) => {
      return sessions.delete(sessionId);
    },

    revokeOthers: async (userId, currentSessionId) => {
      let count = 0;
      for (const [sid, row] of sessions.entries()) {
        if (String(row.user_id) === String(userId) && sid !== currentSessionId) {
          sessions.delete(sid);
          count++;
        }
      }
      return count;
    },

    revokeAll: async (userId) => {
      let count = 0;
      for (const [sid, row] of sessions.entries()) {
        if (String(row.user_id) === String(userId)) {
          sessions.delete(sid);
          count++;
        }
      }
      return count;
    },

    purgeExpired: async (maxAgeMs) => {
      const cutoff = Date.now() - maxAgeMs;
      let count = 0;
      for (const [sid, row] of sessions.entries()) {
        if (row.last_active_at.getTime() < cutoff) {
          sessions.delete(sid);
          count++;
        }
      }
      return count;
    },
  };
}

/**
 * Generic Key-Value session tracker adapter
 * Compatible with Cloudflare KV (env.SESSIONS), Vercel KV, or custom KV stores
 * @param {Object} kv - KV store instance
 * @param {Object} [options]
 * @param {string} [options.prefix='sess:'] - Session key prefix
 * @param {number} [options.ttlSeconds=2592000] - Default TTL in seconds (30 days)
 * @returns {Object} Session tracker adapter
 */
function createKvSessionTracker(kv, options = {}) {
  if (!kv) {
    throw new Error('[createKvSessionTracker] KV store instance is required.');
  }

  const prefix = options.prefix || 'sess:';
  const defaultTtl = options.ttlSeconds || 2592000;

  const kvGet = async (key) => {
    if (typeof kv.get === 'function') {
      const val = await kv.get(key, { type: 'json' });
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (_) { return val; }
      }
      return val;
    }
    return null;
  };

  const kvPut = async (key, val, ttl) => {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    if (typeof kv.put === 'function') {
      // Cloudflare KV syntax
      return await kv.put(key, serialized, { expirationTtl: ttl || defaultTtl });
    }
    if (typeof kv.set === 'function') {
      // Generic / Redis KV syntax
      return await kv.set(key, serialized, { ex: ttl || defaultTtl });
    }
  };

  const kvDelete = async (key) => {
    if (typeof kv.delete === 'function') {
      return await kv.delete(key);
    }
    if (typeof kv.del === 'function') {
      return await kv.del(key);
    }
  };

  return {
    track: async (sessionId, userId, metadata = {}) => {
      if (!sessionId || !userId) return null;

      const ua = metadata.userAgent || '';
      const parsed = parseUserAgent(ua);
      const ip = metadata.ip || '127.0.0.1';
      const now = new Date();

      const record = {
        session_id: sessionId,
        user_id: userId,
        ip_address: ip,
        user_agent: ua,
        browser: metadata.browser || parsed.browser,
        os: metadata.os || parsed.os,
        device: metadata.device || parsed.device,
        last_active_at: now.toISOString(),
        created_at: now.toISOString(),
      };

      await kvPut(`${prefix}${sessionId}`, record, defaultTtl);
      return record;
    },

    /**
     * Touch session to update last_active_at and refresh expiration
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    touch: async (sessionId) => {
      if (!sessionId) return false;
      const record = await kvGet(`${prefix}${sessionId}`);
      if (!record) return false;
      record.last_active_at = new Date().toISOString();
      await kvPut(`${prefix}${sessionId}`, record, defaultTtl);
      return true;
    },

    /**
     * Get session record by session_id
     * @param {string} sessionId
     * @returns {Promise<Object|null>}
     */
    get: async (sessionId) => {
      if (!sessionId) return null;
      return (await kvGet(`${prefix}${sessionId}`)) || null;
    },

    /**
     * List all active sessions for a user, marking current session
     * @param {string|number} userId
     * @param {string} [currentSessionId]
     * @returns {Promise<Array<Object>>}
     */
    list: async (userId, currentSessionId = null) => {
      if (!userId) return [];
      if (typeof kv.list !== 'function') return [];
      const listRes = await kv.list({ prefix });
      const keys = listRes.keys || [];
      const items = await Promise.all(
        keys.map((k) => kvGet(k.name).catch(() => null))
      );
      const results = [];
      for (const item of items) {
        if (item && String(item.user_id) === String(userId)) {
          results.push({
            ...item,
            is_current: Boolean(currentSessionId && item.session_id === currentSessionId),
          });
        }
      }
      return results.sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime());
    },

    /**
     * Legacy alias for list()
     * @param {string|number} userId
     * @returns {Promise<Array<Object>>}
     */
    listUserSessions: async (userId) => {
      if (!userId || typeof kv.list !== 'function') return [];
      const listRes = await kv.list({ prefix });
      const keys = listRes.keys || [];
      const items = await Promise.all(
        keys.map((k) => kvGet(k.name).catch(() => null))
      );
      return items.filter((item) => item && String(item.user_id) === String(userId));
    },

    /**
     * Check if a session exists and belongs to the given user
     * @param {string} sessionId
     * @param {string|number} [userId]
     * @returns {Promise<boolean>}
     */
    isSessionValid: async (sessionId, userId = null) => {
      if (!sessionId) return false;
      const record = await kvGet(`${prefix}${sessionId}`);
      if (!record) return false;
      if (userId && String(record.user_id) !== String(userId)) return false;
      return true;
    },

    /**
     * Legacy alias for isSessionValid()
     * @param {string} sessionId
     * @param {string|number} [userId]
     * @returns {Promise<boolean>}
     */
    validate: async (sessionId, userId = null) => {
      if (!sessionId) return false;
      const record = await kvGet(`${prefix}${sessionId}`);
      if (!record) return false;
      if (userId && String(record.user_id) !== String(userId)) return false;
      return true;
    },

    /**
     * Revoke a single session
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    revoke: async (sessionId) => {
      if (!sessionId) return false;
      await kvDelete(`${prefix}${sessionId}`);
      return true;
    },

    /**
     * Revoke all other sessions for user, keeping the current session active
     * @param {string|number} userId
     * @param {string} currentSessionId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeOthers: async (userId, currentSessionId) => {
      if (!userId || typeof kv.list !== 'function') return 0;
      const listRes = await kv.list({ prefix });
      const keys = listRes.keys || [];
      const items = await Promise.all(
        keys.map((k) => kvGet(k.name).then((item) => ({ key: k.name, item })).catch(() => null))
      );
      const toDelete = [];
      for (const entry of items) {
        if (entry?.item && String(entry.item.user_id) === String(userId) && entry.item.session_id !== currentSessionId) {
          toDelete.push(entry.key);
        }
      }
      if (toDelete.length > 0) {
        await Promise.all(toDelete.map((k) => kvDelete(k)));
      }
      return toDelete.length;
    },

    /**
     * Revoke all sessions for a user (force logout from all devices)
     * @param {string|number} userId
     * @returns {Promise<number>} Number of revoked sessions
     */
    revokeAll: async (userId) => {
      if (!userId || typeof kv.list !== 'function') return 0;
      const listRes = await kv.list({ prefix });
      const keys = listRes.keys || [];
      const items = await Promise.all(
        keys.map((k) => kvGet(k.name).then((item) => ({ key: k.name, item })).catch(() => null))
      );
      const toDelete = [];
      for (const entry of items) {
        if (entry?.item && String(entry.item.user_id) === String(userId)) {
          toDelete.push(entry.key);
        }
      }
      if (toDelete.length > 0) {
        await Promise.all(toDelete.map((k) => kvDelete(k)));
      }
      return toDelete.length;
    },

    purgeExpired: async () => {
      // Cloudflare KV automatically purges expired keys via expirationTtl
      return 0;
    },
  };
}

const {
  RedisSessionStore,
  createRedisSessionStore,
  createRedisSessionTracker,
  MiniRedisClient,
  InMemoryRedisClient,
  createMiniRedisClient,
} = require('./redis-session');

module.exports = {
  createUserSessionsTable,
  dropUserSessionsTable,
  createKnexSessionTracker,
  createMemorySessionTracker,
  createKvSessionTracker,
  createRedisSessionStore,
  createRedisSessionTracker,
  RedisSessionStore,
  MiniRedisClient,
  InMemoryRedisClient,
  createMiniRedisClient,
  getClientIp,
  parseUserAgent,
};
