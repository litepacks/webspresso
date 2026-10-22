'use strict';

import { describe, it, expect, vi } from 'vitest';

const { invokeIsPaidUserHook, userIsPaid, syncBillingForAppUser } = require('../../../plugins/polar/src/billing-hooks');
const { resolvePolarConfig } = require('../../../plugins/polar/src/config');

describe('polar billing hooks', () => {
  const config = resolvePolarConfig({
    tierMapping: { pro: ['pro_monthly'], free: [] },
    proTierName: 'pro',
  });

  it('invokeIsPaidUserHook supports destructured ({ user, knex, config })', async () => {
    const hook = vi.fn(async ({ user }) => user.id === 'nano_abc');
    const result = await invokeIsPaidUserHook(hook, { id: 'nano_abc', tier: 'free' }, {}, config);
    expect(result).toBe(true);
    expect(hook.mock.calls[0][0].user.id).toBe('nano_abc');
  });

  it('invokeIsPaidUserHook supports legacy (user, knex, config) signature', async () => {
    const hook = vi.fn(async (user, knex, cfg) => user.tier === 'pro' && Boolean(knex) && Boolean(cfg));
    expect(await invokeIsPaidUserHook(hook, { tier: 'pro' }, {}, config)).toBe(true);
    expect(hook).toHaveBeenCalledWith({ tier: 'pro' }, {}, config);
  });

  it('userIsPaid falls back to userHasProTier without hook', async () => {
    expect(await userIsPaid({ tier: 'pro' }, null, config)).toBe(true);
    expect(await userIsPaid({ tier: 'free' }, null, config)).toBe(false);
  });

  it('syncBillingForAppUser merges per-call hooks without access token (no-op sync)', async () => {
    const user = { id: 1, tier: 'free' };
    const onChange = vi.fn();
    const out = await syncBillingForAppUser(user, null, {
      ...config,
      accessToken: null,
      hooks: { onSubscriptionChange: vi.fn() },
    }, {
      hooks: { onSubscriptionChange: onChange },
    });
    expect(out).toEqual(user);
    expect(onChange).not.toHaveBeenCalled();
  });
});
