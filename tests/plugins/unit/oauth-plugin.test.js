/**
 * Unit tests for OAuth 2.0 Plugin Definition, Routes & Handlers
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import oauthPlugin, { OAuthClient, OAuthError, createOAuthClient } from '../../../plugins/oauth/index';

import { createMockSpyNext } from '../../utils';

describe('OAuth Plugin Definition & Utilities', () => {
  it('exports plugin factory and OAuthClient classes', () => {
    expect(typeof oauthPlugin).toBe('function');
    expect(OAuthClient).toBeDefined();
    expect(OAuthError).toBeDefined();
    expect(typeof createOAuthClient).toBe('function');
    expect(oauthPlugin.OAuthClient).toBe(OAuthClient);
    expect(oauthPlugin.createOAuthClient).toBe(createOAuthClient);
  });

  it('creates plugin with default metadata and API surface', () => {
    const plugin = oauthPlugin({
      providers: {
        github: {
          clientId: 'gh-id',
          clientSecret: 'gh-secret',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
        },
      },
    });

    expect(plugin.name).toBe('oauth');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.api).toBeDefined();
    expect(plugin.api.getProviderNames()).toContain('github');
    expect(typeof plugin.api.getAuthorizationUrl).toBe('function');
    expect(typeof plugin.api.exchangeCode).toBe('function');
    expect(typeof plugin.api.fetchUserProfile).toBe('function');
    expect(typeof plugin.api.handleCallback).toBe('function');
  });

  describe('Plugin register hook and helpers', () => {
    let mockApp;
    let mockMiddlewares;
    let registeredHelpers;
    let middlewareFn;

    beforeEach(() => {
      registeredHelpers = {};
      mockMiddlewares = {};
      mockApp = {
        use: vi.fn((fn) => {
          middlewareFn = fn;
        }),
      };
    });

    it('attaches req.oauth, req.getOAuthAuthorizationUrl and req.handleOAuthCallback', () => {
      const plugin = oauthPlugin({
        pathPrefix: '/oauth2',
        providers: {
          google: {
            clientId: 'g-id',
            clientSecret: 'g-secret',
            authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
          },
        },
      });

      plugin.register({
        app: mockApp,
        middlewares: mockMiddlewares,
        addHelper: (name, fn) => {
          registeredHelpers[name] = fn;
        },
      });

      expect(mockApp.use).toHaveBeenCalled();

      // Test middleware execution on mock request
      const req = {
        protocol: 'https',
        headers: { host: 'app.example.com' },
      };
      const res = {};
      const next = createMockSpyNext();

      middlewareFn(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.oauth).toBeDefined();
      expect(typeof req.getOAuthAuthorizationUrl).toBe('function');
      expect(typeof req.handleOAuthCallback).toBe('function');

      const authUrl = req.getOAuthAuthorizationUrl('google', { returnTo: '/dashboard' });
      expect(authUrl.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(authUrl.url).toContain(encodeURIComponent('https://app.example.com/oauth2/google/callback'));
    });

    it('registers route middleware and fsy.oauthUrl helper', () => {
      const plugin = oauthPlugin({
        pathPrefix: '/auth',
      });

      plugin.register({
        app: mockApp,
        middlewares: mockMiddlewares,
        addHelper: (name, fn) => {
          registeredHelpers[name] = fn;
        },
      });

      // Named middleware
      expect(typeof mockMiddlewares.oauth).toBe('function');
      const routeMw = mockMiddlewares.oauth('github');
      const req = {};
      const next = createMockSpyNext();
      routeMw(req, {}, next);
      expect(req.oauthProvider).toBe('github');
      expect(next).toHaveBeenCalled();

      // fsy.oauthUrl helper
      expect(typeof registeredHelpers.oauthUrl).toBe('function');
      expect(registeredHelpers.oauthUrl('github')).toBe('/auth/github');
      expect(registeredHelpers.oauthUrl('github', { returnTo: '/profile' })).toBe('/auth/github?returnTo=%2Fprofile');
      expect(registeredHelpers.oauthUrl('github', { scope: ['read:user', 'user:email'] })).toBe(
        '/auth/github?scope=read%3Auser+user%3Aemail'
      );
    });
  });

  describe('OAuth Route Handlers in onRoutesReady', () => {
    let routes;
    let ctx;

    beforeEach(() => {
      routes = {};
      ctx = {
        addRoute: (method, path, handler) => {
          routes[`${method.toUpperCase()} ${path}`] = handler;
        },
      };
    });

    it('skips mounting routes when routes option is false', () => {
      const plugin = oauthPlugin({ routes: false });
      plugin.onRoutesReady(ctx);
      expect(Object.keys(routes)).toHaveLength(0);
    });

    it('mounts GET /auth/:provider and GET /auth/:provider/callback', () => {
      const plugin = oauthPlugin({
        pathPrefix: '/auth',
        providers: {
          mock: {
            clientId: 'id',
            clientSecret: 'sec',
            authorizationUrl: 'https://mock.com/auth',
            tokenUrl: 'https://mock.com/token',
          },
        },
      });

      plugin.onRoutesReady(ctx);
      expect(routes['GET /auth/:provider']).toBeDefined();
      expect(routes['GET /auth/:provider/callback']).toBeDefined();
    });

    it('initiation route passes through unknown providers via next()', async () => {
      const plugin = oauthPlugin({ providers: {} });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider'];
      const req = { params: { provider: 'unknown' } };
      const next = createMockSpyNext();

      await handler(req, {}, next);
      expect(next).toHaveBeenCalled();
    });

    it('initiation route generates auth URL and redirects', async () => {
      const plugin = oauthPlugin({
        pathPrefix: '/auth',
        providers: {
          testprov: {
            clientId: 'test-client',
            clientSecret: 'test-secret',
            authorizationUrl: 'https://provider.test/oauth/authorize',
            tokenUrl: 'https://provider.test/oauth/token',
          },
        },
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider'];
      const req = {
        params: { provider: 'testprov' },
        query: { returnTo: '/members', scope: 'profile,email' },
        protocol: 'https',
        headers: { host: 'mytest.com' },
      };
      let redirectedUrl = null;
      const res = {
        redirect: (url) => {
          redirectedUrl = url;
        },
      };
      const next = createMockSpyNext();

      await handler(req, res, next);
      expect(redirectedUrl).toContain('https://provider.test/oauth/authorize');
      expect(redirectedUrl).toContain('client_id=test-client');
      expect(redirectedUrl).toContain(encodeURIComponent('https://mytest.com/auth/testprov/callback'));
    });

    it('callback route passes through unknown providers via next()', async () => {
      const plugin = oauthPlugin({ providers: {} });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const req = { params: { provider: 'unknown' } };
      const next = createMockSpyNext();

      await handler(req, {}, next);
      expect(next).toHaveBeenCalled();
    });

    it('callback route handles provider error query parameter', async () => {
      const plugin = oauthPlugin({
        failureRedirect: '/auth/failed',
        providers: {
          testprov: {
            clientId: 'cid',
            clientSecret: 'csec',
            authorizationUrl: 'https://test.com/auth',
            tokenUrl: 'https://test.com/token',
          },
        },
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const req = {
        params: { provider: 'testprov' },
        query: { error: 'access_denied', error_description: 'User cancelled consent' },
        headers: {},
      };
      let redirected = null;
      const res = {
        redirect: (target) => {
          redirected = target;
        },
      };

      await handler(req, res, vi.fn());
      expect(redirected).toContain('/auth/failed?');
      expect(redirected).toContain('error=access_denied');
      expect(redirected).toContain('User+cancelled+consent');
    });

    it('callback route returns 400 JSON on error if JSON requested', async () => {
      const plugin = oauthPlugin({
        providers: {
          testprov: {
            clientId: 'cid',
            clientSecret: 'csec',
            authorizationUrl: 'https://test.com/auth',
            tokenUrl: 'https://test.com/token',
          },
        },
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const req = {
        params: { provider: 'testprov' },
        query: { error: 'server_error', format: 'json' },
        headers: {},
      };
      const statusMock = vi.fn().mockReturnThis();
      const jsonMock = vi.fn();
      const res = { status: statusMock, json: jsonMock };

      await handler(req, res, vi.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'server_error',
        })
      );
    });

    it('callback route rejects missing code or state parameter', async () => {
      const plugin = oauthPlugin({
        failureRedirect: '/login',
        providers: {
          testprov: {
            clientId: 'cid',
            clientSecret: 'csec',
            authorizationUrl: 'https://test.com/auth',
            tokenUrl: 'https://test.com/token',
          },
        },
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const req = {
        params: { provider: 'testprov' },
        query: { code: '12345' }, // Missing state
        headers: {},
      };
      let redirected = null;
      const res = {
        redirect: (target) => {
          redirected = target;
        },
      };

      await handler(req, res, vi.fn());
      expect(redirected).toContain('error=INVALID_CALLBACK');
    });

    it('callback route handles success with findOrCreateUser and dual auth session/JWT', async () => {
      const mockClient = {
        getProviderNames: () => ['testprov'],
        getProvider: () => ({ redirectUri: 'https://app.com/cb' }),
        handleCallback: vi.fn().mockResolvedValue({
          provider: 'testprov',
          user: { id: 'ext-99', name: 'Alice' },
          tokens: { accessToken: 'tok-abc' },
          stateData: { returnTo: '/welcome' },
        }),
      };

      const findOrCreateUser = vi.fn().mockResolvedValue({
        id: 1,
        email: 'alice@test.com',
        role: 'user',
      });

      const onSuccess = vi.fn();

      const plugin = oauthPlugin({
        client: mockClient,
        findOrCreateUser,
        onSuccess,
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const authLogin = vi.fn().mockResolvedValue(true);
      const authGenToken = vi.fn().mockReturnValue('mock-jwt-token');

      const req = {
        params: { provider: 'testprov' },
        query: { code: 'valid-code', state: 'valid-state', format: 'json' },
        headers: {},
        auth: {
          login: authLogin,
          generateUserToken: authGenToken,
        },
      };

      let jsonResponse = null;
      const res = {
        json: (val) => {
          jsonResponse = val;
        },
        headersSent: false,
      };

      await handler(req, res, vi.fn());

      expect(mockClient.handleCallback).toHaveBeenCalled();
      expect(findOrCreateUser).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
      expect(authLogin).toHaveBeenCalledWith(expect.objectContaining({ email: 'alice@test.com' }));
      expect(authGenToken).toHaveBeenCalledWith(expect.objectContaining({ email: 'alice@test.com' }));
      expect(jsonResponse).toEqual({
        success: true,
        provider: 'testprov',
        user: expect.objectContaining({ email: 'alice@test.com' }),
        token: 'mock-jwt-token',
        tokens: { accessToken: 'tok-abc' },
      });
    });

    it('callback route redirects to returnTo on HTML success flow', async () => {
      const mockClient = {
        getProviderNames: () => ['testprov'],
        getProvider: () => ({ redirectUri: 'https://app.com/cb' }),
        handleCallback: vi.fn().mockResolvedValue({
          provider: 'testprov',
          user: { id: 'ext-100', name: 'Bob' },
          tokens: { accessToken: 'tok-xyz' },
          stateData: { returnTo: '/dashboard/overview' },
        }),
      };

      const plugin = oauthPlugin({ client: mockClient });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const req = {
        params: { provider: 'testprov' },
        query: { code: 'code1', state: 'state1' },
        headers: { accept: 'text/html' },
      };

      let redirectedTo = null;
      const res = {
        redirect: (target) => {
          redirectedTo = target;
        },
        headersSent: false,
      };

      await handler(req, res, vi.fn());
      expect(redirectedTo).toBe('/dashboard/overview');
    });

    it('refuses off-site returnTo targets (open redirect) unless the origin is allowed', async () => {
      const runCallback = async (returnTo, pluginOptions = {}) => {
        const mockClient = {
          getProviderNames: () => ['testprov'],
          getProvider: () => ({ redirectUri: 'https://app.com/cb' }),
          handleCallback: vi.fn().mockResolvedValue({
            provider: 'testprov',
            user: { id: 'ext-1' },
            tokens: {},
            stateData: { returnTo },
          }),
        };
        const plugin = oauthPlugin({ client: mockClient, defaultReturnTo: '/home', ...pluginOptions });
        plugin.onRoutesReady(ctx);
        let redirectedTo = null;
        await routes['GET /auth/:provider/callback'](
          { params: { provider: 'testprov' }, query: { code: 'c', state: 's' }, headers: { accept: 'text/html' } },
          { redirect: (t) => { redirectedTo = t; }, headersSent: false },
          vi.fn()
        );
        return redirectedTo;
      };

      for (const evil of ['https://evil.example/phish', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
        expect(await runCallback(evil), evil).toBe('/home');
      }
      expect(await runCallback('/account?tab=1')).toBe('/account?tab=1');
      expect(await runCallback('https://app.example.com/after', { allowedRedirectOrigins: ['https://app.example.com'] }))
        .toBe('https://app.example.com/after');
    });

    it('handles onError hook custom interception', async () => {
      const onError = vi.fn().mockImplementation(async ({ res }) => {
        res.status(418).json({ custom: 'handled' });
        return false; // Stop default handling
      });

      const plugin = oauthPlugin({
        onError,
        providers: {
          testprov: {
            clientId: 'id',
            clientSecret: 'secret',
            authorizeUrl: 'https://mock.com/auth',
            tokenUrl: 'https://mock.com/token',
          },
        },
      });
      plugin.onRoutesReady(ctx);

      const handler = routes['GET /auth/:provider/callback'];
      const statusMock = vi.fn().mockReturnThis();
      const jsonMock = vi.fn();
      const res = {
        status: statusMock,
        json: jsonMock,
        headersSent: true,
      };

      const req = {
        params: { provider: 'testprov' },
        query: { error: 'unauthorized_client' },
        headers: {},
      };

      await handler(req, res, vi.fn());
      expect(onError).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(418);
    });
  });
});
