/**
 * Webspresso Auth - Authentication Manager
 * Core authentication logic with adapter pattern
 * @module core/auth/manager
 */

const EventEmitter = require('events');
const { generateToken, hashToken } = require('./hash');
const { PolicyManager } = require('./policy');
const { signJwt, verifyJwt, decodeJwt } = require('./jwt');
const {
  TOKEN_TYPES,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
  hash: hashPassword,
} = require('./tokens');

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
      secure: process.env.NODE_ENV === 'production' ? true : 'auto',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  },
  rememberMe: {
    enabled: true,
    cookieName: 'remember_token',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  jwt: {
    enabled: false,
    secret: null,
    refreshSecret: null,
    expiresIn: '24h',
    refreshExpiresIn: '30d',
  },
  routes: {
    login: '/login',
    logout: '/logout',
    home: '/',
    redirectAfterLogin: '/dashboard',
    twoFactor: '/2fa',
  },
};

/**
 * AuthManager - Handles authentication operations
 */
class AuthManager extends EventEmitter {
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
    super();
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
    this.findUserByIdentifier = config.findUserByIdentifier || null;
    this.rememberTokens = config.rememberTokens || null;
    this.authTokens = config.authTokens || null;
    this.updateUser = config.updateUser || null;
    this.identifierField = config.identifierField || 'email';
    this.verifiedField = config.verifiedField || 'email_verified_at';
    this.passwordField = config.passwordField || 'password';
    this.notifications = {
      passwordReset: config.notifications?.passwordReset || null,
      emailVerification: config.notifications?.emailVerification || null,
      welcome: config.notifications?.welcome || null,
      magicLink: config.notifications?.magicLink || null,
    };

    // TOTP & 2FA initialization
    this.totp = require('./totp');
    this.twoFactor = config.twoFactor || { enabled: false };

    if (config.jwt) {
      const jwtSecret = typeof config.jwt === 'object' && config.jwt.secret
        ? config.jwt.secret
        : (config.session?.secret || process.env.JWT_SECRET || process.env.AUTH_SESSION_SECRET || 'webspresso-jwt-secret');
      const refreshSecret = typeof config.jwt === 'object' && config.jwt.refreshSecret
        ? config.jwt.refreshSecret
        : (process.env.JWT_REFRESH_SECRET || jwtSecret);
      const expiresIn = typeof config.jwt === 'object' && config.jwt.expiresIn
        ? config.jwt.expiresIn
        : '24h';
      const refreshExpiresIn = typeof config.jwt === 'object' && config.jwt.refreshExpiresIn
        ? config.jwt.refreshExpiresIn
        : '30d';
      this.jwt = {
        enabled: true,
        secret: jwtSecret,
        refreshSecret,
        expiresIn,
        refreshExpiresIn,
      };
    } else {
      this.jwt = null;
    }
    
    // Policy manager instance
    this.policies = new PolicyManager();

    // Session tracking and revocation manager
    const { SessionManager } = require('./session-manager');
    const { createKnexSessionTracker, createMemorySessionTracker } = require('./sessions');

    let tracker = config.sessionTracker || null;
    if (!tracker && (config.sessionTracking || config.trackSessions)) {
      if (config.db || this.config.db) {
        tracker = createKnexSessionTracker(config.db || this.config.db);
      } else {
        tracker = createMemorySessionTracker();
      }
    }

