/**
 * Bun adapter stub — future
 * @module adapters/bun
 */

const nodeAdapter = require('../node');

module.exports = {
  ...nodeAdapter,
  name: 'bun',
  version: '0.1.0',
  capabilities: {
    ...nodeAdapter.capabilities,
    fetch: true,
    listen: true,
  },

  bundleOptions(manifest, outputDir) {
    const base = nodeAdapter.bundleOptions(manifest, outputDir);
    return { ...base, target: 'esnext' };
  },
};
