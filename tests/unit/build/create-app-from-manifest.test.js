/**
 * createAppFromManifest tests
 */

const { request } = require('../../helpers/http');
const { runBuild, createAppFromManifest } = require('../../../core/build');
const { createBuildProject, readManifest, loadBuiltHandlers } = require('./helpers');

describe('createAppFromManifest', () => {
  it('requires manifest and handlers', () => {
    expect(() => createAppFromManifest({ pagesDir: '/tmp/pages' })).toThrow(
      'createAppFromManifest requires manifest and handlers'
    );
  });

  it('creates app serving manifest routes', async () => {
    const cwd = createBuildProject();
    await runBuild({ cwd, adapter: 'node', skipBundle: true });
    const manifest = readManifest(cwd);
    const handlers = await loadBuiltHandlers(cwd);

    const { app } = createAppFromManifest({
      pagesDir: `${cwd}/pages`,
      viewsDir: `${cwd}/views`,
      manifest,
      handlers,
      logging: false,
      helmet: false,
      timeout: false,
    });

    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
