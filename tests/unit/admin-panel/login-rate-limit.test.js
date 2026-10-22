/**
 * Admin Panel Login Rate Limiting Unit Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
const { LoginRateLimiter } = require('../../../plugins/admin-panel/lib/login-rate-limiter');
const { createApiHandlers } = require('../../../plugins/admin-panel/api');
const { createMockRes } = require('../../utils/http');

describe('LoginRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter({
      enabled: true,
      maxAttempts: 3,
      windowMs: 60 * 1000,
      blockDurationMs: 60 * 1000,
    });
  });

  it('allows initial login attempts', () => {
    const req = { ip: '127.0.0.1' };
    const status = limiter.isBlocked(req);
    expect(status.blocked).toBe(false);
    expect(status.remaining).toBe(3);
  });

  it('tracks failed attempts and blocks after maxAttempts', () => {
    const req = { ip: '192.168.1.100' };

    // Attempt 1
    const res1 = limiter.recordFailure(req);
    expect(res1.blocked).toBe(false);
    expect(res1.remaining).toBe(2);

    // Attempt 2
    const res2 = limiter.recordFailure(req);
    expect(res2.blocked).toBe(false);
    expect(res2.remaining).toBe(1);

    // Attempt 3 -> reaches threshold
    const res3 = limiter.recordFailure(req);
    expect(res3.blocked).toBe(true);
    expect(res3.remaining).toBe(0);
    expect(res3.retryAfter).toBeGreaterThan(0);
    expect(res3.message).toContain('Too many failed login attempts');

    // Subsequent check
    const check = limiter.isBlocked(req);
    expect(check.blocked).toBe(true);
    expect(check.remaining).toBe(0);
  });

  it('isolates counters between different client IPs', () => {
    const reqA = { ip: '10.0.0.1' };
    const reqB = { ip: '10.0.0.2' };

    limiter.recordFailure(reqA);
    limiter.recordFailure(reqA);
    limiter.recordFailure(reqA);

    expect(limiter.isBlocked(reqA).blocked).toBe(true);
    expect(limiter.isBlocked(reqB).blocked).toBe(false);
    expect(limiter.isBlocked(reqB).remaining).toBe(3);
  });

  it('extracts IP from X-Forwarded-For or socket address', () => {
    const reqForwarded = { headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' } };
    expect(limiter.getClientIp(reqForwarded)).toBe('203.0.113.195');

    const reqSocket = { socket: { remoteAddress: '198.51.100.4' } };
    expect(limiter.getClientIp(reqSocket)).toBe('198.51.100.4');
  });

  it('clears failed attempts upon recordSuccess', () => {
    const req = { ip: '127.0.0.1' };
    limiter.recordFailure(req);
    limiter.recordFailure(req);
    expect(limiter.isBlocked(req).remaining).toBe(1);

    limiter.recordSuccess(req);
    expect(limiter.isBlocked(req).remaining).toBe(3);
  });

  it('supports explicit reset(ip) and reset()', () => {
    const req1 = { ip: '1.1.1.1' };
    const req2 = { ip: '2.2.2.2' };

    limiter.recordFailure(req1);
    limiter.recordFailure(req2);

    limiter.reset('1.1.1.1');
    expect(limiter.isBlocked(req1).remaining).toBe(3);
    expect(limiter.isBlocked(req2).remaining).toBe(2);

    limiter.reset();
    expect(limiter.isBlocked(req2).remaining).toBe(3);
  });

  it('can be completely disabled via false or enabled: false', () => {
    const disabledLimiter = new LoginRateLimiter(false);
    const req = { ip: '127.0.0.1' };

    for (let i = 0; i < 10; i++) {
      const res = disabledLimiter.recordFailure(req);
      expect(res.blocked).toBe(false);
    }
    expect(disabledLimiter.isBlocked(req).blocked).toBe(false);
  });
});

describe('createApiHandlers with LoginRateLimiter', () => {
  let mockRepo;
  let firstMock;
  let comparePassword;
  let handlers;

  beforeEach(() => {
    firstMock = vi.fn();
    mockRepo = {
      query: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        first: firstMock,
      })),
    };

    comparePassword = vi.fn();

    const db = {
      getRepository: () => mockRepo,
      getModel: () => null,
    };

    handlers = createApiHandlers({
      db,
      AdminUser: { name: 'AdminUser' },
      comparePassword,
      loginRateLimit: {
        enabled: true,
        maxAttempts: 2,
        windowMs: 60 * 1000,
        blockDurationMs: 60 * 1000,
      },
    });
  });


  it('returns 401 on bad credentials and blocks with 429 on reaching max attempts', async () => {
    // Admin user exists in DB
    firstMock.mockResolvedValue({
      id: 1,
      email: 'admin@example.com',
      password: 'hash',
      active: true,
    });
    // Password mismatch
    comparePassword.mockResolvedValue(false);

    const req = {
      ip: '5.5.5.5',
      body: { email: 'admin@example.com', password: 'wrong' },
      session: {},
    };

    // First failed attempt
    const res1 = createMockRes();
    await handlers.loginHandler(req, res1);
    expect(res1.statusCode).toBe(401);
    expect(res1.jsonData.error).toBe('Invalid credentials');

    // Second failed attempt -> triggers block
    const res2 = createMockRes();
    await handlers.loginHandler(req, res2);
    expect(res2.statusCode).toBe(401);

    // Third attempt is rejected by rate limiter (429)
    const res3 = createMockRes();
    await handlers.loginHandler(req, res3);
    expect(res3.statusCode).toBe(429);
    expect(res3.headers['Retry-After']).toBeDefined();
    expect(res3.jsonData.error).toContain('Too many failed login attempts');
    expect(res3.jsonData.retryAfter).toBeGreaterThan(0);
  });

  it('clears rate limiter on successful login', async () => {
    firstMock.mockResolvedValue({
      id: 1,
      email: 'admin@example.com',
      password: 'hash',
      active: true,
    });
    comparePassword.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const req = {
      ip: '6.6.6.6',
      body: { email: 'admin@example.com', password: 'pass' },
      session: {},
    };

    // 1st failed attempt
    const res1 = createMockRes();
    await handlers.loginHandler(req, res1);
    expect(res1.statusCode).toBe(401);

    // 2nd attempt succeeds
    const res2 = createMockRes();
    await handlers.loginHandler(req, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.jsonData.success).toBe(true);

    // Counter was reset, so next failed attempt is not immediately blocked
    comparePassword.mockResolvedValueOnce(false);
    const res3 = createMockRes();
    await handlers.loginHandler(req, res3);
    expect(res3.statusCode).toBe(401);
  });

  it('exposes resetLoginAttempts on handler object', async () => {
    handlers.rateLimiter.recordFailure({ ip: '7.7.7.7' });
    handlers.rateLimiter.recordFailure({ ip: '7.7.7.7' });
    expect(handlers.rateLimiter.isBlocked({ ip: '7.7.7.7' }).blocked).toBe(true);

    handlers.resetLoginAttempts('7.7.7.7');
    expect(handlers.rateLimiter.isBlocked({ ip: '7.7.7.7' }).blocked).toBe(false);
  });
});
