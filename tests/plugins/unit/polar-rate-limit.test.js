'use strict';

import { describe, it, expect, vi } from 'vitest';

const {
  resolvePolarRateLimiters,
  getDefaultRateLimits,
  polarIpKey,
  loadIpKeyGenerator,
} = require('../../../plugins/polar/src/rate-limit');
const { resolvePolarConfig } = require('../../../plugins/polar/src/config');
const { rateLimit } = require('express-rate-limit');

describe('polar rate limit integration', () => {
  it('returns empty limiters when rateLimit is disabled', () => {
    const config = resolvePolarConfig({ rateLimit: false });
    const out = resolvePolarRateLimiters({}, config);
    expect(out).toEqual({});
  });

  it('warns and skips when rateLimitPlugin factory is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = resolvePolarConfig({ rateLimit: true });
    const out = resolvePolarRateLimiters({ middlewares: {} }, config);
    expect(out).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rateLimitPlugin'));
    warn.mockRestore();
  });

  it('builds per-route limiters from rateLimit factory', () => {
    const created = [];
    const factory = (opts) => {
      created.push(opts);
      return (_req, _res, next) => next();
    };

    const config = resolvePolarConfig({
      rateLimit: {
        checkout: { limit: 2, windowMs: 30_000 },
        status: false,
      },
    });

    const out = resolvePolarRateLimiters({ middlewares: { rateLimit: factory } }, config);

    expect(typeof out.webhook).toBe('function');
    expect(typeof out.checkout).toBe('function');
    expect(typeof out.portal).toBe('function');
    expect(out.status).toBeUndefined();

    const defaults = getDefaultRateLimits();
    expect(defaults).toBeTruthy();
    expect(created.find((o) => o.limit === defaults.webhook.limit)).toBeTruthy();
    expect(created.find((o) => o.limit === 2)).toBeTruthy();
  });

  it('polar key generators use ipKeyGenerator (express-rate-limit v8 safe)', () => {
    const ipKeyGenerator = loadIpKeyGenerator();
    expect(ipKeyGenerator).toBeTypeOf('function');

    const keyGen = polarIpKey(ipKeyGenerator, 'polar:webhook');
    expect(keyGen({ ip: '203.0.113.1' })).toMatch(/^polar:webhook:/);

    expect(() => rateLimit({
      windowMs: 60_000,
      limit: 5,
      keyGenerator: keyGen,
    })).not.toThrow();
  });
});
