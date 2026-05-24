/**
 * Cloudflare adapter build — templates.mjs + worker output
 */

const fs = require('fs');
const path = require('path');
const { runBuild } = require('../../../core/build');
const { createBuildProject } = require('./helpers');

describe('cloudflare build', () => {
  it('writes worker artifacts including precompiled templates', async () => {
    const cwd = createBuildProject({ adapter: 'cloudflare' });
    await runBuild({ cwd, adapter: 'cloudflare', skipBundle: true });

    const workerDir = path.join(cwd, '.webspresso/worker');
    expect(fs.existsSync(path.join(workerDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(workerDir, 'handlers.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(workerDir, 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(workerDir, 'templates.mjs'))).toBe(true);

    const templates = fs.readFileSync(path.join(workerDir, 'templates.mjs'), 'utf8');
    expect(templates).toContain('export default precompiled');
    expect(templates).toContain('layout.njk');

    const manifest = JSON.parse(fs.readFileSync(path.join(workerDir, 'manifest.json'), 'utf8'));
    const ssr = manifest.routes.find((r) => r.type === 'ssr');
    expect(ssr?.template?.renderMode).toBe('precompiled');
  });
});
