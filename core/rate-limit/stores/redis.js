/**
 * Webspresso Redis Rate Limit Store
 * Distributed sliding window rate limiter backed by Redis.
 * Supports official redis, ioredis, or Webspresso MiniRedisClient.
 * @module core/rate-limit/stores/redis
 */

'use strict';

class RedisRateLimitStore {
  /**
   * @param {Object} options
   * @param {Object} options.client - Redis client instance
   * @param {string} [options.prefix='rl:'] - Key prefix
   * @param {boolean} [options.passOnStoreError=true] - Fail-open on Redis connection errors
   */
  constructor(options = {}) {
    if (!options.client) {
      throw new Error('[RedisRateLimitStore] Requires an initialized redis client');
    }
    this.client = options.client;
    this.prefix = options.prefix || 'rl:';
    this.passOnStoreError = options.passOnStoreError !== false;
  }

  _getKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Increment request count for key within windowMs
   * @param {string} key
   * @param {number} windowMs
   * @returns {Promise<{ totalHits: number, resetTime: Date }>}
   */
  async increment(key, windowMs) {
    const redisKey = this._getKey(key);
    const now = Date.now();
    const threshold = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // 1. If client supports multi() with sorted sets (ioredis / node-redis)
      if (typeof this.client.multi === 'function') {
        const multi = this.client.multi();
        multi.zremrangebyscore(redisKey, 0, threshold);
        multi.zadd(redisKey, now, member);
        multi.zcard(redisKey);
        multi.pexpire(redisKey, windowMs + 1000);

        const execRes = await multi.exec();
        // Handle ioredis tuple [err, res] vs node-redis single value
        const zcardRes = execRes[2];
        const count = Array.isArray(zcardRes) ? zcardRes[1] : zcardRes;

        return {
          totalHits: Number(count) || 1,
          resetTime: new Date(now + windowMs),
        };
      }

      // 2. Fallback using individual commands or INCR + PEXPIRE
      if (typeof this.client.zremrangebyscore === 'function' && typeof this.client.zadd === 'function') {
        await this.client.zremrangebyscore(redisKey, 0, threshold);
        await this.client.zadd(redisKey, now, member);
        const count = await this.client.zcard(redisKey);
        if (typeof this.client.pexpire === 'function') {
          await this.client.pexpire(redisKey, windowMs + 1000);
        }
        return {
          totalHits: Number(count) || 1,
          resetTime: new Date(now + windowMs),
        };
      }

      // 3. Fallback using key per time bucket
      const bucket = Math.floor(now / windowMs);
      const bucketKey = `${redisKey}:${bucket}`;
      let count = 1;
      if (typeof this.client.incr === 'function') {
        count = await this.client.incr(bucketKey);
        if (count === 1 && typeof this.client.pexpire === 'function') {
          await this.client.pexpire(bucketKey, windowMs + 1000);
        }
      }

      return {
        totalHits: Number(count) || 1,
        resetTime: new Date((bucket + 1) * windowMs),
      };
    } catch (err) {
      if (this.passOnStoreError) {
        // Fail-open: allow request to proceed if Redis is down
        return {
          totalHits: 1,
          resetTime: new Date(now + windowMs),
        };
      }
      throw err;
    }
  }

  /**
   * Decrement request count
   * @param {string} key
   * @returns {Promise<void>}
   */
  async decrement(key) {
    const redisKey = this._getKey(key);
    try {
      if (typeof this.client.zpopmax === 'function') {
        await this.client.zpopmax(redisKey, 1);
      } else if (typeof this.client.decr === 'function') {
        await this.client.decr(redisKey);
      }
    } catch (_) {}
  }

  /**
   * Reset hits for a single key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async resetKey(key) {
    const redisKey = this._getKey(key);
    try {
      if (typeof this.client.del === 'function') {
        await this.client.del(redisKey);
      }
    } catch (_) {}
  }

  /**
   * Reset all keys matching prefix
   * @returns {Promise<void>}
   */
  async resetAll() {
    try {
      if (typeof this.client.keys === 'function' && typeof this.client.del === 'function') {
        const keys = await this.client.keys(`${this.prefix}*`);
        if (keys && keys.length > 0) {
          await this.client.del(...keys);
        }
      }
    } catch (_) {}
  }
}

module.exports = {
  RedisRateLimitStore,
};
