/**
 * Webspresso Magic Link & Passwordless Authentication Module
 * Cryptographically signed one-time tokens, session login, and verification helpers
 * @module core/auth/magic-link
 */

'use strict';

/**
 * Construct full magic link verification URL
 * 
 * @param {Object} options
 * @param {string} [options.baseUrl] - Base site URL (e.g. 'https://example.com')
 * @param {string} [options.path='/auth/magic-link/verify'] - Relative path
 * @param {string} options.token - Raw unhashed token
 * @returns {string}
 */
function buildMagicLinkUrl(options = {}) {
  let baseUrl = String(options.baseUrl || process.env.BASE_URL || 'http://localhost:3000');
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const path = options.path || '/auth/magic-link/verify';
  const token = options.token;

  if (!token) {
    throw new Error('Token is required to build magic link URL');
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const sep = cleanPath.includes('?') ? '&' : '?';
  return `${baseUrl}${cleanPath}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Default HTML template for magic link emails
 * 
 * @param {Object} data
 * @param {string} [data.name='there']
 * @param {string} data.magicLinkUrl
 * @param {number} [data.expiresMinutes=15]
 * @returns {string} Clean HTML email body
 */
function formatMagicLinkHtml(data) {
  const name = data.name || 'there';
  const url = data.magicLinkUrl;
  const minutes = data.expiresMinutes || 15;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to your account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e4e4e7;">
    <h2 style="margin-top: 0; font-size: 22px; font-weight: 700; color: #18181b;">Sign in to your account</h2>
    <p style="font-size: 15px; line-height: 1.6; color: #52525b;">Hello ${name},</p>
    <p style="font-size: 15px; line-height: 1.6; color: #52525b;">Click the button below to sign in to your account without a password. This link is valid for <strong>${minutes} minutes</strong>.</p>
    <div style="margin: 28px 0; text-align: center;">
      <a href="${url}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; font-weight: 600; font-size: 15px; border-radius: 12px;">Sign In →</a>
    </div>
    <p style="font-size: 13px; line-height: 1.5; color: #a1a1aa; border-top: 1px solid #f4f4f5; padding-top: 16px;">If you did not request this link, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
}

/**
 * Express / Webspresso route middleware for magic link verification and session login
 * 
 * @param {import('./manager').AuthManager} authManager 
 * @param {Object} [options]
 * @param {string} [options.tokenParam='token'] - Query / body parameter name
 * @param {string} [options.redirectTo='/'] - Redirect URL on successful HTML login
 * @param {string} [options.failureRedirect='/login?error=invalid_magic_link'] - Redirect URL on failure
 * @param {boolean} [options.markEmailVerified=true] - Auto-verify email on login
 * @param {boolean} [options.jwt=false] - Generate JWT tokens in response
 * @returns {Function} Express middleware
 */
function createMagicLinkVerifyMiddleware(authManager, options = {}) {
  const {
    tokenParam = 'token',
    redirectTo = '/',
    failureRedirect = '/login?error=invalid_magic_link',
    markEmailVerified = true,
    jwt = false,
  } = options;

  return async function magicLinkVerifyMiddleware(req, res, next) {
    const rawToken = req.query?.[tokenParam] || req.body?.[tokenParam];
    const isHtml = req.accepts && req.accepts('html') && req.method === 'GET';

    if (!rawToken) {
      if (isHtml) {
        return res.redirect(failureRedirect);
      }
      return res.status(400).json({ error: 'Missing magic link token' });
    }

    try {
      const { user } = await authManager.verifyMagicLink(rawToken, { markEmailVerified });

      if (req.auth && typeof req.auth.login === 'function') {
        await req.auth.login(user);
      }

      let jwtTokens = null;
      if (jwt) {
        jwtTokens = {
          accessToken: authManager.generateUserToken(user),
          refreshToken: authManager.generateRefreshToken(user),
        };
      }

      if (isHtml) {
        return res.redirect(redirectTo);
      }

      return res.status(200).json({
        ok: true,
        user,
        ...(jwtTokens || {}),
      });
    } catch (err) {
      if (isHtml) {
        return res.redirect(failureRedirect);
      }
      return res.status(400).json({
        error: err.message || 'Invalid or expired magic link',
        code: err.code || 'INVALID_MAGIC_LINK',
      });
    }
  };
}

/**
 * Express / Webspresso route handler for requesting a magic link
 * 
 * @param {import('./manager').AuthManager} authManager 
 * @param {Object} [options]
 * @returns {Function} Express route handler
 */
function createMagicLinkRequestHandler(authManager, options = {}) {
  return async function magicLinkRequestHandler(req, res) {
    const identifier = req.body?.email || req.body?.identifier || req.query?.email;
    if (!identifier) {
      return res.status(400).json({ error: 'Email or identifier is required' });
    }

    try {
      const result = await authManager.requestMagicLink(identifier, options);
      return res.status(200).json({
        ok: true,
        message: 'If the account exists, a magic link has been sent.',
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to send magic link' });
    }
  };
}

module.exports = {
  buildMagicLinkUrl,
  formatMagicLinkHtml,
  createMagicLinkVerifyMiddleware,
  createMagicLinkRequestHandler,
};
