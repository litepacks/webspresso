/**
 * Load webspresso.build.js from project root
 * @module core/build/config/load-build-config
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  adapter: 'node',
  pagesDir: 'pages',
  viewsDir: 'views',
  publicDir: 'public',
  plugins: [],
  emailDir: 'emails',
  alias: {},
  experimental: { incremental: false },
  hooks: {},
};

/**
 * @param {string} [cwd]
 * @returns {{ config: typeof DEFAULT_CONFIG, configPath: string | null }}
 */
function loadBuildConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, 'webspresso.build.js');
  if (!fs.existsSync(configPath)) {
    return { config: { ...DEFAULT_CONFIG }, configPath: null };
  }

  delete require.cache[require.resolve(configPath)];
  const user = require(configPath);
  const config = {
    ...DEFAULT_CONFIG,
    ...(typeof user === 'function' ? user({ mode: process.env.NODE_ENV || 'production' }) : user),
  };
  return { config, configPath };
}

module.exports = { loadBuildConfig, DEFAULT_CONFIG };
