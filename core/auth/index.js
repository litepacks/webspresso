/**
 * Webspresso Auth
 * Django/Rails-inspired authentication system with adapter pattern
 * @module core/auth
 */

const { AuthManager, AuthenticationError, DEFAULT_CONFIG } = require('./manager');
const { PolicyManager, AuthorizationError } = require('./policy');
const { authenticateRequest } = require('./authenticate');

let _middleware = null;
function getMiddleware() {
  if (!_middleware) {
    _middleware = require('./middleware');
  }
  return _middleware;
}
const {
  hash,
  verify,
  needsRehash,
  hashScrypt,
  verifyScrypt,
  DEFAULT_SCRYPT_OPTIONS,
  generateToken,
  hashToken,
} = require('./hash');
const { signJwt, verifyJwt, decodeJwt, clearJwtCache, HS256_HEADER_BASE64URL, MAX_PAYLOAD_SIZE } = require('./jwt');
const {
  TOKEN_TYPES,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
} = require('./tokens');
const {
  OAuthClient,
  OAuthError,
  createOAuthClient,
  generatePKCE,
  createSignedState,
  verifySignedState,
  DEFAULT_PROVIDERS,
} = require('./oauth');
const totp = require('./totp');
const {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateHotp,
  verifyHotp,
  generateTotp,
  verifyTotp,
  generateTotpUri,
  generateTotpQrSvg,
  generateTotpQrDataUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  createTotpSetup,
} = totp;
const {
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,
} = require('./qrcode');
const {
  buildMagicLinkUrl,
  formatMagicLinkHtml,
  createMagicLinkVerifyMiddleware,
  createMagicLinkRequestHandler,
} = require('./magic-link');
const {
  createUserSessionsTable,
  dropUserSessionsTable,
  createKnexSessionTracker,
  createMemorySessionTracker,
  createKvSessionTracker,
  createRedisSessionStore,
  createRedisSessionTracker,
  RedisSessionStore,
  MiniRedisClient,
  InMemoryRedisClient,
  createMiniRedisClient,
  getClientIp,
  parseUserAgent,
} = require('./sessions');
const {
  SessionManager,
  createListSessionsHandler,
  createRevokeSessionHandler,
} = require('./session-manager');

/**
 * Create authentication instance
 * @param {Object} config - Configuration
 * @param {Function} config.findUserById - (id) => Promise<User|null>
 * @param {Function} config.findUserByCredentials - (identifier, password) => Promise<User|null>
 * @param {Object} [config.rememberTokens] - Remember token adapter
 * @param {Object} [config.session] - Session configuration
 * @param {Object} [config.rememberMe] - Remember me configuration
 * @param {Object|boolean} [config.jwt] - JWT configuration
 * @param {Object} [config.routes] - Route configuration
 * @returns {AuthManager}
 */
function createAuth(config) {
  return new AuthManager(config);
}

/**
 * Quick auth setup helper for common patterns
 * @param {Object} options - Options
 * @param {Object} options.db - Database instance (with getRepository)
 * @param {string} [options.userModel='User'] - User model name
 * @param {string} [options.identifierField='email'] - Login identifier field
 * @param {string} [options.passwordField='password'] - Password field
 * @param {Object} [options.session] - Session config
 * @param {boolean} [options.rememberMe=true] - Enable remember me
 * @param {boolean} [options.authTokens=false] - Enable auth_tokens adapter (password reset / email verify)
 * @param {boolean} [options.magicLink=false] - Enable magic link / passwordless auth tokens adapter
 * @param {boolean} [options.sessionTracking=false] - Enable active session tracking & revocation
 * @param {Object|boolean} [options.jwt=false] - Enable JWT support or JWT config
 * @param {string} [options.verifiedField='email_verified_at'] - Verified timestamp column
 * @returns {AuthManager}
 */
function quickAuth(options) {
  const {
    db,
    userModel = 'User',
    identifierField = 'email',
    passwordField = 'password',
    session = {},
    rememberMe = true,
    authTokens: enableAuthTokens = false,
    magicLink = false,
    sessionTracking = false,
    jwt = false,
    verifiedField = 'email_verified_at',
  } = options;

  if (!db || typeof db.getRepository !== 'function') {
    throw new Error('db with getRepository is required');
  }

  const UserRepo = db.getRepository(userModel);

  const config = {
    findUserById: async (id) => {
      return await UserRepo.findById(id);
    },

    findUserByCredentials: async (identifier, password) => {
      const user = await UserRepo.findOne({ [identifierField]: identifier });
      if (user && await verify(password, user[passwordField])) {
        return user;
      }
      return null;
    },

    findUserByIdentifier: async (identifier) => {
      return await UserRepo.findOne({ [identifierField]: identifier });
    },

    updateUser: async (userId, data) => {
      return await UserRepo.update(userId, data);
    },

    identifierField,
    passwordField,
    verifiedField,
    jwt,

    session: {
      secret: process.env.SESSION_SECRET || session.secret,
      ...session,
    },
  };

  // Add remember tokens if enabled
  if (rememberMe) {
    config.rememberTokens = {
      create: async (userId, token, expiresAt) => {
        await db.knex('remember_tokens').insert({
          user_id: userId,
          token,
          expires_at: expiresAt,
          created_at: new Date(),
        });
      },
      find: async (token) => {
        return await db.knex('remember_tokens').where({ token }).first();
      },
      delete: async (token) => {
        await db.knex('remember_tokens').where({ token }).delete();
      },
      deleteAllForUser: async (userId) => {
        await db.knex('remember_tokens').where({ user_id: userId }).delete();
      },
    };
  }

  if (enableAuthTokens || magicLink) {
    config.authTokens = createKnexAuthTokensAdapter(db);
  }

  if (sessionTracking) {
    config.sessionTracking = true;
    config.sessionTracker = createKnexSessionTracker(db);
  }

  return createAuth(config);
}

