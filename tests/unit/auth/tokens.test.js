import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const knex = require('knex');
const {
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  createAuthToken,
  verifyAuthToken,
  purgeExpiredAuthTokens,
  TOKEN_TYPES,
} = require('../../../core/auth/tokens');

describe('Auth Tokens Module (core/auth/tokens)', () => {
  let db;
  let adapter;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await createAuthTokensTable(db);
    adapter = createKnexAuthTokensAdapter(db);
  });

  afterEach(async () => {
    if (db) {
      await dropAuthTokensTable(db);
      await db.destroy();
    }
  });

  it('creates and verifies auth tokens', async () => {
    const { rawToken, expiresAt } = await createAuthToken(
      adapter,
      TOKEN_TYPES.PASSWORD_RESET,
      42,
      60000
    );

    expect(rawToken).toBeDefined();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verified = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, rawToken);
    expect(verified).toBeTruthy();
    expect(verified.userId).toBe(42);
  });

  it('purges expired auth tokens while retaining active ones', async () => {
    // 1. Create active token
    await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 1, 60000);

    // 2. Create expired token directly in DB
    const expiredDate = new Date(Date.now() - 10000);
    await adapter.create(2, 'expired_hash_1', TOKEN_TYPES.PASSWORD_RESET, expiredDate);
    await adapter.create(3, 'expired_hash_2', TOKEN_TYPES.EMAIL_VERIFY, expiredDate);

    const initialRows = await db('auth_tokens').select('*');
    expect(initialRows).toHaveLength(3);

    // 3. Purge
    const deletedCount = await purgeExpiredAuthTokens(adapter);
    expect(deletedCount).toBe(2);

    const remainingRows = await db('auth_tokens').select('*');
    expect(remainingRows).toHaveLength(1);
    expect(remainingRows[0].user_id).toBe(1);
  });
});
