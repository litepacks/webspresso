'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const {
  FeatureFlagManager,
  createFeatureFlagManager,
  MemoryFlagStore,
  evaluateFlag,
  getBucket,
  fnv1a,
} = require('../../core/flags');
const { createHelpers } = require('../../src/helpers');
const core = require('../../core');
const webspresso = require('../../index');

describe('core/flags: hasher', () => {
  it('computes deterministic FNV-1a hash and bucket', () => {
    const bucket1 = getBucket('beta_feature', 'user_123');
    const bucket2 = getBucket('beta_feature', 'user_123');
    expect(bucket1).toBe(bucket2);
    expect(bucket1).toBeGreaterThanOrEqual(0);
    expect(bucket1).toBeLessThan(100);

    // Different user should get a deterministic bucket too
    const bucketOther = getBucket('beta_feature', 'user_999');
    expect(bucketOther).toBeGreaterThanOrEqual(0);
    expect(bucketOther).toBeLessThan(100);
  });

  it('handles empty or missing identifiers safely', () => {
    const bucket = getBucket('', null);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
  });
});

describe('core/flags: MemoryFlagStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryFlagStore();
  });

  it('sets, gets, checks, and deletes flags', () => {
    store.set('dark_mode', true);
    expect(store.has('dark_mode')).toBe(true);
    expect(store.get('dark_mode')).toBe(true);

    const deleted = store.delete('dark_mode');
    expect(deleted).toBe(true);
    expect(store.has('dark_mode')).toBe(false);
  });

  it('loads definitions from a plain object', () => {
    store.load({
      feature_a: true,
      feature_b: { enabled: false },
    });

    expect(store.get('feature_a')).toBe(true);
    expect(store.get('feature_b')).toEqual({ enabled: false });
    expect(store.getAll()).toEqual({
      feature_a: true,
      feature_b: { enabled: false },
    });
  });

  it('emits change and clear events', () => {
    const changeSpy = vi.fn();
    const clearSpy = vi.fn();

    store.on('change', changeSpy);
    store.on('clear', clearSpy);

    store.set('k1', true);
    expect(changeSpy).toHaveBeenCalledWith('k1', true);

    store.clear();
    expect(clearSpy).toHaveBeenCalled();
    expect(store.getAll()).toEqual({});
  });
});

