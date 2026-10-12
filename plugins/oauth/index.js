/**
 * OAuth 2.0 & Social Login Plugin for Webspresso
 * Zero external dependencies: powered by native node:crypto and global fetch
 * RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), signed anti-CSRF state tokens, and dual auth integration
 * @module plugins/oauth
 */

const { OAuthClient, OAuthError, createOAuthClient } = require('../../core/auth/oauth');

/**
 * Resolve effective redirect URI for a provider
 * Uses configured redirectUri or derives dynamically from request headers/host
 * 
 * @param {import('express').Request} req
 * @param {string} providerName
 * @param {Object} providerConfig
 * @param {string} pathPrefix
 * @returns {string}
 */
function resolveRedirectUri(req, providerName, providerConfig, pathPrefix) {
  if (providerConfig.redirectUri) {
    return providerConfig.redirectUri;
  }

  const proto = req.headers['x-forwarded-proto'] || (req.connection?.encrypted ? 'https' : req.protocol) || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const cleanPrefix = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`;
  return `${proto}://${host}${cleanPrefix}/${providerName}/callback`;
}

/**
 * Webspresso OAuth Plugin Factory
 * 
 * @param {Object} [options]
 * @param {OAuthClient} [options.client] - Optional pre-instantiated OAuthClient instance
 * @param {Record<string, Object>} [options.providers] - Provider configurations (google, github, etc.)
 * @param {string} [options.secret] - State token signing secret
 * @param {string} [options.pathPrefix='/auth'] - Base path prefix for OAuth routes
 * @param {boolean} [options.routes=true] - Mount automatic /:provider and /:provider/callback routes
 * @param {boolean} [options.pkce=true] - Enable RFC 7636 PKCE
 * @param {number} [options.stateTtlMs=600000] - State TTL in milliseconds (default 10 mins)
 * @param {string} [options.defaultReturnTo='/'] - Default redirect URL after successful login
 * @param {string} [options.failureRedirect='/login'] - Default redirect URL on failure
 * @param {Function} [options.findOrCreateUser] - (params: { provider, profile, tokens, stateData, req, res, db }) => Promise<User>
 * @param {Function} [options.onSuccess] - (params: { provider, user, profile, tokens, stateData, req, res, client }) => Promise<void|any>
 * @param {Function} [options.onError] - (params: { error, provider, req, res, client }) => Promise<void|any>
 * @param {Object} [options.db] - Optional Database instance
 * @returns {Object} Webspresso Plugin Definition
 */
