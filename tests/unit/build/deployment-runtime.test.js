/**
 * Node vs Worker (Cloudflare) manifest runtime — HTTP smoke after webspresso build
 */

const fs = require('fs');
const path = require('path');
const { request } = require('../../helpers/http');
const { runBuild } = require('../../../core/build');
const { createAppFromManifest: createNodeAppFromManifest } = require('../../../core/build/runtime/create-app-from-manifest-node');
const { createAppFromManifest: createWorkerAppFromManifest } = require('../../../core/build/runtime/create-app-from-manifest');
const {
  createBuildProject,
  readManifest,
  loadBuiltHandlers,
  loadPrecompiledTemplates,
  outputDir,
} = require('./helpers');

async function createManifestApp(cwd, adapter) {
  const manifest = readManifest(cwd, adapter);
  const handlers = await loadBuiltHandlers(cwd, adapter);
  const base = {
    pagesDir: path.join(cwd, 'pages'),
    viewsDir: path.join(cwd, 'views'),
    manifest,
    handlers,
    logging: false,
    helmet: false,
    timeout: false,
  };

  if (adapter === 'cloudflare') {
    const precompiledTemplates = await loadPrecompiledTemplates(cwd);
    return createWorkerAppFromManifest({
      ...base,
      precompiledTemplates,
      clientRuntime: { alpine: false, swup: false },
    });
  }

  return createNodeAppFromManifest(base);
}

describe('deployment runtime', () => {
  describe('Node adapter (manifest + full server stack)', () => {
    it('serves API routes from .webspresso/server/', async () => {
      const cwd = createBuildProject({ adapter: 'node' });
      await runBuild({ cwd, adapter: 'node', skipBundle: true });

      const { app } = await createManifestApp(cwd, 'node');
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('writes server output without worker-only templates.mjs', async () => {
      const cwd = createBuildProject({ adapter: 'node' });
      await runBuild({ cwd, adapter: 'node', skipBundle: true });

      const serverDir = outputDir(cwd, 'node');
      expect(fs.existsSync(path.join(serverDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'handlers.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'index.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'templates.mjs'))).toBe(false);
    });
  });

  describe('Worker adapter (createWorkerApp + precompiled Nunjucks)', () => {
    it('serves API routes from .webspresso/worker/', async () => {
      const cwd = createBuildProject({ adapter: 'cloudflare' });
      await runBuild({ cwd, adapter: 'cloudflare', skipBundle: true });

      const { app } = await createManifestApp(cwd, 'cloudflare');
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('loads precompiled templates for SSR routes into createWorkerApp', async () => {
      const cwd = createBuildProject({ adapter: 'cloudflare' });
      await runBuild({ cwd, adapter: 'cloudflare', skipBundle: true });

      const precompiled = await loadPrecompiledTemplates(cwd);
      expect(precompiled['index.njk']).toBeDefined();
      expect(precompiled['layout.njk']).toBeDefined();

      const manifest = readManifest(cwd, 'cloudflare');
      const home = manifest.routes.find(
        (r) => r.type === 'ssr' && r.template?.id === 'tpl:index.njk'
      );
      expect(home?.template?.renderMode).toBe('precompiled');
    });

    it('generated entry imports worker manifest helper, not Node server path', async () => {
      const cwd = createBuildProject({ adapter: 'cloudflare' });
      await runBuild({ cwd, adapter: 'cloudflare', skipBundle: true });

      const entry = fs.readFileSync(path.join(outputDir(cwd, 'cloudflare'), 'index.mjs'), 'utf8');
      expect(entry).toContain('webspresso/build/runtime/create-app-from-manifest');
      expect(entry).not.toContain('create-app-from-manifest-node');
    });
  });
});
