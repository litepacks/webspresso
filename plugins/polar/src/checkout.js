'use strict';

const { polarApiRequest } = require('./api');
const { buildCheckoutMetadata } = require('./user-resolver');
const {
  extractCheckoutUrlFromResponse,
  isValidCheckoutRedirectUrl,
  getPolarBuyBase,
} = require('./urls');

function resolvePlanProductId(plan, config) {
  if (config.plans[plan]) return config.plans[plan];
  if (plan === 'pro_yearly') {
    return config.plans.pro_yearly || config.plans.pro_monthly;
  }
  return config.plans.pro_monthly;
}

function resolveHostedCheckoutBaseUrl(config) {
  if (config.checkoutUrl) return config.checkoutUrl;

  const productId = resolvePlanProductId('pro_monthly', config);
  if (productId && productId.startsWith('polar_cl_')) {
    return `${getPolarBuyBase(config.sandbox)}/${productId}`;
  }

  return null;
}

function buildHostedCheckoutUrl(hostedUrl, user, config) {
  const url = new URL(hostedUrl);
  const f = config.fields;
  if (user[f.email]) url.searchParams.set('email', user[f.email]);
  url.searchParams.set('metadata[user_id]', String(user[f.id]));
  if (user[f.publicId]) url.searchParams.set('metadata[public_id]', user[f.publicId]);
  return url.toString();
}

async function createCheckoutSessionViaApi({ user, productId, baseUrl, config }) {
  const metadata = buildCheckoutMetadata(user, config);
  const f = config.fields;
  const shared = {
    success_url: config.urls.success.startsWith('http')
      ? config.urls.success
      : `${baseUrl}${config.urls.success}`,
    return_url: config.urls.return.startsWith('http')
      ? config.urls.return
      : `${baseUrl}${config.urls.return}`,
    metadata,
    external_customer_id: String(user[f.publicId] || user[f.id]),
  };
  if (user[f.email]) shared.customer_email = user[f.email];

  const attempts = [{ products: [productId], ...shared }];

  if (config.priceId) {
    attempts.push({
      product_id: productId,
      product_price_id: config.priceId,
      customer_email: user[f.email] || undefined,
      success_url: shared.success_url,
      metadata,
    });
  }

  const apiOpts = { accessToken: config.accessToken, sandbox: config.sandbox };
  let lastError = null;

  for (const payload of attempts) {
    try {
      const data = await polarApiRequest('/checkouts/', { method: 'POST', body: payload, ...apiOpts });
      const checkoutUrl = extractCheckoutUrlFromResponse(data, config.sandbox);
      if (checkoutUrl) return checkoutUrl;
      const received = data.url || data.checkout_url || (data.client_secret ? 'client_secret only' : 'none');
      lastError = new Error(`Polar checkout response did not include a valid checkout URL (received: ${received})`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Unable to create Polar checkout session');
}

async function getPolarCheckoutUrl({ user, plan = 'pro_monthly', baseUrl, config }) {
  const productId = resolvePlanProductId(plan, config);

  if (config.accessToken && productId && !productId.startsWith('polar_cl_')) {
    try {
      return await createCheckoutSessionViaApi({ user, productId, baseUrl, config });
    } catch (err) {
      console.error('[polar] Checkout API error:', err.message);
    }
  }

  const hostedUrl = resolveHostedCheckoutBaseUrl(config);
  if (hostedUrl && isValidCheckoutRedirectUrl(hostedUrl)) {
    return buildHostedCheckoutUrl(hostedUrl, user, config);
  }

  throw new Error(
    'Polar checkout is not configured. Set POLAR_ACCESS_TOKEN + POLAR_PRO_PRODUCT_ID (product UUID), or POLAR_CHECKOUT_URL (https://buy.polar.sh/polar_cl_...).'
  );
}

module.exports = {
  resolvePlanProductId,
  resolveHostedCheckoutBaseUrl,
  buildHostedCheckoutUrl,
  createCheckoutSessionViaApi,
  getPolarCheckoutUrl,
};