/**
 * Migration helper for remember_tokens table
 * @param {Object} knex - Knex instance
 * @returns {Promise<void>}
 */
async function createRememberTokensTable(knex) {
  const exists = await knex.schema.hasTable('remember_tokens');
  
  if (!exists) {
    await knex.schema.createTable('remember_tokens', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('user_id').unsigned().notNullable();
      table.string('token', 64).notNullable().unique();
      table.timestamp('expires_at').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      table.index('user_id');
      table.index('token');
    });
  }
}

/**
 * Drop remember_tokens table
 * @param {Object} knex - Knex instance
 * @returns {Promise<void>}
 */
async function dropRememberTokensTable(knex) {
  await knex.schema.dropTableIfExists('remember_tokens');
}

module.exports = {
  // Factory functions
  createAuth,
  quickAuth,
  
  // Classes
  AuthManager,
  PolicyManager,
  Bouncer: require('./bouncer').Bouncer,
  createBouncer: require('./bouncer').createBouncer,
  createBouncerMiddleware: require('./bouncer').createBouncerMiddleware,

  // Policies & Authorization (AdonisJS Bouncer & Django Permissions-inspired)
  definePolicy: require('./policy').definePolicy,
  defineGate: require('./policy').defineGate,
  can: require('./policy').can,
  cannot: require('./policy').cannot,
  authorize: require('./policy').authorize,
  
  // Errors
  AuthenticationError,
  AuthorizationError,
  
  // Middleware & Authenticator
  authenticateRequest,
  createAuthMiddleware: (...args) => getMiddleware().createAuthMiddleware(...args),
  setupAuthMiddleware: (...args) => getMiddleware().setupAuthMiddleware(...args),
  
  // Hash utilities
  hash,
  verify,
  needsRehash,
  hashScrypt,
  verifyScrypt,
  DEFAULT_SCRYPT_OPTIONS,
  generateToken,
  hashToken,

  // JWT utilities
  signJwt,
  verifyJwt,
  decodeJwt,
  clearJwtCache,
  HS256_HEADER_BASE64URL,
  MAX_PAYLOAD_SIZE,
  
  // Migration helpers
  createRememberTokensTable,
  dropRememberTokensTable,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  TOKEN_TYPES,
  
  // OAuth 2.0 & Social Login
  OAuthClient,
  OAuthError,
  createOAuthClient,
  generatePKCE,
  createSignedState,
  verifySignedState,
  DEFAULT_PROVIDERS,

  // 2FA / TOTP (RFC 6238, RFC 4226, RFC 4648)
  totp,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateHotp,
  verifyHotp,
  generateTotp,
  verifyTotp,
  generateTotpUri,
  generateTotpQrSvg,
  generateTotpQrDataUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  createTotpSetup,
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,

  // Magic Link / Passwordless Authentication
  buildMagicLinkUrl,
  formatMagicLinkHtml,
  createMagicLinkVerifyMiddleware,
  createMagicLinkRequestHandler,
  magicLink: {
    buildMagicLinkUrl,
    formatMagicLinkHtml,
    createMagicLinkVerifyMiddleware,
    createMagicLinkRequestHandler,
  },

  // Active Devices & Session Management
  SessionManager,
  createUserSessionsTable,
  dropUserSessionsTable,
  createKnexSessionTracker,
  createMemorySessionTracker,
  createKvSessionTracker,
  createRedisSessionStore,
  createRedisSessionTracker,
  RedisSessionStore,
  MiniRedisClient,
  InMemoryRedisClient,
  createMiniRedisClient,
  getClientIp,
  parseUserAgent,
  createListSessionsHandler,
  createRevokeSessionHandler,
  sessions: {
    SessionManager,
    createUserSessionsTable,
    dropUserSessionsTable,
    createKnexSessionTracker,
    createMemorySessionTracker,
    createKvSessionTracker,
    createRedisSessionStore,
    createRedisSessionTracker,
    RedisSessionStore,
    MiniRedisClient,
    InMemoryRedisClient,
    createMiniRedisClient,
    getClientIp,
    parseUserAgent,
    createListSessionsHandler,
    createRevokeSessionHandler,
  },

  // Config
  DEFAULT_CONFIG,
};
