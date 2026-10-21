import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await createAuthTokensTable(db);
    adapter = createKnexAuthTokensAdapter(db);
  });

  beforeEach(async () => {
    await db('auth_tokens').delete();
  });

  afterAll(async () => {
    if (db) {
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

  it('exercises deleteAllForUser with and without type filter', async () => {
    // Create multiple tokens for user 10 across different types
    await adapter.create(10, 'token_a', TOKEN_TYPES.PASSWORD_RESET, new Date(Date.now() + 60000));
    await adapter.create(10, 'token_b', TOKEN_TYPES.EMAIL_VERIFY, new Date(Date.now() + 60000));
    await adapter.create(20, 'token_c', TOKEN_TYPES.PASSWORD_RESET, new Date(Date.now() + 60000));

    // Delete only PASSWORD_RESET for user 10
    await adapter.deleteAllForUser(10, TOKEN_TYPES.PASSWORD_RESET);
    expect(await adapter.find('token_a', TOKEN_TYPES.PASSWORD_RESET)).toBeFalsy();
    expect(await adapter.find('token_b', TOKEN_TYPES.EMAIL_VERIFY)).toBeTruthy();
    expect(await adapter.find('token_c', TOKEN_TYPES.PASSWORD_RESET)).toBeTruthy();

    // Delete ALL tokens for user 10 regardless of type
    await adapter.create(10, 'token_d', TOKEN_TYPES.MAGIC_LINK, new Date(Date.now() + 60000));
    await adapter.deleteAllForUser(10);
    expect(await adapter.find('token_b', TOKEN_TYPES.EMAIL_VERIFY)).toBeFalsy();
    expect(await adapter.find('token_d', TOKEN_TYPES.MAGIC_LINK)).toBeFalsy();
  });

  it('handles token verification edge cases (empty, non-existent, expired, and consume)', async () => {
    // 1. Empty token
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, '')).toBeNull();
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, null)).toBeNull();

    // 2. Non-existent token
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 'nonexistent_token')).toBeNull();

    // 3. Expired token gets deleted on verify attempt
    const { rawToken } = await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 55, -1000);
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, rawToken)).toBeNull();

    // 4. Valid token and consume
    const valid = await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 77, 60000);
    const verified = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, valid.rawToken);
    expect(verified).toBeDefined();
    expect(verified.userId).toBe(77);

    const { consumeAuthToken } = require('../../../core/auth/tokens');
    await consumeAuthToken(adapter, verified.tokenHash);
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, valid.rawToken)).toBeNull();

    // 5. Purge expired fallback when adapter has no purgeExpired function
    expect(await purgeExpiredAuthTokens(null)).toBe(0);
    expect(await purgeExpiredAuthTokens({})).toBe(0);

    // 6. Idempotent table creation
    await createAuthTokensTable(db);
  });
});
