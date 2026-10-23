import { describe, it, expect, beforeEach } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateHotp,
  verifyHotp,
  generateTotp,
  verifyTotp,
  generateTotpUri,
  generateTotpQrSvg,
  generateTotpQrDataUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  createTotpSetup,
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,
  createAuth,
  createAuthMiddleware,
} from '../../../index';

import { createMockNext } from '../../utils';

describe('Zero-Dependency Two-Factor Authentication (2FA / TOTP)', () => {
  describe('RFC 4648 Base32 Encoding & Decoding', () => {
    // Official test vectors from RFC 4648 Section 10
    const rfc4648Vectors = [
      { text: '', base32: '' },
      { text: 'f', base32: 'MY======' },
      { text: 'fo', base32: 'MZXQ====' },
      { text: 'foo', base32: 'MZXW6===' },
      { text: 'foob', base32: 'MZXW6YQ=' },
      { text: 'fooba', base32: 'MZXW6YTB' },
      { text: 'foobar', base32: 'MZXW6YTBOI======' },
    ];

    it('matches official RFC 4648 test vectors with padding', () => {
      for (const vector of rfc4648Vectors) {
        const encoded = base32Encode(vector.text, { padding: true });
        expect(encoded).toBe(vector.base32);
        const decoded = base32Decode(vector.base32).toString('utf8');
        expect(decoded).toBe(vector.text);
      }
    });

    it('encodes without padding by default for authenticator apps', () => {
      expect(base32Encode('f')).toBe('MY');
      expect(base32Encode('foobar')).toBe('MZXW6YTBOI');
      expect(base32Decode('MY').toString('utf8')).toBe('f');
      expect(base32Decode('MZXW6YTBOI').toString('utf8')).toBe('foobar');
    });

    it('tolerates lowercase, spaces, and hyphens in base32Decode', () => {
      const decoded = base32Decode('mzxw6-ytboi').toString('utf8');
      expect(decoded).toBe('foobar');

      const withSpaces = base32Decode('MZXW 6YTB OI==').toString('utf8');
      expect(withSpaces).toBe('foobar');
    });

    it('throws TypeError for non-string input to base32Decode', () => {
      expect(() => base32Decode(123)).toThrow(TypeError);
    });

    it('throws Error for invalid Base32 characters', () => {
      expect(() => base32Decode('MZXW8')).toThrow(/Invalid Base32 character/);
      expect(() => base32Decode('MZXW1')).toThrow(/Invalid Base32 character/);
      expect(() => base32Decode('MZXW0')).toThrow(/Invalid Base32 character/);
    });
  });

  describe('RFC 4226 HOTP (HMAC-Based One-Time Password)', () => {
    // Official test vectors from RFC 4226 Appendix D
    const secret = '12345678901234567890'; // ASCII key (20 bytes)
    const hotpVectors = [
      { counter: 0, token: '755224' },
      { counter: 1, token: '287082' },
      { counter: 2, token: '359152' },
      { counter: 3, token: '969429' },
      { counter: 4, token: '338314' },
      { counter: 5, token: '254676' },
      { counter: 6, token: '287922' },
      { counter: 7, token: '162583' },
      { counter: 8, token: '399871' },
      { counter: 9, token: '520489' },
    ];

    it('matches official RFC 4226 test vectors for counters 0 through 9', () => {
      for (const vector of hotpVectors) {
        const token = generateHotp(secret, vector.counter, {
          encoding: 'ascii',
          digits: 6,
        });
        expect(token).toBe(vector.token);
        expect(verifyHotp(token, secret, vector.counter, { encoding: 'ascii' })).toBe(true);
      }
    });

    it('rejects wrong token or wrong counter', () => {
      expect(verifyHotp('000000', secret, 0, { encoding: 'ascii' })).toBe(false);
      expect(verifyHotp('755224', secret, 1, { encoding: 'ascii' })).toBe(false);
      expect(verifyHotp(null, secret, 0)).toBe(false);
    });
  });

  describe('RFC 6238 TOTP (Time-Based One-Time Password)', () => {
    // Official test vectors from RFC 6238 Appendix B
    const keySha1 = '12345678901234567890';
    const keySha256 = '12345678901234567890123456789012';
    const keySha512 = '1234567890123456789012345678901234567890123456789012345678901234';

    const rfc6238Vectors = [
      { t: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
      { t: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
      { t: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
      { t: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
      { t: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
      { t: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
    ];

    it('matches official RFC 6238 test vectors across SHA1, SHA256, SHA512', () => {
      for (const vector of rfc6238Vectors) {
        const s1 = generateTotp(keySha1, {
          time: vector.t,
          digits: 8,
          algorithm: 'sha1',
          encoding: 'ascii',
        });
        const s256 = generateTotp(keySha256, {
          time: vector.t,
          digits: 8,
          algorithm: 'sha256',
          encoding: 'ascii',
        });
        const s512 = generateTotp(keySha512, {
          time: vector.t,
          digits: 8,
          algorithm: 'sha512',
          encoding: 'ascii',
        });

        expect(s1).toBe(vector.sha1);
        expect(s256).toBe(vector.sha256);
        expect(s512).toBe(vector.sha512);

        expect(
          verifyTotp(s1, keySha1, {
            time: vector.t,
            digits: 8,
            algorithm: 'sha1',
            encoding: 'ascii',
          })
        ).toBe(true);
      }
    });

    it('generates 6-digit TOTP tokens by default using Base32 secret', () => {
      const secret = generateTotpSecret();
      expect(secret).toHaveLength(32); // 20 bytes = 32 base32 characters

      const token = generateTotp(secret);
      expect(token).toMatch(/^\d{6}$/);

      expect(verifyTotp(token, secret)).toBe(true);
      expect(verifyTotp('000000', secret)).toBe(false);
    });

    it('supports time-drift window tolerance and detailed delta feedback', () => {
      const secret = generateTotpSecret();
      const now = 1700000000; // arbitrary fixed epoch second

      // Tokens from 30 seconds ago (delta = -1) and 30 seconds in future (delta = +1)
      const pastToken = generateTotp(secret, { time: now - 30 });
      const currentToken = generateTotp(secret, { time: now });
      const futureToken = generateTotp(secret, { time: now + 30 });
      const distantToken = generateTotp(secret, { time: now + 90 }); // delta = +3

      // Window = 1 allows -1, 0, +1
      expect(verifyTotp(pastToken, secret, { time: now, window: 1 })).toBe(true);
      expect(verifyTotp(currentToken, secret, { time: now, window: 1 })).toBe(true);
      expect(verifyTotp(futureToken, secret, { time: now, window: 1 })).toBe(true);
      expect(verifyTotp(distantToken, secret, { time: now, window: 1 })).toBe(false);

      // Window = 0 allows only exact time step
      expect(verifyTotp(pastToken, secret, { time: now, window: 0 })).toBe(false);
      expect(verifyTotp(currentToken, secret, { time: now, window: 0 })).toBe(true);

      // Detailed mode returns delta
      const resPast = verifyTotp(pastToken, secret, { time: now, window: 1, detailed: true });
      expect(resPast).toEqual({ valid: true, delta: -1 });

      const resCurrent = verifyTotp(currentToken, secret, { time: now, window: 1, detailed: true });
      expect(resCurrent).toEqual({ valid: true, delta: 0 });

      const resInvalid = verifyTotp('999999', secret, { time: now, window: 1, detailed: true });
      expect(resInvalid).toEqual({ valid: false, delta: null });
    });
  });

  describe('URI Generation & QR Code SVG', () => {
    it('generates standard otpauth:// URI for authenticator apps', () => {
      const uri = generateTotpUri({
        secret: 'JBSWY3DPEHPK3PXP',
        account: 'user@example.com',
        issuer: 'Acme Corp',
      });

      expect(uri).toBe(
        'otpauth://totp/Acme%20Corp%3Auser%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme+Corp'
      );
    });

    it('generates custom parameters in URI when specified', () => {
      const uri = generateTotpUri({
        secret: 'JBSWY3DPEHPK3PXP',
        account: 'alice',
        issuer: 'MyApp',
        algorithm: 'SHA256',
        digits: 8,
        period: 60,
      });

      expect(uri).toContain('algorithm=SHA256');
      expect(uri).toContain('digits=8');
      expect(uri).toContain('period=60');
    });

    it('generates zero-dependency SVG QR code and data URI', () => {
      const uri = generateTotpUri({
        secret: 'JBSWY3DPEHPK3PXP',
        account: 'alice@webspresso.dev',
        issuer: 'Webspresso',
      });

      const svg = generateTotpQrSvg(uri, { size: 200, margin: 4 });
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0');
      expect(svg).toContain('width="200" height="200"');
      expect(svg).toContain('<path d="M');

      const dataUri = generateTotpQrDataUri(uri);
      expect(dataUri.startsWith('data:image/svg+xml;utf8,')).toBe(true);

      const matrixResult = createQrMatrix(uri);
      expect(matrixResult.size).toBeGreaterThanOrEqual(21);
      expect(matrixResult.matrix).toBeInstanceOf(Array);
      expect(typeof matrixResult.matrix[0][0]).toBe('boolean');
    });
  });

  describe('Backup & Recovery Codes', () => {
    it('generates random formatted recovery codes and hashes them', () => {
      const codes = generateRecoveryCodes({ count: 8, length: 10, hyphen: true });
      expect(codes).toHaveLength(8);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
      }

      const hashed = codes.map(hashRecoveryCode);
      expect(hashed).toHaveLength(8);
      for (const h of hashed) {
        expect(h).toMatch(/^[0-9a-f]{64}$/); // SHA-256
      }
    });

    it('verifies recovery code and burns it from list upon use', () => {
      const codes = generateRecoveryCodes({ count: 5 });
      const hashedCodes = codes.map(hashRecoveryCode);

      const codeToUse = codes[2];
      // Case and hyphen insensitivity check
      const input = codeToUse.toUpperCase().replace('-', ' ');

      const result = verifyRecoveryCode(input, hashedCodes);
      expect(result.valid).toBe(true);
      expect(result.matchedIndex).toBe(2);
      expect(result.remainingHashedCodes).toHaveLength(4);
      expect(result.remainingHashedCodes).not.toContain(hashedCodes[2]);

      // Using the same code again fails against the remaining list
      const retryResult = verifyRecoveryCode(input, result.remainingHashedCodes);
      expect(retryResult.valid).toBe(false);
      expect(retryResult.matchedIndex).toBe(-1);
    });

    it('rejects invalid or empty recovery codes', () => {
      expect(verifyRecoveryCode('wrong-code', ['abc', 'def'])).toEqual({
        valid: false,
        matchedIndex: -1,
        remainingHashedCodes: ['abc', 'def'],
      });
      expect(verifyRecoveryCode('', [])).toEqual({
        valid: false,
        matchedIndex: -1,
        remainingHashedCodes: [],
      });
    });
  });

  describe('createTotpSetup() All-In-One Helper', () => {
    it('creates all necessary TOTP artifacts in a single call', () => {
      const setup = createTotpSetup({
        user: { email: 'developer@example.com' },
        issuer: 'Webspresso Enterprise',
        recoveryCodeCount: 10,
      });

      expect(setup.secret).toHaveLength(32);
      expect(setup.uri).toContain('otpauth://totp/');
      expect(setup.uri).toContain('developer%40example.com');
      expect(setup.qrSvg).toContain('<svg');
      expect(setup.qrDataUri).toContain('data:image/svg+xml');
      expect(setup.recoveryCodes).toHaveLength(10);
      expect(setup.recoveryCodesHashed).toHaveLength(10);

      // Verify that a token generated from this setup is valid
      const token = generateTotp(setup.secret);
      expect(verifyTotp(token, setup.secret)).toBe(true);
    });
  });

  describe('AuthManager & req.auth Integration', () => {
    let authManager;

    beforeEach(() => {
      authManager = createAuth({
        findUserById: async (id) => ({ id, email: 'test@example.com', two_factor_enabled: true }),
        findUserByCredentials: async (email, pass) => (pass === 'secret' ? { id: 'u1', email, two_factor_enabled: true } : null),
        session: { secret: 'test-session-secret-12345' },
      });
    });

    it('exposes totp module on authManager and req.auth', () => {
      expect(authManager.totp).toBeDefined();
      expect(typeof authManager.totp.generateTotp).toBe('function');

      const req = { session: {} };
      const res = {};
      const requestAuth = authManager.createRequestAuth(req, res);

      expect(requestAuth.totp).toBeDefined();
      expect(typeof requestAuth.totp.verifyTotp).toBe('function');
    });

    it('tracks 2FA pending and verified lifecycle on session', () => {
      const req = { session: {} };
      const res = {};
      const requestAuth = authManager.createRequestAuth(req, res);

      expect(requestAuth.is2FaVerified()).toBe(false);
      expect(requestAuth.is2FaPending()).toBe(false);

      // Set pending
      requestAuth.set2FaPending({ id: 'u1' });
      expect(requestAuth.is2FaPending()).toBe(true);
      expect(req.session.twoFactorUserId).toBe('u1');
      expect(requestAuth.is2FaVerified()).toBe(false);

      // Set verified
      requestAuth.set2FaVerified(true);
      expect(requestAuth.is2FaVerified()).toBe(true);
      expect(requestAuth.is2FaPending()).toBe(false);
      expect(req.session.twoFactorUserId).toBeUndefined();

      // Clear 2FA
      requestAuth.clear2Fa();
      expect(requestAuth.is2FaVerified()).toBe(false);
    });

    it('requestAuth.verify2Fa verifies TOTP token and automatically sets verified flag', () => {
      const secret = generateTotpSecret();
      const token = generateTotp(secret);

      const req = { session: {} };
      const res = {};
      const requestAuth = authManager.createRequestAuth(req, res);

      const result = requestAuth.verify2Fa(token, { totp_secret: secret });
      expect(result.success).toBe(true);
      expect(result.type).toBe('totp');
      expect(requestAuth.is2FaVerified()).toBe(true);
    });

    it('requestAuth.verify2Fa falls back to recovery code verification', () => {
      const codes = generateRecoveryCodes({ count: 4 });
      const hashedCodes = codes.map(hashRecoveryCode);

      const req = { session: {} };
      const res = {};
      const requestAuth = authManager.createRequestAuth(req, res);

      const result = requestAuth.verify2Fa(codes[1], {
        totp_secret: 'INVALIDSECRET',
        recovery_codes: hashedCodes,
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('recovery_code');
      expect(result.remainingHashedCodes).toHaveLength(3);
      expect(requestAuth.is2FaVerified()).toBe(true);
    });

    it('clears 2FA session on logout', async () => {
      const req = { session: { userId: 'u1', twoFactorVerified: true, twoFactorPending: false } };
      const res = {};
      const requestAuth = authManager.createRequestAuth(req, res);

      await requestAuth.logout();
      expect(req.user).toBeNull();
      expect(requestAuth.is2FaVerified()).toBe(false);
      expect(req.session.twoFactorVerified).toBeUndefined();
    });
  });

  describe('require2Fa Middleware', () => {
    let authManager;
    let middleware;

    beforeEach(() => {
      authManager = createAuth({
        findUserById: async (id) => ({ id, email: 'user@example.com' }),
        findUserByCredentials: async () => null,
        session: { secret: 'test-session-secret-12345' },
        routes: { login: '/login', twoFactor: '/2fa' },
      });
      middleware = createAuthMiddleware(authManager);
    });

    it('redirects unauthenticated user to login in web mode', () => {
      const req = { session: {}, originalUrl: '/dashboard' };
      let redirectUrl = null;
      const res = { redirect: (url) => { redirectUrl = url; } };
      let nextCalled = false;

      middleware.require2Fa()(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(redirectUrl).toBe('/login');
      expect(req.session.intendedUrl).toBe('/dashboard');
    });

    it('returns 401 for unauthenticated user in API mode', () => {
      const req = { session: {}, headers: {} };
      let statusSent = null;
      let jsonSent = null;
      const res = {
        status: (code) => {
          statusSent = code;
          return { json: (d) => { jsonSent = d; } };
        },
      };

      middleware.require2Fa({ api: true })(req, res, createMockNext());

      expect(statusSent).toBe(401);
      expect(jsonSent).toEqual({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    });

    it('passes through if user has 2FA disabled', () => {
      const req = {
        user: { id: 'u1', two_factor_enabled: false },
        session: {},
      };
      const res = {};
      let nextCalled = false;

      middleware.require2Fa()(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    it('redirects to /2fa if user has 2FA enabled but not verified in web mode', () => {
      const req = {
        user: { id: 'u1', two_factor_enabled: true },
        session: { twoFactorVerified: false },
        originalUrl: '/secure-vault',
      };
      let redirectUrl = null;
      const res = { redirect: (url) => { redirectUrl = url; } };

      middleware.require2Fa()(req, res, createMockNext());

      expect(redirectUrl).toBe('/2fa');
      expect(req.session.intendedUrl).toBe('/secure-vault');
    });

    it('returns 403 TwoFactorRequired in API mode if 2FA pending or not verified', () => {
      const req = {
        user: { id: 'u1', two_factor_enabled: true },
        session: { twoFactorVerified: false },
        headers: {},
      };
      let statusSent = null;
      let jsonSent = null;
      const res = {
        status: (code) => {
          statusSent = code;
          return { json: (d) => { jsonSent = d; } };
        },
      };

      middleware.require2Fa({ api: true })(req, res, createMockNext());

      expect(statusSent).toBe(403);
      expect(jsonSent).toEqual({
        error: 'TwoFactorRequired',
        message: 'Two-factor authentication required',
      });
    });

    it('passes through when 2FA is verified', () => {
      const req = {
        user: { id: 'u1', two_factor_enabled: true },
        session: { twoFactorVerified: true },
      };
      const res = {};
      let nextCalled = false;

      middleware.require2Fa()(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    it('parses middleware string 2fa and totp correctly', () => {
      const fn1 = middleware.parseMiddlewareString('2fa');
      expect(typeof fn1).toBe('function');

      const fn2 = middleware.parseMiddlewareString('2fa:api');
      expect(typeof fn2).toBe('function');

      const fn3 = middleware.parseMiddlewareString('totp');
      expect(typeof fn3).toBe('function');
    });
  });
});
