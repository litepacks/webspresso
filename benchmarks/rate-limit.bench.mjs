/**
 * Microbenchmarks: Rate Limiter Engine (`core/rate-limit`)
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RateLimiter,
  createRateLimiter,
  MemoryRateLimitStore,
  extractClientIp,
  parseWindow,
} = require('../core/rate-limit');

describe('Rate Limit: parseWindow & extractClientIp', () => {
  const reqWithCf = {
    headers: {
      'cf-connecting-ip': '203.0.113.195',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    },
  };

  const reqWithXff = {
    headers: {
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    },
  };

  bench('parseWindow("15m")', () => {
    parseWindow('15m');
  });

  bench('extractClientIp (Cloudflare header)', () => {
    extractClientIp(reqWithCf);
  });

  bench('extractClientIp (X-Forwarded-For chain)', () => {
    extractClientIp(reqWithXff);
  });
});

describe('Rate Limit: MemoryRateLimitStore.increment', () => {
  const store = new MemoryRateLimitStore({ cleanupIntervalMs: 60000 });

  bench('store.increment (single key)', async () => {
    await store.increment('bench-client-single', 60000);
  });

  let counter = 0;
  bench('store.increment (multi-key rotation)', async () => {
    const key = `bench-client-${(counter++) % 1000}`;
    await store.increment(key, 60000);
  });
});

describe('Rate Limit: Middleware Overhead (Express)', () => {
  const limiter = createRateLimiter({ limit: 1000000, window: '1m' });
  const req = { ip: '127.0.0.1' };
  const res = {
    setHeader: () => {},
  };
  const next = () => {};

  bench('limiter.middleware (Express pass-through)', async () => {
    await limiter(req, res, next);
  });
});

describe('Rate Limit: Middleware Overhead (Hono)', () => {
  const limiter = createRateLimiter({ limit: 1000000, window: '1m' });
  const c = {
    req: {
      header: (name) => (name === 'cf-connecting-ip' ? '127.0.0.1' : null),
      path: '/api/test',
      method: 'GET',
    },
    header: () => {},
    text: () => {},
    json: () => {},
  };
  const next = async () => {};

  bench('limiter.middleware (Hono pass-through)', async () => {
    await limiter.limiter.middleware(c, next);
  });
});
