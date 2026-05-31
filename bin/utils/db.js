/**
 * Database Utilities
 * Functions for loading database configuration and creating instances
 */

const fs = require('fs');
const path = require('path');
const { fail } = require('./cli-errors');

/**
 * Load database configuration
 * @param {string} [configPath] - Custom config path
 * @returns {Object} Database config
 */
function loadDbConfig(configPath) {
  const defaultPaths = ['webspresso.db.js', 'knexfile.js'];
  const paths = configPath ? [configPath, ...defaultPaths] : defaultPaths;
  
  for (const p of paths) {
    const fullPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(fullPath)) {
      return { config: require(fullPath), path: fullPath };
    }
  }
  
  fail('Database config not found.', {
    hint: 'Add webspresso.db.js or knexfile.js in the project root.',
    command: 'webspresso db:make init',
  });
}

/**
 * Resolve database config if present (no exit when missing; for doctor / tooling)
 * @param {string} [configPath] - Custom config path
 * @returns {{ config: Object, path: string } | null}
 */
function resolveDbConfigIfExists(configPath) {
  const defaultPaths = ['webspresso.db.js', 'knexfile.js'];
  const paths = configPath ? [configPath, ...defaultPaths] : defaultPaths;

  for (const p of paths) {
    const fullPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(fullPath)) {
      return { config: require(fullPath), path: fullPath };
    }
  }
  return null;
}

/**
 * Create database instance from config
 * @param {Object} config - Database config
 * @param {string} [env] - Environment name
 * @returns {Promise<Object>} Database instance
 */
async function createDbInstance(config, env) {
  const environment = env || process.env.NODE_ENV || 'development';
  const dbConfig = config[environment] || config;
  
  // Dynamic import knex
  let knex;
  try {
    knex = require('knex');
  } catch {
    fail('Knex is not installed.', { command: 'npm install knex' });
  }
  
  return knex(dbConfig);
}

module.exports = {
  loadDbConfig,
  resolveDbConfigIfExists,
  createDbInstance
};
