import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { scanRoutes } from '../../../src/discovery/scan-routes';

describe('scanRoutes Directory Scanner', () => {
  const fullstackRoot = path.resolve(__dirname, '../../fixtures/fullstack');

  it('should scan fullstack fixture root and discover pages, api, and module routes', () => {
    const routes = scanRoutes({ rootDir: fullstackRoot });

    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('GET /about');
    expect(paths).toContain('GET /api/health');
    expect(paths).toContain('GET /auth/login');
    expect(paths).toContain('POST /api/auth/login');
  });

  it('should respect opt-out flags (pages: false, api: false, modules: false)', () => {
    const noPages = scanRoutes({ rootDir: fullstackRoot, pages: false });
    expect(noPages.some((r) => r.type === 'page' && !r.module)).toBe(false);

    const noApi = scanRoutes({ rootDir: fullstackRoot, api: false });
    expect(noApi.some((r) => r.type === 'api' && !r.module)).toBe(false);

    const noModules = scanRoutes({ rootDir: fullstackRoot, modules: false });
    expect(noModules.some((r) => r.module !== null)).toBe(false);

    const empty = scanRoutes({
      rootDir: fullstackRoot,
      pages: false,
      api: false,
      modules: false,
    });
    expect(empty).toEqual([]);
  });

  it('should support custom directories and prefixes', () => {
    const routes = scanRoutes({
      rootDir: fullstackRoot,
      pages: { dir: 'src/pages', prefix: '/portal' },
      api: { dir: 'src/api', prefix: '/api/v1' },
      modules: { dir: 'src/modules' },
    });

    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/portal/about');
    expect(paths).toContain('/api/v1/health');
  });

  it('should handle non-existent directories gracefully', () => {
    const routes = scanRoutes({
      rootDir: '/non/existent/project/path',
      pages: { dir: 'nowhere' },
      api: { dir: 'nowhere' },
      modules: { dir: 'nowhere' },
    });

    expect(routes).toEqual([]);
  });

  it('should skip .njk templates and companion .js loaders in pages scanning', () => {
    const routes = scanRoutes({
      rootDir: fullstackRoot,
      api: false,
      modules: false,
    });

    // None of the descriptors should end in .njk
    for (const r of routes) {
      expect(r.file.endsWith('.njk')).toBe(false);
    }
  });

  it('should skip pages/api subdirectory and companion njk files in scanRoutes', () => {
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-edge-'));

    try {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      // 1. Standalone JS page
      fs.writeFileSync(path.join(pagesDir, 'standalone.js'), 'module.exports = () => "ok";');

      // 2. Companion JS + NJK pair
      fs.writeFileSync(path.join(pagesDir, 'companion.js'), 'module.exports = { load: () => {} };');
      fs.writeFileSync(path.join(pagesDir, 'companion.njk'), '<h1>Companion</h1>');

      // 3. API route inside pages/api
      const pagesApiDir = path.join(pagesDir, 'api');
      fs.mkdirSync(pagesApiDir, { recursive: true });
      fs.writeFileSync(path.join(pagesApiDir, 'inside-pages.get.js'), 'module.exports = () => "api";');

      // 4. Ignored / private files (.hidden, _private, txt)
      fs.writeFileSync(path.join(pagesDir, '_private.js'), 'module.exports = () => {};');
      fs.writeFileSync(path.join(pagesDir, '.hidden.js'), 'module.exports = () => {};');
      fs.writeFileSync(path.join(pagesDir, 'notes.txt'), 'notes');

      const routes = scanRoutes({
        rootDir: tempDir,
        api: false,
        modules: false,
      });

      const paths = routes.map((r) => r.path);
      expect(paths).toContain('/standalone');
      expect(paths).not.toContain('/companion');
      expect(paths).not.toContain('/api/inside-pages');
      expect(paths).not.toContain('/_private');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should support module pages and api opt-outs or custom options', () => {
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-opts-'));

    try {
      const modDir = path.join(tempDir, 'modules', 'shop');
      fs.mkdirSync(path.join(modDir, 'pages'), { recursive: true });
      fs.mkdirSync(path.join(modDir, 'api'), { recursive: true });

      fs.writeFileSync(
        path.join(modDir, 'module.js'),
        'module.exports = { pages: { prefix: "/store" }, api: false };'
      );
      fs.writeFileSync(path.join(modDir, 'pages', 'cart.js'), 'module.exports = () => "cart";');
      fs.writeFileSync(path.join(modDir, 'api', 'cart.get.js'), 'module.exports = () => "cart-api";');

      const routes = scanRoutes({
        rootDir: tempDir,
        pages: false,
        api: false,
      });

      const paths = routes.map((r) => r.path);
      expect(paths).toContain('/store/cart');
      expect(paths).not.toContain('/api/shop/cart');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
