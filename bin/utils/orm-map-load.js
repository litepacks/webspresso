/**
 * Load ORM model files into the global registry without opening a DB connection.
 */

const fs = require('fs');
const path = require('path');
const { resolveDbConfigIfExists } = require('./db');
const { getWebspressoOrmForProject } = require('./resolve-webspresso-orm');

/**
 * Resolve absolute models directory.
 * @param {string} cwd
 * @param {{ modelsOverride?: string, configPath?: string, env?: string }} options
 * @returns {string}
 */
function resolveModelsDir(cwd, options = {}) {
  const { modelsOverride, configPath, env } = options;
  if (modelsOverride) {
    return path.resolve(cwd, modelsOverride);
  }

  const resolved = resolveDbConfigIfExists(configPath);
  if (resolved) {
    const environment = env || process.env.NODE_ENV || 'development';
    const cfg = resolved.config[environment] ?? resolved.config;
    if (cfg && typeof cfg.models === 'string') {
      return path.resolve(cwd, cfg.models);
    }
  }

  return path.resolve(cwd, 'models');
}

/**
 * Require each model file (same filter as createDatabase).
 * @param {string} modelsDir
 * @returns {{ loaded: string[], errors: Array<{ file: string, message: string }> }}
 */
function loadModelFiles(modelsDir) {
  const errors = [];
  if (!fs.existsSync(modelsDir)) {
    return {
      loaded: [],
      errors: [{ file: '', message: `Models directory not found: ${modelsDir}` }],
    };
  }

  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();

  const loaded = [];
  for (const file of files) {
    const full = path.join(modelsDir, file);
    try {
      require(full);
      loaded.push(file);
    } catch (e) {
      errors.push({ file, message: e.message || String(e) });
    }
  }

  return { loaded, errors };
}

/**
 * Clear registry and load all models from the resolved directory.
 * @param {string} cwd
 * @param {{ modelsOverride?: string, configPath?: string, env?: string }} options
 * @returns {{ modelsDir: string, loaded: string[], errors: Array<{ file: string, message: string }> }}
 */
function loadProjectModels(cwd, options = {}) {
  const orm = getWebspressoOrmForProject(cwd);
  orm.clearRegistry();
  const modelsDir = resolveModelsDir(cwd, options);
  const { loaded, errors } = loadModelFiles(modelsDir);
  return { modelsDir, loaded, errors };
}

module.exports = {
  resolveModelsDir,
  loadModelFiles,
  loadProjectModels,
};
