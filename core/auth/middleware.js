/**
 * Webspresso Auth - Express Middleware
 * Authentication and authorization middleware
 * @module core/auth/middleware
 */

const session = require('express-session');
const cookieParser = require('cookie-parser');
const { createListSessionsHandler, createRevokeSessionHandler } = require('./session-manager');

/**
 * Create authentication middleware stack
 * @param {import('./manager').AuthManager} authManager - Auth manager instance
 * @returns {Object} Middleware functions
 */
function createAuthMiddleware(authManager) {
  const config = authManager.config;

  const sessionConfig = authManager.getSessionConfig();

  if (!sessionConfig.store && process.env.NODE_ENV === 'production') {
    const warnMsg = '[webspresso:auth] Warning: Default MemoryStore is being used in production. It is not designed for production environments and will leak memory under high load. Please configure a persistent session store (e.g. Knex or Redis).';
    if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
      process.emitWarning(warnMsg, 'SecurityWarning');
    } else {
      console.warn(warnMsg);
    }
  }

  /**
   * Session middleware
   * Sets up express-session with secure cookie enforcement
   */
  const sessionMiddleware = session({
    ...sessionConfig,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      ...(sessionConfig.cookie || {}),
    },
  });

  /**
   * Cookie parser middleware (needed for signed cookies / remember me)
   */
  const baseCookieMiddleware = cookieParser(config.session?.secret);
  const cookieMiddleware = (req, res, next) => {
    if (!req.cookies) {
      return baseCookieMiddleware(req, res, next);
    }
    if (config.session?.secret) {
      if (!req.secret) {
        req.secret = config.session.secret;
      }
      if (!req.signedCookies || Object.keys(req.signedCookies).length === 0) {
        req.signedCookies = cookieParser.signedCookies(req.cookies, config.session.secret);
      }
    }
    next();
  };

  /**
   * Authenticate middleware
   * Loads user from Bearer JWT header, session, or remember me token
   * Should run on every request
   */
  async function authenticate(req, res, next) {
    try {
      // Initialize req.user as null
      req.user = null;
      
      // Create request-bound auth helper
      req.auth = authManager.createRequestAuth(req, res);

      // Check Bearer JWT token header first
      const authHeader = req.headers?.authorization || req.headers?.Authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        try {
          const payload = authManager.verifyJwt(token);
          req.token = token;
          req.jwtPayload = payload;
          if (payload.id) {
            const user = await authManager.findUserById(payload.id);
            req.user = user || payload;
          } else {
            req.user = payload;
          }
        } catch (jwtErr) {
          // Invalid or expired JWT token header
        }
      }

      // Try to load user from session if not authenticated by JWT
      if (!req.user && req.session?.userId) {
        // If session tracking is enabled, verify session has not been revoked
        let isSessionValid = true;
        if (authManager.sessionManager && req.sessionID) {
          isSessionValid = await authManager.isSessionValid(req.sessionID, req.session.userId);
        }

        if (!isSessionValid) {
          // Session was revoked remotely
          delete req.session.userId;
          if (typeof req.session.destroy === 'function') {
            req.session.destroy(() => {});
          }
        } else {
          const user = await authManager.findUserById(req.session.userId);
          if (user) {
            req.user = user;
            if (req.sessionID && authManager.sessionManager) {
              authManager.touchSession(req.sessionID).catch(() => {});
            }
          } else {
            // User no longer exists, clear session
            delete req.session.userId;
          }
        }
      }

      // If no user in session or JWT, try remember me token
      if (!req.user && authManager.rememberTokens) {
        const user = await authManager.verifyRememberToken(req, res);
        if (user) {
          req.user = user;
          req.session.userId = user.id;
          req.session.loggedInAt = Date.now();
          if (req.sessionID && authManager.sessionManager) {
            authManager.trackSession(req.sessionID, user.id, req).catch(() => {});
          }
        }
      }

      next();
    } catch (error) {
      console.error('Authentication middleware error:', error);
      next();
    }
  }

  /**
   * Require authentication middleware
   * Redirects to login if not authenticated
   * @param {Object} [options] - Options
   * @param {string} [options.redirectTo] - Redirect URL (default: config.routes.login)
   * @param {boolean} [options.api=false] - Return JSON error instead of redirect
   */
  function requireAuth(options = {}) {
    return (req, res, next) => {
      if (!req.user) {
        if (options.api) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Store intended URL for redirect after login
        if (req.session) {
          req.session.intendedUrl = req.originalUrl;
        }

        const redirectTo = options.redirectTo || config.routes.login;
        return res.redirect(redirectTo);
      }
      next();
    };
  }

  /**
   * Require JWT middleware
   * Enforces valid Bearer JWT token in Authorization header
   * @param {Object} [options] - Verification options
   */
  function requireJwt(options = {}) {
    return async (req, res, next) => {
      const authHeader = req.headers?.authorization || req.headers?.Authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Bearer token required',
        });
      }

      const token = authHeader.substring(7).trim();
      try {
        const payload = authManager.verifyJwt(token, options);
        req.token = token;
        req.jwtPayload = payload;

        if (payload.id) {
          const user = await authManager.findUserById(payload.id);
          req.user = user || payload;
        } else {
          req.user = payload;
        }

        next();
      } catch (err) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: err.message || 'Invalid JWT token',
        });
      }
    };
  }

  /**
   * Require guest middleware
   * Redirects authenticated users away
   * @param {Object} [options] - Options
   * @param {string} [options.redirectTo] - Redirect URL (default: config.routes.redirectAfterLogin)
   */
  function requireGuest(options = {}) {
    return (req, res, next) => {
      if (req.user) {
        const redirectTo = options.redirectTo || config.routes.redirectAfterLogin;
        return res.redirect(redirectTo);
      }
      next();
    };
  }

  /**
   * Require policy middleware
   * Checks if user can perform action
   * @param {string} action - Action name
   * @param {string} [policy] - Policy name
   * @param {Function} [getResource] - Function to get resource from request: (req) => resource
   */
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
          return res.status(403).render('error/403', {
            message: 'You are not authorized to perform this action',
          });
        }
        
        // Attach resource to request for later use
        if (resource) {
          req.resource = resource;
        }
        
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Verified email middleware
   * Requires user to have verified email
   * @param {Object} [options] - Options
   * @param {string} [options.redirectTo] - Redirect URL
   * @param {string} [options.field='email_verified_at'] - Field to check
   */
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

  /**
   * Require Two-Factor Authentication (2FA / TOTP) middleware
   * Checks if user has completed 2FA step if 2FA is required or enabled for the user
   * @param {Object} [options] - Options
   * @param {boolean} [options.always=false] - Always enforce 2FA verification regardless of user flag
   * @param {boolean} [options.api=false] - Return JSON error instead of redirect
   * @param {string} [options.redirectTo] - Redirect URL (default: config.routes.twoFactor || '/2fa')
   * @param {string} [options.redirectToLogin] - Redirect URL if unauthenticated (default: config.routes.login)
   * @param {Function} [options.isUser2FaEnabled] - Custom predicate (user) => boolean
   */
  function require2Fa(options = {}) {
    return (req, res, next) => {
      // 1. Must be logged in or have a pending 2FA authentication session
      if (!req.user && !req.session?.twoFactorPending) {
        if (options.api || req.xhr || req.headers?.accept?.includes('application/json')) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }
        if (req.session) {
          req.session.intendedUrl = req.originalUrl;
        }
        const loginUrl = options.redirectToLogin || config.routes.login;
        return res.redirect(loginUrl);
      }

      // 2. Check if 2FA is required for this user or route
      let userRequires2Fa = options.always === true;
      if (!userRequires2Fa) {
        if (typeof options.isUser2FaEnabled === 'function') {
          userRequires2Fa = options.isUser2FaEnabled(req.user);
        } else if (req.user) {
          userRequires2Fa = Boolean(
            req.user.two_factor_enabled ||
            req.user.twoFactorEnabled ||
            req.user.totp_enabled ||
            req.user.totpEnabled
          );
        } else if (req.session?.twoFactorPending) {
          userRequires2Fa = true;
        }
      }

      // If user does not have 2FA enabled and route does not enforce it unconditionally, pass
      if (!userRequires2Fa) {
        return next();
      }

      // 3. Check if 2FA is already verified in this session
      const isVerified = Boolean(
        req.auth?.is2FaVerified?.() ||
        req.session?.twoFactorVerified ||
        req.jwtPayload?.twoFactorVerified
      );

      if (isVerified) {
        return next();
      }

      // 4. Not verified -> reject with 403 or redirect to 2FA verification page
      if (options.api || req.xhr || req.headers?.accept?.includes('application/json')) {
        return res.status(403).json({
          error: 'TwoFactorRequired',
          message: 'Two-factor authentication required',
        });
      }

      if (req.session) {
        req.session.intendedUrl = req.originalUrl;
      }

      const redirectTo = options.redirectTo || config.routes.twoFactor || '/2fa';
      return res.redirect(redirectTo);
    };
  }

  /**
   * Parse middleware string like 'can:edit,post' into middleware function
   * @param {string} middlewareString - Middleware string
   * @returns {Function} Middleware function
   */
  function parseMiddlewareString(middlewareString) {
    const [name, ...params] = middlewareString.split(':');
    const args = params.join(':').split(',');

    switch (name) {
      case 'auth':
        return requireAuth({ api: args.includes('api') });
      
      case 'jwt':
        return requireJwt();
      
      case 'guest':
        return requireGuest();

      case '2fa':
      case 'totp':
        return require2Fa({
          api: args.includes('api'),
          always: args.includes('always'),
        });
      
      case 'can':
        // can:action,policy
        const [action, policy] = args;
        return requireCan(action, policy || null);
      
      case 'verified':
        return requireVerified();
      
      default:
        throw new Error(`Unknown auth middleware: ${name}`);
    }
  }

  return {
    // Core middleware
    session: sessionMiddleware,
    cookie: cookieMiddleware,
    authenticate,
    
    // Guard middleware
    requireAuth,
    requireJwt,
    requireGuest,
    require2Fa,
    requireTotp: require2Fa,
    requireCan,
    requireVerified,
    
    // Utility
    parseMiddlewareString,
    
    // Session handlers
    listSessions: createListSessionsHandler(authManager),
    revokeSession: createRevokeSessionHandler(authManager),

    // Aliases for route config (factories — file-router calls requireAuth(opts) / requireGuest(opts))
    auth: requireAuth,
    jwt: requireJwt,
    guest: requireGuest,
    twoFactor: require2Fa,
    totp: require2Fa,
  };
}

/**
 * Setup auth middleware on Express app
 * @param {Object} app - Express app
 * @param {import('./manager').AuthManager} authManager - Auth manager
 * @returns {Object} Middleware functions for use in routes
 */
function setupAuthMiddleware(app, authManager) {
  const middleware = createAuthMiddleware(authManager);
  
  // Apply global middleware
  app.use(middleware.cookie);
  app.use(middleware.session);
  app.use(middleware.authenticate);
  
  return middleware;
}

module.exports = {
  createAuthMiddleware,
  setupAuthMiddleware,
};
