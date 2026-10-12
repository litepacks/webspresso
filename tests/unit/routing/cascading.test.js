import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import {
  getDirectoryChain,
  templateHasExtends,
  findCascadingMiddlewareFiles,
  loadCascadingMiddlewares,
  runMiddleware,
  runMiddlewareChain,
  findCascadingLayouts,
  executeCascadingLayoutLoads,
  applyCascadingLayouts,
  clearCascadingCaches,
} from '../../../src/routing/cascading';
import { createApp } from '../../../src/server';

describe('Cascading Middleware & Nested Layouts', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-cascading-test-'));
    clearCascadingCaches();
  });

  afterEach(() => {
    clearCascadingCaches();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getDirectoryChain', () => {
    it('returns [""] for files in the root folder', () => {
      expect(getDirectoryChain('index.njk')).toEqual(['']);
      expect(getDirectoryChain('about.njk')).toEqual(['']);
      expect(getDirectoryChain('./index.njk')).toEqual(['']);
    });

    it('returns root and single directory for 1-level deep files', () => {
      expect(getDirectoryChain('dashboard/index.njk')).toEqual(['', 'dashboard']);
      expect(getDirectoryChain('api/users.get.js')).toEqual(['', 'api']);
    });

    it('returns complete top-down hierarchy for nested paths', () => {
      expect(getDirectoryChain('dashboard/settings/profile.njk')).toEqual([
        '',
        'dashboard',
        'dashboard/settings',
      ]);
      expect(getDirectoryChain('api/v1/admin/users.get.js')).toEqual([
        '',
        'api',
        'api/v1',
        'api/v1/admin',
      ]);
    });

    it('handles Windows backslashes properly', () => {
      expect(getDirectoryChain('dashboard\\settings\\profile.njk')).toEqual([
        '',
        'dashboard',
        'dashboard/settings',
      ]);
    });
  });

  describe('templateHasExtends', () => {
    it('detects {% extends ... %} in template body', () => {
      expect(templateHasExtends('{% extends "views/layout.njk" %}\n<h1>Content</h1>')).toBe(true);
      expect(templateHasExtends("{%   extends   'base.njk' %}")).toBe(true);
      expect(templateHasExtends('<h1>No layout</h1>')).toBe(false);
      expect(templateHasExtends(null)).toBe(false);
      expect(templateHasExtends(undefined)).toBe(false);
    });

    it('detects extends statement in file on disk if templateBody is not supplied', () => {
      const filePath = path.join(tempDir, 'test.njk');
      fs.writeFileSync(filePath, '{% extends "layout.njk" %}<p>Hi</p>');
      expect(templateHasExtends(null, filePath)).toBe(true);

      const filePathNoExtends = path.join(tempDir, 'plain.njk');
      fs.writeFileSync(filePathNoExtends, '<p>Plain template</p>');
      expect(templateHasExtends(null, filePathNoExtends)).toBe(false);
    });
  });

  describe('findCascadingMiddlewareFiles', () => {
    it('finds existing _middleware.js files from root to leaf directory', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminDir = path.join(pagesDir, 'api', 'admin');
      fs.mkdirSync(adminDir, { recursive: true });

      const rootMw = path.join(pagesDir, '_middleware.js');
      const apiMw = path.join(pagesDir, 'api', '_middleware.js');
      const adminMw = path.join(adminDir, '_middleware.js');

      fs.writeFileSync(rootMw, 'module.exports = (req, res, next) => next();');
      fs.writeFileSync(apiMw, 'module.exports = (req, res, next) => next();');
      fs.writeFileSync(adminMw, 'module.exports = (req, res, next) => next();');

      const found = findCascadingMiddlewareFiles(pagesDir, 'api/admin/users.get.js', true);
      expect(found).toEqual([rootMw, apiMw, adminMw]);
    });

    it('skips missing intermediary _middleware.js files', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminDir = path.join(pagesDir, 'api', 'admin');
      fs.mkdirSync(adminDir, { recursive: true });

      const rootMw = path.join(pagesDir, '_middleware.js');
      const adminMw = path.join(adminDir, '_middleware.js');

      fs.writeFileSync(rootMw, 'module.exports = (req, res, next) => next();');
      fs.writeFileSync(adminMw, 'module.exports = (req, res, next) => next();');

      const found = findCascadingMiddlewareFiles(pagesDir, 'api/admin/users.get.js', true);
      expect(found).toEqual([rootMw, adminMw]);
    });
  });

  describe('loadCascadingMiddlewares', () => {
    it('resolves functions, named middlewares, and options tuples', () => {
      const pagesDir = path.join(tempDir, 'pages');
      const subDir = path.join(pagesDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });

      const rootMw = path.join(pagesDir, '_middleware.js');
      const subMw = path.join(subDir, '_middleware.js');

      fs.writeFileSync(rootMw, 'module.exports = ["auth"];');
      fs.writeFileSync(
        subMw,
        'module.exports = { middleware: [["rateLimit", { max: 5 }], (req, res, next) => next()] };'
      );

      const registry = {
        auth: (req, res, next) => {
          req.authenticated = true;
          next();
        },
        rateLimit: (opts) => (req, res, next) => {
          req.rateLimitMax = opts.max;
          next();
        },
      };

      const resolved = loadCascadingMiddlewares(pagesDir, 'sub/page.njk', registry, true);
      expect(resolved.length).toBe(3);

      const req = {};
      const res = {};
      resolved[0](req, res, () => {});
      resolved[1](req, res, () => {});
      resolved[2](req, res, () => {});

      expect(req.authenticated).toBe(true);
      expect(req.rateLimitMax).toBe(5);
    });
  });

  describe('runMiddleware and runMiddlewareChain', () => {
    it('executes sync and async middlewares sequentially', async () => {
      const executionOrder = [];
      const chain = [
        (req, res, next) => {
          executionOrder.push('mw1');
          next();
        },
        async (req, res, next) => {
          await new Promise((r) => setTimeout(r, 10));
          executionOrder.push('mw2');
          next();
        },
        (req, res, next) => {
          executionOrder.push('mw3');
          next();
        },
      ];

      const req = {};
      const res = { headersSent: false, once: () => {}, removeListener: () => {} };

      await runMiddlewareChain(chain, req, res);
      expect(executionOrder).toEqual(['mw1', 'mw2', 'mw3']);
    });

    it('halts chain execution early when headers are sent (e.g. redirect/error)', async () => {
      const executionOrder = [];
      const chain = [
        (req, res, next) => {
          executionOrder.push('first');
          res.headersSent = true;
          // Middleware sends response without calling next()
        },
        (req, res, next) => {
          executionOrder.push('should_not_run');
          next();
        },
      ];

      const listeners = {};
      const res = {
        headersSent: false,
        once(event, fn) {
          listeners[event] = fn;
        },
        removeListener(event) {
          delete listeners[event];
        },
      };

      const chainPromise = runMiddlewareChain(chain, {}, res);
      // Simulate finish event triggered by response end
      if (listeners['finish']) listeners['finish']();
      await chainPromise;

      expect(executionOrder).toEqual(['first']);
    });

    it('propagates middleware errors to caller', async () => {
      const chain = [
        (req, res, next) => {
          next(new Error('Auth failed'));
        },
      ];

      const res = { headersSent: false, once: () => {}, removeListener: () => {} };
      await expect(runMiddlewareChain(chain, {}, res)).rejects.toThrow('Auth failed');
    });
  });

  describe('findCascadingLayouts and executeCascadingLayoutLoads', () => {
    it('discovers layout files and executes load() in outermost-first order', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminDir = path.join(pagesDir, 'admin');
      const settingsDir = path.join(adminDir, 'settings');
      fs.mkdirSync(settingsDir, { recursive: true });

      // Root layout & loader
      fs.writeFileSync(path.join(pagesDir, '_layout.njk'), '<html>{{ content | safe }}</html>');
      fs.writeFileSync(
        path.join(pagesDir, '_layout.js'),
        'module.exports = { load: async () => ({ siteName: "Webspresso App" }) };'
      );

      // Admin layout & loader
      fs.writeFileSync(
        path.join(adminDir, '_layout.njk'),
        '<div class="admin">{{ content | safe }}</div>'
      );
      fs.writeFileSync(
        path.join(adminDir, '_layout.js'),
        'module.exports = { load: async () => ({ section: "Admin Panel" }) };'
      );

      const layouts = findCascadingLayouts(pagesDir, 'admin/settings/profile.njk', true);
      expect(layouts.length).toBe(2);
      expect(layouts[0].layoutRelPath).toBe('_layout.njk');
      expect(layouts[1].layoutRelPath).toBe('admin/_layout.njk');

      const ctx = { data: {} };
      await executeCascadingLayoutLoads(layouts, {}, ctx, true);

      expect(ctx.data.siteName).toBe('Webspresso App');
      expect(ctx.data.section).toBe('Admin Panel');
    });
  });

  describe('applyCascadingLayouts', () => {
    it('wraps HTML from innermost to outermost layout', () => {
      const fakeNunjucks = {
        render: (tplPath, context) => {
          if (tplPath === 'admin/_layout.njk') {
            return `<div class="admin">${context.content}</div>`;
          }
          if (tplPath === '_layout.njk') {
            return `<html><body>${context.content}</body></html>`;
          }
          return context.content;
        },
      };

      const layouts = [
        { layoutRelPath: '_layout.njk', fullPath: '' },
        { layoutRelPath: 'admin/_layout.njk', fullPath: '' },
      ];

      const pageHtml = '<h1>Page Content</h1>';
      const result = applyCascadingLayouts(fakeNunjucks, layouts, pageHtml, {});

      expect(result).toBe('<html><body><div class="admin"><h1>Page Content</h1></div></body></html>');
    });

    it('returns original HTML if layouts array is empty', () => {
      const result = applyCascadingLayouts({}, [], '<h1>Hello</h1>', {});
      expect(result).toBe('<h1>Hello</h1>');
    });
  });

  describe('End-to-End Server Integration', () => {
    it('applies cascading _middleware.js down folder hierarchy in API routes', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminApiDir = path.join(pagesDir, 'api', 'admin');
      fs.mkdirSync(adminApiDir, { recursive: true });

      // Root pages middleware: adds global header
      fs.writeFileSync(
        path.join(pagesDir, '_middleware.js'),
        `module.exports = (req, res, next) => {
          res.setHeader('X-Framework-Middleware', 'cascading-active');
          next();
        };`
      );

      // Admin API middleware: enforces authorization header
      fs.writeFileSync(
        path.join(adminApiDir, '_middleware.js'),
        `module.exports = (req, res, next) => {
          if (req.headers['x-admin-token'] !== 'secret123') {
            return res.status(401).json({ error: 'Unauthorized admin' });
          }
          next();
        };`
      );

      // Admin API route
      fs.writeFileSync(
        path.join(adminApiDir, 'metrics.get.js'),
        `module.exports = async (req, res) => {
          return res.json({ status: 'ok', adminAccess: true });
        };`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      // Unauthorized request should be blocked by admin _middleware.js with 401
      const resBlocked = await request(app).get('/api/admin/metrics');
      expect(resBlocked.status).toBe(401);
      expect(resBlocked.body.error).toBe('Unauthorized admin');
      expect(resBlocked.headers['x-framework-middleware']).toBe('cascading-active');

      // Authorized request succeeds
      const resAllowed = await request(app)
        .get('/api/admin/metrics')
        .set('x-admin-token', 'secret123');
      expect(resAllowed.status).toBe(200);
      expect(resAllowed.body.adminAccess).toBe(true);
      expect(resAllowed.headers['x-framework-middleware']).toBe('cascading-active');
    });

    it('wraps SSR pages in nested _layout.njk and populates data from _layout.js', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const dashboardDir = path.join(pagesDir, 'dashboard');
      fs.mkdirSync(dashboardDir, { recursive: true });

      // Root layout & loader
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<!DOCTYPE html><html><head><title>{{ siteTitle }}</title></head><body><header>Site Header</header>{{ content | safe }}</body></html>`
      );
      fs.writeFileSync(
        path.join(pagesDir, '_layout.js'),
        `module.exports = {
          load: async () => ({ siteTitle: 'My Corporate Site' })
        };`
      );

      // Dashboard layout
      fs.writeFileSync(
        path.join(dashboardDir, '_layout.njk'),
        `<div class="dashboard-wrapper"><aside>Sidebar</aside><main>{{ content | safe }}</main></div>`
      );

      // Dashboard page & loader
      fs.writeFileSync(
        path.join(dashboardDir, 'analytics.njk'),
        `<h1>Analytics: {{ metric }}</h1>`
      );
      fs.writeFileSync(
        path.join(dashboardDir, 'analytics.js'),
        `module.exports = {
          load: async () => ({ metric: 'Active Users 420' })
        };`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/dashboard/analytics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>My Corporate Site</title>');
      expect(res.text).toContain('Site Header');
      expect(res.text).toContain('<div class="dashboard-wrapper"><aside>Sidebar</aside>');
      expect(res.text).toContain('<h1>Analytics: Active Users 420</h1>');
    });

    it('respects layout: false opt-out in route config', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      // Root layout
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<div class="wrapper">{{ content | safe }}</div>`
      );

      // Page with layout: false opt-out
      fs.writeFileSync(path.join(pagesDir, 'standalone.njk'), `<h1>No Wrapper Here</h1>`);
      fs.writeFileSync(
        path.join(pagesDir, 'standalone.js'),
        `module.exports = {
          layout: false
        };`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/standalone');
      expect(res.status).toBe(200);
      expect(res.text).toBe('<h1>No Wrapper Here</h1>');
      expect(res.text).not.toContain('<div class="wrapper">');
    });

    it('skips cascading layouts if template explicitly declares {% extends ... %}', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const viewsDir = path.join(tempDir, 'views');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(viewsDir, { recursive: true });

      // Custom base template in views/
      fs.writeFileSync(
        path.join(viewsDir, 'custom-base.njk'),
        `<div class="custom-base">{% block body %}{% endblock %}</div>`
      );

      // Cascading _layout.njk in pages/
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<div class="unwanted-cascading-layout">{{ content | safe }}</div>`
      );

      // Page extending custom-base
      fs.writeFileSync(
        path.join(pagesDir, 'extended.njk'),
        `{% extends "custom-base.njk" %}{% block body %}<h1>Extended Content</h1>{% endblock %}`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        viewsDir,
        silent: true,
      });

      const res = await request(app).get('/extended');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div class="custom-base"><h1>Extended Content</h1></div>');
      expect(res.text).not.toContain('unwanted-cascading-layout');
    });

    it('handles 3-level deep nested layouts wrapping properly', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminDir = path.join(pagesDir, 'admin');
      const systemDir = path.join(adminDir, 'system');
      fs.mkdirSync(systemDir, { recursive: true });

      // Level 1: Root layout
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<div class="l1-root">{{ content | safe }}</div>`
      );

      // Level 2: Admin layout
      fs.writeFileSync(
        path.join(adminDir, '_layout.njk'),
        `<div class="l2-admin">{{ content | safe }}</div>`
      );

      // Level 3: System layout
      fs.writeFileSync(
        path.join(systemDir, '_layout.njk'),
        `<div class="l3-system">{{ content | safe }}</div>`
      );

      // Page
      fs.writeFileSync(
        path.join(systemDir, 'health.njk'),
        `<span class="page">All systems operational</span>`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/admin/system/health');
      expect(res.status).toBe(200);
      expect(res.text).toBe(
        '<div class="l1-root"><div class="l2-admin"><div class="l3-system"><span class="page">All systems operational</span></div></div></div>'
      );
    });

    it('halts SSR page execution and redirects when middleware issues a redirect', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const protectedDir = path.join(pagesDir, 'private');
      fs.mkdirSync(protectedDir, { recursive: true });

      // Auth middleware redirecting unauthorized users
      fs.writeFileSync(
        path.join(protectedDir, '_middleware.js'),
        `module.exports = (req, res, next) => {
          if (!req.headers['x-auth-user']) {
            return res.redirect(302, '/login');
          }
          next();
        };`
      );

      fs.writeFileSync(path.join(protectedDir, 'secret.njk'), `Secret: {{ loadedSecret }}`);
      fs.writeFileSync(
        path.join(protectedDir, 'secret.js'),
        `module.exports = {
          load: async () => ({ loadedSecret: 'classified-data' })
        };`
      );

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      // Without auth header -> 302 redirect to /login
      const res = await request(app).get('/private/secret');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');

      // With auth header -> 200 and loads page data
      const resAllowed = await request(app)
        .get('/private/secret')
        .set('x-auth-user', 'john');
      expect(resAllowed.status).toBe(200);
      expect(resAllowed.text).toBe('Secret: classified-data');
    });

    it('supports frontmatter data in _layout.njk', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `---
data:
  themeColor: "#4f46e5"
---
<div class="shell" style="background-color: {{ themeColor }}">{{ content | safe }}</div>`
      );

      fs.writeFileSync(path.join(pagesDir, 'welcome.njk'), `<p>Hello world</p>`);

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/welcome');
      expect(res.status).toBe(200);
      expect(res.text).toContain('style="background-color: #4f46e5"');
      expect(res.text).toContain('<p>Hello world</p>');
    });
  });
});

