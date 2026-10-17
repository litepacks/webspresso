/**
 * Webspresso Zero-Dependency OAuth 2.0 & Social Login Engine
 * RFC 6749 (OAuth 2.0) + RFC 7636 (PKCE) + OpenID Connect Client
 * Zero external dependencies: powered strictly by native node:crypto and global fetch
 * @module core/auth/oauth
 */

const crypto = require('crypto');
const { fetchWithTimeout } = require('../utils/fetch');
const { safeCompare } = require('../utils/crypto');

/**
 * Custom error class for OAuth operations
 */
class OAuthError extends Error {
  constructor(message, code = 'OAUTH_ERROR', details = null) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Built-in standard OAuth2 providers configuration
 */
const DEFAULT_PROVIDERS = {
  google: {
    name: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    defaultScopes: ['openid', 'email', 'profile'],
    defaultParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
    normalizeProfile(raw) {
      return {
        provider: 'google',
        id: raw.sub || raw.id,
        email: raw.email || null,
        emailVerified: Boolean(raw.email_verified),
        name: raw.name || `${raw.given_name || ''} ${raw.family_name || ''}`.trim() || raw.email,
        firstName: raw.given_name || null,
        lastName: raw.family_name || null,
        avatarUrl: raw.picture || null,
        locale: raw.locale || null,
        raw,
      };
    },
  },

  github: {
    name: 'github',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userEmailsUrl: 'https://api.github.com/user/emails',
    defaultScopes: ['read:user', 'user:email'],
    defaultParams: {},
    async fetchExtra(tokens, options = {}) {
      try {
        const timeout = typeof options?.timeout === 'number' ? options.timeout : 10000;
        const res = await fetchWithTimeout('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Webspresso-OAuth',
          },
          timeout,
          signal: options?.signal,
        });
        if (res.ok) {
          const emails = await res.json();
          if (Array.isArray(emails)) {
            const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.primary) || emails[0];
            return {
              primaryEmail: primary ? primary.email : null,
              emailVerified: primary ? Boolean(primary.verified) : false,
              emails,
            };
          }
        }
      } catch {
        // Fallback gracefully if email endpoint is unreachable or times out
      }
      return null;
    },
    normalizeProfile(raw, extra) {
      const email = raw.email || extra?.primaryEmail || null;
      return {
        provider: 'github',
        id: String(raw.id),
        username: raw.login,
        email,
        emailVerified: Boolean(extra ? extra.emailVerified : raw.email),
        name: raw.name || raw.login,
        avatarUrl: raw.avatar_url || null,
        bio: raw.bio || null,
        location: raw.location || null,
        raw,
      };
    },
  },
};

/**
 * Generate PKCE code verifier and code challenge (RFC 7636)
 * @returns {{ codeVerifier: string, codeChallenge: string, codeChallengeMethod: 'S256' }}
 */
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Create an HMAC-signed state parameter with embedded payload (tamper-proof, anti-CSRF)
 * @param {Object} payload
 * @param {string} secret
 * @returns {string} Signed state token: `${base64urlPayload}.${signature}`
 */
