import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import nunjucks from 'nunjucks';
import { oauthPlugin } from '../../plugins/oauth';
import { verifySignedState } from '../../core/auth/oauth';

describe('OAuth Plugin Integration Tests', () => {
  let app;
  let plugin;
  const testSecret = 'oauth-plugin-test-secret-999';

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mock session middleware
    app.use(
      session({
        secret: 'session-secret',
        resave: false,
        saveUninitialized: true,
      })
    );

    // Mock req.auth
    app.use((req, res, next) => {
      req.auth = {
        user: null,
        login: vi.fn().mockImplementation(async (user) => {
          req.session.userId = user.id;
          req.user = user;
          req.auth.user = user;
        }),
        generateUserToken: vi.fn().mockReturnValue('mock-jwt-token-123'),
      };
      next();
    });
  });

  function setupPlugin(options = {}) {
    plugin = oauthPlugin({
      secret: testSecret,
      providers: {
        google: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUri: 'http://localhost/auth/google/callback',
        },
        github: {
          clientId: 'github-client-id',
          clientSecret: 'github-client-secret',
          redirectUri: 'http://localhost/auth/github/callback',
        },
      },
      ...options,
    });

    const mockCtx = {
      app,
      nunjucksEnv: nunjucks.configure({ autoescape: true }),
      middlewares: {},
      addHelper: vi.fn(),
      addRoute: (method, path, ...handlers) => {
        app[method.toLowerCase()](path, ...handlers);
      },
    };

    plugin.register(mockCtx);
    plugin.onRoutesReady(mockCtx);

    return { plugin, mockCtx };
  }

  describe('Route mounting & Initiation', () => {
    it('should redirect GET /auth/google to Google authorization URL with PKCE and state', async () => {
      setupPlugin();

      const res = await request(app)
        .get('/auth/google?returnTo=/dashboard')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location).toContain('client_id=google-client-id');
      expect(location).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fauth%2Fgoogle%2Fcallback');
      expect(location).toContain('response_type=code');
      expect(location).toContain('code_challenge_method=S256');

      // Verify signed state parameter
      const url = new URL(location);
      const state = url.searchParams.get('state');
      const statePayload = verifySignedState(state, testSecret);
      expect(statePayload.provider).toBe('google');
      expect(statePayload.data.returnTo).toBe('/dashboard');
      expect(statePayload.codeVerifier).toBeTypeOf('string');
    });

    it('should redirect GET /auth/github to GitHub authorization URL', async () => {
      setupPlugin();

      const res = await request(app)
        .get('/auth/github')
        .expect(302);

      expect(res.headers.location).toContain('https://github.com/login/oauth/authorize');
      expect(res.headers.location).toContain('client_id=github-client-id');
    });

    it('should return 404 for unconfigured provider', async () => {
      setupPlugin();

      await request(app)
        .get('/auth/twitter')
        .expect(404);
    });

    it('should support custom pathPrefix', async () => {
      setupPlugin({ pathPrefix: '/oauth2' });

      const res = await request(app)
        .get('/oauth2/google')
        .expect(302);

      expect(res.headers.location).toContain('accounts.google.com');
    });
  });

  describe('Callback flow & Dual Auth Integration', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should handle provider errors (e.g. user cancelled) and redirect to failure URL', async () => {
      setupPlugin({ failureRedirect: '/custom-login' });

      const res = await request(app)
        .get('/auth/google/callback?error=access_denied&error_description=The+user+denied+the+request')
        .expect(302);

      expect(res.headers.location).toContain('/custom-login');
      expect(res.headers.location).toContain('error=access_denied');
    });

    it('should call custom onError hook when error occurs', async () => {
      const onErrorMock = vi.fn().mockImplementation(({ res }) => {
        res.status(403).send('Custom Access Denied');
      });

      setupPlugin({ onError: onErrorMock });

      const res = await request(app)
        .get('/auth/google/callback?error=access_denied')
        .expect(403);

      expect(res.text).toBe('Custom Access Denied');
      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          error: expect.any(Error),
        })
      );
    });

    it('should execute full login flow: exchange code, fetch profile, auto-login, and redirect', async () => {
      const { plugin } = setupPlugin();

      // Generate a valid signed state
      const { state } = plugin.api.getAuthorizationUrl('google', {
        stateData: { returnTo: '/settings' },
      });

      // Mock token exchange and user profile fetch
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            access_token: 'fake-google-token',
            token_type: 'Bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: 'google-uid-888',
            email: 'user@example.com',
            name: 'Test Google User',
            picture: 'https://lh3.googleusercontent.com/avatar.jpg',
            email_verified: true,
          }),
        });

      const res = await request(app)
        .get(`/auth/google/callback?code=mock-code-123&state=${encodeURIComponent(state)}`)
        .expect(302);

      expect(res.headers.location).toBe('/settings');
    });

    it('should support findOrCreateUser and onSuccess hooks', async () => {
      const findOrCreateUserMock = vi.fn().mockResolvedValue({
        id: 99,
        email: 'db-user@example.com',
        role: 'member',
      });

      const onSuccessMock = vi.fn().mockImplementation(async ({ res, user }) => {
        res.redirect(`/welcome?user_id=${user.id}`);
      });

      const { plugin } = setupPlugin({
        findOrCreateUser: findOrCreateUserMock,
        onSuccess: onSuccessMock,
      });

      const { state } = plugin.api.getAuthorizationUrl('google');

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ access_token: 'fake-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: 'sub-777',
            email: 'test@example.com',
            name: 'User',
          }),
        });

      const res = await request(app)
        .get(`/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`)
        .expect(302);

      expect(findOrCreateUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          profile: expect.objectContaining({ id: 'sub-777' }),
        })
      );

      expect(onSuccessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          user: expect.objectContaining({ id: 99 }),
        })
      );

      expect(res.headers.location).toBe('/welcome?user_id=99');
    });

    it('should return JSON with JWT token when requested with format=json', async () => {
      const { plugin } = setupPlugin();
      const { state } = plugin.api.getAuthorizationUrl('google');

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ access_token: 'fake-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: 'sub-api',
            email: 'api@example.com',
            name: 'API User',
          }),
        });

      const res = await request(app)
        .get(`/auth/google/callback?code=code&state=${encodeURIComponent(state)}&format=json`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('google');
      expect(res.body.user.email).toBe('api@example.com');
      expect(res.body.token).toBe('mock-jwt-token-123');
    });
  });

  describe('Template Helper & Request Extensions', () => {
    it('should register Nunjucks helper fsy.oauthUrl', () => {
      const { mockCtx } = setupPlugin();

      expect(mockCtx.addHelper).toHaveBeenCalledWith('oauthUrl', expect.any(Function));

      const helperFn = mockCtx.addHelper.mock.calls.find((call) => call[0] === 'oauthUrl')[1];
      expect(helperFn('google')).toBe('/auth/google');
      expect(helperFn('google', { returnTo: '/profile' })).toBe('/auth/google?returnTo=%2Fprofile');
    });

    it('should attach req.oauth and helper methods to request', async () => {
      setupPlugin();

      let capturedReq;
      app.get('/test-oauth-req', (req, res) => {
        capturedReq = req;
        res.json({ ok: true });
      });

      await request(app).get('/test-oauth-req').expect(200);

      expect(capturedReq.oauth).toBeDefined();
      expect(typeof capturedReq.getOAuthAuthorizationUrl).toBe('function');
      expect(typeof capturedReq.handleOAuthCallback).toBe('function');
    });
  });
});
