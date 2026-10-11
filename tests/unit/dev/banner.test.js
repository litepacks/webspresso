import { describe, it, expect, vi } from 'vitest';
const {
  formatRouteTable,
  collectBannerSummary,
  formatDevBanner,
  printDevBanner,
} = require('../../../src/dev/banner');
const { createApp } = require('../../../src/server');

describe('src/dev/banner', () => {
  const sampleRoutes = [
    { method: 'GET', path: '/', type: 'page', source: 'pages/index.njk' },
    { method: 'GET', path: '/notes', type: 'page', source: 'pages/notes/index.njk' },
    { method: 'GET', path: '/api/notes', type: 'api', source: 'pages/api/notes.get.js' },
    { method: 'POST', path: '/api/notes', type: 'api', source: 'pages/api/notes.post.js' },
    { method: 'DELETE', path: '/api/notes/:id', type: 'api', source: 'pages/api/notes/[id].delete.js' },
  ];

  describe('formatRouteTable', () => {
    it('formats a structured table of application routes with type and source', () => {
      const output = formatRouteTable(sampleRoutes, { colors: false });
      expect(output).toContain('Discovered Routes (5 total)');
      expect(output).toContain('GET     /                            [SSR]  → pages/index.njk');
      expect(output).toContain('GET     /api/notes                   [API]  → pages/api/notes.get.js');
      expect(output).toContain('POST    /api/notes                   [API]  → pages/api/notes.post.js');
      expect(output).toContain('DELETE  /api/notes/:id               [API]  → pages/api/notes/[id].delete.js');
    });

    it('handles empty routes array gracefully', () => {
      const output = formatRouteTable([], { colors: false });
      expect(output).toContain('(no routes registered)');
    });

    it('respects limit and appends truncation note', () => {
      const output = formatRouteTable(sampleRoutes, { colors: false, limit: 2 });
      expect(output).toContain('... and 3 more routes');
    });
  });

  describe('collectBannerSummary', () => {
    it('extracts metrics from routeTable, db, services, and plugins', () => {
      const mockDb = {
        knex: { client: { dialect: 'sqlite3', config: { client: 'better-sqlite3' } } },
        getAllModels: () => [{ name: 'User' }, { name: 'Note' }],
      };
      const mockServiceRegistry = {
        services: new Map([
          ['auth.login', {}],
          ['user.create', {}],
        ]),
      };
      const mockPluginManager = {
        plugins: new Map([
          ['adminPanel', {}],
          ['email', {}],
        ]),
      };

      const summary = collectBannerSummary({
        routeTable: sampleRoutes,
        db: mockDb,
        serviceRegistry: mockServiceRegistry,
        pluginManager: mockPluginManager,
        port: 3000,
        host: 'localhost',
      });

      expect(summary.port).toBe(3000);
      expect(summary.urls.local).toBe('http://localhost:3000');
      expect(summary.urls.admin).toBe('http://localhost:3000/_admin');
      expect(summary.dbDialect).toBe('SQLite (better-sqlite3)');
      expect(summary.counts.routesTotal).toBe(5);
      expect(summary.counts.apiRoutes).toBe(3);
      expect(summary.counts.pageRoutes).toBe(2);
      expect(summary.counts.models).toBe(2);
      expect(summary.counts.services).toBe(2);
      expect(summary.counts.plugins).toBe(2);
      expect(summary.models).toEqual(['User', 'Note']);
    });
  });

  describe('formatDevBanner & printDevBanner', () => {
    it('produces formatted ASCII box banner with URLs and summaries', () => {
      const { bannerText, plainText, summary } = formatDevBanner({
        routeTable: sampleRoutes,
        port: 4000,
        host: 'localhost',
      }, { colors: false, showRouteTable: true });

      expect(plainText).toContain('☕ Webspresso');
      expect(plainText).toContain('Local:    http://localhost:4000');
      expect(plainText).toContain('Routes:   5 (3 API, 2 Pages)');
      expect(plainText).toContain('Discovered Routes');
      expect(summary.port).toBe(4000);
    });

    it('prints banner through designated logger', () => {
      const logged = [];
      const mockLogger = { log: (msg) => logged.push(msg) };

      printDevBanner({
        routeTable: sampleRoutes,
        port: 3000,
      }, { logger: mockLogger });

      expect(logged.length).toBe(1);
      expect(logged[0]).toContain('Webspresso');
    });
  });

  describe('createApp integration', () => {
    it('decorates app with printDevBanner and formatDevBanner methods', () => {
      const { app } = createApp({
        rootDir: process.cwd(),
        pages: 'pages',
        logging: false,
      });

      expect(typeof app.printDevBanner).toBe('function');
      expect(typeof app.formatDevBanner).toBe('function');

      const banner = app.formatDevBanner();
      expect(banner).toHaveProperty('bannerText');
      expect(banner).toHaveProperty('plainText');
      expect(banner).toHaveProperty('summary');
      expect(banner.plainText).toContain('Webspresso');

      const logs = [];
      app.printDevBanner({ logger: { log: (m) => logs.push(m) } });
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('Webspresso');
    });
  });
});
