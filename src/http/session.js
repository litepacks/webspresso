/**
 * Shared hono-sessions mount for site auth and admin panel
 * @module src/http/session
 */

const { sessionMiddleware, CookieStore } = require('hono-sessions');
const { bindSessionWrapper } = require('./context');

/**
 * @param {import('./compat-app').createCompatApp} app
 * @param {object} options
 * @param {string} options.secret
 * @param {string} [options.sessionCookieName]
 * @param {number} [options.maxAgeMs]
 */
function mountAppSession(app, options) {
  if (app._webspressoSessionInitialized) return;

  const secret = options.secret;
  if (!secret || secret.length < 32) {
    throw new Error('Session encryption key must be at least 32 characters');
  }

  app._hono.use(
    '*',
    sessionMiddleware({
      store: new CookieStore(),
      encryptionKey: secret,
      expireAfterSeconds: Math.floor((options.maxAgeMs || 86400000) / 1000),
      cookieOptions: {
        httpOnly: options.httpOnly !== false,
        secure: options.secure === true,
        sameSite: options.sameSite || 'Lax',
      },
      sessionCookieName: options.sessionCookieName || 'ws.sid',
    })
  );

  app._hono.use('*', async (c, next) => {
    bindSessionWrapper(c);
    await next();
  });

  app._webspressoSessionInitialized = true;
}

module.exports = { mountAppSession };
