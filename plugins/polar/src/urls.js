'use strict';

function getPolarBuyBase(sandbox) {
  return sandbox ? 'https://sandbox-buy.polar.sh' : 'https://buy.polar.sh';
}

function getPolarWebBase(sandbox) {
  return sandbox ? 'https://sandbox.polar.sh' : 'https://polar.sh';
}

function isBlockedPolarUrl(urlString) {
  try {
    const url = new URL(urlString);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return (
      path === '/404'
      || path === '/purchases/subscriptions'
      || (url.hostname === 'polar.sh' && path === '/')
    );
  } catch {
    return true;
  }
}

function isValidCheckoutRedirectUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (isBlockedPolarUrl(urlString)) return false;

    if (
      url.hostname === 'buy.polar.sh'
      || url.hostname === 'sandbox-buy.polar.sh'
    ) {
      return true;
    }

    const webHosts = new Set(['polar.sh', 'sandbox.polar.sh', 'www.polar.sh']);
    if (webHosts.has(url.hostname)) {
      return (
        url.pathname.startsWith('/checkout/')
        || url.pathname.includes('/polar_c_')
        || url.pathname.includes('/polar_cl_')
      );
    }

    return false;
  } catch {
    return false;
  }
}

function isValidPortalRedirectUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (isBlockedPolarUrl(urlString)) return false;
    if (url.hostname === 'polar.sh' || url.hostname === 'sandbox.polar.sh') {
      return /^\/[^/]+\/portal(?:\/|$)/.test(url.pathname);
    }
    return url.hostname.endsWith('.polar.sh') && url.pathname.includes('/portal');
  } catch {
    return false;
  }
}

function extractCheckoutUrlFromResponse(data, sandbox = false) {
  if (!data || typeof data !== 'object') return null;

  const webBase = getPolarWebBase(sandbox);
  const candidates = [
    data.url,
    data.checkout_url,
    data.checkout?.url,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate.startsWith('/')
      ? `${webBase}${candidate}`
      : candidate;
    if (isValidCheckoutRedirectUrl(normalized)) {
      return normalized;
    }
  }

  if (data.client_secret) {
    const built = `${webBase}/checkout/${data.client_secret}`;
    if (isValidCheckoutRedirectUrl(built)) {
      return built;
    }
  }

  return null;
}

function polarCspDirectives(opts = {}) {
  const domains = opts.domains || [
    'https://buy.polar.sh',
    'https://sandbox-buy.polar.sh',
    'https://polar.sh',
    'https://sandbox.polar.sh',
    'https://api.polar.sh',
    'https://sandbox-api.polar.sh',
  ];
  return {
    formAction: domains,
    connectSrc: domains,
  };
}

module.exports = {
  getPolarBuyBase,
  getPolarWebBase,
  isBlockedPolarUrl,
  isValidCheckoutRedirectUrl,
  isValidPortalRedirectUrl,
  extractCheckoutUrlFromResponse,
  polarCspDirectives,
};
