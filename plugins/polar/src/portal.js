'use strict';

const { polarApiRequest } = require('./api');
const { isValidPortalRedirectUrl } = require('./urls');

function getDefaultPortalUrl(config) {
  if (!config.orgSlug) return null;
  const host = config.sandbox ? 'https://sandbox.polar.sh' : 'https://polar.sh';
  return `${host}/${config.orgSlug}/portal`;
}

async function getPolarPortalUrl(user, baseUrl, config) {
  const defaultPortal = getDefaultPortalUrl(config);
  const f = config.fields;

  if (config.accessToken && user[f.polarCustomerId]) {
    try {
      const payload = { customer_id: user[f.polarCustomerId] };
      if (baseUrl) {
        const returnPath = config.urls.return.startsWith('http')
          ? config.urls.return
          : `${baseUrl}${config.urls.return}`;
        payload.return_url = returnPath;
      }

      const data = await polarApiRequest('/customer-sessions/', {
        method: 'POST',
        body: payload,
        accessToken: config.accessToken,
        sandbox: config.sandbox,
      });

      if (data.customer_portal_url && isValidPortalRedirectUrl(data.customer_portal_url)) {
        return data.customer_portal_url;
      }
    } catch (err) {
      console.error('[polar] Portal API error:', err.message);
    }
  }

  if (defaultPortal && isValidPortalRedirectUrl(defaultPortal)) {
    return defaultPortal;
  }

  throw new Error('Polar customer portal is not configured. Set POLAR_ORG_SLUG to your Polar organization slug.');
}

module.exports = {
  getDefaultPortalUrl,
  getPolarPortalUrl,
};