function createSignedState(payload, secret) {
  if (!secret) {
    throw new OAuthError('State signing secret is required', 'MISSING_SECRET');
  }

  const dataWithMeta = {
    ...payload,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const body = Buffer.from(JSON.stringify(dataWithMeta), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

/**
 * Verify and decode an HMAC-signed state parameter
 * @param {string} stateString
 * @param {string} secret
 * @param {number} [maxAgeMs=600000] - 10 minutes default TTL
 * @returns {Object} Unpacked state payload
 */
function verifySignedState(stateString, secret, maxAgeMs = 10 * 60 * 1000) {
  if (!stateString || typeof stateString !== 'string') {
    throw new OAuthError('Invalid or missing OAuth state parameter', 'INVALID_STATE');
  }

  const parts = stateString.split('.');
  if (parts.length !== 2) {
    throw new OAuthError('Malformed OAuth state parameter', 'INVALID_STATE');
  }

  const [body, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  if (!safeCompare(signature, expectedSignature)) {
    throw new OAuthError('OAuth state signature verification failed', 'INVALID_STATE');
  }

  let payload;
  try {
    const jsonStr = Buffer.from(body, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    throw new OAuthError('Failed to parse OAuth state payload', 'INVALID_STATE');
  }

  if (typeof payload.timestamp === 'number' && Date.now() - payload.timestamp > maxAgeMs) {
    throw new OAuthError('OAuth state has expired. Please retry authorization.', 'EXPIRED_STATE');
  }

  return payload;
}

/**
 * OAuth 2.0 / OIDC Client Class
 */
class OAuthClient {
  /**
   * @param {Object} config
   * @param {string} config.secret - Secret key used for signing state tokens
   * @param {Record<string, Object>} config.providers - Provider configurations
   * @param {number} [config.stateTtlMs=600000] - State token TTL in ms
   */
  constructor(config = {}) {
    this.secret = config.secret || process.env.OAUTH_SECRET || process.env.SESSION_SECRET || 'webspresso-oauth-secret';
    this.stateTtlMs = config.stateTtlMs || 10 * 60 * 1000;
    this.timeout = typeof (config.timeout || config.requestTimeout) === 'number'
      ? (config.timeout || config.requestTimeout)
      : 10000;
    this.providers = {};

    if (config.providers) {
      for (const [key, pConfig] of Object.entries(config.providers)) {
        this.registerProvider(key, pConfig);
      }
    }
  }

  /**
   * Register or override an OAuth provider
   * @param {string} name
   * @param {Object} options
   */
  registerProvider(name, options = {}) {
    const builtin = DEFAULT_PROVIDERS[name] || {};
    this.providers[name] = {
      ...builtin,
      ...options,
      name,
      clientId: options.clientId || options.client_id,
      clientSecret: options.clientSecret || options.client_secret,
      redirectUri: options.redirectUri || options.redirect_uri || builtin.redirectUri,
      scopes: options.scopes || options.scope || builtin.defaultScopes || [],
      params: { ...(builtin.defaultParams || {}), ...(options.params || {}) },
      timeout: typeof options.timeout === 'number' ? options.timeout : (builtin.timeout || this.timeout || 10000),
    };
    return this;
  }

  /**
   * Get registered provider definition
   * @param {string} name
   * @returns {Object}
   */
  getProvider(name) {
    const provider = this.providers[name];
    if (!provider) {
      throw new OAuthError(`OAuth provider "${name}" is not registered`, 'UNKNOWN_PROVIDER');
    }
    if (!provider.clientId || !provider.clientSecret) {
      throw new OAuthError(`Provider "${name}" requires clientId and clientSecret`, 'CONFIG_ERROR');
    }
    return provider;
  }

  /**
   * Get list of registered provider names
   * @returns {string[]}
   */
  getProviderNames() {
    return Object.keys(this.providers);
  }

  /**
   * Build the authorization redirect URL for a provider
   * @param {string} providerName
   * @param {Object} [options]
   * @param {string} [options.redirectUri]
   * @param {string[]} [options.scopes]
   * @param {Object} [options.stateData] - Arbitrary user data saved in signed state (e.g. returnTo URL)
   * @param {boolean} [options.pkce=true] - Enable PKCE (Proof Key for Code Exchange)
   * @param {Object} [options.extraParams]
   * @returns {{ url: string, state: string, codeVerifier?: string }}
   */
  getAuthorizationUrl(providerName, options = {}) {
    const provider = this.getProvider(providerName);
    const redirectUri = options.redirectUri || provider.redirectUri;

    if (!redirectUri) {
      throw new OAuthError(`redirectUri is required for provider "${providerName}"`, 'MISSING_REDIRECT_URI');
    }

    const usePkce = options.pkce !== false;
    let pkce = null;
    if (usePkce) {
      pkce = generatePKCE();
    }

    const statePayload = {
      provider: providerName,
      data: options.stateData || {},
      codeVerifier: pkce ? pkce.codeVerifier : null,
      redirectUri,
    };

    const state = createSignedState(statePayload, this.secret);

    const scopes = options.scopes || provider.scopes || [];
    const scopeString = Array.isArray(scopes) ? scopes.join(' ') : scopes;

    const url = new URL(provider.authorizationUrl);
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    if (scopeString) {
      url.searchParams.set('scope', scopeString);
    }
    url.searchParams.set('state', state);

    if (pkce) {
      url.searchParams.set('code_challenge', pkce.codeChallenge);
      url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
    }

    // Append default and extra parameters
    const allParams = { ...provider.params, ...(options.extraParams || {}) };
    for (const [k, v] of Object.entries(allParams)) {
      if (v !== undefined && v !== null && !url.searchParams.has(k)) {
        url.searchParams.set(k, String(v));
      }
    }

    return {
      url: url.toString(),
      state,
      codeVerifier: pkce ? pkce.codeVerifier : undefined,
    };
  }

  /**
   * Exchange an authorization code for access and ID tokens
   * @param {string} providerName
   * @param {Object} params
   * @param {string} params.code
   * @param {string} params.redirectUri
   * @param {string} [params.codeVerifier]
   * @returns {Promise<Object>} Token response
   */
  async exchangeCode(providerName, { code, redirectUri, codeVerifier, timeout, signal } = {}) {
    const provider = this.getProvider(providerName);

    if (!code) {
      throw new OAuthError('Authorization code is required for token exchange', 'MISSING_CODE');
    }

    const rUri = redirectUri || provider.redirectUri;
    if (!rUri) {
      throw new OAuthError('redirectUri is required for token exchange', 'MISSING_REDIRECT_URI');
    }

    const bodyParams = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: rUri,
    });

    if (codeVerifier) {
      bodyParams.set('code_verifier', codeVerifier);
    }

    const requestTimeout = typeof timeout === 'number'
      ? timeout
      : (provider.timeout || this.timeout || 10000);

    let res;
    try {
      res = await fetchWithTimeout(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'Webspresso-OAuth',
        },
        body: bodyParams.toString(),
        timeout: requestTimeout,
        signal,
      });
    } catch (err) {
      throw new OAuthError(`Token exchange network request failed: ${err.message}`, 'NETWORK_ERROR', err);
    }

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        // Fallback for form-urlencoded responses
        const parsed = new URLSearchParams(text);
        data = Object.fromEntries(parsed.entries());
      }
    }

    if (!res.ok || data.error) {
      const msg = data.error_description || data.error || `HTTP ${res.status}`;
      throw new OAuthError(`OAuth token exchange failed: ${msg}`, 'TOKEN_EXCHANGE_FAILED', data);
    }

    return data;
  }

  /**
   * Fetch and normalize the user profile using the access token
   * @param {string} providerName
   * @param {Object} tokens - Tokens object returned from exchangeCode
   * @returns {Promise<Object>} Normalized user profile
   */
  async fetchUserProfile(providerName, tokens, options = {}) {
    const provider = this.getProvider(providerName);
    const accessToken = tokens.access_token || tokens.accessToken;

    if (!accessToken) {
      throw new OAuthError('Missing access_token for user profile retrieval', 'MISSING_TOKEN');
    }

    const requestTimeout = typeof options?.timeout === 'number'
      ? options.timeout
      : (provider.timeout || this.timeout || 10000);
    const signal = options?.signal;

    let extraData = null;
    if (typeof provider.fetchExtra === 'function') {
      extraData = await provider.fetchExtra(tokens, { timeout: requestTimeout, signal });
    }

    let res;
    try {
      res = await fetchWithTimeout(provider.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'Webspresso-OAuth',
        },
        timeout: requestTimeout,
        signal,
      });
    } catch (err) {
      throw new OAuthError(`User profile fetch failed: ${err.message}`, 'NETWORK_ERROR', err);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new OAuthError(`Failed to fetch user profile (HTTP ${res.status}): ${errText}`, 'USER_FETCH_FAILED');
    }

    const rawProfile = await res.json();
    if (typeof provider.normalizeProfile === 'function') {
      return provider.normalizeProfile(rawProfile, extraData);
    }

    return {
      provider: providerName,
      id: rawProfile.id || rawProfile.sub,
      email: rawProfile.email || null,
      name: rawProfile.name || null,
      raw: rawProfile,
    };
  }

  /**
   * Handle complete OAuth callback in a single call:
   * 1. Validates signed state
   * 2. Extracts codeVerifier (if PKCE)
   * 3. Exchanges code for tokens
   * 4. Fetches and normalizes user profile
   *
   * @param {string} providerName
   * @param {Object} params
   * @param {string} params.code - Authorization code from query
   * @param {string} params.state - State string from query
   * @param {string} [params.redirectUri] - Redirect URI
   * @returns {Promise<{ provider: string, user: Object, tokens: Object, stateData: Object }>}
   */
  async handleCallback(providerName, { code, state, redirectUri, timeout, signal } = {}) {
    if (!state) {
      throw new OAuthError('Missing OAuth state in callback', 'INVALID_STATE');
    }
    if (!code) {
      throw new OAuthError('Missing authorization code in callback', 'MISSING_CODE');
    }

    // Verify state token
    const statePayload = verifySignedState(state, this.secret, this.stateTtlMs);

    if (statePayload.provider && statePayload.provider !== providerName) {
      throw new OAuthError(
        `OAuth state provider mismatch (expected ${statePayload.provider}, got ${providerName})`,
        'PROVIDER_MISMATCH'
      );
    }

    const effectiveRedirectUri = redirectUri || statePayload.redirectUri;
    const codeVerifier = statePayload.codeVerifier;

    // Exchange code for tokens
    const tokens = await this.exchangeCode(providerName, {
      code,
      redirectUri: effectiveRedirectUri,
      codeVerifier,
      timeout,
      signal,
    });

    // Fetch normalized profile
    const user = await this.fetchUserProfile(providerName, tokens, {
      timeout,
      signal,
    });

    return {
      provider: providerName,
      user,
      tokens,
      stateData: statePayload.data || {},
    };
  }
}

/**
 * Factory to create an OAuthClient instance
 * @param {Object} config
 * @returns {OAuthClient}
 */
function createOAuthClient(config) {
  return new OAuthClient(config);
}

module.exports = {
  OAuthClient,
  OAuthError,
  createOAuthClient,
  generatePKCE,
  createSignedState,
  verifySignedState,
  DEFAULT_PROVIDERS,
};
