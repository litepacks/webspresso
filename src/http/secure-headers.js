/**
 * Map Webspresso helmet-style config to Hono secure-headers options
 * @module src/http/secure-headers
 */

/**
 * @param {boolean} isDev
 * @returns {object}
 */
function getDefaultHelmetConfig(isDev) {
  return {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: true,
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  };
}

/**
 * @param {object} helmetConfig
 * @returns {import('hono/utils/types').ContentSecurityPolicy | undefined}
 */
function buildCspString(helmetConfig) {
  const csp = helmetConfig.contentSecurityPolicy;
  if (!csp || csp === false) return undefined;
  const directives = csp.directives || csp;
  const parts = [];
  for (const [key, values] of Object.entries(directives)) {
    const name = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const list = Array.isArray(values) ? values : [values];
    if (list.length === 0 && key === 'upgradeInsecureRequests') {
      parts.push('upgrade-insecure-requests');
    } else if (list.length) {
      parts.push(`${name} ${list.join(' ')}`);
    }
  }
  return parts.join('; ');
}

/**
 * @param {object} helmetConfig
 * @returns {Record<string, string>}
 */
function helmetToSecureHeaders(helmetConfig) {
  const headers = {};

  if (helmetConfig.hidePoweredBy !== false) {
    headers['x-powered-by'] = '';
  }
  if (helmetConfig.noSniff) {
    headers['x-content-type-options'] = 'nosniff';
  }
  if (helmetConfig.frameguard) {
    const action = helmetConfig.frameguard.action || 'deny';
    headers['x-frame-options'] = action.toUpperCase();
  }
  if (helmetConfig.referrerPolicy) {
    const policy =
      typeof helmetConfig.referrerPolicy === 'string'
        ? helmetConfig.referrerPolicy
        : helmetConfig.referrerPolicy.policy;
    headers['referrer-policy'] = policy;
  }
  if (helmetConfig.hsts && helmetConfig.hsts.maxAge) {
    let hsts = `max-age=${helmetConfig.hsts.maxAge}`;
    if (helmetConfig.hsts.includeSubDomains) hsts += '; includeSubDomains';
    if (helmetConfig.hsts.preload) hsts += '; preload';
    headers['strict-transport-security'] = hsts;
  }
  if (helmetConfig.crossOriginOpenerPolicy) {
    headers['cross-origin-opener-policy'] =
      helmetConfig.crossOriginOpenerPolicy.policy || 'same-origin';
  }
  if (helmetConfig.crossOriginResourcePolicy) {
    headers['cross-origin-resource-policy'] =
      helmetConfig.crossOriginResourcePolicy.policy || 'cross-origin';
  }
  if (helmetConfig.ieNoOpen) {
    headers['x-download-options'] = 'noopen';
  }
  if (helmetConfig.xssFilter) {
    headers['x-xss-protection'] = '0';
  }
  if (helmetConfig.dnsPrefetchControl === true) {
    headers['x-dns-prefetch-control'] = 'off';
  }

  const csp = buildCspString(helmetConfig);
  if (csp) {
    headers['content-security-policy'] = csp;
  }

  return headers;
}

module.exports = {
  getDefaultHelmetConfig,
  helmetToSecureHeaders,
  buildCspString,
};
