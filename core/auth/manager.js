/**
 * Webspresso Auth - Authentication Manager
 * Core authentication logic with adapter pattern
 * @module core/auth/manager
 */

const { generateToken, hashToken } = require('./hash');
const { PolicyManager } = require('./policy');

/**
 * Authentication error
 */
class AuthenticationError extends Error {
  constructor(message = 'Authentication failed', code = 'AUTH_FAILED') {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
    this.status = 401;
  }
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  session: {
    name: 'webspresso.sid',
    secret: null, // Required
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  },
  rememberMe: {
    enabled: true,
    cookieName: 'remember_token',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  routes: {
    login: '/login',
    logout: '/logout',
    home: '/',
    redirectAfterLogin: '/dashboard',
  },
};

/**
 * AuthManager - Handles authentication operations
 */
class AuthManager {
  /**
   * Create AuthManager instance
   * @param {Object} config - Configuration
   * @param {Function} config.findUserById - (id) => Promise<User|null>
   * @param {Function} config.findUserByCredentials - (identifier, password) => Promise<User|null>
   * @param {Object} [config.rememberTokens] - Remember token adapter
   * @param {Function} config.rememberTokens.create - (userId, token, expiresAt) => Promise
   * @param {Function} config.rememberTokens.find - (token) => Promise<{user_id, token, expires_at}|null>
   * @param {Function} config.rememberTokens.delete - (token) => Promise
   * @param {Function} config.rememberTokens.deleteAllForUser - (userId) => Promise
   * @param {Object} [config.session] - Session configuration
   * @param {Object} [config.rememberMe] - Remember me configuration
   * @param {Object} [config.routes] - Route configuration
   */
  constructor(config) {
    this.validateConfig(config);
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      session: { ...DEFAULT_CONFIG.session, ...config.session },
      rememberMe: { ...DEFAULT_CONFIG.rememberMe, ...config.rememberMe },
      routes: { ...DEFAULT_CONFIG.routes, ...config.routes },
    };
    
    this.findUserById = config.findUserById;
    this.findUserByCredentials = config.findUserByCredentials;
    this.rememberTokens = config.rememberTokens || null;
    
    // Policy manager instance
    this.policies = new PolicyManager();
  }

  /**
   * Validate configuration
   * @param {Object} config
   */
  validateConfig(config) {
    if (typeof config.findUserById !== 'function') {
      throw new Error('findUserById function is required');
    }
    if (typeof config.findUserByCredentials !== 'function') {
      throw new Error('findUserByCredentials function is required');
    }
    if (config.rememberTokens) {
      const required = ['create', 'find', 'delete', 'deleteAllForUser'];
      for (const method of required) {
        if (typeof config.rememberTokens[method] !== 'function') {
          throw new Error(`rememberTokens.${method} function is required`);
        }
      }
    }
  }

  /**
   * Get session configuration for express-session
   * @returns {Object}
   */
  getSessionConfig() {
    const config = { ...this.config.session };
    
    if (!config.secret) {
      throw new Error('Session secret is required. Set AUTH_SESSION_SECRET environment variable or pass session.secret in config.');
    }
    
    return config;
  }

