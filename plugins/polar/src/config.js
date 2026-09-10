'use strict';

const { parsePolarEnv } = require('./env.schema');

const DEFAULT_FIELDS = {
  id: 'id',
  email: 'email',
  publicId: 'public_id',
  tier: 'tier',
  polarCustomerId: 'polar_customer_id',
  polarSubscriptionId: 'polar_subscription_id',
  polarStatus: 'polar_status',
  polarCurrentPeriodEnd: 'polar_current_period_end',
  polarCancelAtPeriodEnd: 'polar_cancel_at_period_end',
};

const DEFAULT_ROUTES = {
  webhook: '/api/v1/polar/webhook',
  checkout: '/settings/billing/checkout',
  portal: '/settings/billing/portal',
  status: '/api/v1/billing/status',
};

const DEFAULT_URLS = {
  success: '/settings?tab=billing&upgraded=1',
  return: '/settings?tab=billing',
  alreadySubscribed: '/settings?tab=billing&success=already_pro',
  login: '/login?error=required',
};

/**
 * @param {Object} options - polarPlugin options
 * @returns {import('./types').PolarConfig}
 */
function resolvePolarConfig(options = {}) {
  const env = parsePolarEnv({ ...process.env, ...options.env });

  const fields = { ...DEFAULT_FIELDS, ...(options.fields || {}) };
  const tierMapping = options.tierMapping || { pro: ['pro_monthly'], free: [] };
  const plans = {
    ...(options.plans || {}),
  };

  if (!plans.pro_monthly && env.POLAR_PRO_PRODUCT_ID) {
    plans.pro_monthly = env.POLAR_PRO_PRODUCT_ID;
  }
  if (!plans.pro_yearly && env.POLAR_PRO_YEARLY_PRODUCT_ID) {
    plans.pro_yearly = env.POLAR_PRO_YEARLY_PRODUCT_ID;
  }

  const proTiers = Object.keys(tierMapping).filter(
    (t) => t !== 'free' && Array.isArray(tierMapping[t]) && tierMapping[t].length > 0
  );

  return {
    db: options.db || null,
    userModel: options.userModel || 'User',
    userTable: options.userTable || 'users',
    fields,
    plans,
    tierMapping,
    proTiers,
    proTierName: options.proTierName || proTiers[0] || 'pro',
    freeTierName: options.freeTierName || 'free',
    routes: { ...DEFAULT_ROUTES, ...(options.routes || {}) },
    urls: { ...DEFAULT_URLS, ...(options.urls || {}) },
    hooks: options.hooks || {},
    requireAuth: options.requireAuth || null,
    syncMiddleware: options.syncMiddleware || null,
    /** Sync from Polar API before checkout redirect (default true). Set false to skip. */
    syncBeforeCheckout: options.syncBeforeCheckout !== false,
    rateLimit: options.rateLimit !== undefined ? options.rateLimit : true,
    env,
    accessToken: options.accessToken || env.POLAR_ACCESS_TOKEN || null,
    webhookSecret: options.webhookSecret || env.POLAR_WEBHOOK_SECRET || null,
    orgSlug: options.orgSlug || env.POLAR_ORG_SLUG || null,
    checkoutUrl: options.checkoutUrl || env.POLAR_CHECKOUT_URL || null,
    priceId: options.priceId || env.POLAR_PRO_PRICE_ID || null,
    sandbox: options.sandbox !== undefined ? options.sandbox : env.POLAR_SANDBOX === true,
    baseUrl: options.baseUrl || env.BASE_URL || null,
    enabled: options.enabled !== false,
  };
}

module.exports = {
  DEFAULT_FIELDS,
  DEFAULT_ROUTES,
  DEFAULT_URLS,
  resolvePolarConfig,
};
