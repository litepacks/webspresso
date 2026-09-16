import { describe, it, expect, vi } from 'vitest';
import {
  RouteTable,
  compileRouteTable,
  compareRouteOrder,
  getRouteSortMeta,
} from '../../../src/routing/route-table';

describe('RouteTable & Compiler', () => {
  describe('Deterministic Sorting', () => {
    it('should sort static routes before parameterized and catch-all routes', () => {
      const descriptors = [
        { method: 'GET', path: '/docs/*path', file: 'docs/[...path].js' },
        { method: 'GET', path: '/users/:id', file: 'users/[id].js' },
        { method: 'GET', path: '/users/active', file: 'users/active.js' },
        { method: 'GET', path: '/', file: 'index.js' },
        { method: 'GET', path: '/about', file: 'about.js' },
      ];

      const table = compileRouteTable(descriptors);
      const paths = table.routes.map((r) => r.path);

      expect(paths).toEqual([
        '/users/active',
        '/about',
        '/',
        '/users/:id',
        '/docs/*path',
      ]);
    });
  });

  describe('Conflict Detection', () => {
    it('should throw descriptive startup error when duplicate METHOD + PATH is registered', () => {
      const descriptors = [
        {
          method: 'GET',
          path: '/auth/login',
          file: '/app/modules/auth/pages/login.js',
          source: 'modules/auth/pages/login.js',
        },
        {
          method: 'GET',
          path: '/auth/login',
          file: '/app/modules/account/pages/auth/login.js',
          source: 'modules/account/pages/auth/login.js',
        },
      ];

      expect(() => compileRouteTable(descriptors)).toThrow(
        /Route conflict detected:[\s\S]*GET \/auth\/login[\s\S]*modules\/auth\/pages\/login\.js[\s\S]*modules\/account\/pages\/auth\/login\.js/
      );
    });

    it('should allow same path if HTTP methods are different', () => {
      const descriptors = [
        { method: 'GET', path: '/auth/login', file: 'modules/auth/pages/login.js' },
        { method: 'POST', path: '/auth/login', file: 'modules/auth/api/login.post.js' },
      ];

      const table = compileRouteTable(descriptors);
      expect(table.size).toBe(2);
      expect(table.has('GET', '/auth/login')).toBe(true);
      expect(table.has('POST', '/auth/login')).toBe(true);
    });
  });

  describe('Explicit Route Precedence', () => {
    it('should prioritize explicit routes over generated file routes with warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const descriptors = [
        { method: 'POST', path: '/api/users', file: 'src/api/users.post.js' },
      ];

      const explicitRoutes = [
        { method: 'POST', path: '/api/users', handler: () => {} },
      ];

      const table = compileRouteTable(descriptors, { explicitRoutes, isDev: true });
      expect(table.size).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated route POST /api/users was overridden by an explicit route.')
      );

      warnSpy.mockRestore();
    });
  });

  describe('Introspection API', () => {
    it('should list all registered routes with metadata for CLI and debugging', () => {
      const descriptors = [
        {
          type: 'page',
          method: 'GET',
          path: '/auth/login',
          module: 'auth',
          source: 'modules/auth/pages/login.js',
          file: '/app/modules/auth/pages/login.js',
        },
        {
          type: 'api',
          method: 'POST',
          path: '/api/auth/login',
          module: 'auth',
          source: 'modules/auth/api/login.post.js',
          file: '/app/modules/auth/api/login.post.js',
          description: 'Authenticate user',
          tags: ['Auth'],
        },
      ];

      const table = compileRouteTable(descriptors);
      const list = table.list();

      expect(list).toEqual([
        {
          method: 'POST',
          path: '/api/auth/login',
          type: 'api',
          module: 'auth',
          source: 'modules/auth/api/login.post.js',
          description: 'Authenticate user',
          tags: ['Auth'],
        },
        {
          method: 'GET',
          path: '/auth/login',
          type: 'page',
          module: 'auth',
          source: 'modules/auth/pages/login.js',
          description: undefined,
          tags: undefined,
        },
      ]);

      expect(table.get('GET', '/auth/login')).toBeDefined();
      expect(table.has('DELETE', '/auth/login')).toBe(false);
    });
  });

  describe('Edge Cases & Defensive Handling', () => {
    it('should handle null, undefined, or empty descriptors without throwing', () => {
      const tableEmpty = compileRouteTable();
      expect(tableEmpty.size).toBe(0);

      const tableWithNulls = compileRouteTable([null, undefined, {}, { method: 'GET', path: '/valid' }]);
      expect(tableWithNulls.size).toBe(1);
      expect(tableWithNulls.has('GET', '/valid')).toBe(true);

      const defaultTable = new RouteTable();
      expect(defaultTable.size).toBe(0);
      expect(defaultTable.list()).toEqual([]);
    });

    it('should calculate route sorting metadata with getRouteSortMeta', () => {
      const staticMeta = getRouteSortMeta('/users/profile');
      expect(staticMeta.tier).toBe(0);
      expect(staticMeta.depth).toBe(2);

      const paramMeta = getRouteSortMeta('/users/:id');
      expect(paramMeta.tier).toBe(1);
      expect(paramMeta.paramSegCount).toBe(1);

      const catchAllMeta = getRouteSortMeta('/docs/*path');
      expect(catchAllMeta.tier).toBe(2);
    });

    it('should mount discovered routes with mountDiscoveredRoutes', () => {
      const express = require('express');
      const { mountDiscoveredRoutes } = require('../../../src/routing/mount-discovered-routes');

      const app = express();
      const descriptors = [
        { type: 'page', method: 'GET', path: '/static-page', file: 'static.js' },
        { type: 'api', method: 'GET', path: '/users/:id', file: 'user.get.js' },
      ];

      const table = compileRouteTable(descriptors);
      const { routeMetadata, registerDynamicDiscoveredRoutes } = mountDiscoveredRoutes(app, table, { silent: true });

      expect(routeMetadata.length).toBe(2);
      expect(typeof registerDynamicDiscoveredRoutes).toBe('function');

      // Call deferred dynamic registration
      expect(() => registerDynamicDiscoveredRoutes()).not.toThrow();
    });

    it('should cover all branches in compareRouteOrder and RouteTable methods', () => {
      const { compareRouteOrder } = require('../../../src/routing/route-table');

      // 1. Same tier, different literalSegCount
      const r1 = { path: '/api/v1/users', method: 'GET' };
      const r2 = { path: '/users', method: 'GET' };
      expect(compareRouteOrder(r1, r2)).toBeLessThan(0);

      // 2. Same tier & literal, different depth
      const r3 = { path: '/a/b', method: 'GET' };
      const r4 = { path: '/ab', method: 'GET' };
      expect(compareRouteOrder(r3, r4)).toBeLessThan(0);

      // 3. Different param counts
      const r5 = { path: '/users/:id/posts/:pid', method: 'GET' };
      const r6 = { path: '/users/:id', method: 'GET' };
      expect(compareRouteOrder(r5, r6)).toBeLessThan(0);

      // 4. Fallback alphabetical
      const r7 = { path: '/beta', method: 'GET' };
      const r8 = { path: '/alpha', method: 'GET' };
      expect(compareRouteOrder(r7, r8)).toBeGreaterThan(0);

      // 5. Explicit route with default method (undefined r.method)
      const table = compileRouteTable(
        [{ method: 'GET', path: '/test-explicit', file: 'test.js' }],
        { explicitRoutes: [{ path: '/test-explicit' }] }
      );
      expect(table.size).toBe(0);

      // 6. routeTable.get non-existent
      expect(table.get('GET', '/not-found')).toBeUndefined();
    });
  });
});
