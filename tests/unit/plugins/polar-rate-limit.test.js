'use strict';

import { describe, it, expect, vi } from 'vitest';

const { resolvePolarRateLimiters, DEFAULT_RATE_LIMITS } = require('../../../plugins/polar/src/rate-limit');
const { resolvePolarConfig } = require('../../../plugins/polar/src/config');

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

    expect(created.find((o) => o.limit === DEFAULT_RATE_LIMITS.webhook.limit)).toBeTruthy();
    expect(created.find((o) => o.limit === 2)).toBeTruthy();
  });
});
