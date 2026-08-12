/**
 * Webspresso Auth
 * Django/Rails-inspired authentication system with adapter pattern
 * @module core/auth
 */

const { AuthManager, AuthenticationError, DEFAULT_CONFIG } = require('./manager');
const { PolicyManager, AuthorizationError } = require('./policy');
const { createAuthMiddleware, setupAuthMiddleware } = require('./middleware');
const { hash, verify, needsRehash, generateToken, hashToken } = require('./hash');
const { signJwt, verifyJwt, decodeJwt } = require('./jwt');
const {
  TOKEN_TYPES,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
} = require('./tokens');

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

  if (enableAuthTokens) {
    config.authTokens = createKnexAuthTokensAdapter(db);
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
  
  // Errors
  AuthenticationError,
  AuthorizationError,
  
  // Middleware
  createAuthMiddleware,
  setupAuthMiddleware,
  
  // Hash utilities
  hash,
  verify,
  needsRehash,
  generateToken,
  hashToken,

  // JWT utilities
  signJwt,
  verifyJwt,
  decodeJwt,
  
  // Migration helpers
  createRememberTokensTable,
  dropRememberTokensTable,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  TOKEN_TYPES,
  
  // Config
  DEFAULT_CONFIG,
};
