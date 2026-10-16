import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager, AuthenticationError } from '../../../core/auth/manager';
import { hashToken } from '../../../core/auth/hash';
import { signJwt } from '../../../core/auth/jwt';

describe('AuthManager Comprehensive Lifecycle Scenarios', () => {
  let usersDb;
  let tokensDb;
  let rememberTokensDb;
  let auth;
  let sentNotifications;

  beforeEach(() => {
    usersDb = new Map();
    tokensDb = new Map();
    rememberTokensDb = new Map();
    sentNotifications = [];

    // Seed test users
    usersDb.set(1, {
      id: 1,
      email: 'alice@example.com',
      password: 'hashed_secret_password',
      email_verified_at: null,
      role: 'user',
    });

    usersDb.set(2, {
      id: 2,
      email: 'bob@example.com',
      password: 'hashed_bob_password',
      email_verified_at: new Date(),
      role: 'admin',
    });

    auth = new AuthManager({
      session: { secret: 'test-session-secret-key-12345' },
      jwt: {
        secret: 'jwt-access-secret-12345',
        refreshSecret: 'jwt-refresh-secret-12345',
        expiresIn: '1h',
        refreshExpiresIn: '7d',
      },
      sessionTracking: true,
      findUserById: async (id) => usersDb.get(Number(id)) || null,
      findUserByCredentials: async (email, password) => {
        for (const user of usersDb.values()) {
          if (user.email === email && password === 'valid_pass') {
            return user;
          }
        }
        return null;
      },
      findUserByIdentifier: async (identifier) => {
        for (const user of usersDb.values()) {
          if (user.email === identifier) return user;
        }
        return null;
      },
      updateUser: async (id, data) => {
        const user = usersDb.get(Number(id));
        if (!user) throw new Error('User not found');
        Object.assign(user, data);
        return user;
      },
      rememberTokens: {
        create: async (userId, token, expiresAt) => {
          rememberTokensDb.set(token, { user_id: userId, token, expires_at: expiresAt });
        },
        find: async (token) => rememberTokensDb.get(token) || null,
        delete: async (token) => {
          rememberTokensDb.delete(token);
        },
        deleteAllForUser: async (userId) => {
          for (const [k, v] of rememberTokensDb.entries()) {
            if (v.user_id === userId) rememberTokensDb.delete(k);
          }
        },
      },
      authTokens: {
        create: async (userId, tokenHash, type, expiresAt) => {
          tokensDb.set(tokenHash, { user_id: userId, token: tokenHash, type, expires_at: expiresAt });
        },
        find: async (tokenHash, type) => {
          const item = tokensDb.get(tokenHash);
          if (!item) return null;
          if (type && item.type !== type) return null;
          return item;
        },
        delete: async (tokenHash) => {
          tokensDb.delete(tokenHash);
        },
        deleteAllForUser: async (userId, type) => {
          for (const [k, v] of tokensDb.entries()) {
            if (v.user_id === userId && (!type || v.type === type)) tokensDb.delete(k);
          }
        },
      },
      notifications: {
        passwordReset: async (user, { token, resetUrl, expiresAt }) => {
          sentNotifications.push({ type: 'passwordReset', user, token, resetUrl, expiresAt });
        },
        emailVerification: async (user, { token, verifyUrl, expiresAt }) => {
          sentNotifications.push({ type: 'emailVerification', user, token, verifyUrl, expiresAt });
        },
        magicLink: async (user, { token, magicLinkUrl, expiresAt }) => {
          sentNotifications.push({ type: 'magicLink', user, token, magicLinkUrl, expiresAt });
        },
        welcome: async (user) => {
          sentNotifications.push({ type: 'welcome', user });
        },
      },
    });
  });

  describe('Password Reset Lifecycle', () => {
    it('requests password reset for existing user and completes reset with new password', async () => {
      const requested = await auth.requestPasswordReset('alice@example.com', {
        baseUrl: 'https://mysite.com',
      });
      expect(requested.sent).toBe(true);
      expect(sentNotifications.length).toBe(1);
      expect(sentNotifications[0].type).toBe('passwordReset');
      expect(sentNotifications[0].user.email).toBe('alice@example.com');

      const rawToken = sentNotifications[0].token;
      expect(rawToken).toBeDefined();

      // Complete password reset
      const resetResult = await auth.completePasswordReset(rawToken, 'new_super_secret');
      expect(resetResult.ok).toBe(true);
      expect(usersDb.get(1).password).not.toBe('hashed_secret_password');

      // Verify token was deleted and cannot be reused
      await expect(
        auth.completePasswordReset(rawToken, 'another_secret')
      ).rejects.toThrow();
    });

    it('gracefully handles password reset request for non-existent email', async () => {
      const requested = await auth.requestPasswordReset('nobody@example.com');
      expect(requested.sent).toBe(false);
      expect(sentNotifications.length).toBe(0);
    });

    it('rejects password reset with invalid or expired token', async () => {
      await expect(
        auth.completePasswordReset('invalid_raw_token_xyz', 'newpass')
      ).rejects.toThrow();

      // Expired token
      const expiredRaw = 'expired_raw_token';
      const expiredHash = hashToken(expiredRaw);
      tokensDb.set(expiredHash, {
        user_id: 1,
        token: expiredHash,
        type: 'password_reset',
        expires_at: new Date(Date.now() - 10000),
      });

      await expect(
        auth.completePasswordReset(expiredRaw, 'newpass')
      ).rejects.toThrow(/expired/i);
    });
  });

  describe('Email Verification Lifecycle', () => {
    it('requests verification for unverified user and confirms verification', async () => {
      const sent = await auth.requestEmailVerification(1, { baseUrl: 'https://mysite.com' });
      expect(sent.sent).toBe(true);
      expect(sentNotifications.length).toBe(1);
      expect(sentNotifications[0].type).toBe('emailVerification');

      const rawToken = sentNotifications[0].token;
      const verified = await auth.verifyEmail(rawToken);
      expect(verified.ok).toBe(true);
      expect(verified.userId).toBe(1);
      expect(usersDb.get(1).email_verified_at).toBeInstanceOf(Date);
    });

    it('returns false when requesting verification for non-existent user', async () => {
      const nonExistent = await auth.requestEmailVerification(999);
      expect(nonExistent.sent).toBe(false);
    });

    it('rejects invalid or expired email verification tokens', async () => {
      await expect(auth.verifyEmail('bogus_token')).rejects.toThrow();

      const expiredRaw = 'expired_email_token';
      const expiredHash = hashToken(expiredRaw);
      tokensDb.set(expiredHash, {
        user_id: 1,
        token: expiredHash,
        type: 'email_verify',
        expires_at: new Date(Date.now() - 60000),
      });

      await expect(auth.verifyEmail(expiredRaw)).rejects.toThrow(/expired/i);
    });
  });

  describe('Magic Link Authentication', () => {
    it('generates magic link token and verifies login', async () => {
      const requested = await auth.requestMagicLink('alice@example.com', {
        baseUrl: 'https://mysite.com',
      });
      expect(requested.sent).toBe(true);
      expect(requested.userFound).toBe(true);
      expect(sentNotifications.length).toBe(1);
      expect(sentNotifications[0].type).toBe('magicLink');

      const rawToken = requested.token;
      const verifyResult = await auth.verifyMagicLink(rawToken);
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.user.id).toBe(1);
      expect(verifyResult.user.email).toBe('alice@example.com');

      // Attempting to reuse should fail
      await expect(auth.verifyMagicLink(rawToken)).rejects.toThrow();
    });

    it('returns userFound: false when magic link requested for unknown identifier', async () => {
      const requested = await auth.requestMagicLink('unknown@example.com');
      expect(requested.sent).toBe(true);
      expect(requested.userFound).toBe(false);
      expect(sentNotifications.length).toBe(0);
    });

    it('rejects expired magic link tokens', async () => {
      const expiredRaw = 'expired_magic_token';
      const expiredHash = hashToken(expiredRaw);
      tokensDb.set(expiredHash, {
        user_id: 1,
        token: expiredHash,
        type: 'magic_link',
        expires_at: new Date(Date.now() - 5000),
      });

      await expect(auth.verifyMagicLink(expiredRaw)).rejects.toThrow(/expired/i);
    });
  });

  describe('Session Management & Revocation', () => {
    it('tracks, touches, checks validity, and lists user sessions', async () => {
      const mockReq = {
        ip: '127.0.0.1',
        headers: { 'user-agent': 'Mozilla/5.0 Vitest' },
      };

      await auth.trackSession('sess_101', 1, mockReq);
      await auth.trackSession('sess_102', 1, mockReq);

      expect(await auth.isSessionValid('sess_101', 1)).toBe(true);
      expect(await auth.isSessionValid('sess_unknown', 1)).toBe(false);

      await auth.touchSession('sess_101');

      const sessions = await auth.listSessions(1, 'sess_101');
      expect(sessions.length).toBe(2);
      const current = sessions.find((s) => s.session_id === 'sess_101');
      expect(current.is_current).toBe(true);

      // Revoke other sessions
      await auth.revokeOtherSessions(1, 'sess_101');
      expect(await auth.isSessionValid('sess_102', 1)).toBe(false);
      expect(await auth.isSessionValid('sess_101', 1)).toBe(true);

      // Revoke all sessions
      await auth.revokeAllSessions(1);
      expect(await auth.isSessionValid('sess_101', 1)).toBe(false);
    });
  });

  describe('Remember Token & Cookie Lifecycle', () => {
    it('creates remember token and sets cookie on response', async () => {
      const cookiesSet = {};
      const mockRes = {
        cookie: (name, val, opts) => {
          cookiesSet[name] = { val, opts };
        },
        clearCookie: (name) => {
          delete cookiesSet[name];
        },
      };

      await auth.createRememberToken(1, mockRes);
      expect(cookiesSet['remember_token']).toBeDefined();
      const plainToken = cookiesSet['remember_token'].val;

      // Verify remember token with signed cookie
      const mockReq = {
        signedCookies: { remember_token: plainToken },
      };
      const user = await auth.verifyRememberToken(mockReq, mockRes);
      expect(user).toBeDefined();
      expect(user.id).toBe(1);

      // Verify missing cookie returns null
      expect(await auth.verifyRememberToken({ signedCookies: {} }, mockRes)).toBeNull();

      // Verify invalid cookie returns null and clears cookie
      const badReq = { signedCookies: { remember_token: 'bogus_token_123' } };
      expect(await auth.verifyRememberToken(badReq, mockRes)).toBeNull();
      expect(cookiesSet['remember_token']).toBeUndefined();
    });
  });

  describe('JWT Access & Refresh Token Lifecycle', () => {
    it('generates access & refresh tokens and refreshes expired access token', async () => {
      const user = usersDb.get(1);
      const token = auth.generateUserToken(user);
      const refreshToken = auth.generateRefreshToken(user);

      expect(typeof token).toBe('string');
      expect(typeof refreshToken).toBe('string');

      const refreshed = await auth.refreshAccessToken(refreshToken);
      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.user.id).toBe(1);

      // Invalid refresh token string
      await expect(auth.refreshAccessToken('invalid.jwt.token')).rejects.toThrow();

      // Token with wrong type (access token instead of refresh)
      const wrongTypeToken = signJwt({ id: 1, type: 'access' }, 'jwt-refresh-secret-12345');
      await expect(auth.refreshAccessToken(wrongTypeToken)).rejects.toThrow(
        AuthenticationError
      );

      // Refresh token for non-existent user
      const ghostUserToken = signJwt({ id: 9999, type: 'refresh' }, 'jwt-refresh-secret-12345');
      await expect(auth.refreshAccessToken(ghostUserToken)).rejects.toThrow(
        AuthenticationError
      );
    });
  });

  describe('Welcome Notification', () => {
    it('dispatches welcome notification to newly registered user', async () => {
      const user = usersDb.get(1);
      await auth.sendWelcomeNotification(user);
      expect(sentNotifications.some((n) => n.type === 'welcome')).toBe(true);

      // Without welcome notification configured
      const noNotifAuth = new AuthManager({
        findUserById: async () => null,
        findUserByCredentials: async () => null,
        session: { secret: 'secret' },
      });
      await expect(noNotifAuth.sendWelcomeNotification(user)).resolves.not.toThrow();
    });
  });

  describe('Request-bound auth helper (createRequestAuth)', () => {
    it('exercises login, logout, attempt, and magic link login helper bindings', async () => {
      let destroyed = false;
      let regenerated = false;
      const mockReq = {
        session: {
          user: null,
          regenerate: (cb) => {
            regenerated = true;
            cb(null);
          },
          destroy: (cb) => {
            destroyed = true;
            cb(null);
          },
        },
        cookies: {},
        ip: '127.0.0.1',
        headers: {},
      };
      const mockRes = {
        cookie: vi.fn(),
        clearCookie: vi.fn(),
      };

      const reqAuth = auth.createRequestAuth(mockReq, mockRes);
      expect(reqAuth.manager).toBe(auth);

      // Attempt login
      const attemptedUser = await reqAuth.attempt('alice@example.com', 'valid_pass');
      expect(attemptedUser).toBeDefined();
      expect(attemptedUser.id).toBe(1);

      // Attempt failed login
      const failedUser = await reqAuth.attempt('alice@example.com', 'wrong_pass');
      expect(failedUser).toBeNull();

      // Login helper
      await reqAuth.login(attemptedUser, { remember: true });
      expect(regenerated).toBe(true);

      // Logout helper
      await reqAuth.logout();
      expect(destroyed).toBe(true);
    });
  });
});
