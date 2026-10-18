import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { sha256, hashSha256 } from '../../../core/utils/crypto';
import sha256ReExport from '../../../core/utils/sha256';
import { utils } from '../../../src/helpers';
import webspresso from '../../../index';

describe('Zero-Dependency sha256 Utility (core/utils/crypto)', () => {
  it('exports sha256 across core, sha256 re-export, helpers.utils, and root webspresso', () => {
    expect(typeof sha256).toBe('function');
    expect(typeof hashSha256).toBe('function');
    expect(sha256).toBe(hashSha256);
    expect(typeof sha256ReExport).toBe('function');
    expect(typeof sha256ReExport.sha256).toBe('function');
    expect(typeof utils.sha256).toBe('function');
    expect(typeof webspresso.sha256).toBe('function');
  });

  it('computes correct NIST standard SHA-256 hex digest for empty string', () => {
    const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(sha256('')).toBe(emptySha);
    expect(sha256(null)).toBe(emptySha);
    expect(sha256(undefined)).toBe(emptySha);
  });

  it('computes correct SHA-256 for standard string', () => {
    const expected = crypto.createHash('sha256').update('hello world').digest('hex');
    expect(sha256('hello world')).toBe(expected);
    expect(sha256('hello world')).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('supports UTF-8 multibyte characters', () => {
    const text = 'Webspresso ☕ Türkçe şçğüöı';
    const expected = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    expect(sha256(text)).toBe(expected);
  });

  it('supports Buffer inputs', () => {
    const buf = Buffer.from('buffer-payload-test', 'utf8');
    const expected = crypto.createHash('sha256').update(buf).digest('hex');
    expect(sha256(buf)).toBe(expected);
  });

  it('supports non-string/non-buffer inputs via coercion', () => {
    expect(sha256(12345)).toBe(crypto.createHash('sha256').update('12345').digest('hex'));
    expect(sha256(true)).toBe(crypto.createHash('sha256').update('true').digest('hex'));
  });

  it('supports base64, base64url, and raw buffer output encodings', () => {
    const input = 'my-pkce-verifier-string-1234567890';

    const base64Expected = crypto.createHash('sha256').update(input).digest('base64');
    expect(sha256(input, 'base64')).toBe(base64Expected);

    const base64urlExpected = crypto.createHash('sha256').update(input).digest('base64url');
    expect(sha256(input, 'base64url')).toBe(base64urlExpected);

    const bufferExpected = crypto.createHash('sha256').update(input).digest();
    const resultBuffer = sha256(input, 'buffer');
    expect(Buffer.isBuffer(resultBuffer)).toBe(true);
    expect(resultBuffer.equals(bufferExpected)).toBe(true);
  });

  it('integrates seamlessly with helpers.utils and root webspresso', () => {
    const val = 'integration-test-key';
    const expected = crypto.createHash('sha256').update(val).digest('hex');

    expect(utils.sha256(val)).toBe(expected);
    expect(webspresso.sha256(val)).toBe(expected);
    expect(sha256ReExport(val)).toBe(expected);
  });
});
