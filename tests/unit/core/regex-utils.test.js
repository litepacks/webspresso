import { describe, it, expect } from 'vitest';
import {
  escapeRegExp,
  escapeRegex,
  globToRegExp,
} from '../../../core/utils/regex';
import escapeRegExpDirect from '../../../core/utils/escape-regexp';
import {
  utils,
  escapeRegExp as indexEscapeRegExp,
  escapeRegex as indexEscapeRegex,
  globToRegExp as indexGlobToRegExp,
} from '../../../index';

describe('core/utils/regex - RegExp & Glob Utilities', () => {
  describe('escapeRegExp', () => {
    it('escapes all 14 special regex characters', () => {
      const allSpecials = '\\ ^ $ * + ? . ( ) | [ ] { }';
      const escaped = escapeRegExp(allSpecials);
      expect(escaped).toBe('\\\\ \\^ \\$ \\* \\+ \\? \\. \\( \\) \\| \\[ \\] \\{ \\}');

      const regex = new RegExp(escaped);
      expect(regex.test(allSpecials)).toBe(true);
      expect(regex.test('plain text')).toBe(false);
    });

    it('safely handles non-string, null, and undefined inputs', () => {
      expect(escapeRegExp(null)).toBe('');
      expect(escapeRegExp(undefined)).toBe('');
      expect(escapeRegExp('')).toBe('');
      expect(escapeRegExp(12345)).toBe('12345');
      expect(escapeRegExp(true)).toBe('true');
    });

    it('prevents regex injection and ReDoS vulnerabilities', () => {
      const malicious = '(a+)+$';
      const escaped = escapeRegExp(malicious);
      const re = new RegExp(`^${escaped}$`);
      expect(re.test('(a+)+$')).toBe(true);
      expect(re.test('aaaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
    });

    it('provides escapeRegex alias identical to escapeRegExp', () => {
      expect(escapeRegex).toBe(escapeRegExp);
      expect(escapeRegex('price (USD) * 1.2')).toBe('price \\(USD\\) \\* 1\\.2');
    });

    it('exports via direct module core/utils/escape-regexp', () => {
      expect(escapeRegExpDirect).toBe(escapeRegExp);
      expect(escapeRegExpDirect.escapeRegExp).toBe(escapeRegExp);
      expect(escapeRegExpDirect.escapeRegex).toBe(escapeRegExp);
      expect(escapeRegExpDirect('[tag]')).toBe('\\[tag\\]');
    });

    it('exports via index and utils', () => {
      expect(indexEscapeRegExp).toBe(escapeRegExp);
      expect(indexEscapeRegex).toBe(escapeRegExp);
      expect(utils.escapeRegExp('test.*')).toBe('test\\.\\*');
      expect(utils.escapeRegex('test.*')).toBe('test\\.\\*');
    });
  });

  describe('globToRegExp', () => {
    describe('default / separator (URL & Path globbing)', () => {
      it('matches single wildcard * within segment', () => {
        const re = globToRegExp('/api/*');
        expect(re.test('/api/users')).toBe(true);
        expect(re.test('/api/products')).toBe(true);
        expect(re.test('/api/users/123')).toBe(false);
        expect(re.test('/other/path')).toBe(false);
      });

      it('matches globstar ** across segments', () => {
        const re = globToRegExp('/api/**');
        expect(re.test('/api/users')).toBe(true);
        expect(re.test('/api/users/123')).toBe(true);
        expect(re.test('/api/v1/auth/login')).toBe(true);
        expect(re.test('/public/logo.png')).toBe(false);
      });

      it('matches single character wildcard ?', () => {
        const re = globToRegExp('/file?.js');
        expect(re.test('/file1.js')).toBe(true);
        expect(re.test('/fileA.js')).toBe(true);
        expect(re.test('/file12.js')).toBe(false);
      });

      it('matches universal wildcards * and **', () => {
        const star = globToRegExp('*');
        const dstar = globToRegExp('**');
        expect(star.test('anything/at/all')).toBe(true);
        expect(dstar.test('anything/at/all')).toBe(true);
      });

      it('escapes literal regex characters in pattern correctly', () => {
        const re = globToRegExp('/api/v1.[0-9]+/(user|admin)/*');
        expect(re.test('/api/v1.[0-9]+/(user|admin)/profile')).toBe(true);
        expect(re.test('/api/v1.0/user/profile')).toBe(false);
      });

      it('supports flags and exact=false', () => {
        const re = globToRegExp('USER/*', { flags: 'i', exact: false });
        expect(re.test('prefix/user/123/suffix')).toBe(true);
      });
    });

    describe('separator: . (Event & Dot-notation globbing)', () => {
      it('matches single segment wildcard *', () => {
        const re = globToRegExp('order.*', { separator: '.' });
        expect(re.test('order.created')).toBe(true);
        expect(re.test('order.updated')).toBe(true);
        expect(re.test('order.item.created')).toBe(false);
        expect(re.test('user.created')).toBe(false);
      });

      it('matches multi segment wildcard **', () => {
        const re = globToRegExp('order.**', { separator: '.' });
        expect(re.test('order.created')).toBe(true);
        expect(re.test('order.item.created')).toBe(true);
        expect(re.test('order.item.line.taxed')).toBe(true);
        expect(re.test('user.created')).toBe(false);
      });

      it('matches wildcard in middle of pattern', () => {
        const re = globToRegExp('order.*.shipped', { separator: '.' });
        expect(re.test('order.express.shipped')).toBe(true);
        expect(re.test('order.standard.shipped')).toBe(true);
        expect(re.test('order.shipped')).toBe(false);
        expect(re.test('order.intl.express.shipped')).toBe(false);
      });
    });

    describe('separator: null (Flat wildcard matching)', () => {
      it('matches * across any characters with full regex escaping', () => {
        const re = globToRegExp('user+account.*', { separator: null });
        expect(re.test('user+account.created')).toBe(true);
        expect(re.test('user+account.profile.updated')).toBe(true);
        expect(re.test('user-account.created')).toBe(false);
      });

      it('supports case-insensitive matching with flags', () => {
        const re = globToRegExp('USER(VIP).*', { separator: null, flags: 'i' });
        expect(re.test('user(vip).login')).toBe(true);
        expect(re.test('USER(VIP).LOGOUT')).toBe(true);
        expect(re.test('user(normal).login')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('handles non-string inputs safely', () => {
        expect(globToRegExp(null).test('')).toBe(false);
        expect(globToRegExp(undefined).test('')).toBe(false);
        expect(globToRegExp(123).test('')).toBe(false);
        expect(globToRegExp(null, { exact: false }).test('anything')).toBe(true);
      });
    });

    it('exports via index and utils', () => {
      expect(indexGlobToRegExp).toBe(globToRegExp);
      const re = utils.globToRegExp('admin/**', { separator: '/' });
      expect(re.test('admin/users/edit')).toBe(true);
    });
  });
});
