/**
 * Webspresso Auth - Express Middleware
 * Authentication and authorization middleware
 * @module core/auth/middleware
 */

const session = require('express-session');
const cookieParser = require('cookie-parser');

/**
 * Create authentication middleware stack
 * @param {import('./manager').AuthManager} authManager - Auth manager instance
 * @returns {Object} Middleware functions
 */
function createAuthMiddleware(authManager) {
  const config = authManager.config;

  /**
   * Session middleware
   * Sets up express-session
   */
  const sessionMiddleware = session(authManager.getSessionConfig());

  /**
   * Cookie parser middleware (needed for signed cookies / remember me)
   */
  const cookieMiddleware = cookieParser(config.session.secret);

  /**
   * Authenticate middleware
   * Loads user from session or remember me token
   * Should run on every request
   */
  async function authenticate(req, res, next) {
    try {
      // Initialize req.user as null
      req.user = null;
      
      // Create request-bound auth helper
      req.auth = authManager.createRequestAuth(req, res);

      // Try to load user from session
      if (req.session?.userId) {
        const user = await authManager.findUserById(req.session.userId);
        if (user) {
          req.user = user;
        } else {
          // User no longer exists, clear session
          delete req.session.userId;
        }
      }

      // If no user in session, try remember me token
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
      
      case 'guest':
        return requireGuest();
      
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
    requireGuest,
    requireCan,
    requireVerified,
    
    // Utility
    parseMiddlewareString,
    
    // Aliases for route config (factories — file-router calls requireAuth(opts) / requireGuest(opts))
    auth: requireAuth,
    guest: requireGuest,
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
