/**
 * Webspresso Auth - middleware (Hono compat req/res)
 * @module core/auth/middleware
 */

/**
 * Create authentication middleware stack
 * @param {import('./manager').AuthManager} authManager
 * @returns {Object}
 */
function createAuthMiddleware(authManager) {
  const config = authManager.config;

  async function authenticate(req, res, next) {
    try {
      req.user = null;
      req.auth = authManager.createRequestAuth(req, res);

      if (req.session?.userId) {
        const user = await authManager.findUserById(req.session.userId);
        if (user) {
          req.user = user;
        } else {
          delete req.session.userId;
        }
      }

      if (!req.user && authManager.rememberTokens) {
        const user = await authManager.verifyRememberToken(req, res);
        if (user) {
          req.user = user;
          req.session.userId = user.id;
          req.session.loggedInAt = Date.now();
        }
      }

      next();
    } catch (error) {
      console.error('Authentication middleware error:', error);
      next();
    }
  }

  function requireAuth(options = {}) {
    return (req, res, next) => {
      if (!req.user) {
        if (options.api) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        if (req.session) {
          req.session.intendedUrl = req.originalUrl;
        }

        const redirectTo = options.redirectTo || config.routes.login;
        return res.redirect(redirectTo);
      }
      next();
    };
  }

  function requireGuest(options = {}) {
    return (req, res, next) => {
      if (req.user) {
        const redirectTo = options.redirectTo || config.routes.redirectAfterLogin;
        return res.redirect(redirectTo);
      }
      next();
    };
  }

  function requireCan(action, policy = null, getResource = null) {
    return async (req, res, next) => {
      try {
        const resource = getResource ? await getResource(req) : null;

        if (!req.auth.can(action, policy, resource)) {
          if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'You are not authorized to perform this action',
            });
          }
          return res.status(403).send('Forbidden');
        }

        if (resource) {
          req.resource = resource;
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  function requireVerified(options = {}) {
    const field = options.field || 'email_verified_at';

    return (req, res, next) => {
      if (!req.user) {
        return requireAuth()(req, res, next);
      }

      if (!req.user[field]) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Email verification required',
          });
        }

        const redirectTo = options.redirectTo || '/verify-email';
        return res.redirect(redirectTo);
      }

      next();
    };
  }

  function parseMiddlewareString(middlewareString) {
    const [name, ...params] = middlewareString.split(':');
    const args = params.join(':').split(',');

    switch (name) {
      case 'auth':
        return requireAuth({ api: args.includes('api') });
      case 'guest':
        return requireGuest();
      case 'can': {
        const [action, policy] = args;
        return requireCan(action, policy || null);
      }
      case 'verified':
        return requireVerified();
      default:
        throw new Error(`Unknown auth middleware: ${name}`);
    }
  }

  return {
    authenticate,
    requireAuth,
    requireGuest,
    requireCan,
    requireVerified,
    parseMiddlewareString,
    auth: requireAuth,
    guest: requireGuest,
  };
}

/**
 * @param {Object} app - Compat app
 * @param {import('./manager').AuthManager} authManager
 * @param {{ cookieSecret?: string }} [_opts]
 */
function setupAuthMiddleware(app, authManager, _opts = {}) {
  const middleware = createAuthMiddleware(authManager);
  app.use(middleware.authenticate);
  return middleware;
}

module.exports = {
  createAuthMiddleware,
  setupAuthMiddleware,
};
