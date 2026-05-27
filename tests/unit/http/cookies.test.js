/**
 * Cookie parse / sign / serialize helpers
 */

const {
  parseCookieHeader,
  getSignedCookies,
  sign,
  unsign,
  serializeCookie,
} = require('../../../src/http/cookies');

describe('http/cookies', () => {
  describe('parseCookieHeader', () => {
    it('returns empty object for missing header', () => {
      expect(parseCookieHeader()).toEqual({});
      expect(parseCookieHeader('')).toEqual({});
    });

    it('parses multiple cookies and quoted values', () => {
      const out = parseCookieHeader('a=1; b="hello world"; c=%7E');
      expect(out.a).toBe('1');
      expect(out.b).toBe('hello world');
      expect(out.c).toBe('~');
    });

    it('skips parts without equals', () => {
      expect(parseCookieHeader('broken; ok=yes')).toEqual({ ok: 'yes' });
    });

    it('keeps raw value when decodeURIComponent fails', () => {
      const out = parseCookieHeader('bad=%E0%A4%A');
      expect(out.bad).toBe('%E0%A4%A');
    });
  });

  describe('sign / unsign', () => {
    const secret = 'test-secret-key-at-least-32-chars!!';

    it('round-trips signed values', () => {
      const signed = sign('payload', secret);
      expect(unsign(signed, secret)).toBe('payload');
    });

    it('returns false for invalid input', () => {
      expect(unsign('', secret)).toBe(false);
      expect(unsign('no-dot', secret)).toBe(false);
      expect(unsign('tampered.badmac', secret)).toBe(false);
    });
  });

  describe('getSignedCookies', () => {
    const secret = 'another-secret-key-32-chars-min!!';

    it('returns empty when secret is missing', () => {
      expect(getSignedCookies({ sid: 's:abc' }, '')).toEqual({});
      expect(getSignedCookies({ sid: 's:abc' }, null)).toEqual({});
    });

    it('extracts verified signed cookie values', () => {
      const raw = sign('user-42', secret);
      const cookies = { sid: `s:${raw}`, plain: 'x' };
      expect(getSignedCookies(cookies, secret)).toEqual({ sid: 'user-42' });
    });

    it('omits cookies that fail verification', () => {
      expect(getSignedCookies({ sid: 's:bad.sig' }, secret)).toEqual({});
    });
  });

  describe('serializeCookie', () => {
    it('sets default Path and optional flags', () => {
      const line = serializeCookie('token', 'abc', {
        maxAge: 3600000,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/admin',
      });
      expect(line).toContain('token=abc');
      expect(line).toContain('Max-Age=3600');
      expect(line).toContain('Path=/admin');
      expect(line).toContain('HttpOnly');
      expect(line).toContain('Secure');
      expect(line).toContain('SameSite=Lax');
    });

    it('includes Expires when provided', () => {
      const exp = new Date('2030-01-01T00:00:00.000Z');
      const line = serializeCookie('x', '1', { expires: exp });
      expect(line).toContain('Expires=');
    });
  });
});
