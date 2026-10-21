'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const {
  RateLimiter,
  createRateLimiter,
  rateLimit,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  parseWindow,
  extractClientIp,
  formatResetSeconds,
} = require('../../core/rate-limit');
const core = require('../../core');
const webspresso = require('../../index');

describe('core/rate-limit: parseWindow', () => {
  it('parses numeric values as milliseconds', () => {
    expect(parseWindow(5000)).toBe(5000);
    expect(parseWindow(100.5)).toBe(100);
  });

  it('parses duration strings with different units', () => {
    expect(parseWindow('500ms')).toBe(500);
    expect(parseWindow('10s')).toBe(10000);
    expect(parseWindow('1m')).toBe(60000);
    expect(parseWindow('15m')).toBe(900000);
    expect(parseWindow('2h')).toBe(7200000);
    expect(parseWindow('1d')).toBe(86400000);
  });

  it('falls back to 60000ms for invalid or empty inputs', () => {
    expect(parseWindow('')).toBe(60000);
    expect(parseWindow(null)).toBe(60000);
    expect(parseWindow('invalid')).toBe(60000);
  });
});

describe('core/rate-limit: extractClientIp', () => {
  it('prefers req.ip if present', () => {
    const req = { ip: '192.168.1.1' };
    expect(extractClientIp(req)).toBe('192.168.1.1');
  });

  it('extracts Cloudflare connecting IP', () => {
    const req = {
      headers: {
        'cf-connecting-ip': '203.0.113.195',
        'x-forwarded-for': '198.51.100.1',
      },
    };
    expect(extractClientIp(req)).toBe('203.0.113.195');
  });

  it('extracts Fastly / Akamai client IP', () => {
    const req = {
      headers: {
        'fastly-client-ip': '198.51.100.5',
      },
    };
    expect(extractClientIp(req)).toBe('198.51.100.5');
  });

  it('extracts first IP from X-Forwarded-For chain', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      },
    };
    expect(extractClientIp(req)).toBe('203.0.113.195');
  });

  it('extracts X-Real-IP if no preceding headers', () => {
    const req = {
      headers: {
        'x-real-ip': '198.51.100.22',
      },
    };
    expect(extractClientIp(req)).toBe('198.51.100.22');
  });

  it('extracts socket remote address and normalizes IPv4-mapped IPv6', () => {
    const req = {
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    };
    expect(extractClientIp(req)).toBe('127.0.0.1');
  });

  it('returns fallback 127.0.0.1 when req is missing or empty', () => {
    expect(extractClientIp(null)).toBe('127.0.0.1');
    expect(extractClientIp({})).toBe('127.0.0.1');
  });
});

describe('core/rate-limit: formatResetSeconds', () => {
  it('calculates remaining seconds accurately', () => {
    const futureDate = new Date(Date.now() + 5000);
    const secs = formatResetSeconds(futureDate);
    expect(secs).toBeGreaterThanOrEqual(4);
    expect(secs).toBeLessThanOrEqual(6);
  });

  it('returns 0 for past timestamps', () => {
    const pastDate = new Date(Date.now() - 5000);
    expect(formatResetSeconds(pastDate)).toBe(0);
  });
});

describe('core/rate-limit: MemoryRateLimitStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryRateLimitStore({ cleanupIntervalMs: 60000 });
  });

  afterEach(() => {
    store.destroy();
  });

  it('tracks sliding window hits for a key', async () => {
    const res1 = await store.increment('client-1', 1000);
    expect(res1.totalHits).toBe(1);
    expect(res1.resetTime).toBeInstanceOf(Date);

    const res2 = await store.increment('client-1', 1000);
    expect(res2.totalHits).toBe(2);

    const resOther = await store.increment('client-2', 1000);
    expect(resOther.totalHits).toBe(1);
  });

  it('decrements hits on request skip or failure', async () => {
    await store.increment('client-dec', 5000);
    await store.increment('client-dec', 5000);
    await store.decrement('client-dec');

    const res = await store.increment('client-dec', 5000);
    expect(res.totalHits).toBe(2); // 2 - 1 + 1 = 2
  });

  it('resets key and all keys', async () => {
    await store.increment('k1', 5000);
    await store.increment('k2', 5000);

    await store.resetKey('k1');
    const r1 = await store.increment('k1', 5000);
    expect(r1.totalHits).toBe(1);

    await store.resetAll();
    const r2 = await store.increment('k2', 5000);
    expect(r2.totalHits).toBe(1);
  });

  it('sweeps expired keys without active hits', () => {
    store.hits.set('stale', []);
    store.hits.set('ancient', [Date.now() - 4000000]); // > 1 hr
    store.hits.set('fresh', [Date.now()]);

    store.sweep();

    expect(store.hits.has('stale')).toBe(false);
    expect(store.hits.has('ancient')).toBe(false);
    expect(store.hits.has('fresh')).toBe(true);
  });
});

