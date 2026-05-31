import { describe, it, expect } from 'vitest';
import path from 'path';
import { enrichRoutes, filterRoutes, isPluginOwnedPath } from '../../core/studio/route-enrich.js';

describe('studio route manifest', () => {
  it('marks plugin-owned paths', () => {
    expect(isPluginOwnedPath('/_admin/users')).toBe(true);
    expect(isPluginOwnedPath('/hello')).toBe(false);
  });

  it('enriches file routes', () => {
    const routes = enrichRoutes(
      [
        {
          type: 'api',
          method: 'get',
          pattern: '/api/test',
          file: 'pages/api/test.get.js',
          isDynamic: false,
        },
      ],
      { pagesDir: path.join(process.cwd(), 'tests/fixtures/pages'), isDev: false }
    );
    expect(routes[0].path).toBe('/api/test');
    expect(routes[0].pluginOwned).toBe(false);
  });

  it('filters by method', () => {
    const routes = [
      { method: 'get', path: '/', type: 'page', authRequired: false, pluginOwned: false },
      { method: 'post', path: '/api', type: 'api', authRequired: true, pluginOwned: false },
    ];
    const filtered = filterRoutes(routes, { method: 'post' });
    expect(filtered).toHaveLength(1);
  });
});
