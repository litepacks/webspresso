import { describe, it, expect, afterEach } from 'vitest';

const {
  createFeatureFlagManager,
  evaluateFlag,
  getBucket,
  fnv1a,
} = require('../../../core/flags');

describe('Feature Flags Stress Lab', () => {
  const envKeys = [];

  afterEach(() => {
    while (envKeys.length > 0) {
      delete process.env[envKeys.pop()];
    }
  });

  it('1. produces uniform FNV-1a canary bucketing across 10,000 distinct users (25% rollout)', () => {
    const counts = { enabled: 0, disabled: 0 };

    for (let i = 0; i < 10000; i++) {
      const userId = `user-${i}`;
      const b1 = getBucket('new-checkout', userId);
      const b2 = getBucket('new-checkout', userId);
      expect(b1).toBe(b2);
      expect(b1).toBeGreaterThanOrEqual(0);
      expect(b1).toBeLessThan(100);

      const res = evaluateFlag('new-checkout', { rollout: 25 }, { user: { id: userId } });
      if (res.enabled) counts.enabled += 1;
      else counts.disabled += 1;
    }

    // 25% of 10,000 should land cleanly within [2200, 2800]
    expect(counts.enabled).toBeGreaterThan(2200);
    expect(counts.enabled).toBeLessThan(2800);
    expect(counts.enabled + counts.disabled).toBe(10000);
    expect(fnv1a('webspresso-seed')).toBeGreaterThan(0);
  });

  it('2. distributes weighted A/B/C multivariate flags deterministically across 6,000 users', () => {
    const manager = createFeatureFlagManager({
      flags: {
        'pricing-exp': {
          variants: [
            { name: 'control', weight: 50 },
            { name: 'tier-a', weight: 30 },
            { name: 'tier-b', weight: 20 },
          ],
        },
      },
    });

    const tallies = { control: 0, 'tier-a': 0, 'tier-b': 0 };
    for (let i = 0; i < 6000; i++) {
      const variant = manager.getVariant('pricing-exp', { distinctId: `usr-${i}` });
      tallies[variant] += 1;
    }

    // Expected: ~3000 control, ~1800 tier-a, ~1200 tier-b
    expect(tallies.control).toBeGreaterThan(2750);
    expect(tallies.control).toBeLessThan(3250);
    expect(tallies['tier-a']).toBeGreaterThan(1600);
    expect(tallies['tier-a']).toBeLessThan(2000);
    expect(tallies['tier-b']).toBeGreaterThan(1050);
    expect(tallies['tier-b']).toBeLessThan(1350);
  });

  it('3. evaluates targeting rules (users, roles, emailDomains, custom conditions, master disable, env overrides) across 200 flags', () => {
    const flags = {};
    for (let i = 0; i < 200; i++) {
      flags[`flag-${i}`] = {
        users: [`vip-${i}`],
        roles: ['admin'],
        emailDomains: ['webspresso.dev'],
        condition: (ctx) => ctx.plan === 'enterprise',
        rollout: 0,
      };
    }
    flags['master-off'] = { enabled: false, users: ['vip-0'], roles: ['admin'] };
    flags['env-flag'] = false;

    process.env.FEATURE_ENV_FLAG = 'true';
    envKeys.push('FEATURE_ENV_FLAG');

    const manager = createFeatureFlagManager({ flags });

    expect(manager.isEnabled('flag-42', { user: { id: 'vip-42' } })).toBe(true);
    expect(manager.isEnabled('flag-42', { user: { id: 'other', roles: ['admin'] } })).toBe(true);
    expect(manager.isEnabled('flag-42', { user: { id: 'other', email: 'dev@webspresso.dev' } })).toBe(true);
    expect(manager.isEnabled('flag-42', { user: { id: 'other' }, plan: 'enterprise' })).toBe(true);
    expect(manager.isEnabled('flag-42', { user: { id: 'other' }, plan: 'free' })).toBe(false);

    expect(manager.evaluate('master-off', { user: { id: 'vip-0', roles: ['admin'] } })).toMatchObject({
      enabled: false,
      reason: 'master_disabled',
    });

    expect(manager.evaluate('env-flag', {})).toMatchObject({
      enabled: true,
      reason: 'env_override',
    });

    const bulk = manager.getAllFlags({ user: { id: 'vip-0' } });
    expect(Object.keys(bulk).length).toBe(202);
    expect(bulk['flag-0']).toBe(true);
    expect(bulk['flag-1']).toBe(false);
    expect(bulk['master-off']).toBe(false);
    expect(bulk['env-flag']).toBe(true);
  });
});