describe('core/rate-limit: RedisRateLimitStore', () => {
  it('throws if client is not provided', () => {
    expect(() => new RedisRateLimitStore({})).toThrow(/Requires an initialized redis client/);
  });

  it('uses client.multi() with sorted set sliding window', async () => {
    const mockMulti = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([null, null, 3, null]),
    };
    const mockClient = {
      multi: vi.fn().mockReturnValue(mockMulti),
    };

    const store = new RedisRateLimitStore({ client: mockClient, prefix: 'test:' });
    const res = await store.increment('user-123', 60000);

    expect(mockClient.multi).toHaveBeenCalled();
    expect(mockMulti.zremrangebyscore).toHaveBeenCalled();
    expect(mockMulti.zadd).toHaveBeenCalled();
    expect(mockMulti.zcard).toHaveBeenCalled();
    expect(mockMulti.pexpire).toHaveBeenCalled();
    expect(res.totalHits).toBe(3);
    expect(res.resetTime).toBeInstanceOf(Date);
  });

  it('fails open when Redis errors if passOnStoreError is true', async () => {
    const mockClient = {
      multi: () => {
        throw new Error('Redis connection refused');
      },
    };

    const store = new RedisRateLimitStore({ client: mockClient, passOnStoreError: true });
    const res = await store.increment('user-err', 60000);

    expect(res.totalHits).toBe(1);
    expect(res.resetTime).toBeInstanceOf(Date);
  });

  it('throws on Redis error when passOnStoreError is false', async () => {
    const mockClient = {
      multi: () => {
        throw new Error('Redis connection refused');
      },
    };

    const store = new RedisRateLimitStore({ client: mockClient, passOnStoreError: false });
    await expect(store.increment('user-err', 60000)).rejects.toThrow('Redis connection refused');
  });

  it('calls del on resetKey and del keys on resetAll', async () => {
    const mockClient = {
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue(['rl:k1', 'rl:k2']),
    };

    const store = new RedisRateLimitStore({ client: mockClient });
    await store.resetKey('k1');
    expect(mockClient.del).toHaveBeenCalledWith('rl:k1');

    await store.resetAll();
    expect(mockClient.keys).toHaveBeenCalledWith('rl:*');
    expect(mockClient.del).toHaveBeenCalledWith('rl:k1', 'rl:k2');
  });
});

