/**
 * Unit tests for Two-Factor Authentication (TOTP / HOTP / 2FA)
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';

const {
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
} = require('../../../core/auth/totp');

describe('Two-Factor Authentication (core/auth/totp)', () => {
  describe('Base32 Encode & Decode (RFC 4648)', () => {
    it('encodes and decodes strings and buffers accurately', () => {
      const rawText = 'Hello Webspresso 2FA!';
      const encoded = base32Encode(rawText);
      expect(typeof encoded).toBe('string');
      expect(encoded).not.toContain('=');

      const decoded = base32Decode(encoded).toString('utf8');
      expect(decoded).toBe(rawText);
    });

    it('tolerates hyphens, spaces, and lowercase in base32Decode', () => {
      const original = 'SecretKey';
      const encoded = base32Encode(original);
      const formatted = `${encoded.toLowerCase().slice(0, 4)}-${encoded.toLowerCase().slice(4)}`;

      const decoded = base32Decode(formatted).toString('utf8');
      expect(decoded).toBe(original);
    });

    it('handles padding option and empty inputs', () => {
      expect(base32Encode('')).toBe('');
      expect(base32Decode('').length).toBe(0);

      const padded = base32Encode('abc', { padding: true });
      expect(padded.endsWith('=')).toBe(true);
      expect(base32Decode(padded).toString('utf8')).toBe('abc');
    });

    it('throws error on invalid Base32 characters or non-string input', () => {
      expect(() => base32Decode('INVALID_1890!')).toThrow(/Invalid Base32 character/);
      expect(() => base32Decode(null)).toThrow(TypeError);
    });
  });

  describe('HOTP (RFC 4226) & TOTP (RFC 6238)', () => {
    const SECRET = generateTotpSecret({ length: 20 });

    it('generates cryptographically secure Base32 secret', () => {
      expect(typeof SECRET).toBe('string');
      expect(SECRET.length).toBeGreaterThanOrEqual(16);
      expect(() => base32Decode(SECRET)).not.toThrow();
    });

    it('generates and verifies counter-based HOTP tokens', () => {
      const token1 = generateHotp(SECRET, 0);
      const token2 = generateHotp(SECRET, 1);

      expect(token1).toHaveLength(6);
      expect(token2).toHaveLength(6);
      expect(token1).not.toBe(token2);

      expect(verifyHotp(token1, SECRET, 0)).toBe(true);
      expect(verifyHotp(token1, SECRET, 1)).toBe(false);
      expect(verifyHotp('000000', SECRET, 0)).toBe(false);
      expect(verifyHotp(null, SECRET, 0)).toBe(false);
    });

    it('supports custom digit lengths in HOTP (e.g. 8 digits)', () => {
      const token8 = generateHotp(SECRET, 42, { digits: 8 });
      expect(token8).toHaveLength(8);
      expect(verifyHotp(token8, SECRET, 42, { digits: 8 })).toBe(true);
    });

    it('generates and verifies time-based TOTP tokens', () => {
      const now = Date.now();
      const code = generateTotp(SECRET, { time: now });

      expect(code).toHaveLength(6);
      expect(verifyTotp(code, SECRET, { time: now })).toBe(true);
      expect(verifyTotp('wrong', SECRET, { time: now })).toBe(false);
    });

    it('verifies TOTP tokens with drift window', () => {
      const t0 = 1700000000; // seconds
      const codeT0 = generateTotp(SECRET, { time: t0 });

      // Check 30 seconds later (t0 + 30) with window=1 (should pass)
      const isPastValid = verifyTotp(codeT0, SECRET, { time: t0 + 30, window: 1 });
      expect(isPastValid).toBe(true);

      // Check 90 seconds later (t0 + 90) with window=1 (should fail)
      const isFarPastValid = verifyTotp(codeT0, SECRET, { time: t0 + 90, window: 1 });
      expect(isFarPastValid).toBe(false);

      // Detailed return mode
      const detailed = verifyTotp(codeT0, SECRET, { time: t0 + 30, window: 1, detailed: true });
      expect(detailed.valid).toBe(true);
      expect(detailed.delta).toBe(-1);
    });
  });

  describe('Key URI & QR Code Generation', () => {
    it('generates valid otpauth:// URI string', () => {
      const uri = generateTotpUri({
        secret: 'JBSWY3DPEHPK3PXP',
        account: 'user@example.com',
        issuer: 'MyApp',
        digits: 6,
        period: 30,
      });

      expect(uri).toContain('otpauth://totp/MyApp%3Auser%40example.com?');
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('issuer=MyApp');
    });

    it('throws error when secret is missing in generateTotpUri', () => {
      expect(() => generateTotpUri({})).toThrow('Secret is required to generate TOTP URI');
    });

    it('generates QR SVG and Data URI for authenticator setup', () => {
      const uri = 'otpauth://totp/TestApp:alice?secret=JBSWY3DPEHPK3PXP&issuer=TestApp';
      const svg = generateTotpQrSvg(uri, { size: 200 });

      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox=');

      const dataUri = generateTotpQrDataUri(uri);
      expect(dataUri).toMatch(/^data:image\/svg\+xml/);
    });
  });

  describe('Recovery Codes & Setup Helper', () => {
    it('generates, hashes, and verifies backup recovery codes', () => {
      const codes = generateRecoveryCodes({ count: 4, length: 8, hyphen: true });
      expect(codes).toHaveLength(4);
      expect(codes[0]).toContain('-');

      const hashedCodes = codes.map(hashRecoveryCode);
      expect(hashedCodes).toHaveLength(4);
      expect(hashedCodes[0]).toHaveLength(64); // SHA-256

      // Verify and consume first code
      const result1 = verifyRecoveryCode(codes[0], hashedCodes);
      expect(result1.valid).toBe(true);
      expect(result1.matchedIndex).toBe(0);
      expect(result1.remainingHashedCodes).toHaveLength(3);

      // Verifying already consumed code should fail
      const result2 = verifyRecoveryCode(codes[0], result1.remainingHashedCodes);
      expect(result2.valid).toBe(false);

      // Verifying with spaces or different case still matches
      const formattedCode = ` ${codes[1].toUpperCase()} `;
      const result3 = verifyRecoveryCode(formattedCode, result1.remainingHashedCodes);
      expect(result3.valid).toBe(true);
    });

    it('createTotpSetup returns complete configuration bundle', () => {
      const setup = createTotpSetup({
        user: { email: 'admin@webspresso.dev' },
        issuer: 'Webspresso Test',
        recoveryCodeCount: 6,
      });

      expect(setup.secret).toBeDefined();
      expect(setup.uri).toContain('otpauth://totp/');
      expect(setup.qrSvg).toContain('<svg');
      expect(setup.qrDataUri).toContain('data:image/svg+xml');
      expect(setup.recoveryCodes).toHaveLength(6);
      expect(setup.recoveryCodesHashed).toHaveLength(6);
    });
  });
});
