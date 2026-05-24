/**
 * Build compiler unit tests
 */

const fs = require('fs');
const path = require('path');
const {
  runBuild,
  createBuilder,
  resolveAdapter,
  loadBuildConfig,
  formatBuildError,
  BuildError,
} = require('../../../core/build');
const { createBuildProject, readManifest } = require('./helpers');

describe('core/build', () => {
  describe('runBuild', () => {
    it('should compile fixtures project and write manifest', async () => {
      const cwd = createBuildProject();
      const result = await runBuild({ cwd, adapter: 'node', skipBundle: true });

      expect(result.manifest).toBeDefined();
      expect(result.manifest.routes.length).toBeGreaterThan(0);
      expect(result.diagnostics.routes).toBe(result.manifest.routes.length);
      expect(fs.existsSync(path.join(cwd, '.webspresso/server/manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.webspresso/server/handlers.mjs'))).toBe(true);

      const manifest = readManifest(cwd);
      expect(manifest.adapter.name).toBe('node');
      expect(manifest.buildId).toBeTruthy();
    });

    it('should write diagnostics.json when bundle runs', async () => {
      const cwd = createBuildProject();
      await runBuild({ cwd, adapter: 'node', skipBundle: false });

      const diagPath = path.join(cwd, '.webspresso/meta/diagnostics.json');
      expect(fs.existsSync(diagPath)).toBe(true);
      const diag = JSON.parse(fs.readFileSync(diagPath, 'utf8'));
      expect(diag.routes).toBeGreaterThan(0);
    });
  });

  describe('createBuilder', () => {
    it('should expose build() that runs pipeline', async () => {
      const cwd = createBuildProject();
      const builder = createBuilder({ cwd, adapter: 'node', skipBundle: true });
      const result = await builder.build();
      expect(result.adapter).toBe('node');
      expect(readManifest(cwd).routes.length).toBeGreaterThan(0);
    });
  });

  describe('resolveAdapter', () => {
    it('should load node adapter', () => {
      const adapter = resolveAdapter('node');
      expect(adapter).toBeDefined();
      expect(typeof adapter.validate).toBe('function');
    });

    it('should throw BuildError for unknown adapter', () => {
      expect(() => resolveAdapter('unknown-xyz')).toThrow(BuildError);
      try {
        resolveAdapter('unknown-xyz');
      } catch (err) {
        expect(err.code).toBe('WS_BUILD_ADAPTER_UNKNOWN');
      }
    });
  });

  describe('loadBuildConfig', () => {
    it('should return defaults when config file missing', () => {
      const cwd = createBuildProject();
      fs.unlinkSync(path.join(cwd, 'webspresso.build.js'));
      const { config, configPath } = loadBuildConfig(cwd);
      expect(configPath).toBeNull();
      expect(config.adapter).toBe('node');
      expect(config.pagesDir).toBe('pages');
    });
  });

  describe('formatBuildError', () => {
    it('should format BuildError with hint and file', () => {
      const err = new BuildError('WS_BUILD_TEST', 'Something failed', {
        file: 'pages/foo.js',
        hint: 'Fix the file',
        docsUrl: 'https://example.com/docs',
      });
      const text = formatBuildError(err);
      expect(text).toContain('WS_BUILD_TEST');
      expect(text).toContain('pages/foo.js');
      expect(text).toContain('Fix the file');
      expect(text).toContain('https://example.com/docs');
    });

    it('should format generic errors', () => {
      const text = formatBuildError(new Error('boom'));
      expect(text).toContain('WS_BUILD_UNKNOWN');
      expect(text).toContain('boom');
    });
  });
});
