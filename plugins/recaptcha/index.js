/**
 * Google reCAPTCHA plugin — server verification + Nunjucks helpers
 * @module plugins/recaptcha
 */

const { verifyRecaptcha, getRemoteIp } = require('./verify');
const {
  recaptchaScriptTag,
  recaptchaV2WidgetHtml,
  recaptchaV3ExecuteScript,
} = require('./helpers');
const { createRecaptchaMiddleware } = require('./middleware');

/**
 * Align `createRecaptchaMiddleware` with the same options object passed to `recaptchaPlugin`
 * (secret, version, minScore, expectedAction). Spread into middleware, then add `bodyField`.
 * @param {Object} options - Same shape as `recaptchaPlugin` options (`siteKey` ignored here)
 * @returns {{ secret?: string, version: 'v2'|'v3', minScore: number, expectedAction?: string }}
 */
function resolveRecaptchaMiddlewareParams(options = {}) {
  const secret = options.secretKey || process.env.RECAPTCHA_SECRET_KEY;
  const version = options.version === 'v3' ? 'v3' : 'v2';
  return {
    secret,
    version,
    minScore: options.minScore ?? 0.5,
    expectedAction: options.expectedAction,
  };
}

/**
 * @param {Object} options
 * @param {string} options.siteKey - Public site key (used in templates)
 * @param {string} [options.secretKey] - Secret key; falls back to `process.env.RECAPTCHA_SECRET_KEY`
 * @param {'v2'|'v3'} [options.version='v2'] - Default for verifyToken / helpers
 * @param {number} [options.minScore=0.5] - v3 minimum score
 * @param {string} [options.expectedAction] - v3: token must match this action (verify)
 * @param {string} [options.defaultV3Action='submit'] - v3: helper `recaptchaV3Token` default action
 */
function recaptchaPlugin(options = {}) {
  const {
    siteKey,
    secretKey,
    version: versionOpt = 'v2',
    minScore = 0.5,
    expectedAction,
    defaultV3Action = 'submit',
  } = options;

  if (!siteKey || typeof siteKey !== 'string') {
    throw new Error('recaptcha plugin requires options.siteKey');
  }

  const version = versionOpt === 'v3' ? 'v3' : 'v2';

  function resolveSecret() {
    const s = secretKey || process.env.RECAPTCHA_SECRET_KEY;
    if (!s) {
      throw new Error('recaptcha: pass options.secretKey or set RECAPTCHA_SECRET_KEY for verification');
    }
    return s;
  }

  async function verifyToken(token, req) {
    const secret = resolveSecret();
    return verifyRecaptcha({
      secret,
      token,
      remoteIp: getRemoteIp(req),
      version,
      minScore,
      expectedAction,
    });
  }

  async function verifyRequest(req, opts = {}) {
    const field = opts.bodyField || 'g-recaptcha-response';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const token = body[field];
    return verifyToken(token, req);
  }

  return {
    name: 'recaptcha',
    version: '1.0.0',
    description: 'Google reCAPTCHA v2/v3 verification and template helpers',

    csp: {
      scriptSrc: ['https://www.google.com', 'https://www.gstatic.com'],
      frameSrc: ['https://www.google.com'],
      connectSrc: ['https://www.google.com'],
    },

    api: {
      verifyToken,
      verifyRequest,
      getSiteKey: () => siteKey,
      getVersion: () => version,
      createMiddleware: (mwOpts = {}) =>
        createRecaptchaMiddleware({
          secret: resolveSecret(),
          bodyField: mwOpts.bodyField,
          version: mwOpts.version || version,
          minScore: mwOpts.minScore ?? minScore,
          expectedAction: mwOpts.expectedAction ?? expectedAction,
        }),
    },

    register(ctx) {
      ctx.addHelper('recaptchaScript', () =>
        version === 'v3' ? recaptchaScriptTag(siteKey) : recaptchaScriptTag()
      );

      ctx.addHelper('recaptchaWidget', () =>
        recaptchaV2WidgetHtml({ siteKey })
      );

      ctx.addHelper('recaptchaV3Token', () =>
        recaptchaV3ExecuteScript({
          siteKey,
          action: defaultV3Action,
        })
      );
    },
  };
}

module.exports = recaptchaPlugin;
module.exports.recaptchaPlugin = recaptchaPlugin;
module.exports.createRecaptchaMiddleware = createRecaptchaMiddleware;
module.exports.resolveRecaptchaMiddlewareParams = resolveRecaptchaMiddlewareParams;
