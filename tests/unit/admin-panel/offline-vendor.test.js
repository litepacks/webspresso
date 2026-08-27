/**
 * Tests for Admin Panel Offline Zero-CDN Vendor Asset Serving
 */

const express = require('express');
const request = require('supertest');
const adminPanelPlugin = require('../../../plugins/admin-panel');

describe('Admin Panel Offline Zero-CDN Static Assets', () => {
  let app;

  const mockDb = {
    getAllModels: () => new Map(),
    getModel: () => null,
    hasModel: () => false,
    registerModel: () => {},
    getRepository: () => ({
      find: async () => [],
      findById: async () => null,
      create: async (d) => d,
      update: async (id, d) => d,
      delete: async () => true,
    }),
  };

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Fake session middleware
    app.use((req, res, next) => {
      req.session = { adminUser: { id: 1, role: 'admin', email: 'admin@example.com' } };
      next();
    });

    const adminPlugin = adminPanelPlugin({
      db: mockDb,
      path: '/_admin',
      adminUsers: false,
    });

    const ctx = {
      app,
      addRoute: (method, routePath, ...handlers) => {
        app[method.toLowerCase()](routePath, ...handlers);
      },
    };

    adminPlugin.onRoutesReady(ctx);
  });

  it('serves mithril.min.js with correct content type and caching header', async () => {
    const res = await request(app)
      .get('/_admin/vendor/mithril.min.js')
      .expect(200)
      .expect('Content-Type', /javascript/);

    expect(res.headers['cache-control']).toContain('public');
    expect(res.text.length).toBeGreaterThan(1000);
    expect(res.text).toContain('m');
  });

  it('serves tailwind.min.js with correct content type and caching header', async () => {
    const res = await request(app)
      .get('/_admin/vendor/tailwind.min.js')
      .expect(200)
      .expect('Content-Type', /javascript/);

    expect(res.headers['cache-control']).toContain('public');
    expect(res.text.length).toBeGreaterThan(10000);
    expect(res.text).toContain('tailwind');
  });

  it('serves quill.min.js with correct content type', async () => {
    const res = await request(app)
      .get('/_admin/vendor/quill.min.js')
      .expect(200)
      .expect('Content-Type', /javascript/);

    expect(res.headers['cache-control']).toContain('public');
    expect(res.text.length).toBeGreaterThan(10000);
    expect(res.text).toContain('Quill');
  });

  it('serves quill.snow.min.css with correct css content type', async () => {
    const res = await request(app)
      .get('/_admin/vendor/quill.snow.min.css')
      .expect(200)
      .expect('Content-Type', /css/);

    expect(res.headers['cache-control']).toContain('public');
    expect(res.text.length).toBeGreaterThan(1000);
    expect(res.text).toContain('.ql-snow');
  });

  it('returns 404 for non-existent vendor file', async () => {
    await request(app)
      .get('/_admin/vendor/does-not-exist.js')
      .expect(404);
  });

  it('protects against path traversal attacks', async () => {
    await request(app)
      .get('/_admin/vendor/..%2F..%2Fpackage.json')
      .expect(404);
  });

  it('renders admin panel HTML with local vendor script tags and no external CDN scripts', async () => {
    const res = await request(app)
      .get('/_admin')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(res.text).toContain('/_admin/vendor/mithril.min.js');
    expect(res.text).toContain('/_admin/vendor/tailwind.min.js');
    expect(res.text).not.toContain('https://unpkg.com/mithril/mithril.js');
    expect(res.text).not.toContain('https://cdn.tailwindcss.com');
  });
});