function oauthPlugin(options = {}) {
  const {
    pathPrefix = '/auth',
    routes: mountRoutes = true,
    pkce = true,
    defaultReturnTo = '/',
    failureRedirect = '/login',
    stateTtlMs = 10 * 60 * 1000,
    providers = {},
    secret,
  } = options;

  const client = options.client || createOAuthClient({
    secret: secret || process.env.OAUTH_SECRET || process.env.SESSION_SECRET || 'webspresso-oauth-secret',
    stateTtlMs,
    providers,
  });

  /**
   * Handle OAuth failure response
   */
  async function handleFailure(err, providerName, req, res, next) {
    if (typeof options.onError === 'function') {
      try {
        const hookResult = await options.onError({
          error: err,
          provider: providerName,
          req,
          res,
          client,
        });
        if (res.headersSent || hookResult === false) {
          return;
        }
      } catch (hookErr) {
        console.error('[oauthPlugin] onError hook error:', hookErr);
      }
    }

    const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.query.format === 'json';
    if (acceptsJson) {
      return res.status(400).json({
        error: err.code || 'OAUTH_ERROR',
        message: err.message,
        details: err.details || null,
      });
    }

    const failureBase = options.failureRedirect || failureRedirect;
    const url = new URL(failureBase, 'http://localhost');
    url.searchParams.set('error', err.code || 'oauth_failed');
    url.searchParams.set('message', err.message);

    const redirectTarget = `${url.pathname}${url.search}`;
    return res.redirect(redirectTarget);
  }

  /**
   * Handle OAuth success response
   */
  async function handleSuccess(result, req, res, next) {
    const { provider, user: profile, tokens, stateData } = result;

    let appUser = null;
    const db = req.db || options.db;
    if (typeof options.findOrCreateUser === 'function') {
      appUser = await options.findOrCreateUser({
        provider,
        profile,
        tokens,
        stateData,
        req,
        res,
        db,
      });
    }

    const effectiveUser = appUser || profile;

    if (typeof options.onSuccess === 'function') {
      const hookResult = await options.onSuccess({
        provider,
        user: effectiveUser,
        profile,
        tokens,
        stateData,
        req,
        res,
        client,
      });

      if (res.headersSent || hookResult === false) {
        return;
      }
    }

    // Default Session / Dual-auth login integration
    if (effectiveUser) {
      req.user = effectiveUser;
      if (req.auth && typeof req.auth.login === 'function') {
        try {
          await req.auth.login(effectiveUser);
        } catch (authErr) {
          console.warn('[oauthPlugin] req.auth.login failed:', authErr.message);
        }
      }
    }

    // JSON response for API/mobile clients
    const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.query.format === 'json';
    if (acceptsJson) {
      let jwtToken = undefined;
      if (req.auth && typeof req.auth.generateUserToken === 'function' && effectiveUser) {
        try {
          jwtToken = req.auth.generateUserToken(effectiveUser);
        } catch {}
      }

      return res.json({
        success: true,
        provider,
        user: effectiveUser,
        token: jwtToken,
        tokens,
      });
    }

    const targetUrl = stateData?.returnTo || defaultReturnTo;
    return res.redirect(targetUrl);
  }

  return {
    name: 'oauth',
    version: '1.0.0',
    description: 'Zero-dependency OAuth 2.0 & Social Login plugin for Webspresso',

    api: {
      client,
      getProvider: (name) => client.getProvider(name),
      getProviderNames: () => client.getProviderNames(),
      getAuthorizationUrl: (provider, opts) => client.getAuthorizationUrl(provider, opts),
      exchangeCode: (provider, params) => client.exchangeCode(provider, params),
      fetchUserProfile: (provider, tokens) => client.fetchUserProfile(provider, tokens),
      handleCallback: (provider, params) => client.handleCallback(provider, params),
    },

    register(ctx) {
      // 1. Attach req.oauth and helper methods to every incoming request
      ctx.app.use((req, res, next) => {
        req.oauth = client;

        req.getOAuthAuthorizationUrl = (providerName, opts = {}) => {
          const providerConfig = client.getProvider(providerName);
          const redirectUri = opts.redirectUri || resolveRedirectUri(req, providerName, providerConfig, pathPrefix);
          return client.getAuthorizationUrl(providerName, {
            redirectUri,
            pkce,
            ...opts,
          });
        };

        req.handleOAuthCallback = (providerName, params = {}) => {
          const providerConfig = client.getProvider(providerName);
          const redirectUri = params.redirectUri || resolveRedirectUri(req, providerName, providerConfig, pathPrefix);
          return client.handleCallback(providerName, {
            redirectUri,
            ...params,
          });
        };

        next();
      });

      // 2. Register named route middleware: middleware: ['oauth']
      if (ctx.middlewares) {
        ctx.middlewares.oauth = (providerName) => async (req, res, next) => {
          req.oauthProvider = providerName;
          next();
        };
      }

      // 3. Register template helper: fsy.oauthUrl('google', { returnTo: '/profile' })
      ctx.addHelper('oauthUrl', (providerName, helperOpts = {}) => {
        const cleanPrefix = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`;
        const base = `${cleanPrefix}/${providerName}`;
        const params = new URLSearchParams();
        if (helperOpts.returnTo) params.set('returnTo', helperOpts.returnTo);
        if (helperOpts.scope) {
          params.set('scope', Array.isArray(helperOpts.scope) ? helperOpts.scope.join(' ') : helperOpts.scope);
        }
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
      });
    },

    onRoutesReady(ctx) {
      if (!mountRoutes) return;

      const cleanPrefix = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`;

      // Initiation Route: GET /auth/:provider
      ctx.addRoute('get', `${cleanPrefix}/:provider`, async (req, res, next) => {
        const providerName = req.params.provider;
        if (!client.getProviderNames().includes(providerName)) {
          return next();
        }

        try {
          const providerConfig = client.getProvider(providerName);
          const redirectUri = resolveRedirectUri(req, providerName, providerConfig, pathPrefix);

          const returnTo = req.query.returnTo || req.query.redirect || defaultReturnTo;
          const extraState = req.query.state ? { customState: req.query.state } : {};
          const stateData = {
            returnTo,
            ...extraState,
          };

          const scopes = req.query.scope ? req.query.scope.split(/[\s,]+/) : undefined;

          const { url } = client.getAuthorizationUrl(providerName, {
            redirectUri,
            scopes,
            stateData,
            pkce,
          });

          return res.redirect(url);
        } catch (err) {
          return handleFailure(err, providerName, req, res, next);
        }
      });

      // Callback Route: GET /auth/:provider/callback
      ctx.addRoute('get', `${cleanPrefix}/:provider/callback`, async (req, res, next) => {
        const providerName = req.params.provider;
        if (!client.getProviderNames().includes(providerName)) {
          return next();
        }

        // Provider reported error (e.g. user cancelled)
        if (req.query.error) {
          const errorMsg = req.query.error_description || req.query.error;
          const oauthErr = new OAuthError(
            `OAuth error from ${providerName}: ${errorMsg}`,
            req.query.error,
            req.query
          );
          return handleFailure(oauthErr, providerName, req, res, next);
        }

        const { code, state } = req.query;
        if (!code || !state) {
          const missingErr = new OAuthError(
            'Missing OAuth authorization code or state parameter',
            'INVALID_CALLBACK'
          );
          return handleFailure(missingErr, providerName, req, res, next);
        }

        try {
          const providerConfig = client.getProvider(providerName);
          const redirectUri = resolveRedirectUri(req, providerName, providerConfig, pathPrefix);

          const result = await client.handleCallback(providerName, {
            code,
            state,
            redirectUri,
          });

          return handleSuccess(result, req, res, next);
        } catch (err) {
          return handleFailure(err, providerName, req, res, next);
        }
      });
    },
  };
}

oauthPlugin.oauthPlugin = oauthPlugin;
oauthPlugin.OAuthClient = OAuthClient;
oauthPlugin.OAuthError = OAuthError;
oauthPlugin.createOAuthClient = createOAuthClient;

module.exports = oauthPlugin;
module.exports.oauthPlugin = oauthPlugin;
module.exports.OAuthClient = OAuthClient;
module.exports.OAuthError = OAuthError;
module.exports.createOAuthClient = createOAuthClient;
