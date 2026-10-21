/**
 * Webspresso Core Zero-Dependency Rate Limiter Engine
 * @module core/rate-limit
 */

'use strict';

const { RateLimiter, createRateLimiter, rateLimit } = require('./limiter');
const { MemoryRateLimitStore } = require('./stores/memory');
const { RedisRateLimitStore } = require('./stores/redis');
const { parseWindow, extractClientIp, formatResetSeconds } = require('./utils');

module.exports = {
  RateLimiter,
  createRateLimiter,
  rateLimit,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  parseWindow,
  extractClientIp,
  formatResetSeconds,
};