describe('core/flags: evaluateFlag', () => {
  it('evaluates primitive boolean flags', () => {
    expect(evaluateFlag('t1', true).enabled).toBe(true);
    expect(evaluateFlag('t2', false).enabled).toBe(false);
    expect(evaluateFlag('t3', null).enabled).toBe(false);
  });

  it('evaluates master disabled toggle', () => {
    const flag = {
      enabled: false,
      users: ['u1'],
      rollout: 100,
    };
    const res = evaluateFlag('test', flag, { user: { id: 'u1' } });
    expect(res.enabled).toBe(false);
    expect(res.reason).toBe('master_disabled');
  });

  it('targets whitelisted users by id or email', () => {
    const flag = {
      users: ['user_vip', 'alice@company.com'],
    };

    const res1 = evaluateFlag('vip_deal', flag, { user: { id: 'user_vip' } });
    expect(res1.enabled).toBe(true);
    expect(res1.reason).toBe('targeted_user');

    const res2 = evaluateFlag('vip_deal', flag, { email: 'alice@company.com' });
    expect(res2.enabled).toBe(true);

    const res3 = evaluateFlag('vip_deal', flag, { user: { id: 'user_regular' } });
    expect(res3.enabled).toBe(false);
  });

  it('targets specific roles', () => {
    const flag = {
      roles: ['admin', 'beta_tester'],
    };

    const resAdmin = evaluateFlag('admin_dash', flag, { user: { role: 'admin' } });
    expect(resAdmin.enabled).toBe(true);
    expect(resAdmin.reason).toBe('targeted_role');

    const resUser = evaluateFlag('admin_dash', flag, { user: { role: 'guest' } });
    expect(resUser.enabled).toBe(false);
  });

  it('targets email domains', () => {
    const flag = {
      emailDomains: ['company.org'],
    };

    const resInternal = evaluateFlag('internal_tool', flag, { email: 'dev@company.org' });
    expect(resInternal.enabled).toBe(true);
    expect(resInternal.reason).toBe('targeted_email_domain');

    const resExternal = evaluateFlag('internal_tool', flag, { email: 'user@gmail.com' });
    expect(resExternal.enabled).toBe(false);
  });

  it('evaluates custom condition predicates', () => {
    const flag = {
      condition: (ctx) => ctx.plan === 'enterprise' && ctx.tier > 2,
    };

    expect(evaluateFlag('ent_only', flag, { plan: 'enterprise', tier: 3 }).enabled).toBe(true);
    expect(evaluateFlag('ent_only', flag, { plan: 'free', tier: 1 }).enabled).toBe(false);
  });

  it('evaluates percentage rollout / canary traffic splitting', () => {
    const flagZero = { rollout: 0 };
    expect(evaluateFlag('zero', flagZero, { distinctId: 'any' }).enabled).toBe(false);

    const flagFull = { rollout: 100 };
    expect(evaluateFlag('full', flagFull, { distinctId: 'any' }).enabled).toBe(true);

    const flagPartial = { rollout: 50 };
    const resA = evaluateFlag('partial', flagPartial, { distinctId: 'user_a' });
    const resB = evaluateFlag('partial', flagPartial, { distinctId: 'user_a' });
    // Deterministic for same distinctId
    expect(resA.enabled).toBe(resB.enabled);
  });

  it('evaluates multivariate variants based on weights', () => {
    const flag = {
      variants: [
        { name: 'blue_button', weight: 50 },
        { name: 'green_button', weight: 50 },
      ],
    };

    const res = evaluateFlag('ab_test', flag, { distinctId: 'user_test' });
    expect(res.enabled).toBe(true);
    expect(['blue_button', 'green_button']).toContain(res.variant);
    expect(res.reason).toBe('variant_match');
  });

  it('respects environment variable overrides', () => {
    process.env.FEATURE_TEST_OVERRIDE = 'true';
    const flag = { enabled: false };

    const res = evaluateFlag('test_override', flag, {}, { envPrefix: 'FEATURE_' });
    expect(res.enabled).toBe(true);
    expect(res.reason).toBe('env_override');

    delete process.env.FEATURE_TEST_OVERRIDE;
  });
});

