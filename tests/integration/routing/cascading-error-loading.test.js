import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import { clearCascadingCaches } from '../../../src/routing/cascading';
import { createApp } from '../../../src/server';
import { NotFoundError, ForbiddenError } from '../../../core/errors';

function createTestApp(opts) {
  return createApp({
    silent: true,
    helmet: false,
    compression: false,
    cache: false,
    healthCheck: false,
    metrics: false,
    ...opts,
  });
}

describe('Cascading Error Boundaries & Loading Skeletons (_error.njk, _loading.njk)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-err-load-test-'));
    clearCascadingCaches();
  });

  afterEach(() => {
    clearCascadingCaches();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Directory-Level Error Boundaries (_error.njk)', () => {
    it('catches SSR loader error and renders inside parent nested layouts', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const dashDir = path.join(pagesDir, 'dashboard');
      const billingDir = path.join(dashDir, 'billing');
      fs.mkdirSync(billingDir, { recursive: true });

      // Root layout
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<div class="root-shell"><header>Site Nav</header>{{ content | safe }}</div>`
      );

      // Dashboard layout
      fs.writeFileSync(
        path.join(dashDir, '_layout.njk'),
        `<div class="dashboard-shell"><aside>Dash Sidebar</aside><main>{{ content | safe }}</main></div>`
      );

      // Dashboard error boundary
      fs.writeFileSync(
        path.join(dashDir, '_error.njk'),
        `<div class="dash-error-card"><h2>Dashboard Error: {{ error.status }}</h2><p>{{ error.message }}</p></div>`
      );

      // Crashing route: /dashboard/billing/invoices
      fs.writeFileSync(path.join(billingDir, 'invoices.njk'), `<h1>Invoices List</h1>`);
      fs.writeFileSync(
        path.join(billingDir, 'invoices.js'),
        `const { NotFoundError } = require('${path.resolve(__dirname, '../../../core/errors')}');
        module.exports = {
          load: async () => {
            throw new NotFoundError('Invoice account #404 not found');
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/dashboard/billing/invoices');
      expect(res.status).toBe(404);
      // Preserves isolated UI context within cascading layouts
      expect(res.text).toContain('<div class="root-shell">');
      expect(res.text).toContain('<header>Site Nav</header>');
      expect(res.text).toContain('<div class="dashboard-shell">');
      expect(res.text).toContain('<aside>Dash Sidebar</aside>');
      // Rendered error card
      expect(res.text).toContain('Dashboard Error: 404');
      expect(res.text).toContain('Invoice account #404 not found');
    });

    it('executes companion _error.js loader to inject custom error context', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const teamDir = path.join(pagesDir, 'team');
      fs.mkdirSync(teamDir, { recursive: true });

      fs.writeFileSync(
        path.join(teamDir, '_error.njk'),
        `<div class="team-error"><h1>{{ error.message }}</h1><p>Contact: {{ supportEmail }}</p></div>`
      );
      fs.writeFileSync(
        path.join(teamDir, '_error.js'),
        `module.exports = {
          load: async ({ error, req }) => {
            return {
              supportEmail: 'team-ops@example.com',
            };
          }
        };`
      );

      fs.writeFileSync(path.join(teamDir, 'members.njk'), `<h1>Members</h1>`);
      fs.writeFileSync(
        path.join(teamDir, 'members.js'),
        `const { ForbiddenError } = require('${path.resolve(__dirname, '../../../core/errors')}');
        module.exports = {
          load: async () => {
            throw new ForbiddenError('You do not have access to team members');
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/team/members');
      expect(res.status).toBe(403);
      expect(res.text).toContain('You do not have access to team members');
      expect(res.text).toContain('Contact: team-ops@example.com');
    });

    it('falls back to root _error.njk when intermediate folder has no error boundary', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const nestedDir = path.join(pagesDir, 'catalog', 'items');
      fs.mkdirSync(nestedDir, { recursive: true });

      fs.writeFileSync(
        path.join(pagesDir, '_error.njk'),
        `<div class="site-error"><h1>Global Error {{ error.status }}</h1><p>{{ error.message }}</p></div>`
      );

      fs.writeFileSync(path.join(nestedDir, 'view.njk'), `<h1>Item View</h1>`);
      fs.writeFileSync(
        path.join(nestedDir, 'view.js'),
        `module.exports = {
          load: async () => {
            throw new Error('Database connection reset');
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/catalog/items/view');
      expect(res.status).toBe(500);
      expect(res.text).toContain('Global Error 500');
      expect(res.text).toContain('Database connection reset');
    });

    it('falls through to global Express error handler when no _error.njk is present', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      fs.writeFileSync(path.join(pagesDir, 'crash.njk'), `<h1>Crash</h1>`);
      fs.writeFileSync(
        path.join(pagesDir, 'crash.js'),
        `module.exports = {
          load: async () => {
            throw new Error('Uncaught severe crash');
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/crash');
      expect(res.status).toBe(500);
      // No custom _error.njk, standard error boundary returns
      expect(res.text).toBeDefined();
    });

    it('respects layout: false in _error.js or frontmatter', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const portalDir = path.join(pagesDir, 'portal');
      fs.mkdirSync(portalDir, { recursive: true });

      // Layout that should NOT wrap the error
      fs.writeFileSync(
        path.join(pagesDir, '_layout.njk'),
        `<div class="unwanted-root">{{ content | safe }}</div>`
      );

      // Error with layout: false in frontmatter
      fs.writeFileSync(
        path.join(portalDir, '_error.njk'),
        `---
layout: false
---
<div class="standalone-error"><h1>Standalone Portal Error: {{ error.message }}</h1></div>`
      );

      fs.writeFileSync(path.join(portalDir, 'login.njk'), `<h1>Login</h1>`);
      fs.writeFileSync(
        path.join(portalDir, 'login.js'),
        `module.exports = {
          load: async () => {
            throw new Error('Portal maintenance in progress');
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/portal/login');
      expect(res.status).toBe(500);
      expect(res.text).toContain('<div class="standalone-error">');
      expect(res.text).toContain('Portal maintenance in progress');
      expect(res.text).not.toContain('unwanted-root');
    });
  });

  describe('Directory-Level Loading Skeletons (_loading.njk)', () => {
    it('automatically populates empty data-stream-target slots with _loading.njk in SSR streaming', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const analyticsDir = path.join(pagesDir, 'dashboard', 'analytics');
      fs.mkdirSync(analyticsDir, { recursive: true });

      // Directory loading skeleton
      fs.writeFileSync(
        path.join(analyticsDir, '_loading.njk'),
        `<div class="analytics-skeleton"><div class="skeleton-bar"></div><span>Loading metrics...</span></div>`
      );

      // Streaming page template
      fs.writeFileSync(
        path.join(analyticsDir, 'overview.njk'),
        `<html><body><header>Analytics Dashboard</header><div data-stream-target="kpis"></div><footer>End</footer></body></html>`
      );

      // Page loader returning stream: true and deferred slot
      let resolveKpis;
      const kpisPromise = new Promise((resolve) => {
        resolveKpis = resolve;
      });

      fs.writeFileSync(
        path.join(analyticsDir, 'overview.js'),
        `module.exports = {
          load: async () => {
            return {
              stream: true,
              defer: {
                kpis: new Promise((resolve) => {
                  setTimeout(() => {
                    resolve({ totalRevenue: '$120,400', activeUsers: 3400 });
                  }, 40);
                })
              }
            };
          }
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app)
        .get('/dashboard/analytics/overview')
        .expect(200)
        .expect('Content-Type', /text\/html/);

      expect(res.headers['transfer-encoding']).toBe('chunked');
      // The shell chunk received by the browser should have the skeleton inside the slot
      expect(res.text).toContain('<div class="analytics-skeleton">');
      expect(res.text).toContain('Loading metrics...');
      // And the deferred replacement chunk streams in with resolved data
      expect(res.text).toContain('totalRevenue');
      expect(res.text).toContain('$120,400');
    });

    it('preserves existing custom inline slot fallback when slot is not empty', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });

      // Directory loading skeleton
      fs.writeFileSync(
        path.join(pagesDir, '_loading.njk'),
        `<div class="default-skeleton">Default Loader</div>`
      );

      // Template with custom explicit fallback
      fs.writeFileSync(
        path.join(pagesDir, 'custom.njk'),
        `<html><body><div data-stream-target="data"><p class="custom-spinner">My Custom Spinner</p></div></body></html>`
      );

      fs.writeFileSync(
        path.join(pagesDir, 'custom.js'),
        `module.exports = {
          load: async () => ({
            stream: true,
            defer: {
              data: new Promise((resolve) => setTimeout(() => resolve('Finished!'), 30))
            }
          })
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/custom').expect(200);
      // Custom spinner must be preserved in shell
      expect(res.text).toContain('<p class="custom-spinner">My Custom Spinner</p>');
      expect(res.text).not.toContain('Default Loader');
      expect(res.text).toContain('Finished!');
    });

    it('wraps streaming shell in cascading layouts seamlessly', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const adminDir = path.join(pagesDir, 'admin');
      fs.mkdirSync(adminDir, { recursive: true });

      // Cascading layout
      fs.writeFileSync(
        path.join(adminDir, '_layout.njk'),
        `<div class="admin-wrapper"><nav>Admin Nav</nav>{{ content | safe }}</div>`
      );

      // Loading skeleton
      fs.writeFileSync(
        path.join(adminDir, '_loading.njk'),
        `<span class="loading-badge">Loading admin data...</span>`
      );

      // Streaming page
      fs.writeFileSync(
        path.join(adminDir, 'stats.njk'),
        `<div class="stats-card"><div data-stream-target="numbers"></div></div>`
      );

      fs.writeFileSync(
        path.join(adminDir, 'stats.js'),
        `module.exports = {
          load: async () => ({
            stream: true,
            defer: {
              numbers: new Promise((resolve) => setTimeout(() => resolve('42'), 25))
            }
          })
        };`
      );

      const { app } = createTestApp({
        rootDir: tempDir,
        pagesDir,
        silent: true,
      });

      const res = await request(app).get('/admin/stats').expect(200);
      expect(res.text).toContain('<div class="admin-wrapper">');
      expect(res.text).toContain('<nav>Admin Nav</nav>');
      expect(res.text).toContain('<span class="loading-badge">Loading admin data...</span>');
      expect(res.text).toContain('42');
    });
  });
});
