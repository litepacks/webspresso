'use strict';

const { rateLimit } = require('./webspresso');

/**
 * Named rate limiters. Limits are env-tunable so load tests / benchmarks can lift them.
 */
const loginLimiter = rateLimit({
  window: '1m',
  limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
  message: { error: 'Too many login attempts. Please wait a minute.' },
});

const writeLimiter = rateLimit({
  window: '1m',
  limit: Number(process.env.WRITE_RATE_LIMIT || 60),
  message: { error: 'Too many write requests.' },
});

module.exports = { loginLimiter, writeLimiter };

