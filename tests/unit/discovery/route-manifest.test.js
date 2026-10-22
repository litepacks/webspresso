import { cleanupDir } from '../../utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import {
  generateRouteManifest,
  loadRouteManifest,
  DEFAULT_MANIFEST_REL_PATH,
} from '../../../src/discovery/route-manifest';
import { createApp } from '../../../src/server';

describe('AOT Route Manifest (Production Manifest & Zero-Scan Boot)', () => {
  const tempDir = path.join(__dirname, '../../fixtures/temp-manifest-' + Date.now());

  beforeEach(() => {
    cleanupDir(tempDir);
    fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'views'), { recursive: true });

    // Setup fixture pages
    fs.writeFileSync(path.join(tempDir, 'pages', 'index.njk'), '<h1>Home Page</h1>');
    fs.writeFileSync(path.join(tempDir, 'pages', 'about.njk'), '<h1>About Page</h1>');
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'about.js'),
      `module.exports = { load: async () => ({ title: 'About' }) };`
    );
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'api', 'users.get.js'),
      `module.exports = { handler: (req, res) => res.json({ users: ['alice', 'bob'] }) };`
    );

    // Setup src/api route
    fs.writeFileSync(
      path.join(tempDir, 'src', 'api', 'status.get.js'),
      `module.exports = { handler: (req, res) => res.json({ status: 'healthy' }) };`
    );
  });

  afterEach(() => {
    cleanupDir(tempDir);
    vi.restoreAllMocks();
  });

  it('generateRouteManifest should generate a portable JSON manifest', () => {
    const result = generateRouteManifest({
      rootDir: tempDir,
    });

    expect(result.manifestPath).toBe(path.join(tempDir, DEFAULT_MANIFEST_REL_PATH));
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(result.routeCount).toBeGreaterThanOrEqual(3);

    const manifest = result.manifest;
    expect(manifest.version).toBe(1);
    expect(typeof manifest.generatedAt).toBe('string');
    expect(manifest.pagesDirRel).toBe('pages');
    expect(manifest.scannedPagesFiles).toContain('index.njk');
    expect(manifest.scannedPagesFiles).toContain('about.njk');
    expect(manifest.scannedPagesFiles).toContain('about.js');
    expect(manifest.scannedPagesFiles).toContain('api/users.get.js');

    // Verify portable relative source paths for file-based API route
    const userRoute = manifest.routes.find((r) => r.path === '/api/users');
    expect(userRoute).toBeDefined();
    expect(userRoute.type).toBe('api');
    expect(userRoute.method).toBe('GET');
    expect(userRoute.source).toBe('pages/api/users.get.js');

    // Verify discovered src/api route
    const statusRoute = manifest.routes.find((r) => r.path === '/api/status');
    expect(statusRoute).toBeDefined();
    expect(statusRoute.type).toBe('api');
    expect(statusRoute.source).toBe('src/api/status.get.js');
  });

  it('loadRouteManifest should load and reconstruct runtime descriptors', () => {
    const gen = generateRouteManifest({ rootDir: tempDir });
    expect(fs.existsSync(gen.manifestPath)).toBe(true);

    const loaded = loadRouteManifest({ rootDir: tempDir });
    expect(loaded).not.toBeNull();
    expect(loaded.manifest.version).toBe(1);
    expect(Array.isArray(loaded.descriptors)).toBe(true);

    const statusDesc = loaded.descriptors.find((d) => d.path === '/api/status');
    expect(statusDesc).toBeDefined();
    expect(statusDesc.file).toBe(path.join(tempDir, 'src', 'api', 'status.get.js'));
    expect(loaded.descriptors.scannedPagesDir).toBe(path.join(tempDir, 'pages'));
    expect(loaded.descriptors.scannedPagesFiles).toContain('index.njk');
  });

  it('loadRouteManifest should return null for missing or invalid manifest file', () => {
    const loaded = loadRouteManifest({ rootDir: path.join(tempDir, 'non-existent') });
    expect(loaded).toBeNull();
  });

  it('createApp should use AOT manifest and mount all routes successfully', async () => {
    // 1. Generate manifest first
    generateRouteManifest({ rootDir: tempDir });

    // 2. Create app with routesManifest
    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      routesManifest: true,
      logging: false,
    });

    expect(app.routesManifest).toBeDefined();
    expect(app.routesManifest.version).toBe(1);

    // 3. Verify endpoints function correctly
    const apiRes = await request(app).get('/api/users');
    expect(apiRes.status).toBe(200);
    expect(apiRes.body.users).toEqual(['alice', 'bob']);

    const statusRes = await request(app).get('/api/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('healthy');

    const pageRes = await request(app).get('/about');
    expect(pageRes.status).toBe(200);
    expect(pageRes.text).toContain('About Page');
  });

  it('createApp should fall back to normal scan when routesManifest: false', async () => {
    generateRouteManifest({ rootDir: tempDir });

    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      routesManifest: false,
      logging: false,
    });

    expect(app.routesManifest).toBeUndefined();

    const apiRes = await request(app).get('/api/users');
    expect(apiRes.status).toBe(200);
  });

  it('createApp should support custom manifest path string', async () => {
    const customPath = path.join(tempDir, 'custom-manifest.json');
    generateRouteManifest({ rootDir: tempDir, outFile: customPath });

    const { app } = createApp({
      rootDir: tempDir,
      pagesDir: path.join(tempDir, 'pages'),
      routesManifest: customPath,
      logging: false,
    });

    expect(app.routesManifest).toBeDefined();

    const apiRes = await request(app).get('/api/users');
    expect(apiRes.status).toBe(200);
  });

  it('routes CLI command with -m should generate route manifest', () => {
    const { registerCommand } = require('../../../bin/commands/routes');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    let actionFn = null;
    const mockProgram = {
      command: () => mockProgram,
      description: () => mockProgram,
      option: () => mockProgram,
      action: (fn) => { actionFn = fn; return mockProgram; },
    };

    registerCommand(mockProgram);
    expect(typeof actionFn).toBe('function');

    actionFn({ root: tempDir, manifest: true });
    console.log = origLog;

    const manifestPath = path.join(tempDir, DEFAULT_MANIFEST_REL_PATH);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(logs.some((l) => l.includes('AOT route manifest written'))).toBe(true);
  });

  it('build CLI command should generate route manifest by default', async () => {
    // Write minimal package.json in tempDir so build command recognizes it as project
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-app' }));

    const { registerCommand } = require('../../../bin/commands/build');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    let actionFn = null;
    const mockProgram = {
      command: () => mockProgram,
      alias: () => mockProgram,
      description: () => mockProgram,
      option: () => mockProgram,
      action: (fn) => { actionFn = fn; return mockProgram; },
    };

    registerCommand(mockProgram);
    expect(typeof actionFn).toBe('function');

    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      await actionFn({ css: false, js: false });
    } finally {
      process.chdir(origCwd);
      console.log = origLog;
    }

    const manifestPath = path.join(tempDir, DEFAULT_MANIFEST_REL_PATH);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(logs.some((l) => l.includes('AOT route manifest generated'))).toBe(true);
  });

  describe('Route Manifest Edge Cases & Direct Path Scenarios', () => {
    it('generateRouteManifest handles custom manifestPath and formats JSON', () => {
      const customPath = path.join(tempDir, 'custom-manifest.json');
      const res = generateRouteManifest({
        rootDir: tempDir,
        outFile: customPath,
      });

      expect(res.manifestPath).toBe(customPath);
      expect(fs.existsSync(customPath)).toBe(true);
      const content = fs.readFileSync(customPath, 'utf8');
      expect(content).toContain('"version": 1');
    });

    it('loadRouteManifest returns null for non-existent, invalid, or corrupted manifests', () => {
      // 1. Non-existent file
      expect(
        loadRouteManifest({ manifestPath: path.join(tempDir, 'does-not-exist.json') })
      ).toBeNull();

      // 2. Corrupted JSON file
      const corruptedPath = path.join(tempDir, 'corrupted.json');
      fs.writeFileSync(corruptedPath, 'NOT_VALID_JSON{[');
      expect(loadRouteManifest({ manifestPath: corruptedPath })).toBeNull();

      // 3. Valid JSON but invalid manifest structure (missing routes array)
      const invalidPath = path.join(tempDir, 'invalid-structure.json');
      fs.writeFileSync(invalidPath, JSON.stringify({ version: 1, routes: null }));
      expect(loadRouteManifest({ manifestPath: invalidPath })).toBeNull();
    });

    it('loadRouteManifest supports string path argument and handles missing optional fields', () => {
      const manifestPath = path.join(tempDir, 'string-arg-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          version: 1,
          routes: [
            {
              type: 'api',
              method: 'get',
              path: '/api/test',
              target: 'discovered',
              source: 'pages/api/test.get.js',
            },
            {
              type: 'page',
              method: 'get',
              path: '/ignored-target',
              target: 'other',
            },
          ],
        })
      );

      // Call directly with string path
      const result = loadRouteManifest(manifestPath);
      expect(result).toBeDefined();
      expect(result.descriptors.length).toBe(1);
      expect(result.descriptors[0].path).toBe('/api/test');
      expect(result.descriptors.scannedPagesFiles).toEqual([]);
      expect(result.descriptors.scannedPagesDir).toBeDefined();
    });
  });
});
