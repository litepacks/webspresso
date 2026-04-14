/**
 * Optional Express middleware: verify reCAPTCHA token from JSON/urlencoded body
 * @module plugins/recaptcha/middleware
 */

const { verifyRecaptcha, getRemoteIp } = require('./verify');

/**
 * @param {Object} options
 * @param {string} options.secret - Secret key
 * @param {string} [options.bodyField='g-recaptcha-response'] - Form / JSON field name
 * @param {'v2'|'v3'} [options.version='v2']
 * @param {number} [options.minScore=0.5] - v3
 * @param {string} [options.expectedAction] - v3
 */
function createRecaptchaMiddleware(options) {
  const {
    secret,
    bodyField = 'g-recaptcha-response',
    version = 'v2',
    minScore = 0.5,
    expectedAction,
  } = options;

  if (!secret || typeof secret !== 'string') {
    throw new Error('createRecaptchaMiddleware requires options.secret');
  }

  return async function recaptchaMiddleware(req, res, next) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const token = body[bodyField];
      const remoteIp = getRemoteIp(req);

      const result = await verifyRecaptcha({
        secret,
        token,
        remoteIp,
        version,
        minScore,
        expectedAction,
      });

      if (!result.success) {
        return res.status(400).json({
          error: 'Recaptcha verification failed',
          codes: result.errorCodes || [],
        });
      }

      req.recaptcha = result;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  createRecaptchaMiddleware,
};