describe('core/flags: FeatureFlagManager', () => {
  let manager;

  beforeEach(() => {
    manager = createFeatureFlagManager({
      flags: {
        new_navbar: true,
        canary_feature: { rollout: 100, variant: 'v2' },
        secret_api: { users: ['vip_1'] },
      },
    });
  });

  it('checks if a feature is enabled and retrieves variants', () => {
    expect(manager.isEnabled('new_navbar')).toBe(true);
    expect(manager.isEnabled('canary_feature')).toBe(true);
    expect(manager.getVariant('canary_feature')).toBe('v2');
    expect(manager.isEnabled('non_existent')).toBe(false);
  });

  it('provides scoped forContext evaluation', () => {
    const scoped = manager.forContext({ distinctId: 'vip_1' });
    expect(scoped.isEnabled('secret_api')).toBe(true);
    expect(scoped.all()).toHaveProperty('secret_api', true);

    const scopedOther = manager.forContext({ distinctId: 'regular' });
    expect(scopedOther.isEnabled('secret_api')).toBe(false);
  });

  it('injects flags into Express request and res.locals via middleware', async () => {
    const mw = manager.middleware();
    const req = {
      user: { id: 'vip_1' },
      headers: {},
    };
    const res = { locals: {} };
    let nextCalled = false;

    await mw(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(typeof req.hasFeature).toBe('function');
    expect(req.hasFeature('secret_api')).toBe(true);
    expect(req.hasFeature('new_navbar')).toBe(true);
    expect(res.locals.hasFeature('new_navbar')).toBe(true);
  });

  it('injects flags into Hono context via middleware', async () => {
    const mw = manager.middleware();
    const storage = new Map();
    const c = {
      req: {
        header: () => null,
        path: '/api/v1',
      },
      header: () => {},
      text: () => {},
      set: (k, v) => storage.set(k, v),
      get: (k) => storage.get(k),
    };
    let nextCalled = false;

    await mw(c, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(typeof c.hasFeature).toBe('function');
    expect(c.hasFeature('new_navbar')).toBe(true);
  });

  it('guard middleware allows enabled requests and blocks disabled ones with 404', () => {
    const guardMw = manager.guard('new_navbar');
    let nextCalled = false;
    guardMw({}, {}, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    const blockedGuard = manager.guard('secret_api');
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => {
        statusSent = code;
        return {
          json: (data) => {
            jsonSent = data;
          },
        };
      },
    };

    let blockedNext = false;
    blockedGuard({ user: { id: 'stranger' } }, res, () => {
      blockedNext = true;
    });

    expect(blockedNext).toBe(false);
    expect(statusSent).toBe(404);
    expect(jsonSent).toHaveProperty('error', 'Not Found');
  });
});

describe('core/flags: Template helper integration', () => {
  it('fsy.hasFeature delegates to req.hasFeature or ctx.hasFeature', () => {
    const req = {
      hasFeature: vi.fn((key) => key === 'feature_active'),
      getVariant: vi.fn((key) => (key === 'feature_active' ? 'variant_b' : null)),
    };
    const fsy = createHelpers({ req });

    expect(fsy.hasFeature('feature_active')).toBe(true);
    expect(fsy.hasFeature('feature_inactive')).toBe(false);
    expect(fsy.flag('feature_active')).toBe('variant_b');
  });

  it('fsy.hasFeature returns false when no flags configured', () => {
    const fsy = createHelpers({});
    expect(fsy.hasFeature('anything')).toBe(false);
    expect(fsy.flag('anything')).toBe(false);
  });
});

describe('core/flags: Edge Cases & Defensive Handling', () => {
  it('gracefully handles condition functions that throw errors', () => {
    const flag = {
      condition: () => {
        throw new Error('Condition failure');
      },
    };
    const res = evaluateFlag('fragile_feature', flag, {});
    expect(res.enabled).toBe(false);
  });

  it('ensures master enabled: false takes absolute precedence over all other matchers', () => {
    const flag = {
      enabled: false,
      users: ['vip_user'],
      roles: ['admin'],
      emailDomains: ['acme.com'],
      rollout: 100,
      condition: () => true,
    };

    const res = evaluateFlag('disabled_override', flag, {
      user: { id: 'vip_user', role: 'admin' },
      email: 'boss@acme.com',
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toBe('master_disabled');
  });

  it('respects distinctId fallback resolution hierarchy', () => {
    const manager = createFeatureFlagManager({
      flags: { test_flag: { rollout: 50 } },
    });

    // 1. Explicit distinctId
    const res1 = manager.evaluate('test_flag', { distinctId: 'custom_id', user: { id: 'ignored_id' } });
    expect(res1.bucket).toBe(getBucket('test_flag', 'custom_id'));

    // 2. User ID fallback
    const res2 = manager.evaluate('test_flag', { user: { id: 'user_xyz' } });
    expect(res2.bucket).toBe(getBucket('test_flag', 'user_xyz'));

    // 3. User email fallback
    const res3 = manager.evaluate('test_flag', { user: { email: 'john@example.com' } });
    expect(res3.bucket).toBe(getBucket('test_flag', 'john@example.com'));

    // 4. Session ID fallback
    const res4 = manager.evaluate('test_flag', { session: { id: 'sess_123' } });
    expect(res4.bucket).toBe(getBucket('test_flag', 'sess_123'));

    // 5. IP fallback
    const res5 = manager.evaluate('test_flag', { ip: '192.168.1.1' });
    expect(res5.bucket).toBe(getBucket('test_flag', '192.168.1.1'));
  });

  it('supports custom statusCode and error message on route guard', () => {
    const manager = createFeatureFlagManager({
      flags: { secret: false },
    });

    const guard = manager.guard('secret', {
      statusCode: 403,
      message: 'Exclusive beta access required',
    });

    let statusSent = 0;
    let jsonSent = null;
    let nextCalled = false;

    const req = {};
    const res = {
      status(s) {
        statusSent = s;
        return this;
      },
      json(j) {
        jsonSent = j;
        return this;
      },
    };

    guard(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusSent).toBe(403);
    expect(jsonSent).toEqual({ error: 'Exclusive beta access required' });
  });

  it('supports Hono middleware and route guard parity', () => {
    const manager = createFeatureFlagManager({
      flags: { beta_hono: true, locked_hono: false },
    });

    // 1. Hono middleware
    const honoContextStore = new Map();
    const honoContext = {
      req: {
        header: (name) => (name === 'x-user-id' ? 'user_hono_1' : null),
      },
      set: (k, v) => honoContextStore.set(k, v),
      get: (k) => honoContextStore.get(k),
      json: (data, status = 200) => ({ data, status }),
    };

    let nextCalled = false;
    const middleware = manager.middleware();
    middleware(honoContext, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(honoContext.get('hasFeature')('beta_hono')).toBe(true);
    expect(honoContext.get('hasFeature')('locked_hono')).toBe(false);

    // 2. Hono route guard (Allowed)
    let guardAllowed = false;
    const guardAllowedHandler = manager.guard('beta_hono');
    guardAllowedHandler(honoContext, () => {
      guardAllowed = true;
    });
    expect(guardAllowed).toBe(true);

    // 3. Hono route guard (Blocked)
    let guardBlocked = false;
    const guardBlockedHandler = manager.guard('locked_hono');
    const blockedRes = guardBlockedHandler(honoContext, () => {
      guardBlocked = true;
    });
    expect(guardBlocked).toBe(false);
    expect(blockedRes.status).toBe(404);
  });

  it('handles dynamic runtime flag mutations immediately', () => {
    const manager = createFeatureFlagManager({
      flags: { dynamic_toggle: false },
    });

    expect(manager.isEnabled('dynamic_toggle')).toBe(false);

    // Enable dynamically
    manager.store.set('dynamic_toggle', true);
    expect(manager.isEnabled('dynamic_toggle')).toBe(true);

    // Delete dynamically
    manager.store.delete('dynamic_toggle');
    expect(manager.isEnabled('dynamic_toggle')).toBe(false);
  });

  it('executes 10,000 deterministic FNV-1a hash operations rapidly under stress', () => {
    const startTime = Date.now();
    for (let i = 0; i < 10000; i++) {
      const bucket = getBucket('feature_perf_test', 'user_' + i);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(100); // 10,000 evaluations well under 100ms
  });
});

describe('core/flags: Public Exports', () => {
  it('exports FeatureFlagManager and helpers from core and webspresso', () => {
    expect(typeof core.FeatureFlagManager).toBe('function');
    expect(typeof core.createFeatureFlagManager).toBe('function');
    expect(typeof core.MemoryFlagStore).toBe('function');
    expect(typeof core.evaluateFlag).toBe('function');
    expect(typeof core.getBucket).toBe('function');

    expect(typeof webspresso.FeatureFlagManager).toBe('function');
    expect(typeof webspresso.createFeatureFlagManager).toBe('function');
    expect(typeof webspresso.MemoryFlagStore).toBe('function');
    expect(typeof webspresso.evaluateFlag).toBe('function');
    expect(typeof webspresso.getBucket).toBe('function');
  });
});
