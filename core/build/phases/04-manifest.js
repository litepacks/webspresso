/**
 * Phase 4 — Manifest assembly
 * @module core/build/phases/04-manifest
 */

const path = require('path');
const pkg = require('../../../package.json');
const { hashParts } = require('../graph/hash');
const { buildContentIndexPhase } = require('./02b-content-index');

const MANIFEST_SCHEMA = 'https://webspresso.dev/schemas/manifest-v3.json';

/**
 * @param {import('../index').BuildContextInternal} ctx
 * @param {object} compiled
 */
function assembleManifest(ctx, compiled) {
  const caps = ctx.adapter.capabilities;
  const capabilityList = Object.entries(caps)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  const fileHashes = [...ctx.graph.nodes.values()].map((n) => n.hash);
  const buildId = `sha256:${hashParts([...fileHashes, ctx.adapter.name, pkg.version])}`;

  /** @type {import('../types').WebspressoManifest} */
  const manifest = {
    version: 3,
    framework: {
      name: 'webspresso',
      version: pkg.version,
      schema: MANIFEST_SCHEMA,
    },
    adapter: {
      name: ctx.adapter.name,
      version: ctx.adapter.version,
      capabilities: capabilityList,
    },
    buildId,
    builtAt: new Date().toISOString(),
    compatibility: {
      minFramework: '0.0.70',
      maxFramework: '0.x',
      requiredCapabilities: ctx.adapter.name === 'cloudflare' ? ['fetch'] : ['listen'],
    },
    routes: compiled.routeEntries,
    templates: compiled.templates,
    emailTemplates: compiled.emailTemplates || {},
    i18n: compiled.i18n,
    middleware: compiled.middleware,
    plugins: compiled.plugins,
    assets: {
      publicDir: ctx.config.publicDir || 'public',
      prefix: '',
    },
    models: {},
    hooks: compiled.hooks,
    seo: {},
  };

  const contentIndex = buildContentIndexPhase(ctx);
  if (contentIndex) {
    manifest.contentIndex = contentIndex;
  }

  if (ctx.config.hooks && typeof ctx.config.hooks['build:manifest'] === 'function') {
    ctx.config.hooks['build:manifest'](manifest);
  }

  return manifest;
}

module.exports = { assembleManifest, MANIFEST_SCHEMA };
