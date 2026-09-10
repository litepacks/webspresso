'use strict';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const {
  isValidCheckoutRedirectUrl,
  isValidPortalRedirectUrl,
  extractCheckoutUrlFromResponse,
} = require('../../../plugins/polar/src/urls');
const {
  buildCheckoutMetadata,
  isProSubscriptionStatus,
  pickBestActiveSubscription,
} = require('../../../plugins/polar/src/user-resolver');
const { resolvePolarConfig } = require('../../../plugins/polar/src/config');

describe('Polar URL validation', () => {
  it('accepts buy.polar.sh checkout URLs', () => {
    expect(isValidCheckoutRedirectUrl('https://buy.polar.sh/polar_cl_abc123')).toBe(true);
    expect(isValidCheckoutRedirectUrl('https://sandbox-buy.polar.sh/checkout/abc')).toBe(true);
  });

  it('accepts polar.sh/checkout client-secret URLs', () => {
    expect(isValidCheckoutRedirectUrl('https://polar.sh/checkout/polar_cst_abc123')).toBe(true);
    expect(isValidCheckoutRedirectUrl('https://polar.sh/polar_c_abc123')).toBe(true);
  });

  it('builds checkout URL from client_secret when url is missing', () => {
    expect(extractCheckoutUrlFromResponse({ client_secret: 'polar_cst_testsecret' }))
      .toBe('https://polar.sh/checkout/polar_cst_testsecret');
    expect(extractCheckoutUrlFromResponse({ url: 'https://polar.sh/checkout/polar_cst_fromurl' }))
      .toBe('https://polar.sh/checkout/polar_cst_fromurl');
  });

  it('rejects polar.sh pages and deprecated portal URLs for checkout', () => {
    expect(isValidCheckoutRedirectUrl('https://polar.sh/404')).toBe(false);
    expect(isValidCheckoutRedirectUrl('https://polar.sh/purchases/subscriptions')).toBe(false);
    expect(isValidCheckoutRedirectUrl('https://polar.sh/my-org/portal')).toBe(false);
  });

  it('accepts org portal URLs on polar.sh', () => {
    expect(isValidPortalRedirectUrl('https://polar.sh/my-org/portal')).toBe(true);
    expect(isValidPortalRedirectUrl('https://polar.sh/my-org/portal/session')).toBe(true);
  });

  it('rejects deprecated and invalid portal URLs', () => {
    expect(isValidPortalRedirectUrl('https://polar.sh/purchases/subscriptions')).toBe(false);
    expect(isValidPortalRedirectUrl('https://polar.sh/404')).toBe(false);
    expect(isValidPortalRedirectUrl('https://buy.polar.sh/polar_cl_test')).toBe(false);
  });
});

describe('Polar metadata and subscription helpers', () => {
  const config = resolvePolarConfig({
    plans: { pro_monthly: 'prod-pro' },
    tierMapping: { pro: ['pro_monthly'], free: [] },
  });

  it('prefers the configured Pro product when multiple active subscriptions exist', () => {
    expect(pickBestActiveSubscription([
      { id: 'sub-other', status: 'active', product_id: 'prod-other' },
      { id: 'sub-pro', status: 'active', product_id: 'prod-pro' },
    ], config)?.id).toBe('sub-pro');
  });

  it('treats active and trialing Polar subscription statuses as Pro', () => {
    expect(isProSubscriptionStatus('active')).toBe(true);
    expect(isProSubscriptionStatus('trialing')).toBe(true);
    expect(isProSubscriptionStatus('incomplete')).toBe(false);
    expect(isProSubscriptionStatus('canceled')).toBe(false);
  });

  it('omits empty username/public_id from checkout metadata', () => {
    expect(buildCheckoutMetadata({ id: 42, public_id: 'pub_abc', username: '' }, config)).toEqual({
      user_id: '42',
      public_id: 'pub_abc',
    });
    expect(buildCheckoutMetadata({ id: 7, username: 'ahmet' }, config)).toEqual({
      user_id: '7',
      username: 'ahmet',
    });
  });
});
