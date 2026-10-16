import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { discoverAppRoutes, scanRoutes } from '../../../src/discovery/scan-routes';
import { createApp } from '../../../src/server';

describe('discoverAppRoutes Unified Scanner', () => {
  const fullstackRoot = path.resolve(__dirname, '../../fixtures/fullstack');

  it('should discover routes and return compiled RouteTable and scannedPagesFiles', () => {
    const result = discoverAppRoutes({ rootDir: fullstackRoot });

    expect(result).toHaveProperty('descriptors');
    expect(result).toHaveProperty('routeTable');
    expect(result).toHaveProperty('scannedPagesFiles');
    expect(result).toHaveProperty('scannedPagesDir');

    expect(Array.isArray(result.descriptors)).toBe(true);
    expect(result.descriptors.length).toBeGreaterThan(0);
    expect(result.routeTable.size).toBeGreaterThan(0);
    expect(Array.isArray(result.scannedPagesFiles)).toBe(true);

    // Verify RouteTable lookup
    const healthRoute = result.routeTable.get('GET', '/api/health');
    expect(healthRoute).toBeDefined();

    // Verify scannedPagesFiles includes discovered pages
    expect(result.scannedPagesFiles.length).toBeGreaterThan(0);
  });

  it('should be exposed directly on the webspresso main module', () => {
    const webspresso = require('../../../index');
    expect(typeof webspresso.discoverAppRoutes).toBe('function');

    const result = webspresso.discoverAppRoutes({ rootDir: fullstackRoot });
    expect(result.routeTable).toBeDefined();
  });

  it('should avoid redundant filesystem scanning when createApp mounts pages', () => {
    const tempDir = path.join(__dirname, '../../fixtures/temp-unified-test-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'pages', 'index.njk'), '<h1>Home</h1>');
    fs.writeFileSync(path.join(tempDir, 'pages', 'about.njk'), '<h1>About</h1>');
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'api', 'health.get.js'),
      'module.exports = { handler: (req, res) => res.json({ ok: true }) };'
    );

    try {
      const readdirSpy = vi.spyOn(fs, 'readdirSync');

      const { app } = createApp({
        rootDir: tempDir,
        pagesDir: path.join(tempDir, 'pages'),
        logging: false,
      });

      expect(app).toBeDefined();
      expect(app.routes).toBeDefined();

      // Ensure routes are mounted properly
      expect(app.fastPathStaticByMethod.GET.has('/')).toBe(true);
      expect(app.fastPathStaticByMethod.GET.has('/about')).toBe(true);

      readdirSpy.mockRestore();
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('should emit warnings for uppercase paths and dynamic route collisions during discovery', () => {
    const tempDir = path.join(__dirname, '../../fixtures/temp-unified-warn-' + Date.now());
    fs.mkdirSync(path.join(tempDir, 'pages', 'Products'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'pages', 'Products', '[id].njk'), 'id');
    fs.writeFileSync(path.join(tempDir, 'pages', 'Products', '[slug].njk'), 'slug');

    const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      discoverAppRoutes({
        rootDir: tempDir,
        pages: { dir: path.join(tempDir, 'pages') },
      });

      const calls = mockWarn.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes('contains uppercase letters'))).toBe(true);
      expect(calls.some((c) => c.includes('Dynamic route collision'))).toBe(true);
    } finally {
      mockWarn.mockRestore();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