    if (tracker || config.sessionTracking || config.trackSessions) {
      this.sessionManager = new SessionManager({
        tracker: tracker || createMemorySessionTracker(),
        sessionStore: config.sessionStore || this.config.session?.store,
        touchThrottleMs: config.sessionTouchThrottleMs,
        emitter: this,
      });
    } else {
      this.sessionManager = null;
    }
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
    if (config.authTokens) {
      const required = ['create', 'find', 'delete', 'deleteAllForUser'];
      for (const method of required) {
        if (typeof config.authTokens[method] !== 'function') {
          throw new Error(`authTokens.${method} function is required`);
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

    const mergedCookie = {
      httpOnly: true,
      sameSite: 'lax',
      ...DEFAULT_CONFIG.session.cookie,
      ...(config.cookie || {}),
    };
    const userSetSecure =
      typeof (this.config.session.cookie && this.config.session.cookie.secure) === 'boolean';
    const secureComputed =
      process.env.NODE_ENV === 'production' ||
      process.env.COOKIE_SECURE === 'true' ||
      /^https:/i.test(String(process.env.BASE_URL || '').trim());
    mergedCookie.secure = userSetSecure ? mergedCookie.secure : secureComputed;
    config.cookie = mergedCookie;

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
      manager: self,

      /**
       * Generate JWT access token for user
       */
      generateUserToken(user, options) {
        return self.generateUserToken(user, options);
      },

      /**
       * Generate JWT refresh token for user
       */
      generateRefreshToken(user, options) {
        return self.generateRefreshToken(user, options);
      },

      /**
       * Refresh access token using refresh token
       */
      async refreshAccessToken(refreshToken, options) {
        return await self.refreshAccessToken(refreshToken, options);
      },

      /**
       * Create JWT payload
       */
      createJwt(payload, options) {
        return self.createJwt(payload, options);
      },

      /**
       * Verify JWT token
       */
      verifyJwt(token, options) {
        return self.verifyJwt(token, options);
      },
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
        
        // Set session if active
        if (req.session) {
          req.session.userId = user.id;
          req.session.loggedInAt = Date.now();
        }
        
        // Set req.user
        req.user = user;

        // Handle remember me
        if (options.remember && self.rememberTokens && self.config.rememberMe.enabled) {
          await self.createRememberToken(user.id, res);
        }
        
        // Regenerate session ID for security if supported
        if (req.session && typeof req.session.regenerate === 'function') {
          return new Promise((resolve, reject) => {
            req.session.regenerate(async (err) => {
              if (err) {
                reject(new AuthenticationError('Session regeneration failed', 'SESSION_ERROR'));
              } else {
                // Restore userId after regenerate
                req.session.userId = user.id;
                req.session.loggedInAt = Date.now();
                if (req.sessionID && self.sessionManager) {
                  try {
                    await self.sessionManager.track(req.sessionID, user.id, req);
                  } catch (e) {
                    // Non-blocking
                  }
                }
                resolve();
              }
            });
          });
        }

        // Track active session if sessionManager is active and not regenerated
        if (req.sessionID && self.sessionManager) {
          try {
            await self.sessionManager.track(req.sessionID, user.id, req);
          } catch (e) {
            // Non-blocking
          }
        }
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
          if (typeof res?.clearCookie === 'function') {
            res.clearCookie(self.config.rememberMe.cookieName);
          }
        }
        
        // Clear 2FA session state
        this.clear2Fa();

        // Revoke session if sessionManager is active
        if (req.sessionID && self.sessionManager) {
          try {
            if (options.everywhere && userId) {
              await self.sessionManager.revokeAllSessions(userId);
            } else {
              await self.sessionManager.revokeSession(req.sessionID, { userId });
            }
          } catch (e) {
            // Non-blocking
          }
        }

        // Clear user
        req.user = null;
        
        // Destroy session if supported
        if (req.session && typeof req.session.destroy === 'function') {
          return new Promise((resolve) => {
            req.session.destroy((err) => {
              if (err) {
                console.error('Session destroy error:', err);
              }
              resolve();
            });
          });
        }
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
       * TOTP helper utilities (RFC 6238 / RFC 4226)
       */
      totp: self.totp,

      /**
       * Check if two-factor authentication has been verified in current session/request
       * @returns {boolean}
       */
      is2FaVerified() {
        if (req.session?.twoFactorVerified) return true;
        if (req.jwtPayload?.twoFactorVerified) return true;
        return false;
      },

      /**
       * Check if two-factor authentication is pending verification
       * @returns {boolean}
       */
      is2FaPending() {
        return Boolean(req.session?.twoFactorPending);
      },

      /**
       * Mark two-factor authentication as verified
       * @param {boolean} [verified=true]
       */
      set2FaVerified(verified = true) {
        if (req.session) {
          req.session.twoFactorVerified = Boolean(verified);
          if (verified) {
            delete req.session.twoFactorPending;
            delete req.session.twoFactorUserId;
          }
        }
      },

      /**
       * Mark two-factor authentication as pending verification for a user
       * @param {Object} [user] - User object or user ID
       */
      set2FaPending(user) {
        if (req.session) {
          req.session.twoFactorPending = true;
          req.session.twoFactorVerified = false;
          if (user?.id) {
            req.session.twoFactorUserId = user.id;
          } else if (typeof user === 'string' || typeof user === 'number') {
            req.session.twoFactorUserId = user;
          }
        }
      },

      /**
       * Clear two-factor authentication status from session
       */
      clear2Fa() {
        if (req.session) {
          delete req.session.twoFactorVerified;
          delete req.session.twoFactorPending;
          delete req.session.twoFactorUserId;
        }
      },

      /**
       * Verify submitted TOTP token or recovery code
       * Automatically marks 2FA as verified upon success
       * @param {string} tokenOrCode - Submitted 6-digit TOTP code or recovery code
       * @param {Object|string} secretOrUser - Secret string or user object with totp_secret / recovery_codes
       * @param {Object} [options]
       * @returns {{ success: boolean, type?: 'totp'|'recovery_code', delta?: number, remainingHashedCodes?: string[], matchedIndex?: number }}
       */
      verify2Fa(tokenOrCode, secretOrUser, options = {}) {
        if (!tokenOrCode) {
          return { success: false };
        }

        let secret = null;
        let recoveryCodes = null;

        if (typeof secretOrUser === 'string') {
          secret = secretOrUser;
        } else if (secretOrUser && typeof secretOrUser === 'object') {
          secret = secretOrUser.totp_secret || secretOrUser.totpSecret || secretOrUser.two_factor_secret || secretOrUser.twoFactorSecret;
          recoveryCodes = secretOrUser.recovery_codes || secretOrUser.recoveryCodes || secretOrUser.two_factor_recovery_codes;
        }

        // Try TOTP code first
        if (secret) {
          const totpResult = self.totp.verifyTotp(tokenOrCode, secret, { ...options, detailed: true });
          if (totpResult.valid) {
            this.set2FaVerified(true);
            return { success: true, type: 'totp', delta: totpResult.delta };
          }
        }

        // Try recovery codes if provided
        if (recoveryCodes && Array.isArray(recoveryCodes) && recoveryCodes.length > 0) {
          const recResult = self.totp.verifyRecoveryCode(tokenOrCode, recoveryCodes);
          if (recResult.valid) {
            this.set2FaVerified(true);
            return {
              success: true,
              type: 'recovery_code',
              matchedIndex: recResult.matchedIndex,
              remainingHashedCodes: recResult.remainingHashedCodes,
            };
          }
        }

        return { success: false };
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

      /**
       * Request a magic link for passwordless login
       * @param {string} identifier - User email or username
       * @param {Object} [options]
       * @returns {Promise<{ sent: boolean, expiresAt?: Date, token?: string, magicLinkUrl?: string, userFound: boolean }>}
       */
      requestMagicLink(identifier, options = {}) {
        return self.requestMagicLink(identifier, options);
      },

      /**
       * Verify magic link token
       * @param {string} rawToken
       * @param {Object} [options]
       * @returns {Promise<{ ok: true, user: Object, userId: * }>}
       */
      verifyMagicLink(rawToken, options = {}) {
        return self.verifyMagicLink(rawToken, options);
      },

      /**
       * Verify magic link token and log user into current request session
       * @param {string} rawToken
       * @param {Object} [options]
       * @returns {Promise<{ ok: true, user: Object, userId: *, accessToken?: string, refreshToken?: string }>}
       */
      async loginWithMagicLink(rawToken, options = {}) {
        const result = await self.verifyMagicLink(rawToken, options);
        await this.login(result.user, options.remember);

        const response = { ...result };
        if (options.jwt) {
          response.accessToken = self.generateUserToken(result.user, options.jwtAccessOptions);
          response.refreshToken = self.generateRefreshToken(result.user, options.jwtRefreshOptions);
        }

        return response;
      },

      /**
       * List active sessions/devices for current user
       * @returns {Promise<Array<Object>>}
       */
      sessions() {
        if (!req.user?.id) return Promise.resolve([]);
        return self.listSessions(req.user.id, req.sessionID);
      },

      /**
       * Revoke a specific session
       * @param {string} sessionId
       * @returns {Promise<boolean>}
       */
      async revokeSession(sessionId) {
        if (sessionId === req.sessionID) {
          await this.logout();
          return true;
        }
        return await self.revokeSession(sessionId, { userId: req.user?.id });
      },

      /**
       * Revoke all other active sessions except current
       * @returns {Promise<number>}
       */
      revokeOtherSessions() {
        if (!req.user?.id) return Promise.resolve(0);
        return self.revokeOtherSessions(req.user.id, req.sessionID);
      },

      /**
       * Revoke all active sessions for user (force logout from all devices)
       * @param {string|number} [userId]
       * @returns {Promise<number>}
       */
      async revokeAllSessions(userId = null) {
        const targetUserId = userId || req.user?.id;
        if (!targetUserId) return 0;
        const count = await self.revokeAllSessions(targetUserId);
        if (targetUserId === req.user?.id) {
          await this.logout();
        }
        return count;
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

  /**
   * Find user by login identifier (email, username, …)
   * @param {string} identifier
   * @returns {Promise<Object|null>}
   */
  async resolveUserByIdentifier(identifier) {
    if (typeof this.findUserByIdentifier === 'function') {
      return this.findUserByIdentifier(identifier);
    }
    return null;
  }

  /**
   * Request password reset — always resolves (no user enumeration)
   * @param {string} identifier
   * @param {Object} [options]
   * @param {number} [options.tokenTtlMs=3600000]
   * @param {Function} [options.buildResetUrl] - (rawToken) => string
   * @returns {Promise<{ sent: boolean }>}
   */
  async requestPasswordReset(identifier, options = {}) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for password reset');
    }

    const user = await this.resolveUserByIdentifier(identifier);
    if (!user) {
      return { sent: false };
    }

    const tokenTtlMs = options.tokenTtlMs ?? 60 * 60 * 1000;
    const { rawToken, expiresAt } = await createAuthToken(
      this.authTokens,
      TOKEN_TYPES.PASSWORD_RESET,
      user.id,
      tokenTtlMs
    );

    const resetUrl = typeof options.buildResetUrl === 'function'
      ? options.buildResetUrl(rawToken)
      : null;

    if (typeof this.notifications.passwordReset === 'function') {
      await this.notifications.passwordReset(user, {
        token: rawToken,
        expiresAt,
        resetUrl,
      });
    }

    return { sent: true };
  }

  /**
   * Complete password reset with token
   * @param {string} rawToken
   * @param {string} newPassword
   * @returns {Promise<{ ok: true }>}
   */
  async completePasswordReset(rawToken, newPassword) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for password reset');
    }
    if (!this.updateUser) {
      throw new Error('updateUser function is required for password reset');
    }

    const verified = await verifyAuthToken(
      this.authTokens,
      TOKEN_TYPES.PASSWORD_RESET,
      rawToken
    );
    if (!verified) {
      throw new AuthenticationError('Invalid or expired reset token', 'INVALID_TOKEN');
    }

    const hashed = await hashPassword(newPassword);
    await this.updateUser(verified.userId, { [this.passwordField]: hashed });
    await consumeAuthToken(this.authTokens, verified.tokenHash);
    await this.authTokens.deleteAllForUser(verified.userId, TOKEN_TYPES.PASSWORD_RESET);

    return { ok: true };
  }