describe('core/rate-limit: RateLimiter (Express Middleware)', () => {
  it('allows requests within limit and sets standard headers', async () => {
    const limiter = new RateLimiter({ limit: 5, window: '1m' });
    const headers = {};
    const req = { ip: '127.0.0.1' };
    const res = {
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    await limiter.middleware(req, res, next);

    expect(nextCalled).toBe(true);
    expect(headers['ratelimit-limit']).toBe('5');
    expect(headers['ratelimit-remaining']).toBe('4');
    expect(headers['ratelimit-policy']).toBe('5;w=60');
    expect(headers['ratelimit-reset']).toBeDefined();
    expect(req.rateLimit).toBeDefined();
    expect(req.rateLimit.current).toBe(1);
    expect(req.rateLimit.remaining).toBe(4);
  });

  it('blocks requests exceeding limit with 429 and Retry-After header', async () => {
    const limiter = new RateLimiter({ limit: 2, window: '10s' });
    const headers = {};
    let statusSent = null;
    let bodySent = null;

    const createRes = () => ({
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
      status: (code) => {
        statusSent = code;
        return {
          json: (b) => {
            bodySent = b;
          },
          send: (b) => {
            bodySent = b;
          },
        };
      },
    });

    const req = { ip: '10.0.0.1' };

    // Request 1: OK
    await limiter.middleware(req, createRes(), () => {});
    expect(statusSent).toBeNull();

    // Request 2: OK
    await limiter.middleware(req, createRes(), () => {});
    expect(statusSent).toBeNull();

    // Request 3: Exceeded -> 429
    let nextCalled = false;
    await limiter.middleware(req, createRes(), () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusSent).toBe(429);
    expect(headers['retry-after']).toBeDefined();
    expect(bodySent).toHaveProperty('error', 'Too Many Requests');
  });

  it('sets legacy X-RateLimit-* headers when legacyHeaders: true', async () => {
    const limiter = new RateLimiter({ limit: 10, window: '1m', legacyHeaders: true });
    const headers = {};
    const res = {
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
    };

    await limiter.middleware({ ip: '10.0.0.2' }, res, () => {});

    expect(headers['x-ratelimit-limit']).toBe('10');
    expect(headers['x-ratelimit-remaining']).toBe('9');
    expect(headers['x-ratelimit-reset']).toBeDefined();
  });

  it('skips rate limiting when skip() returns true', async () => {
    const limiter = new RateLimiter({
      limit: 1,
      window: '1m',
      skip: (req) => req.url === '/health',
    });

    let nextCount = 0;
    const next = () => {
      nextCount++;
    };

    const req = { ip: '10.0.0.3', url: '/health' };
    await limiter.middleware(req, { setHeader: () => {} }, next);
    await limiter.middleware(req, { setHeader: () => {} }, next);
    await limiter.middleware(req, { setHeader: () => {} }, next);

    expect(nextCount).toBe(3);
  });

  it('supports custom handler on rate limit exceeded', async () => {
    let customHandlerCalled = false;
    const limiter = new RateLimiter({
      limit: 1,
      window: '1m',
      handler: (req, res, next, info) => {
        customHandlerCalled = true;
        expect(info.totalHits).toBe(2);
        res.status(429).json({ custom: true });
      },
    });

    const res = {
      setHeader: () => {},
      status: () => ({ json: () => {} }),
    };

    await limiter.middleware({ ip: '10.0.0.4' }, res, () => {});
    await limiter.middleware({ ip: '10.0.0.4' }, res, () => {});

    expect(customHandlerCalled).toBe(true);
  });

  it('supports skipFailedRequests decrements hit on 4xx/5xx finish', async () => {
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter({
      limit: 5,
      window: '1m',
      store,
      skipFailedRequests: true,
    });

    let finishCallback = null;
    const res = {
      setHeader: () => {},
      statusCode: 404,
      on: (event, cb) => {
        if (event === 'finish') finishCallback = cb;
      },
    };

    await limiter.middleware({ ip: '10.0.0.5' }, res, () => {});
    const infoBefore = await store.increment('10.0.0.5', 60000);
    expect(infoBefore.totalHits).toBe(2);

    // Trigger finish on 404
    finishCallback();

    // Give microtask queue time to run decrement
    await new Promise((r) => setTimeout(r, 10));

    const infoAfter = await store.increment('10.0.0.5', 60000);
    expect(infoAfter.totalHits).toBe(2); // 2 - 1 (decremented) + 1 = 2
  });
});

describe('core/rate-limit: RateLimiter (Hono Context)', () => {
  it('detects Hono signature, sets headers and returns json on exceeded', async () => {
    const limiter = new RateLimiter({ limit: 1, window: '1m' });
    const headers = {};

    const createHonoContext = () => ({
      req: {
        header: (name) => {
          if (!name) return {};
          return null;
        },
        path: '/api/items',
        method: 'GET',
      },
      header: (name, val) => {
        headers[name.toLowerCase()] = val;
      },
      text: () => {},
      json: (data, status) => ({ data, status }),
    });

    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
    };

    // Request 1: OK
    const c1 = createHonoContext();
    await limiter.middleware(c1, next);
    expect(nextCalled).toBe(true);
    expect(headers['ratelimit-limit']).toBe('1');
    expect(headers['ratelimit-remaining']).toBe('0');

    // Request 2: Exceeded -> returns Hono response
    nextCalled = false;
    const c2 = createHonoContext();
    const response = await limiter.middleware(c2, next);

    expect(nextCalled).toBe(false);
    expect(response.status).toBe(429);
    expect(headers['retry-after']).toBeDefined();
  });
});

describe('core/rate-limit: Public exports', () => {
  it('exports rateLimit and createRateLimiter from core and webspresso top-level', () => {
    expect(typeof core.rateLimit).toBe('function');
    expect(typeof core.createRateLimiter).toBe('function');
    expect(typeof core.RateLimiter).toBe('function');
    expect(typeof core.MemoryRateLimitStore).toBe('function');
    expect(typeof core.RedisRateLimitStore).toBe('function');

    expect(typeof webspresso.rateLimit).toBe('function');
    expect(typeof webspresso.createRateLimiter).toBe('function');
    expect(typeof webspresso.RateLimiter).toBe('function');
    expect(typeof webspresso.MemoryRateLimitStore).toBe('function');
    expect(typeof webspresso.RedisRateLimitStore).toBe('function');
    expect(typeof webspresso.rateLimitPlugin).toBe('function');
  });

  it('createRateLimiter factory creates callable middleware with limiter property', () => {
    const mw = createRateLimiter({ limit: 10, window: '30s' });
    expect(typeof mw).toBe('function');
    expect(mw.limiter).toBeInstanceOf(RateLimiter);
    expect(mw.limiter.limit).toBe(10);
    expect(mw.limiter.windowMs).toBe(30000);
  });
});
