/**
 * Webspresso build compiler — createBuilder()
 * @module core/build
 */

const path = require('path');
const fs = require('fs');
const { BuildGraph } = require('./graph/build-graph');
const { BuildCache } = require('./cache/build-cache');
const { loadBuildConfig } = require('./config/load-build-config');
const { BuildError, formatBuildError } = require('./errors/build-error');
const { discoverRoutes } = require('./phases/01-discover');
const { analyzeRoutes } = require('./phases/02-analyze');
const { compilePhase } = require('./phases/03-compile');
const { assembleManifest } = require('./phases/04-manifest');
const { bundlePhase } = require('./phases/05-bundle');
const { validateBuild, assertValid } = require('./phases/06-validate');

const ADAPTERS = {
  node: () => require('../../adapters/node'),
  cloudflare: () => require('../../adapters/cloudflare'),
  bun: () => require('../../adapters/bun'),
};

/**
 * @typedef {object} BuildContextInternal
 * @property {string} cwd
 * @property {object} config
 * @property {object} adapter
 * @property {BuildGraph} graph
 * @property {BuildCache} cache
 */

/**
 * @param {string} name
 */
function resolveAdapter(name) {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new BuildError('WS_BUILD_ADAPTER_UNKNOWN', `Unknown adapter "${name}"`, {
      hint: `Supported: ${Object.keys(ADAPTERS).join(', ')}`,
    });
  }
  return factory();
}

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.adapter]
 * @param {boolean} [opts.failOnWarnings]
 * @param {boolean} [opts.skipBundle]
 */
async function runBuild(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const { config } = loadBuildConfig(cwd);
  const adapterName = opts.adapter || config.adapter || 'node';
  const adapter = resolveAdapter(adapterName);

  /** @type {BuildContextInternal} */
  const ctx = {
    cwd,
    config: { ...config, adapter: adapterName },
    adapter,
    graph: new BuildGraph(),
    cache: new BuildCache(path.join(cwd, '.webspresso', 'cache')),
  };

  ctx.cache.load();

  const { routes, pagesDir } = discoverRoutes(ctx);
  const { analyzed, globalHooks, edgeIssues, viewsDir } = analyzeRoutes(ctx, routes);

  const unresolvedTemplates = analyzed.flatMap((r) => r.unresolvedTemplates || []);

  const compiled = await compilePhase(ctx, analyzed, viewsDir, globalHooks);
  const manifest = assembleManifest(ctx, compiled);

  const validation = validateBuild({ unresolvedTemplates }, manifest, adapter, edgeIssues);
  assertValid(validation, { failOnWarnings: opts.failOnWarnings });

  let bundleResult = null;
  bundleResult = await bundlePhase(ctx, manifest, compiled.handlersSource, {
    skipEsbuild: !!opts.skipBundle || adapterName === 'cloudflare',
  });

  ctx.cache.save();

  const diagnostics = {
    validation,
    routes: manifest.routes.length,
    templates: Object.keys(manifest.templates).length,
    buildId: manifest.buildId,
  };

  if (bundleResult) {
    fs.mkdirSync(bundleResult.metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundleResult.metaDir, 'diagnostics.json'),
      JSON.stringify(diagnostics, null, 2)
    );
  }

  return {
    manifest,
    graph: ctx.graph.toJSON(),
    diagnostics,
    bundle: bundleResult,
    adapter: adapterName,
  };
}

function createBuilder(opts = {}) {
  return {
    build: () => runBuild(opts),
  };
}

module.exports = {
  createBuilder,
  runBuild,
  resolveAdapter,
  loadBuildConfig,
  formatBuildError,
  BuildError,
  mountPagesFromManifest: require('./runtime/mount-manifest').mountPagesFromManifest,
  createAppFromManifest: require('./runtime/create-app-from-manifest-node').createAppFromManifest,
};
