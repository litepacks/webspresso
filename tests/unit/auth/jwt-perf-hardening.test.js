const {
  signJwt,
  verifyJwt,
  decodeJwt,
  clearJwtCache,
  HS256_HEADER_BASE64URL,
  MAX_PAYLOAD_SIZE,
} = require('../../../core/auth');
const { base64UrlEncode } = require('../../../core/utils/crypto');

describe('JWT Fast-Path, LRU Cache & DoS Hardening', () => {
  const SECRET = 'ultra-secure-test-secret-32-chars-long';

  beforeEach(() => {
    clearJwtCache();
  });

  describe('Fast-Path Header Evaluation', () => {
    it('uses standard HS256_HEADER_BASE64URL constant by default', () => {
      const token = signJwt({ userId: 1 }, SECRET);
      const [header] = token.split('.');
      expect(header).toBe(HS256_HEADER_BASE64URL);

      const verified = verifyJwt(token, SECRET);
      expect(verified.userId).toBe(1);
    });

    it('gracefully handles non-standard but valid HS256 headers', () => {
      // Custom typ or extra header fields
      const customHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', custom: 'field' }));
      const payload = base64UrlEncode(JSON.stringify({ userId: 42 }));
      const { hmacSha256 } = require('../../../core/utils/crypto');
      const sig = hmacSha256(`${customHeader}.${payload}`, SECRET, 'base64url');
      const token = `${customHeader}.${payload}.${sig}`;

      const verified = verifyJwt(token, SECRET);
      expect(verified.userId).toBe(42);

      const decoded = decodeJwt(token);
      expect(decoded.header.custom).toBe('field');
      expect(decoded.payload.userId).toBe(42);
    });
  });

  describe('Bounded Verification LRU Cache', () => {
    it('memoizes successfully verified tokens and speeds up repeated calls', () => {
      const token = signJwt({ userId: 10, role: 'member' }, SECRET);

      const res1 = verifyJwt(token, SECRET);
      const res2 = verifyJwt(token, SECRET);

      expect(res1.userId).toBe(10);
      expect(res2.userId).toBe(10);
      expect(res1).toEqual(res2);
    });

    it('returns a defensive copy on cache hit to prevent cache pollution', () => {
      const token = signJwt({ userId: 99, role: 'user' }, SECRET);

      const first = verifyJwt(token, SECRET);
      first.role = 'superadmin'; // Mutate caller object
      first.injected = true;

      const second = verifyJwt(token, SECRET);
      expect(second.role).toBe('user');
      expect(second.injected).toBeUndefined();
    });

    it('re-evaluates expiration on cache hit and rejects expired tokens', () => {
      // 1-second token
      const token = signJwt({ userId: 5 }, SECRET, { expiresIn: 1 });
      const verified = verifyJwt(token, SECRET);
      expect(verified.userId).toBe(5);

      // Artificially age the clock
      const originalNow = Date.now;
      try {
        Date.now = () => originalNow() + 3000;
        expect(() => verifyJwt(token, SECRET)).toThrow('JWT token has expired');
      } finally {
        Date.now = originalNow;
      }
    });

    it('re-evaluates issuer and audience constraints on cache hit', () => {
      const token = signJwt({ userId: 12 }, SECRET, { issuer: 'auth-server', audience: 'web-client' });
      const valid = verifyJwt(token, SECRET, { issuer: 'auth-server', audience: 'web-client' });
      expect(valid.userId).toBe(12);

      // Cache hit with wrong issuer
      expect(() => verifyJwt(token, SECRET, { issuer: 'wrong-server' })).toThrow(/Invalid JWT issuer/);

      // Cache hit with wrong audience
      expect(() => verifyJwt(token, SECRET, { audience: 'mobile-client' })).toThrow(/Invalid JWT audience/);
    });

    it('supports bypassing cache with options.cache = false', () => {
      const token = signJwt({ userId: 7 }, SECRET);
      const res = verifyJwt(token, SECRET, { cache: false });
      expect(res.userId).toBe(7);
    });

    it('evicts oldest items when cache limit is exceeded', () => {
      for (let i = 0; i < 1100; i++) {
        const t = signJwt({ uid: i }, SECRET, { expiresIn: '10m' });
        verifyJwt(t, SECRET);
      }
      // Most recent should hit cache cleanly
      const latest = signJwt({ uid: 1099 }, SECRET);
      expect(verifyJwt(latest, SECRET).uid).toBe(1099);
    });

    it('clearJwtCache resets the cache', () => {
      const token = signJwt({ userId: 1 }, SECRET);
      verifyJwt(token, SECRET);
      clearJwtCache();
      // Should re-verify cleanly after clear
      const res = verifyJwt(token, SECRET);
      expect(res.userId).toBe(1);
    });
  });

  describe('DoS Protection & Payload Size Guard', () => {
    it('rejects oversized payloads exceeding maxPayloadSize', () => {
      const hugeData = 'x'.repeat(2000);
      const token = signJwt({ data: hugeData }, SECRET);

      // Default MAX_PAYLOAD_SIZE is 1MB, but passing custom maxPayloadSize triggers guard
      expect(() => verifyJwt(token, SECRET, { maxPayloadSize: 500 })).toThrow('JWT payload exceeds maximum allowed size');
    });

    it('allows payloads within maxPayloadSize limit', () => {
      const token = signJwt({ small: 'ok' }, SECRET);
      const res = verifyJwt(token, SECRET, { maxPayloadSize: 10000 });
      expect(res.small).toBe('ok');
    });
  });

  describe('decodeJwt fast-path', () => {
    it('uses fast-path header decoding for decodeJwt', () => {
      const token = signJwt({ name: 'tester' }, SECRET);
      const decoded = decodeJwt(token);
      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.name).toBe('tester');
    });
  });
});