  /**
   * Create request-bound auth helper
   * This is attached to req.auth in middleware
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @returns {Object} Request-bound auth helper
   */
  createRequestAuth(req, res) {
    const self = this;
    
    return {
      /**
       * Attempt login with credentials
       * @param {string} identifier - Email or username
       * @param {string} password - Password
       * @param {Object} [options] - Options
       * @param {boolean} [options.remember=false] - Create remember me token
       * @returns {Promise<Object|null>} User if successful, null if failed
       */
      async attempt(identifier, password, options = {}) {
        const user = await self.findUserByCredentials(identifier, password);
        
        if (!user) {
          return null;
        }
        
        // Login the user
        await this.login(user, options);
        
        return user;
      },

      /**
       * Login a user directly (without credentials check)
       * @param {Object} user - User object
       * @param {Object} [options] - Options
       * @param {boolean} [options.remember=false] - Create remember me token
       */
      async login(user, options = {}) {
        if (!user || !user.id) {
          throw new AuthenticationError('Invalid user object', 'INVALID_USER');
        }
        
        // Set session
        req.session.userId = user.id;
        req.session.loggedInAt = Date.now();
        
        // Set req.user
        req.user = user;
        
        // Handle remember me
        if (options.remember && self.rememberTokens && self.config.rememberMe.enabled) {
          await self.createRememberToken(user.id, res);
        }
        
        // Regenerate session ID for security
        return new Promise((resolve, reject) => {
          req.session.regenerate((err) => {
            if (err) {
              reject(new AuthenticationError('Session regeneration failed', 'SESSION_ERROR'));
            } else {
              // Restore userId after regenerate
              req.session.userId = user.id;
              req.session.loggedInAt = Date.now();
              resolve();
            }
          });
        });
      },

      /**
       * Logout current user
       * @param {Object} [options] - Options
       * @param {boolean} [options.everywhere=false] - Logout from all devices
       */
      async logout(options = {}) {
        const userId = req.session?.userId;
        
        // Clear remember token
        if (self.rememberTokens) {
          const tokenFromCookie = req.cookies?.[self.config.rememberMe.cookieName];
          
          if (options.everywhere && userId) {
            // Delete all tokens for user
            await self.rememberTokens.deleteAllForUser(userId);
          } else if (tokenFromCookie) {
            // Delete only current token
            await self.rememberTokens.delete(hashToken(tokenFromCookie));
          }
          
          // Clear cookie
          res.clearCookie(self.config.rememberMe.cookieName);
        }
        
        // Clear user
        req.user = null;
        
        // Destroy session
        return new Promise((resolve) => {
          req.session.destroy((err) => {
            if (err) {
              console.error('Session destroy error:', err);
            }
            resolve();
          });
        });
      },

      /**
       * Check if user is authenticated
       * @returns {boolean}
       */
      check() {
        return !!req.user;
      },

      /**
       * Check if user is a guest
       * @returns {boolean}
       */
      guest() {
        return !req.user;
      },

      /**
       * Get current user
       * @returns {Object|null}
       */
      user() {
        return req.user || null;
      },

      /**
       * Get current user ID
       * @returns {*|null}
       */
      id() {
        return req.user?.id || null;
      },

      /**
       * Check if user can perform action (policy check)
       * @param {string} action - Action name
       * @param {string} [policy] - Policy name
       * @param {*} [resource] - Resource to check
       * @returns {boolean}
       */
      can(action, policy = null, resource = null) {
        return self.policies.can(req.user, action, policy, resource);
      },

      /**
       * Check if user cannot perform action
       * @param {string} action - Action name
       * @param {string} [policy] - Policy name
       * @param {*} [resource] - Resource to check
       * @returns {boolean}
       */
      cannot(action, policy = null, resource = null) {
        return self.policies.cannot(req.user, action, policy, resource);
      },

      /**
       * Authorize action - throws if unauthorized
       * @param {string} action - Action name
       * @param {string} [policy] - Policy name
       * @param {*} [resource] - Resource to check
       * @throws {AuthorizationError}
       */
      authorize(action, policy = null, resource = null) {
        return self.policies.authorize(req.user, action, policy, resource);
      },
    };
  }

  /**
   * Create remember me token
   * @param {*} userId - User ID
   * @param {Object} res - Express response
   */
  async createRememberToken(userId, res) {
    if (!this.rememberTokens) return;
    
    const token = generateToken(32);
    const hashedToken = hashToken(token);
    const expiresAt = new Date(Date.now() + this.config.rememberMe.maxAge);
    
    // Store hashed token in DB
    await this.rememberTokens.create(userId, hashedToken, expiresAt);
    
    // Set plain token in cookie
    res.cookie(this.config.rememberMe.cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: this.config.rememberMe.maxAge,
      signed: true,
    });
  }

  /**
   * Verify remember me token and login user
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @returns {Promise<Object|null>} User if valid token, null otherwise
   */
  async verifyRememberToken(req, res) {
    if (!this.rememberTokens || !this.config.rememberMe.enabled) {
      return null;
    }
    
    const token = req.signedCookies?.[this.config.rememberMe.cookieName];
    if (!token) {
      return null;
    }
    
    const hashedToken = hashToken(token);
    const tokenRecord = await this.rememberTokens.find(hashedToken);
    
    if (!tokenRecord) {
      // Invalid token, clear cookie
      res.clearCookie(this.config.rememberMe.cookieName);
      return null;
    }
    
    // Check expiration
    if (new Date(tokenRecord.expires_at) < new Date()) {
      // Token expired, delete and clear cookie
      await this.rememberTokens.delete(hashedToken);
      res.clearCookie(this.config.rememberMe.cookieName);
      return null;
    }
    
    // Token valid, get user
    const user = await this.findUserById(tokenRecord.user_id);
    
    if (!user) {
      // User not found, delete token
      await this.rememberTokens.delete(hashedToken);
      res.clearCookie(this.config.rememberMe.cookieName);
      return null;
    }
    
    // Rotate token for security
    await this.rememberTokens.delete(hashedToken);
    await this.createRememberToken(user.id, res);
    
    return user;
  }

  /**
   * Define a policy
   * @param {string} name - Policy name
   * @param {Object} rules - Policy rules
   */
  definePolicy(name, rules) {
    this.policies.definePolicy(name, rules);
  }

  /**
   * Define a gate
   * @param {string} name - Gate name
   * @param {Function} callback - Gate callback
   */
  defineGate(name, callback) {
    this.policies.defineGate(name, callback);
  }

  /**
   * Register before callback for policies
   * @param {Function} callback
   */
  beforePolicy(callback) {
    this.policies.before(callback);
  }
}

module.exports = {
  AuthManager,
  AuthenticationError,
  DEFAULT_CONFIG,
};
