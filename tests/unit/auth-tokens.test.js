/**
 * Auth token flows unit tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAuth, verify, createAuthTokensTable } from '../../core/auth/index.js';
import { hashToken } from '../../core/auth/hash.js';

describe('AuthManager password reset / email verify', () => {
  let auth;
  let users;
  let tokens;
  let notifications;

  beforeEach(() => {
    users = new Map([
      [1, { id: 1, email: 'user@test.com', password: '', name: 'User', email_verified_at: null }],
    ]);
    tokens = new Map();

    notifications = {
      passwordReset: [],
      emailVerification: [],
    };

    auth = createAuth({
      findUserById: async (id) => users.get(id) || null,
      findUserByCredentials: async () => null,
      findUserByIdentifier: async (identifier) => {
        for (const u of users.values()) {
          if (u.email === identifier) return u;
        }
        return null;
      },
      updateUser: async (userId, data) => {
        const user = users.get(userId);
        if (!user) return null;
        Object.assign(user, data);
        return user;
      },
      session: { secret: 'test-secret-key-32chars-minimum!!' },
      authTokens: {
        create: async (userId, tokenHash, type, expiresAt) => {
          tokens.set(tokenHash, { user_id: userId, token: tokenHash, type, expires_at: expiresAt });
        },
        find: async (tokenHash, type) => {
          const row = tokens.get(tokenHash);
          if (!row || row.type !== type) return null;
          return row;
        },
        delete: async (tokenHash) => {
          tokens.delete(tokenHash);
        },
        deleteAllForUser: async (userId, type) => {
          for (const [k, v] of tokens.entries()) {
            if (v.user_id === userId && (!type || v.type === type)) tokens.delete(k);
          }
        },
      },
      notifications: {
        passwordReset: async (user, payload) => {
          notifications.passwordReset.push({ user, payload });
        },
        emailVerification: async (user, payload) => {
          notifications.emailVerification.push({ user, payload });
        },
      },
    });
  });

  it('requestPasswordReset does not enumerate missing users', async () => {
    const result = await auth.requestPasswordReset('missing@test.com');
    expect(result.sent).toBe(false);
    expect(notifications.passwordReset).toHaveLength(0);
  });

  it('requestPasswordReset creates token and notifies', async () => {
    const result = await auth.requestPasswordReset('user@test.com');
    expect(result.sent).toBe(true);
    expect(notifications.passwordReset).toHaveLength(1);
    expect(notifications.passwordReset[0].payload.token).toBeTruthy();
  });

  it('completePasswordReset updates password and consumes token', async () => {
    await auth.requestPasswordReset('user@test.com');
    const rawToken = notifications.passwordReset[0].payload.token;

    await auth.completePasswordReset(rawToken, 'new-password-123');
    const user = users.get(1);
    expect(await verify('new-password-123', user.password)).toBe(true);
    expect(tokens.size).toBe(0);
  });

  it('completePasswordReset rejects invalid token', async () => {
    await expect(auth.completePasswordReset('bad-token', 'x')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('verifyEmail sets verified field', async () => {
    let rawToken;
    auth.notifications.emailVerification = async (user, payload) => {
      rawToken = payload.token;
    };

    await auth.requestEmailVerification(1);
    expect(rawToken).toBeTruthy();

    const result = await auth.verifyEmail(rawToken);
    expect(result.ok).toBe(true);
    expect(users.get(1).email_verified_at).toBeTruthy();
  });
});

describe('createAuthTokensTable integration', () => {
  it('works with knex sqlite', async () => {
    const { default: knexFactory } = await import('knex');
    const knex = knexFactory({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await createAuthTokensTable(knex);
    await knex('auth_tokens').insert({
      user_id: 1,
      token: hashToken('abc'),
      type: 'password_reset',
      expires_at: new Date(Date.now() + 3600000),
      created_at: new Date(),
    });

    const row = await knex('auth_tokens').first();
    expect(row.type).toBe('password_reset');
    await knex.destroy();
  });
});
