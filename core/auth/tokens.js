/**
 * Auth token types and helpers (password reset, email verification)
 * @module core/auth/tokens
 */

const { generateToken, hashToken, hash } = require('./hash');

const TOKEN_TYPES = {
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFY: 'email_verify',
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
async function createAuthTokensTable(knex) {
  const exists = await knex.schema.hasTable('auth_tokens');
  if (exists) return;

  await knex.schema.createTable('auth_tokens', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('token', 64).notNullable().unique();
    table.string('type', 32).notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id', 'type']);
    table.index('token');
    table.index('expires_at');
  });
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
async function dropAuthTokensTable(knex) {
  await knex.schema.dropTableIfExists('auth_tokens');
}

/**
 * Create Knex auth_tokens adapter
 * @param {Object} db - Database with knex
 * @returns {Object}
 */
function createKnexAuthTokensAdapter(db) {
  const knex = db.knex || db;

  return {
    create: async (userId, tokenHash, type, expiresAt) => {
      await knex('auth_tokens').insert({
        user_id: userId,
        token: tokenHash,
        type,
        expires_at: expiresAt,
        created_at: new Date(),
      });
    },
    find: async (tokenHash, type) => {
      return knex('auth_tokens').where({ token: tokenHash, type }).first();
    },
    delete: async (tokenHash) => {
      await knex('auth_tokens').where({ token: tokenHash }).delete();
    },
    deleteAllForUser: async (userId, type) => {
      const q = knex('auth_tokens').where({ user_id: userId });
      if (type) q.where({ type });
      await q.delete();
    },
  };
}

/**
 * @param {Object} authTokensAdapter
 * @param {string} type
 * @param {*} userId
 * @param {number} ttlMs
 * @returns {Promise<{ rawToken: string, expiresAt: Date }>}
 */
async function createAuthToken(authTokensAdapter, type, userId, ttlMs) {
  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);

  await authTokensAdapter.deleteAllForUser(userId, type);
  await authTokensAdapter.create(userId, tokenHash, type, expiresAt);

  return { rawToken, expiresAt };
}

/**
 * @param {Object} authTokensAdapter
 * @param {string} type
 * @param {string} rawToken
 * @returns {Promise<{ userId: *, expiresAt: Date }|null>}
 */
async function verifyAuthToken(authTokensAdapter, type, rawToken) {
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const record = await authTokensAdapter.find(tokenHash, type);
  if (!record) return null;

  if (new Date(record.expires_at) < new Date()) {
    await authTokensAdapter.delete(tokenHash);
    return null;
  }

  return {
    userId: record.user_id,
    expiresAt: new Date(record.expires_at),
    tokenHash,
  };
}

/**
 * @param {Object} authTokensAdapter
 * @param {string} tokenHash
 */
async function consumeAuthToken(authTokensAdapter, tokenHash) {
  await authTokensAdapter.delete(tokenHash);
}

module.exports = {
  TOKEN_TYPES,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
  hash,
};
