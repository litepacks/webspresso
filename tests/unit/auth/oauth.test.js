import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  OAuthClient,
  OAuthError,
  createOAuthClient,
  generatePKCE,
  createSignedState,
  verifySignedState,
  DEFAULT_PROVIDERS,
} from '../../../core/auth/oauth';

describe('OAuth 2.0 Core Module', () => {
  const testSecret = 'oauth-test-secret-key-12345';

  describe('RFC 7636 PKCE Generation', () => {
    it('should generate valid PKCE codeVerifier and codeChallenge with S256 method', () => {
      const pkce = generatePKCE();

      expect(pkce.codeChallengeMethod).toBe('S256');
      expect(typeof pkce.codeVerifier).toBe('string');
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);

      // Verify that codeChallenge is the base64url SHA-256 of codeVerifier
      const expectedChallenge = crypto
        .createHash('sha256')
        .update(pkce.codeVerifier)
        .digest('base64url');

      expect(pkce.codeChallenge).toBe(expectedChallenge);
    });

    it('should generate distinct random values on consecutive calls', () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();

      expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
      expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);
    });
  });

  describe('Signed Anti-CSRF State Tokens', () => {
    it('should create and verify signed state token with embedded payload', () => {
      const payload = { returnTo: '/dashboard', customId: 42 };
      const stateToken = createSignedState(payload, testSecret);

      expect(typeof stateToken).toBe('string');
      expect(stateToken.split('.').length).toBe(2);

      const decoded = verifySignedState(stateToken, testSecret);
      expect(decoded.returnTo).toBe('/dashboard');
      expect(decoded.customId).toBe(42);
      expect(decoded.timestamp).toBeTypeOf('number');
      expect(decoded.nonce).toBeTypeOf('string');
    });

    it('should reject tampered signature', () => {
      const stateToken = createSignedState({ user: 'alice' }, testSecret);
      const [body, signature] = stateToken.split('.');
      const tampered = `${body}.${signature.slice(0, -2)}xx`;

      expect(() => verifySignedState(tampered, testSecret)).toThrow(OAuthError);
      expect(() => verifySignedState(tampered, testSecret)).toThrow(/signature verification failed/i);
    });

    it('should reject state signed with a different secret', () => {
      const stateToken = createSignedState({ user: 'alice' }, testSecret);

      expect(() => verifySignedState(stateToken, 'different-secret')).toThrow(OAuthError);
    });

    it('should reject expired state tokens', () => {
      const stateToken = createSignedState({ user: 'alice' }, testSecret);

      // Force TTL to be negative to simulate expiration
      expect(() => verifySignedState(stateToken, testSecret, -100)).toThrow(OAuthError);
      expect(() => verifySignedState(stateToken, testSecret, -100)).toThrow(/expired/i);
    });

    it('should reject malformed state tokens', () => {
      expect(() => verifySignedState('not-a-token', testSecret)).toThrow(OAuthError);
      expect(() => verifySignedState('', testSecret)).toThrow(OAuthError);
      expect(() => verifySignedState(null, testSecret)).toThrow(OAuthError);
    });
  });

  describe('OAuthClient', () => {
    let client;

    beforeEach(() => {
      client = createOAuthClient({
        secret: testSecret,
        providers: {
          google: {
            clientId: 'google-client-id-123',
            clientSecret: 'google-client-secret-456',
            redirectUri: 'https://example.com/auth/google/callback',
          },
          github: {
            clientId: 'github-client-id-789',
            clientSecret: 'github-client-secret-abc',
            redirectUri: 'https://example.com/auth/github/callback',
          },
        },
      });
    });

    it('should register and retrieve provider definitions', () => {
      expect(client.getProviderNames()).toEqual(['google', 'github']);

      const google = client.getProvider('google');
      expect(google.clientId).toBe('google-client-id-123');
      expect(google.clientSecret).toBe('google-client-secret-456');
      expect(google.authorizationUrl).toBe(DEFAULT_PROVIDERS.google.authorizationUrl);
    });

    it('should throw error when requesting unregistered provider', () => {
      expect(() => client.getProvider('unknown')).toThrow(OAuthError);
      expect(() => client.getProvider('unknown')).toThrow(/not registered/);
    });

    it('should throw error when provider is missing clientId or clientSecret', () => {
      const badClient = createOAuthClient({
        secret: testSecret,
        providers: {
          google: { clientId: 'only-id' }, // missing secret
        },
      });

      expect(() => badClient.getProvider('google')).toThrow(OAuthError);
      expect(() => badClient.getProvider('google')).toThrow(/requires clientId and clientSecret/);
    });

    describe('getAuthorizationUrl', () => {
      it('should generate Google authorization URL with PKCE and signed state', () => {
        const result = client.getAuthorizationUrl('google', {
          stateData: { returnTo: '/account' },
        });

        expect(result.url).toBeTypeOf('string');
        expect(result.state).toBeTypeOf('string');
        expect(result.codeVerifier).toBeTypeOf('string');

        const parsedUrl = new URL(result.url);
        expect(parsedUrl.origin + parsedUrl.pathname).toBe(DEFAULT_PROVIDERS.google.authorizationUrl);
        expect(parsedUrl.searchParams.get('client_id')).toBe('google-client-id-123');
        expect(parsedUrl.searchParams.get('redirect_uri')).toBe('https://example.com/auth/google/callback');
        expect(parsedUrl.searchParams.get('response_type')).toBe('code');
        expect(parsedUrl.searchParams.get('scope')).toContain('openid');
        expect(parsedUrl.searchParams.get('scope')).toContain('email');
        expect(parsedUrl.searchParams.get('access_type')).toBe('offline');
        expect(parsedUrl.searchParams.get('prompt')).toBe('consent');
        expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
        expect(parsedUrl.searchParams.get('code_challenge')).toBeTypeOf('string');

        // Verify signed state has returnTo and codeVerifier embedded
        const statePayload = verifySignedState(result.state, testSecret);
        expect(statePayload.provider).toBe('google');
        expect(statePayload.data.returnTo).toBe('/account');
        expect(statePayload.codeVerifier).toBe(result.codeVerifier);
      });

      it('should support disabling PKCE when explicitly configured', () => {
        const result = client.getAuthorizationUrl('github', { pkce: false });
        const parsedUrl = new URL(result.url);

        expect(result.codeVerifier).toBeUndefined();
        expect(parsedUrl.searchParams.has('code_challenge')).toBe(false);
      });

      it('should allow custom scope overrides and extra query parameters', () => {
        const result = client.getAuthorizationUrl('google', {
          scopes: ['openid', 'custom:scope'],
          extraParams: { hd: 'mycompany.com' },
        });

        const parsedUrl = new URL(result.url);
        expect(parsedUrl.searchParams.get('scope')).toBe('openid custom:scope');
        expect(parsedUrl.searchParams.get('hd')).toBe('mycompany.com');
      });
    });

    describe('exchangeCode and fetchUserProfile', () => {
      const originalFetch = global.fetch;

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should exchange authorization code for tokens', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            access_token: 'mock-access-token-123',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: 'mock-id-token',
          }),
        });

        const tokens = await client.exchangeCode('google', {
          code: 'valid-auth-code',
          redirectUri: 'https://example.com/auth/google/callback',
          codeVerifier: 'mock-code-verifier',
        });

        expect(tokens.access_token).toBe('mock-access-token-123');
        expect(global.fetch).toHaveBeenCalledTimes(1);

        const [fetchUrl, fetchOpts] = global.fetch.mock.calls[0];
        expect(fetchUrl).toBe(DEFAULT_PROVIDERS.google.tokenUrl);
        expect(fetchOpts.method).toBe('POST');
        expect(fetchOpts.body).toContain('code=valid-auth-code');
        expect(fetchOpts.body).toContain('code_verifier=mock-code-verifier');
        expect(fetchOpts.body).toContain('grant_type=authorization_code');
      });

      it('should throw OAuthError when token exchange returns error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Code has expired',
          }),
        });

        await expect(
          client.exchangeCode('google', {
            code: 'expired-code',
            redirectUri: 'https://example.com/auth/google/callback',
          })
        ).rejects.toThrow(/Code has expired/);
      });

      it('should fetch and normalize Google profile', async () => {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            sub: 'google-sub-999',
            name: 'Jane Doe',
            given_name: 'Jane',
            family_name: 'Doe',
            picture: 'https://lh3.googleusercontent.com/photo.jpg',
            email: 'jane@gmail.com',
            email_verified: true,
            locale: 'en',
          }),
        });

        const profile = await client.fetchUserProfile('google', {
          access_token: 'mock-token',
        });

        expect(profile.provider).toBe('google');
        expect(profile.id).toBe('google-sub-999');
        expect(profile.email).toBe('jane@gmail.com');
        expect(profile.emailVerified).toBe(true);
        expect(profile.name).toBe('Jane Doe');
        expect(profile.firstName).toBe('Jane');
        expect(profile.lastName).toBe('Doe');
        expect(profile.avatarUrl).toBe('https://lh3.googleusercontent.com/photo.jpg');
      });

      it('should fetch and normalize GitHub profile and fallback to emails endpoint', async () => {
        global.fetch = vi.fn()
          // First call: GitHub fetchExtra (/user/emails)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => [
              { email: 'secondary@github.com', primary: false, verified: true },
              { email: 'primary@github.com', primary: true, verified: true },
            ],
          })
          // Second call: GitHub userInfoUrl (/user)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              id: 1234567,
              login: 'octocat',
              name: 'The Octocat',
              email: null, // Private email in GitHub profile
              avatar_url: 'https://avatars.githubusercontent.com/u/1234567',
              bio: 'Open source lover',
              location: 'San Francisco',
            }),
          });

        const profile = await client.fetchUserProfile('github', {
          access_token: 'mock-gh-token',
        });

        expect(profile.provider).toBe('github');
        expect(profile.id).toBe('1234567');
        expect(profile.username).toBe('octocat');
        expect(profile.email).toBe('primary@github.com');
        expect(profile.emailVerified).toBe(true);
        expect(profile.name).toBe('The Octocat');
        expect(profile.avatarUrl).toBe('https://avatars.githubusercontent.com/u/1234567');
      });

      it('should handle full callback flow via handleCallback', async () => {
        // Step 1: create auth url
        const { state, codeVerifier } = client.getAuthorizationUrl('google', {
          stateData: { returnTo: '/welcome' },
        });

        // Step 2: mock token and profile responses
        global.fetch = vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ access_token: 'at-123' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              sub: 'g-101',
              email: 'test@example.com',
              name: 'Tester',
            }),
          });

        const result = await client.handleCallback('google', {
          code: 'oauth-code-456',
          state,
        });

        expect(result.provider).toBe('google');
        expect(result.user.id).toBe('g-101');
        expect(result.user.email).toBe('test@example.com');
        expect(result.tokens.access_token).toBe('at-123');
        expect(result.stateData.returnTo).toBe('/welcome');
      });

      it('should reject callback when state provider does not match', async () => {
        const { state } = client.getAuthorizationUrl('google');

        await expect(
          client.handleCallback('github', {
            code: 'any-code',
            state,
          })
        ).rejects.toThrow(/provider mismatch/i);
      });
    });
  });
});