  /**
   * Send email verification token
   * @param {*} userId
   * @param {Object} [options]
   * @param {number} [options.tokenTtlMs=86400000]
   * @param {Function} [options.buildVerifyUrl] - (rawToken) => string
   * @returns {Promise<{ sent: boolean }>}
   */
  async requestEmailVerification(userId, options = {}) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for email verification');
    }

    const user = await this.findUserById(userId);
    if (!user) {
      return { sent: false };
    }

    const tokenTtlMs = options.tokenTtlMs ?? 24 * 60 * 60 * 1000;
    const { rawToken, expiresAt } = await createAuthToken(
      this.authTokens,
      TOKEN_TYPES.EMAIL_VERIFY,
      user.id,
      tokenTtlMs
    );

    const verifyUrl = typeof options.buildVerifyUrl === 'function'
      ? options.buildVerifyUrl(rawToken)
      : null;

    if (typeof this.notifications.emailVerification === 'function') {
      await this.notifications.emailVerification(user, {
        token: rawToken,
        expiresAt,
        verifyUrl,
      });
    }

    return { sent: true };
  }

  /**
   * Verify email with token
   * @param {string} rawToken
   * @returns {Promise<{ ok: true, userId: * }>}
   */
  async verifyEmail(rawToken) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for email verification');
    }
    if (!this.updateUser) {
      throw new Error('updateUser function is required for email verification');
    }

    const verified = await verifyAuthToken(
      this.authTokens,
      TOKEN_TYPES.EMAIL_VERIFY,
      rawToken
    );
    if (!verified) {
      throw new AuthenticationError('Invalid or expired verification token', 'INVALID_TOKEN');
    }

    await this.updateUser(verified.userId, { [this.verifiedField]: new Date() });
    await consumeAuthToken(this.authTokens, verified.tokenHash);

    return { ok: true, userId: verified.userId };
  }

  /**
   * Request magic link passwordless login — safe against user enumeration
   * @param {string} identifier - Email or username
   * @param {Object} [options]
   * @param {number} [options.tokenTtlMs=900000] - Default 15 minutes (900,000ms)
   * @param {Function} [options.buildMagicLinkUrl] - (rawToken) => string
   * @param {string} [options.path='/auth/magic-link/verify']
   * @param {boolean} [options.hideUserNotFound=true]
   * @returns {Promise<{ sent: boolean, expiresAt?: Date, token?: string, magicLinkUrl?: string, userFound: boolean }>}
   */
  async requestMagicLink(identifier, options = {}) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for magic link authentication');
    }

    const user = await this.resolveUserByIdentifier(identifier);
    if (!user) {
      return {
        sent: options.hideUserNotFound !== false,
        userFound: false,
      };
    }

    const tokenTtlMs = options.tokenTtlMs ?? 15 * 60 * 1000;
    const { rawToken, expiresAt } = await createAuthToken(
      this.authTokens,
      TOKEN_TYPES.MAGIC_LINK,
      user.id,
      tokenTtlMs
    );

    let baseUrl = String(options.baseUrl || this.config.baseUrl || process.env.BASE_URL || 'http://localhost:3000');
    while (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const pathSegment = options.path || '/auth/magic-link/verify';
    const cleanPath = pathSegment.startsWith('/') ? pathSegment : `/${pathSegment}`;
    const sep = cleanPath.includes('?') ? '&' : '?';

    const hasCustomUrl = typeof options.buildMagicLinkUrl === 'function' || Boolean(options.path) || Boolean(options.baseUrl);
    const customMagicLinkUrl = typeof options.buildMagicLinkUrl === 'function'
      ? options.buildMagicLinkUrl(rawToken)
      : hasCustomUrl
        ? `${baseUrl}${cleanPath}${sep}token=${encodeURIComponent(rawToken)}`
        : null;

    const defaultMagicLinkUrl = `${baseUrl}${cleanPath}${sep}token=${encodeURIComponent(rawToken)}`;

    if (typeof this.notifications.magicLink === 'function') {
      await this.notifications.magicLink(user, {
        token: rawToken,
        expiresAt,
        magicLinkUrl: customMagicLinkUrl,
        expiresMinutes: Math.round(tokenTtlMs / 60000),
      });
    }

    this.emit('magicLink:requested', { userId: user.id, email: user.email, expiresAt });

    return {
      sent: true,
      userFound: true,
      expiresAt,
      token: rawToken,
      magicLinkUrl: customMagicLinkUrl || defaultMagicLinkUrl,
    };
  }

  /**
   * Verify magic link token and resolve user
   * @param {string} rawToken
   * @param {Object} [options]
   * @param {boolean} [options.markEmailVerified=true]
   * @param {boolean} [options.consumeAllForUser=true]
   * @returns {Promise<{ ok: true, user: Object, userId: * }>}
   */
  async verifyMagicLink(rawToken, options = {}) {
    if (!this.authTokens) {
      throw new Error('authTokens adapter is required for magic link authentication');
    }

    const verified = await verifyAuthToken(
      this.authTokens,
      TOKEN_TYPES.MAGIC_LINK,
      rawToken
    );
    if (!verified) {
      throw new AuthenticationError('Invalid or expired magic link', 'INVALID_MAGIC_LINK');
    }

    const user = await this.findUserById(verified.userId);
    if (!user) {
      throw new AuthenticationError('User not found for magic link', 'USER_NOT_FOUND');
    }

    await consumeAuthToken(this.authTokens, verified.tokenHash);

    if (options.consumeAllForUser !== false) {
      await this.authTokens.deleteAllForUser(verified.userId, TOKEN_TYPES.MAGIC_LINK);
    }

    // Auto mark email verified if user has not verified it yet
    if (options.markEmailVerified !== false && this.updateUser && this.verifiedField && !user[this.verifiedField]) {
      try {
        await this.updateUser(user.id, { [this.verifiedField]: new Date() });
        user[this.verifiedField] = new Date();
      } catch (e) {
        // Continue even if update fails
      }
    }

    this.emit('magicLink:verified', { userId: user.id });

    return { ok: true, user, userId: verified.userId };
  }

  /**
   * Send welcome notification if configured
   * @param {Object} user
   * @returns {Promise<void>}
   */
  async sendWelcomeNotification(user) {
    if (typeof this.notifications.welcome === 'function') {
      await this.notifications.welcome(user, {});
    }
  }

  /**
   * Create JWT token
   * @param {Object} payload
   * @param {Object} [options]
   * @returns {string} JWT string
   */
  createJwt(payload, options = {}) {
    const secret = options.secret || this.jwt?.secret || this.config.session?.secret || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT secret is missing');
    }
    const expiresIn = options.expiresIn || this.jwt?.expiresIn || '24h';
    return signJwt(payload, secret, { expiresIn, ...options });
  }

  /**
   * Verify JWT token
   * @param {string} token
   * @param {Object} [options]
   * @returns {Object} Decoded payload
   */
  verifyJwt(token, options = {}) {
    const secret = options.secret || this.jwt?.secret || this.config.session?.secret || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT secret is missing');
    }
    const payload = verifyJwt(token, secret, options);
    if (options.isAccess !== false && payload.type === 'refresh') {
      throw new Error('Refresh token cannot be used as an access token');
    }
    return payload;
  }

  /**
   * Generate JWT token for user
   * @param {Object} user
   * @param {Object} [options]
   * @returns {string} JWT string
   */
  generateUserToken(user, options = {}) {
    if (!user || !user.id) {
      throw new Error('User object with id is required');
    }
    const payload = {
      id: user.id,
      type: 'access',
      ...(this.identifierField && user[this.identifierField] ? { [this.identifierField]: user[this.identifierField] } : {}),
      ...(user.email && { email: user.email }),
      ...(user.role && { role: user.role }),
      ...options.payload,
    };
    return this.createJwt(payload, options);
  }

  /**
   * Generate JWT Refresh token for user
   * @param {Object} user
   * @param {Object} [options]
   * @returns {string} Refresh token string
   */
  generateRefreshToken(user, options = {}) {
    if (!user || !user.id) {
      throw new Error('User object with id is required');
    }
    const secret = options.secret || this.jwt?.refreshSecret || this.jwt?.secret || this.config.session?.secret || process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT refresh secret is missing');
    }
    const expiresIn = options.expiresIn || this.jwt?.refreshExpiresIn || '30d';
    const payload = {
      id: user.id,
      type: 'refresh',
      jti: generateToken(16),
      [this.identifierField]: user[this.identifierField],
      ...options.payload,
    };
    return signJwt(payload, secret, { expiresIn, ...options });
  }

  /**
   * Refresh access token using valid refresh token
   * @param {string} refreshToken
   * @param {Object} [options]
   * @returns {Promise<{ accessToken: string, refreshToken: string, user: Object }>}
   */
  async refreshAccessToken(refreshToken, options = {}) {
    const secret = options.secret || this.jwt?.refreshSecret || this.jwt?.secret || this.config.session?.secret || process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT refresh secret is missing');
    }

    const payload = verifyJwt(refreshToken, secret, options);
    if (payload.type !== 'refresh') {
      throw new AuthenticationError('Invalid refresh token type', 'INVALID_REFRESH_TOKEN');
    }

    const user = await this.findUserById(payload.id);
    if (!user) {
      throw new AuthenticationError('User not found for refresh token', 'USER_NOT_FOUND');
    }

    const accessToken = this.generateUserToken(user, options.accessOptions);
    const rotate = options.rotate ?? true;
    const newRefreshToken = rotate ? this.generateRefreshToken(user, options.refreshOptions) : refreshToken;

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user,
    };
  }

  /**
   * Get requireJwt guard middleware for Express routes
   * @param {Object} [options]
   * @returns {Function} Express middleware
   */
  requireJwt(options = {}) {
    if (!this._authMiddleware) {
      const { createAuthMiddleware } = require('./middleware');
      this._authMiddleware = createAuthMiddleware(this);
    }
    return this._authMiddleware.requireJwt(options);
  }

  /**
   * Get require2Fa guard middleware for Express routes
   * @param {Object} [options]
   * @returns {Function} Express middleware
   */
  require2Fa(options = {}) {
    if (!this._authMiddleware) {
      const { createAuthMiddleware } = require('./middleware');
      this._authMiddleware = createAuthMiddleware(this);
    }
    return this._authMiddleware.require2Fa(options);
  }

  /**
   * Track session for a request
   * @param {string} sessionId
   * @param {string|number} userId
   * @param {Object} req
   */
  async trackSession(sessionId, userId, req) {
    if (this.sessionManager) {
      return await this.sessionManager.track(sessionId, userId, req);
    }
    return null;
  }

  /**
   * Touch session to update activity timestamp
   * @param {string} sessionId
   */
  async touchSession(sessionId) {
    if (this.sessionManager) {
      return await this.sessionManager.touch(sessionId);
    }
    return false;
  }

  /**
   * List active sessions for user
   * @param {string|number} userId
   * @param {string} [currentSessionId]
   */
  async listSessions(userId, currentSessionId = null) {
    if (this.sessionManager) {
      return await this.sessionManager.listSessions(userId, currentSessionId);
    }
    return [];
  }

  /**
   * Check if session is valid in store
   * @param {string} sessionId
   * @param {string|number} [userId]
   */
  async isSessionValid(sessionId, userId = null) {
    if (this.sessionManager) {
      return await this.sessionManager.isSessionValid(sessionId, userId);
    }
    return true;
  }

  /**
   * Revoke a specific session
   * @param {string} sessionId
   * @param {Object} [options]
   */
  async revokeSession(sessionId, options = {}) {
    if (this.sessionManager) {
      return await this.sessionManager.revokeSession(sessionId, options);
    }
    return false;
  }

  /**
   * Revoke all other sessions for user
   * @param {string|number} userId
   * @param {string} currentSessionId
   */
  async revokeOtherSessions(userId, currentSessionId) {
    if (this.sessionManager) {
      return await this.sessionManager.revokeOtherSessions(userId, currentSessionId);
    }
    return 0;
  }

  /**
   * Revoke all sessions for user
   * @param {string|number} userId
   */
  async revokeAllSessions(userId) {
    if (this.sessionManager) {
      return await this.sessionManager.revokeAllSessions(userId);
    }
    return 0;
  }
}

module.exports = {
  AuthManager,
  AuthenticationError,
  DEFAULT_CONFIG,
};
