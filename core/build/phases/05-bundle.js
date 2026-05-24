/**
 * Phase 5 — Bundle with esbuild (optional) + write artifacts
 * @module core/build/phases/05-bundle
 */

const fs = require('fs');
const path = require('path');
const { buildPrecompiledTemplatesMjs } = require('../phases/03-compile/templates');

/**
 * @param {import('../index').BuildContextInternal} ctx
 * @param {object} manifest
 * @param {string} handlersSource
 * @param {{ skipEsbuild?: boolean }} [opts]
 */
async function bundlePhase(ctx, manifest, handlersSource, opts = {}) {
  const outSubdir = ctx.adapter.name === 'cloudflare' ? 'worker' : 'server';
  const outputDir = path.join(ctx.cwd, '.webspresso', outSubdir);
  const metaDir = path.join(ctx.cwd, '.webspresso', 'meta');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(metaDir, 'build-graph.json'), JSON.stringify(ctx.graph.toJSON(), null, 2));

  if (ctx.adapter.name === 'cloudflare') {
    const pagesDir = path.resolve(ctx.cwd, ctx.config.pagesDir || 'pages');
    const viewsDir = ctx.config.viewsDir
      ? path.resolve(ctx.cwd, ctx.config.viewsDir)
      : fs.existsSync(path.join(ctx.cwd, 'views'))
        ? path.join(ctx.cwd, 'views')
        : null;
    const { parseNjkDirectives } = require('./02-analyze');
    const ssrRoutes = (manifest.routes || [])
      .filter((r) => r.type === 'ssr')
      .map((r) => {
        const absPath = path.join(pagesDir, r.source.page);
        return {
          absPath,
          sourceFile: r.source.page,
          njk: fs.existsSync(absPath)
            ? parseNjkDirectives(fs.readFileSync(absPath, 'utf8'))
            : null,
        };
      });
    const templatesMjs = buildPrecompiledTemplatesMjs(ctx, ssrRoutes, viewsDir);
    fs.writeFileSync(path.join(outputDir, 'templates.mjs'), templatesMjs);
  }

  const handlersPath = path.join(outputDir, 'handlers.mjs');
  fs.writeFileSync(handlersPath, handlersSource);

  const entrySource = ctx.adapter.generateEntry(manifest);
  const entryPath = path.join(outputDir, 'entry.mjs');
  fs.writeFileSync(entryPath, entrySource);

  let bundled = false;
  let bundleError = null;

  if (!opts.skipEsbuild) {
  try {
    const esbuild = require('esbuild');
    const bundleOpts = ctx.adapter.bundleOptions(manifest, outputDir);
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      outfile: path.join(outputDir, 'index.mjs'),
      absWorkingDir: ctx.cwd,
      logLevel: 'warning',
      ...bundleOpts,
    });
    bundled = true;
  } catch (err) {
    bundleError = err.code === 'MODULE_NOT_FOUND' && /esbuild/.test(String(err.message))
      ? 'esbuild not installed — wrote entry.mjs + handlers.mjs (run: npm install esbuild -D)'
      : err.message;
    fs.copyFileSync(entryPath, path.join(outputDir, 'index.mjs'));
  }
  } else {
    fs.copyFileSync(entryPath, path.join(outputDir, 'index.mjs'));
  }

  copyPublicAssets(ctx, outputDir);

  return {
    outputDir,
    metaDir,
    bundled,
    bundleError,
    artifacts: {
      manifest: path.join(outputDir, 'manifest.json'),
      handlers: handlersPath,
      entry: path.join(outputDir, 'index.mjs'),
      graph: path.join(metaDir, 'build-graph.json'),
    },
  };
}

/**
 * @param {import('../index').BuildContextInternal} ctx
 * @param {string} outputDir
 */
function copyPublicAssets(ctx, outputDir) {
  const publicDir = path.resolve(ctx.cwd, ctx.config.publicDir || 'public');
  if (!fs.existsSync(publicDir)) return;
  const assetsOut = path.join(outputDir, 'assets', 'public');
  fs.mkdirSync(assetsOut, { recursive: true });
  copyDirSync(publicDir, assetsOut);
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = { bundlePhase, copyPublicAssets };
