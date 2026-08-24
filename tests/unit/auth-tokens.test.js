const knexLib = require('knex');
const {
  TOKEN_TYPES,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
} = require('../../core/auth/tokens');

describe('Auth Tokens Module (core/auth/tokens)', () => {
  let knex;
  let adapter;

  beforeAll(async () => {
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await createAuthTokensTable(knex);
    // idempotent check
    await createAuthTokensTable(knex);
    adapter = createKnexAuthTokensAdapter(knex);
  });

  afterAll(async () => {
    await dropAuthTokensTable(knex);
    await knex.destroy();
  });

  it('should expose TOKEN_TYPES constants', () => {
    expect(TOKEN_TYPES.PASSWORD_RESET).toBe('password_reset');
    expect(TOKEN_TYPES.EMAIL_VERIFY).toBe('email_verify');
  });

  it('should create and verify valid auth token', async () => {
    const { rawToken, expiresAt } = await createAuthToken(
      adapter,
      TOKEN_TYPES.PASSWORD_RESET,
      101,
      60 * 1000 // 1 minute
    );

    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBeGreaterThan(10);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const result = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, rawToken);
    expect(result).not.toBeNull();
    expect(result.userId).toBe(101);
    expect(typeof result.tokenHash).toBe('string');
  });

  it('should return null when verifying null or non-existent token', async () => {
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, null)).toBeNull();
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, '')).toBeNull();
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 'non-existent-random-token')).toBeNull();
  });

  it('should reject and clean up expired tokens', async () => {
    const { rawToken } = await createAuthToken(
      adapter,
      TOKEN_TYPES.EMAIL_VERIFY,
      202,
      -1000 // Expired 1 second ago
    );

    const result = await verifyAuthToken(adapter, TOKEN_TYPES.EMAIL_VERIFY, rawToken);
    expect(result).toBeNull();

    // Verify it was deleted from db
    const secondCheck = await verifyAuthToken(adapter, TOKEN_TYPES.EMAIL_VERIFY, rawToken);
    expect(secondCheck).toBeNull();
  });

  it('should consume and delete token via consumeAuthToken', async () => {
    const { rawToken } = await createAuthToken(
      adapter,
      TOKEN_TYPES.PASSWORD_RESET,
      303,
      60 * 1000
    );

    const verified = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, rawToken);
    expect(verified).not.toBeNull();

    await consumeAuthToken(adapter, verified.tokenHash);

    const checkAgain = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, rawToken);
    expect(checkAgain).toBeNull();
  });

  it('should delete all existing tokens for a user when creating a new token of same type', async () => {
    const token1 = await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 404, 60 * 1000);
    const token2 = await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 404, 60 * 1000);

    // Old token should be deleted
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, token1.rawToken)).toBeNull();
    // New token should be valid
    expect(await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, token2.rawToken)).not.toBeNull();
  });

  it('adapter.deleteAllForUser without type should delete all types for user', async () => {
    await createAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, 505, 60 * 1000);
    await createAuthToken(adapter, TOKEN_TYPES.EMAIL_VERIFY, 505, 60 * 1000);

    await adapter.deleteAllForUser(505);

    const rows = await knex('auth_tokens').where({ user_id: 505 });
    expect(rows.length).toBe(0);
  });
});
