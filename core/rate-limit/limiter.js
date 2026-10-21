/**
 * Webspresso Core Rate Limiter Engine
 * Zero-dependency, framework-agnostic rate limiting middleware for Express and Hono.
 * Implements RFC 6585 and IETF Draft standard RateLimit headers.
 * @module core/rate-limit/limiter
 */

'use strict';

const { parseWindow, extractClientIp, formatResetSeconds } = require('./utils');
const { MemoryRateLimitStore } = require('./stores/memory');
const { TooManyRequestsError } = require('../errors');

class RateLimiter {
  /**
   * @param {Object} [options]
   * @param {number} [options.limit=60] - Maximum requests allowed in the time window
   * @param {number} [options.max=60] - Alias for options.limit
   * @param {string|number} [options.window='1m'] - Time window in ms or string ('1m', '10s', etc.)
   * @param {string|number} [options.windowMs] - Alias for options.window
   * @param {Object} [options.store] - Store instance (MemoryRateLimitStore or RedisRateLimitStore)
   * @param {Function} [options.keyGenerator] - Custom key generator (req) => string
   * @param {Function} [options.skip] - Predicate function (req) => boolean
   * @param {boolean} [options.standardHeaders=true] - Send RateLimit-* headers
   * @param {boolean} [options.legacyHeaders=false] - Send X-RateLimit-* headers
   * @param {boolean} [options.skipFailedRequests=false] - Don't count failed requests (status >= 400)
   * @param {boolean} [options.skipSuccessfulRequests=false] - Don't count successful requests (status < 400)
   * @param {number} [options.statusCode=429] - Status code on limit exceeded
   * @param {string|Object} [options.message] - Response body on limit exceeded
   * @param {Function} [options.handler] - Custom handler when limit exceeded
   */
  constructor(options = {}) {
    this.limit = options.limit || options.max || 60;
    this.windowMs = parseWindow(options.windowMs || options.window || 60000);
    this.store = options.store || new MemoryRateLimitStore();
    this.keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : extractClientIp;
    this.skip = typeof options.skip === 'function' ? options.skip : (() => false);
    this.standardHeaders = options.standardHeaders !== false;
    this.legacyHeaders = Boolean(options.legacyHeaders);
    this.skipFailedRequests = Boolean(options.skipFailedRequests);
    this.skipSuccessfulRequests = Boolean(options.skipSuccessfulRequests);
    this.statusCode = options.statusCode || 429;
    this.message = options.message || {
      error: 'Too Many Requests',
      message: 'Too many requests, please try again later.',
      statusCode: this.statusCode,
    };
    this.handler = typeof options.handler === 'function' ? options.handler : null;

    // Bind middleware
    this.middleware = this.middleware.bind(this);
  }

  /**
   * Set standard and legacy RateLimit headers on response
   * @private
   */
  _setHeaders(setter, limit, remaining, resetSeconds, resetDate, isExceeded) {
    if (this.standardHeaders) {
      setter('ratelimit-limit', String(limit));
      setter('ratelimit-remaining', String(remaining));
      setter('ratelimit-reset', String(resetSeconds));
      setter('ratelimit-policy', `${limit};w=${Math.ceil(this.windowMs / 1000)}`);
    }

    if (this.legacyHeaders) {
      setter('x-ratelimit-limit', String(limit));
      setter('x-ratelimit-remaining', String(remaining));
      setter('x-ratelimit-reset', String(Math.ceil(resetDate.getTime() / 1000)));
    }

    if (isExceeded) {
      setter('retry-after', String(Math.max(1, resetSeconds)));
    }
  }

  /**
   * Universal Middleware Handler
   * Works on Express (req, res, next) and Hono (c, next)
   */
  async middleware(reqOrC, resOrNext, maybeNext) {
    // 1. Detect Hono vs Express signature
    const isHono = typeof reqOrC.header === 'function' && typeof reqOrC.text === 'function' && typeof resOrNext === 'function';

    if (isHono) {
      const c = reqOrC;
      const next = resOrNext;

      const reqMock = {
        ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1',
        headers: c.req.header(),
        path: c.req.path,
        method: c.req.method,
      };

      if (this.skip(reqMock)) {
        return next();
      }

      const key = String(this.keyGenerator(reqMock) || '127.0.0.1');
      const { totalHits, resetTime } = await this.store.increment(key, this.windowMs);
      const remaining = Math.max(0, this.limit - totalHits);
      const resetSeconds = formatResetSeconds(resetTime);
      const isExceeded = totalHits > this.limit;

      this._setHeaders(
        (headerName, headerVal) => c.header(headerName, headerVal),
        this.limit,
        remaining,
        resetSeconds,
        resetTime,
        isExceeded
      );

      if (isExceeded) {
        if (this.handler) {
          return this.handler(c, {
            totalHits,
            remaining,
            resetTime,
            limit: this.limit,
          });
        }
        return c.json(typeof this.message === 'object' ? this.message : { message: this.message }, this.statusCode);
      }

      return next();
    }

    // 2. Standard Express signature: (req, res, next)
    const req = reqOrC;
    const res = resOrNext;
    const next = maybeNext || (() => {});

    if (this.skip(req)) {
      return next();
    }

    const key = String(this.keyGenerator(req) || '127.0.0.1');
    const { totalHits, resetTime } = await this.store.increment(key, this.windowMs);
    const remaining = Math.max(0, this.limit - totalHits);
    const resetSeconds = formatResetSeconds(resetTime);
    const isExceeded = totalHits > this.limit;

    // Attach info to request
    req.rateLimit = {
      limit: this.limit,
      current: totalHits,
      remaining,
      resetTime,
    };

    if (res && typeof res.setHeader === 'function') {
      this._setHeaders(
        (name, val) => res.setHeader(name, val),
        this.limit,
        remaining,
        resetSeconds,
        resetTime,
        isExceeded
      );
    }

    // Handle skip on success / failure
    if (res && typeof res.on === 'function' && (this.skipFailedRequests || this.skipSuccessfulRequests)) {
      res.on('finish', () => {
        const isFailed = res.statusCode >= 400;
        if (isFailed && this.skipFailedRequests) {
          this.store.decrement(key).catch(() => {});
        } else if (!isFailed && this.skipSuccessfulRequests) {
          this.store.decrement(key).catch(() => {});
        }
      });
    }

    if (isExceeded) {
      if (this.handler) {
        return this.handler(req, res, next, {
          totalHits,
          remaining,
          resetTime,
          limit: this.limit,
        });
      }

      if (res && typeof res.status === 'function') {
        if (typeof this.message === 'object') {
          return res.status(this.statusCode).json(this.message);
        }
        return res.status(this.statusCode).send(String(this.message));
      }

      const err = new TooManyRequestsError(
        typeof this.message === 'string' ? this.message : this.message.message || 'Too Many Requests'
      );
      return next(err);
    }

    return next();
  }
}

/**
 * Factory helper for creating rate limiter middleware
 * @param {Object} [options]
 * @returns {import('express').RequestHandler & { limiter: RateLimiter }}
 */
function createRateLimiter(options = {}) {
  const limiter = new RateLimiter(options);
  const mw = (req, res, next) => limiter.middleware(req, res, next);
  mw.limiter = limiter;
  return mw;
}

module.exports = {
  RateLimiter,
  createRateLimiter,
  rateLimit: createRateLimiter,
};
