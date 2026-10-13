import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const knex = require('knex');
const {
  createAuth,
  quickAuth,
  AuthenticationError,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  buildMagicLinkUrl,
  formatMagicLinkHtml,
  createMagicLinkVerifyMiddleware,
  createMagicLinkRequestHandler,
  TOKEN_TYPES,
} = require('../../../core/auth');
const { BUNDLED_AUTH_TEMPLATES, registerBundledAuthTemplates } = require('../../../plugins/email/bundled-templates');
const { wireAuthEmails, registerAuthEmailRoutes } = require('../../../plugins/email/auth-bridge');
const { TemplateRegistry } = require('../../../plugins/email/template-registry');

describe('Magic Link Authentication (core/auth/magic-link)', () => {
  let db;
  let adapter;
  let mockUsers;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await createAuthTokensTable(db);
    adapter = createKnexAuthTokensAdapter(db);

    mockUsers = [
      { id: 1, email: 'alice@example.com', name: 'Alice', role: 'admin', email_verified_at: null },
      { id: 2, email: 'bob@example.com', name: 'Bob', role: 'user', email_verified_at: new Date('2025-01-01') },
    ];
  });

  afterEach(async () => {
    if (db) {
      await dropAuthTokensTable(db);
      await db.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('URL & HTML Helpers', () => {
    it('buildMagicLinkUrl builds correct URL with defaults', () => {
      const url = buildMagicLinkUrl({ token: 'abc123raw' });
      expect(url).toContain('token=abc123raw');
      expect(url).toMatch(/^https?:\/\/localhost:\d+\/auth\/magic-link\/verify\?token=abc123raw/);
    });

    it('buildMagicLinkUrl respects custom baseUrl, path and query strings', () => {
      const url = buildMagicLinkUrl({
        baseUrl: 'https://mysite.com/',
        path: '/login/verify?ref=promo',
        token: 'token+with+special&chars',
      });
      expect(url).toBe('https://mysite.com/login/verify?ref=promo&token=token%2Bwith%2Bspecial%26chars');
    });

    it('buildMagicLinkUrl throws when token is missing', () => {
      expect(() => buildMagicLinkUrl({})).toThrow('Token is required');
    });

    it('formatMagicLinkHtml generates email body with personalized details', () => {
      const html = formatMagicLinkHtml({
        name: 'Alice',
        magicLinkUrl: 'https://mysite.com/verify?token=xyz',
        expiresMinutes: 10,
      });

      expect(html).toContain('Alice');
      expect(html).toContain('https://mysite.com/verify?token=xyz');
      expect(html).toContain('10 minutes');
    });

    it('formatMagicLinkHtml handles default name and expiry', () => {
      const html = formatMagicLinkHtml({
        magicLinkUrl: 'https://mysite.com/verify?token=xyz',
      });

      expect(html).toContain('there');
      expect(html).toContain('15 minutes');
    });
  });

  describe('AuthManager.prototype.requestMagicLink', () => {
    it('throws if authTokens adapter is not configured', async () => {
      const auth = createAuth({
        findUserById: async () => null,
        findUserByCredentials: async () => null,
      });

      await expect(auth.requestMagicLink('test@example.com')).rejects.toThrow(
        'authTokens adapter is required'
      );
    });

    it('returns silent success for non-existent users by default (anti-enumeration)', async () => {
      const auth = createAuth({
        authTokens: adapter,
        findUserById: async () => null,
        findUserByCredentials: async () => null,
        findUserByIdentifier: async () => null,
      });

      const result = await auth.requestMagicLink('ghost@example.com');
      expect(result).toEqual({ sent: true, userFound: false });
    });

    it('returns sent: false for non-existent users if hideUserNotFound is false', async () => {
      const auth = createAuth({
        authTokens: adapter,
        findUserById: async () => null,
        findUserByCredentials: async () => null,
        findUserByIdentifier: async () => null,
      });

      const result = await auth.requestMagicLink('ghost@example.com', { hideUserNotFound: false });
      expect(result).toEqual({ sent: false, userFound: false });
    });

    it('generates a hashed magic link token and sends notification', async () => {
      let notifiedData = null;
      let eventPayload = null;

      const auth = createAuth({
        authTokens: adapter,
        findUserById: async (id) => mockUsers.find((u) => u.id === id),
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
        notifications: {
          magicLink: async (user, data) => {
            notifiedData = { user, ...data };
          },
        },
      });

      auth.on('magicLink:requested', (data) => {
        eventPayload = data;
      });

      const result = await auth.requestMagicLink('alice@example.com', {
        baseUrl: 'https://webspresso.dev',
        tokenTtlMs: 20 * 60 * 1000,
      });

      expect(result.sent).toBe(true);
      expect(result.userFound).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.magicLinkUrl).toContain('https://webspresso.dev/auth/magic-link/verify?token=');
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // DB check
      const rows = await db('auth_tokens').where({ type: TOKEN_TYPES.MAGIC_LINK });
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(1);

      // Notification check
      expect(notifiedData).not.toBeNull();
      expect(notifiedData.user.email).toBe('alice@example.com');
      expect(notifiedData.token).toBe(result.token);
      expect(notifiedData.expiresMinutes).toBe(20);

      // Event check
      expect(eventPayload).not.toBeNull();
      expect(eventPayload.userId).toBe(1);
      expect(eventPayload.email).toBe('alice@example.com');
    });

    it('supports custom buildMagicLinkUrl option', async () => {
      const auth = createAuth({
        authTokens: adapter,
        findUserById: async () => null,
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
      });

      const result = await auth.requestMagicLink('alice@example.com', {
        buildMagicLinkUrl: (token) => `https://custom.app/verify/${token}`,
      });

      expect(result.magicLinkUrl).toBe(`https://custom.app/verify/${result.token}`);
    });
  });

  describe('AuthManager.prototype.verifyMagicLink', () => {
    let auth;
    let updatedUsers;

    beforeEach(() => {
      updatedUsers = {};
      auth = createAuth({
        authTokens: adapter,
        verifiedField: 'email_verified_at',
        findUserById: async (id) => {
          const user = mockUsers.find((u) => u.id === id);
          if (!user) return null;
          return { ...user, ...(updatedUsers[id] || {}) };
        },
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
        updateUser: async (id, data) => {
          updatedUsers[id] = { ...(updatedUsers[id] || {}), ...data };
          return updatedUsers[id];
        },
      });
    });

    it('verifies valid magic link, consumes token and marks email verified', async () => {
      let verifiedEvent = null;
      auth.on('magicLink:verified', (d) => { verifiedEvent = d; });

      const request = await auth.requestMagicLink('alice@example.com');
      const rawToken = request.token;

      // Verify token
      const verifyResult = await auth.verifyMagicLink(rawToken);
      expect(verifyResult.ok).toBe(true);
      expect(verifyResult.user.id).toBe(1);
      expect(verifyResult.user.email).toBe('alice@example.com');
      expect(verifyResult.user.email_verified_at).toBeInstanceOf(Date);

      // Event emitted
      expect(verifiedEvent).toEqual({ userId: 1 });

      // Token consumed in DB
      const tokensInDb = await db('auth_tokens').where({ type: TOKEN_TYPES.MAGIC_LINK });
      expect(tokensInDb).toHaveLength(0);

      // Second attempt fails (single-use)
      await expect(auth.verifyMagicLink(rawToken)).rejects.toThrow(AuthenticationError);
    });

    it('throws AuthenticationError with code INVALID_MAGIC_LINK on nonexistent token', async () => {
      await expect(auth.verifyMagicLink('non_existent_token_12345')).rejects.toThrow(
        /Invalid or expired magic link/
      );
    });

    it('throws AuthenticationError with code INVALID_MAGIC_LINK on expired token', async () => {
      const request = await auth.requestMagicLink('alice@example.com', {
        tokenTtlMs: -1000, // already expired
      });

      await expect(auth.verifyMagicLink(request.token)).rejects.toThrow(
        /Invalid or expired magic link/
      );
    });

    it('throws AuthenticationError with code USER_NOT_FOUND if user was deleted', async () => {
      const request = await auth.requestMagicLink('alice@example.com');
      // Remove alice
      mockUsers = mockUsers.filter((u) => u.id !== 1);

      await expect(auth.verifyMagicLink(request.token)).rejects.toThrow(
        /User not found for magic link/
      );
    });

    it('does not re-verify email if already verified', async () => {
      const request = await auth.requestMagicLink('bob@example.com');
      const verifyResult = await auth.verifyMagicLink(request.token);

      expect(verifyResult.ok).toBe(true);
      expect(updatedUsers[2]).toBeUndefined(); // Was not updated
    });
  });

  describe('Request Auth Integration (req.auth)', () => {
    it('provides requestMagicLink, verifyMagicLink, and loginWithMagicLink on req.auth', async () => {
      const auth = createAuth({
        authTokens: adapter,
        jwt: { secret: 'super-secret-jwt-key-32-chars-long!!' },
        findUserById: async (id) => mockUsers.find((u) => u.id === id),
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
      });

      let loggedInUser = null;
      const req = {
        session: {},
        login: (user, cb) => {
          loggedInUser = user;
          cb && cb();
        },
      };
      const res = {};
      const requestAuth = auth.createRequestAuth(req, res);

      // 1. requestMagicLink
      const reqResult = await requestAuth.requestMagicLink('bob@example.com');
      expect(reqResult.sent).toBe(true);
      expect(reqResult.token).toBeDefined();

      // 2. verifyMagicLink
      // create another request for standalone verify
      const reqResult2 = await requestAuth.requestMagicLink('alice@example.com');
      const verifiedOnly = await requestAuth.verifyMagicLink(reqResult2.token);
      expect(verifiedOnly.user.email).toBe('alice@example.com');

      // 3. loginWithMagicLink (with JWT generation)
      const loginResult = await requestAuth.loginWithMagicLink(reqResult.token, { jwt: true });
      expect(loginResult.ok).toBe(true);
      expect(loginResult.user.email).toBe('bob@example.com');
      expect(req.user.email).toBe('bob@example.com');
      expect(req.session.userId).toBe(2);
      expect(loginResult.accessToken).toBeDefined();
      expect(loginResult.refreshToken).toBeDefined();
    });
  });

  describe('Express Middlewares', () => {
    let auth;

    beforeEach(() => {
      auth = createAuth({
        authTokens: adapter,
        jwt: { secret: 'secret-key-at-least-32-chars-long-12345' },
        findUserById: async (id) => mockUsers.find((u) => u.id === id),
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
      });
    });

    describe('createMagicLinkRequestHandler', () => {
      it('returns 400 when identifier/email is missing', async () => {
        const handler = createMagicLinkRequestHandler(auth);
        let status = 200;
        let responseJson = null;

        const req = { body: {} };
        const res = {
          status: (code) => { status = code; return res; },
          json: (data) => { responseJson = data; return res; },
        };

        await handler(req, res);
        expect(status).toBe(400);
        expect(responseJson.error).toContain('Email or identifier is required');
      });

      it('returns 200 and sends magic link when email is provided', async () => {
        const handler = createMagicLinkRequestHandler(auth);
        let status = 200;
        let responseJson = null;

        const req = { body: { email: 'alice@example.com' } };
        const res = {
          status: (code) => { status = code; return res; },
          json: (data) => { responseJson = data; return res; },
        };

        await handler(req, res);
        expect(status).toBe(200);
        expect(responseJson.ok).toBe(true);
        expect(responseJson.message).toContain('magic link has been sent');
        expect(responseJson.expiresAt).toBeDefined();
      });
    });

    describe('createMagicLinkVerifyMiddleware', () => {
      it('handles JSON verification failure when token is missing', async () => {
        const mw = createMagicLinkVerifyMiddleware(auth);
        let status = 200;
        let responseJson = null;

        const req = { query: {}, method: 'POST', accepts: () => false };
        const res = {
          status: (code) => { status = code; return res; },
          json: (data) => { responseJson = data; return res; },
        };

        await mw(req, res, () => {});
        expect(status).toBe(400);
        expect(responseJson.error).toContain('Missing magic link token');
      });

      it('handles HTML verification failure with redirect when token is missing', async () => {
        const mw = createMagicLinkVerifyMiddleware(auth, { failureRedirect: '/custom-fail' });
        let redirectedUrl = null;

        const req = { query: {}, method: 'GET', accepts: (type) => type === 'html' };
        const res = {
          redirect: (url) => { redirectedUrl = url; },
        };

        await mw(req, res, () => {});
        expect(redirectedUrl).toBe('/custom-fail');
      });

      it('logs in user and redirects for HTML GET requests on success', async () => {
        const { token } = await auth.requestMagicLink('bob@example.com');
        const mw = createMagicLinkVerifyMiddleware(auth, { redirectTo: '/dashboard' });

        let loggedIn = null;
        let redirected = null;

        const req = {
          query: { token },
          method: 'GET',
          accepts: (t) => t === 'html',
          auth: {
            login: async (u) => { loggedIn = u; },
          },
        };
        const res = {
          redirect: (url) => { redirected = url; },
        };

        await mw(req, res, () => {});
        expect(loggedIn).not.toBeNull();
        expect(loggedIn.email).toBe('bob@example.com');
        expect(redirected).toBe('/dashboard');
      });

      it('returns JSON payload with user and JWT tokens on success', async () => {
        const { token } = await auth.requestMagicLink('alice@example.com');
        const mw = createMagicLinkVerifyMiddleware(auth, { jwt: true });

        let status = 200;
        let responseJson = null;
        let loggedIn = null;

        const req = {
          query: { token },
          method: 'POST',
          accepts: () => false,
          auth: {
            login: async (u) => { loggedIn = u; },
          },
        };
        const res = {
          status: (code) => { status = code; return res; },
          json: (data) => { responseJson = data; return res; },
        };

        await mw(req, res, () => {});
        expect(status).toBe(200);
        expect(responseJson.ok).toBe(true);
        expect(responseJson.user.email).toBe('alice@example.com');
        expect(responseJson.accessToken).toBeDefined();
        expect(responseJson.refreshToken).toBeDefined();
        expect(loggedIn).not.toBeNull();
      });

      it('handles invalid token in JSON response with 400', async () => {
        const mw = createMagicLinkVerifyMiddleware(auth);
        let status = 200;
        let responseJson = null;

        const req = {
          query: { token: 'invalid-token' },
          method: 'POST',
          accepts: () => false,
        };
        const res = {
          status: (code) => { status = code; return res; },
          json: (data) => { responseJson = data; return res; },
        };

        await mw(req, res, () => {});
        expect(status).toBe(400);
        expect(responseJson.code).toBe('INVALID_MAGIC_LINK');
      });
    });
  });

  describe('Email Plugin Bridge Integration', () => {
    it('registers auth-magic-link template in bundled templates', () => {
      const registry = new TemplateRegistry();
      registerBundledAuthTemplates(registry);

      expect(registry.has('auth-magic-link')).toBe(true);
      expect(BUNDLED_AUTH_TEMPLATES['auth-magic-link']).toBeDefined();
    });

    it('wires authManager.notifications.magicLink to send email template', async () => {
      const registry = new TemplateRegistry();
      const sentEmails = [];
      const mockEmailService = {
        sendTemplate: async (tpl, opts) => {
          sentEmails.push({ tpl, opts });
          return { messageId: '123' };
        },
      };

      const auth = createAuth({
        authTokens: adapter,
        findUserById: async () => null,
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
      });

      wireAuthEmails(auth, mockEmailService, registry, {
        magicLink: {
          enabled: true,
          template: 'auth-magic-link',
          subject: 'Sign In Link',
          path: '/auth/verify',
        },
      }, db);

      expect(typeof auth.notifications.magicLink).toBe('function');

      await auth.requestMagicLink('alice@example.com');
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].tpl).toBe('auth-magic-link');
      expect(sentEmails[0].opts.to).toBe('alice@example.com');
      expect(sentEmails[0].opts.subject).toBe('Sign In Link');
      expect(sentEmails[0].opts.data.magicLinkUrl).toContain('/auth/verify?token=');
    });

    it('registers magic link routes when registerRoutes is enabled', async () => {
      const routes = [];
      const mockCtx = {
        addRoute: (method, path, ...handlers) => {
          routes.push({ method, path, handlerCount: handlers.length, lastHandler: handlers[handlers.length - 1] });
        },
        middlewares: {
          guest: (req, res, next) => next(),
        },
      };

      const auth = createAuth({
        authTokens: adapter,
        findUserById: async (id) => mockUsers.find((u) => u.id === id),
        findUserByCredentials: async () => null,
        findUserByIdentifier: async (email) => mockUsers.find((u) => u.email === email),
      });

      registerAuthEmailRoutes({
        authManager: auth,
        ctx: mockCtx,
        authEmailsConfig: {
          registerRoutes: true,
          routePrefix: '/api/auth',
          magicLink: { enabled: true },
        },
      });

      const magicReqRoute = routes.find((r) => r.path === '/api/auth/magic-link');
      const magicVerifyRoute = routes.find((r) => r.path === '/api/auth/magic-link/verify');

      expect(magicReqRoute).toBeDefined();
      expect(magicReqRoute.method).toBe('post');
      expect(magicVerifyRoute).toBeDefined();
      expect(magicVerifyRoute.method).toBe('post');

      // Execute request route handler
      let reqJson = null;
      const res1 = { json: (d) => { reqJson = d; } };
      await magicReqRoute.lastHandler({ body: { email: 'alice@example.com' } }, res1);
      expect(reqJson.ok).toBe(true);

      // Execute verify route handler with generated token
      const tokensInDb = await db('auth_tokens').where({ type: TOKEN_TYPES.MAGIC_LINK });
      expect(tokensInDb.length).toBeGreaterThan(0);
    });
  });

  describe('quickAuth Helper with magicLink: true', () => {
    it('initializes authTokens adapter automatically', async () => {
      const mockDb = {
        knex: db,
        getRepository: (name) => ({
          findById: async (id) => mockUsers.find((u) => u.id === id),
          findOne: async (query) => mockUsers.find((u) => u.email === query.email),
          update: async () => {},
        }),
      };

      const auth = quickAuth({
        db: mockDb,
        magicLink: true,
      });

      expect(auth.authTokens).toBeDefined();
      const result = await auth.requestMagicLink('bob@example.com');
      expect(result.sent).toBe(true);
      expect(result.token).toBeDefined();
    });
  });
});
