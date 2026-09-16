import { describe, it, expect } from 'vitest';
import {
  parseFileRoute,
  isPrivateOrIgnored,
  transformDynamicSegment,
  normalizePrefix,
} from '../../../src/discovery/file-route-parser';

describe('File Route Parser', () => {
  describe('Page Route Parsing', () => {
    it('should parse root index and normal pages', () => {
      expect(parseFileRoute('index.js')).toEqual({
        path: '/',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(parseFileRoute('about.js')).toEqual({
        path: '/about',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });
    });

    it('should parse nested index and sub-pages', () => {
      expect(parseFileRoute('blog/index.js')).toEqual({
        path: '/blog',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(parseFileRoute('blog/archive.js')).toEqual({
        path: '/blog/archive',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });
    });

    it('should parse dynamic parameters and catch-all routes', () => {
      expect(parseFileRoute('blog/[slug].js')).toEqual({
        path: '/blog/:slug',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(parseFileRoute('docs/[...path].js')).toEqual({
        path: '/docs/*path',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });
    });

    it('should apply custom prefixes', () => {
      expect(parseFileRoute('login.js', { prefix: '/auth' })).toEqual({
        path: '/auth/login',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(parseFileRoute('index.js', { prefix: '/shop' })).toEqual({
        path: '/shop',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });
    });
  });

  describe('API Route Parsing & HTTP Methods', () => {
    it('should parse API routes with HTTP method suffixes', () => {
      expect(parseFileRoute('health.get.js', { type: 'api', prefix: '/api' })).toEqual({
        path: '/api/health',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: 'get',
      });

      expect(parseFileRoute('users.post.js', { type: 'api', prefix: '/api' })).toEqual({
        path: '/api/users',
        method: 'POST',
        isValid: true,
        isPrivate: false,
        originalMethodPart: 'post',
      });

      expect(parseFileRoute('users/[id].patch.js', { type: 'api', prefix: '/api' })).toEqual({
        path: '/api/users/:id',
        method: 'PATCH',
        isValid: true,
        isPrivate: false,
        originalMethodPart: 'patch',
      });

      expect(parseFileRoute('users/[id].delete.js', { type: 'api', prefix: '/api' })).toEqual({
        path: '/api/users/:id',
        method: 'DELETE',
        isValid: true,
        isPrivate: false,
        originalMethodPart: 'delete',
      });
    });

    it('should reject invalid HTTP methods in filenames', () => {
      const result = parseFileRoute('users.invalidMethod.js', { type: 'api' });
      expect(result.isValid).toBe(false);
      expect(result.invalidMethod).toBe(true);
    });
  });

  describe('Private & Ignored Files/Directories', () => {
    it('should ignore files and directories starting with _', () => {
      expect(isPrivateOrIgnored('_components')).toBe(true);
      expect(isPrivateOrIgnored('_helpers')).toBe(true);
      expect(isPrivateOrIgnored('_private.js')).toBe(true);

      const parsed = parseFileRoute('blog/_components/card.js');
      expect(parsed.isPrivate).toBe(true);
      expect(parsed.isValid).toBe(false);
    });

    it('should ignore hidden and temporary editor files', () => {
      expect(isPrivateOrIgnored('.DS_Store')).toBe(true);
      expect(isPrivateOrIgnored('.login.js.swp')).toBe(true);
      expect(isPrivateOrIgnored('login.js~')).toBe(true);
      expect(isPrivateOrIgnored('temp.tmp')).toBe(true);

      const parsed = parseFileRoute('.DS_Store');
      expect(parsed.isPrivate).toBe(true);
      expect(parsed.isValid).toBe(false);
    });
  });

  describe('Edge Cases & Malformed Inputs', () => {
    it('should handle null, undefined, and non-string inputs safely', () => {
      expect(parseFileRoute(null).isValid).toBe(false);
      expect(parseFileRoute(undefined).isValid).toBe(false);
      expect(parseFileRoute(12345).isValid).toBe(false);
      expect(parseFileRoute({}).isValid).toBe(false);
    });

    it('should handle empty brackets and empty param names safely', () => {
      expect(transformDynamicSegment('[]')).toBe('[]');
      expect(transformDynamicSegment('[...]')).toBe('*');
      expect(transformDynamicSegment(null)).toBe('');
      expect(transformDynamicSegment(undefined)).toBe('');
    });

    it('should normalize invalid and messy prefixes safely', () => {
      expect(normalizePrefix('/')).toBe('');
      expect(normalizePrefix('///')).toBe('');
      expect(normalizePrefix(null)).toBe('');
      expect(normalizePrefix('/api///')).toBe('/api');
    });

    it('should safely scan directories with scanDirSafely', () => {
      const path = require('path');
      const { scanDirSafely } = require('../../../src/discovery/file-route-parser');

      // Non-existent directory
      expect(scanDirSafely('/non/existent/path')).toEqual([]);

      // Existing fixtures directory
      const fixtureDir = path.resolve(__dirname, '../../fixtures/fullstack/src/pages');
      const results = scanDirSafely(fixtureDir);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].relativePath).toBeDefined();
    });

    it('should parse .njk files and handle root/empty routes', () => {
      expect(parseFileRoute('index.njk')).toEqual({
        path: '/',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(parseFileRoute('about.njk')).toEqual({
        path: '/about',
        method: 'GET',
        isValid: true,
        isPrivate: false,
        originalMethodPart: null,
      });

      expect(isPrivateOrIgnored(null)).toBe(true);
      expect(isPrivateOrIgnored('')).toBe(true);
      expect(isPrivateOrIgnored(123)).toBe(true);
    });
  });
});
