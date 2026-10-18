import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  hmacSha256,
  createHmacSha256,
  randomToken,
  randomId,
  randomTimestampedId,
  base64UrlEncode,
  base64UrlDecode,
  safeCompare,
  sha256,
} from '../../../core/utils/crypto';
import hmacReExport from '../../../core/utils/hmac';
import { randomToken as rToken, randomId as rId, randomTimestampedId as rTsId } from '../../../core/utils/random';
import { base64UrlEncode as b64UrlEnc, base64UrlDecode as b64UrlDec } from '../../../core/utils/base64url';
import { utils } from '../../../src/helpers';
import webspresso from '../../../index';

describe('Webspresso Unified Crypto & Security Utilities (core/utils/crypto)', () => {
  describe('hmacSha256', () => {
    const secret = 'super-secret-key-12345';
    const message = 'Hello, Webspresso Webhooks & Tokens!';

    it('computes correct HMAC-SHA256 in hex format matching native crypto', () => {
      const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
      const result = hmacSha256(message, secret, 'hex');
      expect(result).toBe(expected);
      expect(typeof result).toBe('string');
      expect(result).toHaveLength(64);
    });

    it('supports createHmacSha256 alias and hmac.js re-export', () => {
      const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
      expect(createHmacSha256(message, secret)).toBe(expected);
      expect(hmacReExport(message, secret)).toBe(expected);
      expect(hmacReExport.hmacSha256(message, secret)).toBe(expected);
      expect(utils.hmacSha256(message, secret)).toBe(expected);
      expect(webspresso.hmacSha256(message, secret)).toBe(expected);
    });

    it('supports base64, base64url, and raw Buffer encodings', () => {
      const base64Expected = crypto.createHmac('sha256', secret).update(message).digest('base64');
      expect(hmacSha256(message, secret, 'base64')).toBe(base64Expected);

      const base64urlExpected = crypto.createHmac('sha256', secret).update(message).digest('base64url');
      expect(hmacSha256(message, secret, 'base64url')).toBe(base64urlExpected);

      const bufferExpected = crypto.createHmac('sha256', secret).update(message).digest();
      const resultBuffer = hmacSha256(message, secret, 'buffer');
      expect(Buffer.isBuffer(resultBuffer)).toBe(true);
      expect(resultBuffer.equals(bufferExpected)).toBe(true);
    });

    it('handles empty/null/undefined payload safely', () => {
      const emptyExpected = crypto.createHmac('sha256', secret).update('').digest('hex');
      expect(hmacSha256('', secret)).toBe(emptyExpected);
      expect(hmacSha256(null, secret)).toBe(emptyExpected);
      expect(hmacSha256(undefined, secret)).toBe(emptyExpected);
    });

    it('handles Buffer input payloads', () => {
      const buf = Buffer.from('buffer-message-content', 'utf8');
      const expected = crypto.createHmac('sha256', secret).update(buf).digest('hex');
      expect(hmacSha256(buf, secret)).toBe(expected);
    });

    it('coerces non-string/non-buffer inputs safely', () => {
      const expected = crypto.createHmac('sha256', secret).update('12345').digest('hex');
      expect(hmacSha256(12345, secret)).toBe(expected);
    });

    it('throws TypeError if secret is missing or null', () => {
      expect(() => hmacSha256('data', null)).toThrow(TypeError);
      expect(() => hmacSha256('data', undefined)).toThrow(TypeError);
    });
  });

  describe('randomToken, randomId & randomTimestampedId', () => {
    it('generates randomToken with default 32 bytes hex', () => {
      const token = randomToken();
      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it('supports custom lengths and encodings (hex, base64url, buffer)', () => {
      const token16 = randomToken(16, 'hex');
      expect(token16).toHaveLength(32);

      const b64urlToken = randomToken(24, 'base64url');
      expect(typeof b64urlToken).toBe('string');
      expect(b64urlToken).toHaveLength(32);

      const bufToken = randomToken(16, 'buffer');
      expect(Buffer.isBuffer(bufToken)).toBe(true);
      expect(bufToken).toHaveLength(16);
    });

    it('generates randomId with and without prefixes', () => {
      const unPrefixed = randomId('', 8);
      expect(unPrefixed).toHaveLength(16);

      const prefixedWithUnderscore = randomId('whsec_', 12);
      expect(prefixedWithUnderscore.startsWith('whsec_')).toBe(true);
      expect(prefixedWithUnderscore.slice(6)).toHaveLength(24);

      const prefixedWithoutUnderscore = randomId('api', 8);
      expect(prefixedWithoutUnderscore.startsWith('api_')).toBe(true);
      expect(prefixedWithoutUnderscore.slice(4)).toHaveLength(16);
    });

    it('generates randomTimestampedId formatted with current time and random suffix', () => {
      const before = Date.now();
      const id = randomTimestampedId('dlv', 6);
      const after = Date.now();

      expect(id.startsWith('dlv_')).toBe(true);
      const parts = id.split('_');
      expect(parts).toHaveLength(3); // ['dlv', timestamp, hex]
      const ts = parseInt(parts[1], 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
      expect(parts[2]).toHaveLength(12); // 6 bytes = 12 hex chars
    });

    it('supports random.js re-exports and framework level exposure', () => {
      expect(typeof rToken).toBe('function');
      expect(typeof rId).toBe('function');
      expect(typeof rTsId).toBe('function');
      expect(typeof utils.randomToken).toBe('function');
      expect(typeof utils.randomId).toBe('function');
      expect(typeof webspresso.randomToken).toBe('function');
      expect(typeof webspresso.randomId).toBe('function');
    });
  });

  describe('base64UrlEncode & base64UrlDecode', () => {
    it('correctly encodes and decodes ASCII strings', () => {
      const text = 'Hello Webspresso OAuth & JWT!';
      const encoded = base64UrlEncode(text);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
      const decoded = base64UrlDecode(encoded);
      expect(decoded).toBe(text);
    });

    it('correctly handles UTF-8 multibyte strings', () => {
      const text = 'Türkçe karakterler: ğüşıöç ☕ 🔥';
      const encoded = base64UrlEncode(text);
      expect(base64UrlDecode(encoded)).toBe(text);
    });

    it('supports Buffer input for base64UrlEncode', () => {
      const buf = Buffer.from('buffer-to-encode', 'utf8');
      const expected = buf.toString('base64url');
      expect(base64UrlEncode(buf)).toBe(expected);
      expect(base64UrlDecode(expected)).toBe('buffer-to-encode');
    });

    it('handles null, undefined, and empty inputs gracefully', () => {
      expect(base64UrlEncode(null)).toBe('');
      expect(base64UrlEncode(undefined)).toBe('');
      expect(base64UrlEncode('')).toBe('');
      expect(base64UrlDecode(null)).toBe('');
      expect(base64UrlDecode(undefined)).toBe('');
      expect(base64UrlDecode('')).toBe('');
    });

    it('supports base64url.js re-exports and framework level exposure', () => {
      expect(typeof b64UrlEnc).toBe('function');
      expect(typeof b64UrlDec).toBe('function');
      expect(typeof utils.base64UrlEncode).toBe('function');
      expect(typeof utils.base64UrlDecode).toBe('function');
      expect(typeof webspresso.base64UrlEncode).toBe('function');
      expect(typeof webspresso.base64UrlDecode).toBe('function');
    });
  });
});
