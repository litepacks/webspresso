import { describe, it, expect, afterEach } from 'vitest';

const {
  RateLimiter,
  createRateLimiter,
  MemoryRateLimitStore,
  parseWindow,
  extractClientIp,
} = require('../../../core/rate-limit');
const { TooManyRequestsError } = require('../../../core/errors');

function mockExpressReq(ip = '10.0.0.1', path = '/api/test') {
  return {
    ip,
    path,
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
  };
}

function mockExpressRes() {
  const headers = {};
  const listeners = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    on(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    emitFinish() {
      (listeners.finish || []).forEach((fn) => fn());
    },
  };
}

describe('RateLimit Stress Lab', () => {
  const stores = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop().destroy();
    }
  });

  it('1. handles 1,500 sliding-window increments across 150 distinct keys and sweeps stale entries', async () => {
    expect(parseWindow('10s')).toBe(10000);
    expect(parseWindow('2m')).toBe(120000);

    const store = new MemoryRateLimitStore({ cleanupIntervalMs: 60000 });
    stores.push(store);

    // 150 keys x 10 requests each concurrently
    const ops = [];
    for (let k = 0; k < 150; k++) {
      for (let r = 0; r < 10; r++) {
        ops.push(store.increment(`ip:192.168.1.${k}`, 5000));
      }
    }
    const results = await Promise.all(ops);
    expect(results).toHaveLength(1500);
    expect(store.hits.size).toBe(150);
    expect(store.hits.get('ip:192.168.1.0')).toHaveLength(10);

    // Decrement & resetKey
    await store.decrement('ip:192.168.1.0');
    expect(store.hits.get('ip:192.168.1.0')).toHaveLength(9);

    await store.resetKey('ip:192.168.1.1');
    expect(store.hits.has('ip:192.168.1.1')).toBe(false);

    // Simulate stale key older than 1 hour and verify sweep() purges it
    store.hits.set('stale-ip', [Date.now() - 3600001]);
    store.sweep();
    expect(store.hits.has('stale-ip')).toBe(false);
    expect(store.hits.has('ip:192.168.1.0')).toBe(true);
  });

  it('2. enforces exact limit boundary with RFC 6585 RateLimit-* and Retry-After headers on Express middleware', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);

    const limiter = createRateLimiter({
      limit: 25,
      window: '30s',
      store,
      standardHeaders: true,
      legacyHeaders: true,
    });

    let passed = 0;
    let blocked = 0;

    for (let i = 0; i < 40; i++) {
      const req = mockExpressReq('203.0.113.5');
      const res = mockExpressRes();
      let nextErr = null;
      let nextCalled = false;

      await limiter(req, res, (err) => {
        nextCalled = true;
        nextErr = err || null;
      });

      if (i < 25) {
        expect(nextCalled).toBe(true);
        expect(nextErr).toBeNull();
        expect(res.headers['ratelimit-limit']).toBe('25');
        expect(res.headers['ratelimit-remaining']).toBe(String(25 - (i + 1)));
        expect(res.headers['x-ratelimit-limit']).toBe('25');
        expect(res.headers['retry-after']).toBeUndefined();
        passed += 1;
      } else {
        expect(res.headers['ratelimit-remaining']).toBe('0');
        expect(res.headers['retry-after']).toBeDefined();
        if (nextErr) {
          expect(nextErr).toBeInstanceOf(TooManyRequestsError);
        } else {
          expect(res.statusCode).toBe(429);
        }
        blocked += 1;
      }
    }

    expect(passed).toBe(25);
    expect(blocked).toBe(15);
  });

  it('3. expires old sliding-window hits and allows fresh burst after windowMs elapses', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);

    const limiter = new RateLimiter({
      limit: 5,
      windowMs: 45,
      store,
    });

    for (let i = 0; i < 5; i++) {
      const res = mockExpressRes();
      let nextCalled = false;
      await limiter.middleware(mockExpressReq('10.10.10.10'), res, (err) => {
        if (!err) nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    }

    // 6th request is blocked
    const blockedRes = mockExpressRes();
    let blockedErr = null;
    await limiter.middleware(mockExpressReq('10.10.10.10'), blockedRes, (err) => {
      blockedErr = err || null;
    });
    expect(blockedErr || blockedRes.statusCode === 429).toBeTruthy();

    // Wait for windowMs to slide past
    await new Promise((r) => setTimeout(r, 60));

    // New request succeeds with full remaining quota (limit - 1 = 4)
    const freshRes = mockExpressRes();
    let freshPassed = false;
    await limiter.middleware(mockExpressReq('10.10.10.10'), freshRes, (err) => {
      if (!err) freshPassed = true;
    });
    expect(freshPassed).toBe(true);
    expect(freshRes.headers['ratelimit-remaining']).toBe('4');
  });

  it('4. supports skip(), custom keyGenerator, Hono context adapter, and IP extraction', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);

    expect(
      extractClientIp({
        headers: { 'cf-connecting-ip': '198.51.100.2', 'x-forwarded-for': '1.2.3.4' },
      }),
    ).toBe('198.51.100.2');

    const limiter = createRateLimiter({
      limit: 2,
      window: '10s',
      store,
      skip: (req) => req.path === '/healthz',
      keyGenerator: (req) => req.headers['x-api-key'] || 'anon',
    });

    // /healthz always skipped even after 10 calls
    for (let i = 0; i < 10; i++) {
      let ok = false;
      await limiter(mockExpressReq('1.1.1.1', '/healthz'), mockExpressRes(), () => {
        ok = true;
      });
      expect(ok).toBe(true);
    }

    // Hono context simulation
    const honoHeaders = {};
    const makeHonoCtx = (apiKey) => ({
      req: {
        path: '/api/v1/data',
        method: 'POST',
        header(name) {
          if (!name) return { 'x-api-key': apiKey };
          if (name === 'x-api-key') return apiKey;
          return undefined;
        },
      },
      header(k, v) {
        honoHeaders[k.toLowerCase()] = v;
      },
      json(body, status) {
        return { body, status };
      },
      text(body, status) {
        return { body, status };
      },
    });

    await limiter(makeHonoCtx('key-abc'), async () => 'next-1');
    await limiter(makeHonoCtx('key-abc'), async () => 'next-2');
    const third = await limiter(makeHonoCtx('key-abc'), async () => 'next-3');
    expect(third.status).toBe(429);
    expect(honoHeaders['ratelimit-remaining']).toBe('0');
  });
});
