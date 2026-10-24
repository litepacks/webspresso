import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { safeCompare, timingSafeEqual } from '../../../core/utils/crypto';
import { safeCompare as utilsIndexSafeCompare } from '../../../core/utils';
import { utils } from '../../../src/helpers';
import webspresso from '../../../index';

describe('Zero-Dependency safeCompare Utility (core/utils/crypto)', () => {
  it('exports safeCompare across core, core/utils index, helpers.utils, and root webspresso', () => {
    expect(typeof safeCompare).toBe('function');
    expect(typeof timingSafeEqual).toBe('function');
    expect(safeCompare).toBe(timingSafeEqual);
    expect(typeof utilsIndexSafeCompare).toBe('function');
    expect(typeof utils.safeCompare).toBe('function');
    expect(typeof webspresso.safeCompare).toBe('function');
  });

  it('returns true for identical strings', () => {
    expect(safeCompare('super-secret-token', 'super-secret-token')).toBe(true);
    expect(safeCompare('', '')).toBe(true);
    expect(safeCompare('a', 'a')).toBe(true);
    expect(safeCompare('utf8-turkish-şçğüöı', 'utf8-turkish-şçğüöı')).toBe(true);
  });

  it('returns false for differing strings of equal length', () => {
    expect(safeCompare('secret1', 'secret2')).toBe(false);
    expect(safeCompare('abc', 'abd')).toBe(false);
  });

  it('returns false for strings of differing lengths', () => {
    expect(safeCompare('secret', 'secret123')).toBe(false);
    expect(safeCompare('secret123', 'secret')).toBe(false);
    expect(safeCompare('secret', '')).toBe(false);
    expect(safeCompare('', 'secret')).toBe(false);
  });

  it('performs dummy comparison when string lengths differ to preserve constant-time execution', () => {
    const timingSpy = vi.spyOn(crypto, 'timingSafeEqual');

    const result = safeCompare('short', 'longer-string');
    expect(result).toBe(false);
    expect(timingSpy).toHaveBeenCalledTimes(1);

    timingSpy.mockRestore();
  });

  it('supports comparing Buffers directly', () => {
    const bufA = Buffer.from('my-buffer-secret', 'utf8');
    const bufB = Buffer.from('my-buffer-secret', 'utf8');
    const bufC = Buffer.from('my-differ-secret', 'utf8');
    const bufShort = Buffer.from('short', 'utf8');

    expect(safeCompare(bufA, bufB)).toBe(true);
    expect(safeCompare(bufA, bufC)).toBe(false);
    expect(safeCompare(bufA, bufShort)).toBe(false);
    expect(safeCompare(bufShort, bufA)).toBe(false);
    expect(safeCompare(Buffer.alloc(0), bufA)).toBe(false);
    expect(safeCompare(bufA, Buffer.alloc(0))).toBe(false);

    // Empty buffers
    expect(safeCompare(Buffer.alloc(0), Buffer.alloc(0))).toBe(true);
  });

  it('safely handles non-string and non-buffer inputs without throwing', () => {
    expect(safeCompare(null, 'secret')).toBe(false);
    expect(safeCompare('secret', null)).toBe(false);
    expect(safeCompare(undefined, 'secret')).toBe(false);
    expect(safeCompare('secret', undefined)).toBe(false);
    expect(safeCompare(null, null)).toBe(false);
    expect(safeCompare(undefined, undefined)).toBe(false);

    // Numbers, booleans, objects
    expect(safeCompare(12345, 12345)).toBe(false);
    expect(safeCompare(true, true)).toBe(false);
    expect(safeCompare({}, {})).toBe(false);
    expect(safeCompare([], [])).toBe(false);
  });

  it('works via utils.safeCompare and webspresso.safeCompare', () => {
    expect(utils.safeCompare('token-xyz', 'token-xyz')).toBe(true);
    expect(utils.safeCompare('token-xyz', 'token-wrong')).toBe(false);
    expect(webspresso.safeCompare('token-abc', 'token-abc')).toBe(true);
    expect(webspresso.safeCompare('token-abc', 'token-def')).toBe(false);
  });
});
