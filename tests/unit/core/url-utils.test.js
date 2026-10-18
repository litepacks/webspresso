import { describe, it, expect } from 'vitest';
import {
  stripTrailingSlash,
  ensureLeadingSlash,
  ensureTrailingSlash,
  stripLeadingSlash,
  joinUrl,
  trimUrlPathSlashes,
} from '../../../core/utils/url';
import stripTrailingSlashDirect from '../../../core/utils/strip-trailing-slash';
import ensureLeadingSlashDirect from '../../../core/utils/ensure-leading-slash';
import {
  utils,
  stripTrailingSlash as indexStripTrailing,
  ensureLeadingSlash as indexEnsureLeading,
  ensureTrailingSlash as indexEnsureTrailing,
  stripLeadingSlash as indexStripLeading,
  joinUrl as indexJoinUrl,
} from '../../../index';
import { buildMagicLinkUrl } from '../../../core/auth/magic-link';

describe('core/utils/url - URL & Path Formatting Utilities', () => {
  describe('stripTrailingSlash', () => {
    it('handles null, undefined, and non-string inputs safely', () => {
      expect(stripTrailingSlash(null)).toBe('');
      expect(stripTrailingSlash(undefined)).toBe('');
      expect(stripTrailingSlash('')).toBe('');
      expect(stripTrailingSlash(123)).toBe('123');
    });

    it('strips single and multiple trailing slashes', () => {
      expect(stripTrailingSlash('http://localhost:7331/')).toBe('http://localhost:7331');
      expect(stripTrailingSlash('http://localhost:7331///')).toBe('http://localhost:7331');
      expect(stripTrailingSlash('/api/users/')).toBe('/api/users');
      expect(stripTrailingSlash('/api/users///')).toBe('/api/users');
      expect(stripTrailingSlash('/api/users')).toBe('/api/users');
    });

    it('handles root slashes with preserveRoot option', () => {
      expect(stripTrailingSlash('/')).toBe('');
      expect(stripTrailingSlash('///')).toBe('');
      expect(stripTrailingSlash('/', { preserveRoot: true })).toBe('/');
      expect(stripTrailingSlash('///', { preserveRoot: true })).toBe('/');
      expect(stripTrailingSlash('/users/', { preserveRoot: true })).toBe('/users');
    });
  });

  describe('ensureLeadingSlash', () => {
    it('handles null, undefined, and empty string', () => {
      expect(ensureLeadingSlash(null)).toBe('/');
      expect(ensureLeadingSlash(undefined)).toBe('/');
      expect(ensureLeadingSlash('')).toBe('/');
      expect(ensureLeadingSlash('   ')).toBe('/');
    });

    it('ensures single leading slash on paths without one', () => {
      expect(ensureLeadingSlash('api/users')).toBe('/api/users');
      expect(ensureLeadingSlash('users')).toBe('/users');
    });

    it('leaves paths with existing leading slash unchanged', () => {
      expect(ensureLeadingSlash('/api/users')).toBe('/api/users');
      expect(ensureLeadingSlash('/')).toBe('/');
    });
  });

  describe('ensureTrailingSlash', () => {
    it('handles null, undefined, and empty string', () => {
      expect(ensureTrailingSlash(null)).toBe('/');
      expect(ensureTrailingSlash(undefined)).toBe('/');
      expect(ensureTrailingSlash('')).toBe('/');
    });

    it('adds trailing slash when missing', () => {
      expect(ensureTrailingSlash('/api/users')).toBe('/api/users/');
      expect(ensureTrailingSlash('https://example.com')).toBe('https://example.com/');
    });

    it('leaves existing trailing slash intact', () => {
      expect(ensureTrailingSlash('/api/users/')).toBe('/api/users/');
      expect(ensureTrailingSlash('/')).toBe('/');
    });
  });

  describe('stripLeadingSlash', () => {
    it('handles null, undefined, and empty string', () => {
      expect(stripLeadingSlash(null)).toBe('');
      expect(stripLeadingSlash(undefined)).toBe('');
      expect(stripLeadingSlash('')).toBe('');
    });

    it('removes single and repeated leading slashes', () => {
      expect(stripLeadingSlash('/api/users')).toBe('api/users');
      expect(stripLeadingSlash('///api/users')).toBe('api/users');
      expect(stripLeadingSlash('api/users')).toBe('api/users');
      expect(stripLeadingSlash('/')).toBe('');
    });
  });

  describe('joinUrl', () => {
    it('joins base URL and fragments without duplicate slashes', () => {
      expect(joinUrl('https://example.com/', '/api/', '/v1/users')).toBe('https://example.com/api/v1/users');
      expect(joinUrl('https://example.com', 'api', 'users')).toBe('https://example.com/api/users');
      expect(joinUrl('/admin', '/settings/')).toBe('/admin/settings');
    });

    it('handles empty fragments gracefully', () => {
      expect(joinUrl('https://example.com', null, undefined, 'api')).toBe('https://example.com/api');
      expect(joinUrl('', 'api', 'v1')).toBe('api/v1');
    });
  });

  describe('trimUrlPathSlashes re-export', () => {
    it('trims leading and trailing slashes in linear time', () => {
      expect(trimUrlPathSlashes('///api/users///')).toBe('api/users');
      expect(trimUrlPathSlashes(null)).toBe('');
    });
  });

  describe('Direct and Index Re-exports', () => {
    it('provides consistent functions across exports', () => {
      expect(typeof stripTrailingSlashDirect).toBe('function');
      expect(stripTrailingSlashDirect('/foo/')).toBe('/foo');
      expect(typeof ensureLeadingSlashDirect).toBe('function');
      expect(ensureLeadingSlashDirect('foo')).toBe('/foo');

      expect(typeof indexStripTrailing).toBe('function');
      expect(typeof indexEnsureLeading).toBe('function');
      expect(typeof indexEnsureTrailing).toBe('function');
      expect(typeof indexStripLeading).toBe('function');
      expect(typeof indexJoinUrl).toBe('function');

      expect(typeof utils.stripTrailingSlash).toBe('function');
      expect(typeof utils.ensureLeadingSlash).toBe('function');
      expect(typeof utils.ensureTrailingSlash).toBe('function');
      expect(typeof utils.stripLeadingSlash).toBe('function');
      expect(typeof utils.joinUrl).toBe('function');
    });
  });

  describe('Consumer Verification: buildMagicLinkUrl', () => {
    it('correctly constructs magic link URLs without double slashes', () => {
      const url = buildMagicLinkUrl({
        baseUrl: 'https://mysite.com///',
        path: 'auth/magic-link/verify',
        token: 'secret123',
      });
      expect(url).toBe('https://mysite.com/auth/magic-link/verify?token=secret123');
    });
  });
});
