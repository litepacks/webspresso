/**
 * Google reCAPTCHA siteverify API
 * @module plugins/recaptcha/verify
 */

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * @typedef {Object} VerifyOptions
 * @property {string} secret - Secret key (server-side only)
 * @property {string} [token] - User response token from widget or grecaptcha.execute
 * @property {string} [remoteIp] - Optional end user IP
 * @property {'v2'|'v3'} [version='v2'] - reCAPTCHA version used on the client
 * @property {number} [minScore=0.5] - v3 only: minimum acceptable score (0–1)
 * @property {string} [expectedAction] - v3 only: if set, response action must match
 */

/**
 * Call Google siteverify and validate the response.
 * @param {VerifyOptions} options
 * @returns {Promise<{ success: boolean, score?: number, action?: string, hostname?: string, challenge_ts?: string, errorCodes?: string[], raw: object }>}
 */
async function verifyRecaptcha(options) {
  const {
    secret,
    token,
    remoteIp,
    version = 'v2',
    minScore = 0.5,
    expectedAction,
  } = options;

  if (!secret || typeof secret !== 'string') {
    throw new Error('recaptcha: secret is required');
  }

  if (!token || typeof token !== 'string') {
    return {
      success: false,
      errorCodes: ['missing-input-response'],
      raw: {},
    };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const res = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    return {
      success: false,
      errorCodes: [`http-${res.status}`],
      raw: {},
    };
  }

  /** @type {Record<string, unknown>} */
  const raw = await res.json();
  const googleSuccess = raw.success === true;

  if (!googleSuccess) {
    return {
      success: false,
      errorCodes: Array.isArray(raw['error-codes']) ? raw['error-codes'] : [],
      raw,
    };
  }

  if (version === 'v3') {
    const score = typeof raw.score === 'number' ? raw.score : undefined;
    const action = typeof raw.action === 'string' ? raw.action : undefined;

    if (score === undefined || score < minScore) {
      return {
        success: false,
        score,
        action,
        hostname: typeof raw.hostname === 'string' ? raw.hostname : undefined,
        challenge_ts: typeof raw.challenge_ts === 'string' ? raw.challenge_ts : undefined,
        errorCodes: score === undefined ? ['invalid-score'] : ['score-too-low'],
        raw,
      };
    }

    if (expectedAction != null && expectedAction !== '' && action !== expectedAction) {
      return {
        success: false,
        score,
        action,
        hostname: typeof raw.hostname === 'string' ? raw.hostname : undefined,
        challenge_ts: typeof raw.challenge_ts === 'string' ? raw.challenge_ts : undefined,
        errorCodes: ['action-mismatch'],
        raw,
      };
    }

    return {
      success: true,
      score,
      action,
      hostname: typeof raw.hostname === 'string' ? raw.hostname : undefined,
      challenge_ts: typeof raw.challenge_ts === 'string' ? raw.challenge_ts : undefined,
      raw,
    };
  }

  return {
    success: true,
    hostname: typeof raw.hostname === 'string' ? raw.hostname : undefined,
    challenge_ts: typeof raw.challenge_ts === 'string' ? raw.challenge_ts : undefined,
    raw,
  };
}

/**
 * Resolve client IP from Express request (best effort).
 * @param {import('express').Request} [req]
 * @returns {string|undefined}
 */
function getRemoteIp(req) {
  if (!req) return undefined;
  const xf = req.headers && req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  if (req.ip) {
    return req.ip;
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return undefined;
}

module.exports = {
  verifyRecaptcha,
  getRemoteIp,
  SITEVERIFY_URL,
};
