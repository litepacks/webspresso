import { describe, it, expect } from 'vitest';
import {
  parseDurationSec,
  parseDurationMs,
  parseDuration,
  parseTtlMs,
  sleep,
} from '../../../core/utils/time';
import {
  utils,
  parseDurationSec as indexParseDurationSec,
  parseDuration as indexParseDuration,
  parseDurationMs as indexParseDurationMs,
  parseTtlMs as indexParseTtlMs,
  sleep as indexSleep,
} from '../../../index';

describe('core/utils/time - Time & Duration Utilities', () => {
  describe('parseDurationSec / parseDuration', () => {
    it('returns number as-is when given a number', () => {
      expect(parseDurationSec(120)).toBe(120);
      expect(parseDurationSec(0)).toBe(0);
      expect(parseDuration(45)).toBe(45);
    });

    it('returns default (3600) for null, undefined, and non-strings', () => {
      expect(parseDurationSec(null)).toBe(3600);
      expect(parseDurationSec(undefined)).toBe(3600);
      expect(parseDurationSec({})).toBe(3600);
      expect(parseDurationSec('invalid')).toBe(3600);
    });

    it('accepts custom default seconds', () => {
      expect(parseDurationSec(null, 7200)).toBe(7200);
      expect(parseDurationSec('bad', 300)).toBe(300);
    });

    it('parses second units (s)', () => {
      expect(parseDurationSec('30s')).toBe(30);
      expect(parseDurationSec('10S')).toBe(10);
      expect(parseDuration('1s')).toBe(1);
    });

    it('parses minute units (m)', () => {
      expect(parseDurationSec('5m')).toBe(300);
      expect(parseDurationSec('15M')).toBe(900);
      expect(parseDuration('1m')).toBe(60);
    });

    it('parses hour units (h)', () => {
      expect(parseDurationSec('1h')).toBe(3600);
      expect(parseDurationSec('2H')).toBe(7200);
    });

    it('parses day units (d)', () => {
      expect(parseDurationSec('1d')).toBe(86400);
      expect(parseDurationSec('3d')).toBe(259200);
      expect(parseDurationSec('7D')).toBe(604800);
    });

    it('parses week units (w)', () => {
      expect(parseDurationSec('1w')).toBe(604800);
      expect(parseDurationSec('2w')).toBe(1209600);
    });

    it('parses plain numeric strings', () => {
      expect(parseDurationSec('500')).toBe(500);
      expect(parseDurationSec('1200')).toBe(1200);
    });

    it('falls back to parseInt for strings with unrecognized trailing characters', () => {
      expect(parseDurationSec('4x')).toBe(4);
    });

    it('provides parseDuration alias identical to parseDurationSec', () => {
      expect(parseDuration).toBe(parseDurationSec);
    });
  });

  describe('parseDurationMs / parseTtlMs', () => {
    it('returns positive number as-is in milliseconds', () => {
      expect(parseDurationMs(1500)).toBe(1500);
      expect(parseDurationMs(50)).toBe(50);
    });

    it('returns default (60000) for zero or negative numbers', () => {
      expect(parseDurationMs(-500)).toBe(60000);
      expect(parseDurationMs(0)).toBe(60000);
    });

    it('returns default for booleans, null, undefined, or empty values', () => {
      expect(parseDurationMs(true)).toBe(60000);
      expect(parseDurationMs(false)).toBe(60000);
      expect(parseDurationMs(null)).toBe(60000);
      expect(parseDurationMs(undefined)).toBe(60000);
      expect(parseDurationMs('')).toBe(60000);
      expect(parseDurationMs('invalid')).toBe(60000);
    });

    it('accepts custom default milliseconds', () => {
      expect(parseDurationMs(null, 10000)).toBe(10000);
      expect(parseDurationMs('invalid', 5000)).toBe(5000);
      expect(parseDurationMs(-10, 5000)).toBe(5000);
    });

    it('parses millisecond units (ms)', () => {
      expect(parseDurationMs('500ms')).toBe(500);
      expect(parseDurationMs('1500MS')).toBe(1500);
    });

    it('parses second units (s)', () => {
      expect(parseDurationMs('5s')).toBe(5000);
      expect(parseDurationMs('10S')).toBe(10000);
    });

    it('parses minute units (m)', () => {
      expect(parseDurationMs('1m')).toBe(60000);
      expect(parseDurationMs('2M')).toBe(120000);
      expect(parseDurationMs('5m')).toBe(300000);
    });

    it('parses hour units (h)', () => {
      expect(parseDurationMs('1h')).toBe(3600000);
      expect(parseDurationMs('2H')).toBe(7200000);
    });

    it('parses day units (d)', () => {
      expect(parseDurationMs('1d')).toBe(86400000);
      expect(parseDurationMs('2D')).toBe(172800000);
    });

    it('parses week units (w)', () => {
      expect(parseDurationMs('1w')).toBe(604800000);
    });

    it('treats numeric string without unit as seconds (compatible with parseTtlMs contract)', () => {
      expect(parseDurationMs('100')).toBe(100000);
      expect(parseDurationMs('50')).toBe(50000);
    });

    it('provides parseTtlMs alias identical to parseDurationMs', () => {
      expect(parseTtlMs).toBe(parseDurationMs);
    });
  });

  describe('sleep', () => {
    it('resolves after specified milliseconds', async () => {
      const start = Date.now();
      await sleep(20);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    it('handles zero, negative, or invalid ms gracefully', async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-100)).resolves.toBeUndefined();
      await expect(sleep(null)).resolves.toBeUndefined();
    });
  });

  describe('re-exports via index and utils', () => {
    it('exports time functions via index', () => {
      expect(indexParseDurationSec).toBe(parseDurationSec);
      expect(indexParseDuration).toBe(parseDurationSec);
      expect(indexParseDurationMs).toBe(parseDurationMs);
      expect(indexParseTtlMs('5s')).toBe(5000);
      expect(indexSleep).toBe(sleep);
    });

    it('exports time functions via src/helpers.js utils', () => {
      expect(utils.parseDurationSec('10s')).toBe(10);
      expect(utils.parseDuration('2h')).toBe(7200);
      expect(utils.parseDurationMs('5s')).toBe(5000);
      expect(utils.parseTtlMs('1m')).toBe(60000);
      expect(typeof utils.sleep).toBe('function');
    });
  });
});
