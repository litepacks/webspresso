/**
 * Database Utilities
 * Functions for loading database configuration and creating instances
 */

const fs = require('fs');
const path = require('path');

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
  
  console.error('❌ Database config not found. Create webspresso.db.js or knexfile.js');
  process.exit(1);
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
    console.error('❌ Knex not installed. Run: npm install knex');
    process.exit(1);
  }
  
  return knex(dbConfig);
}

module.exports = {
  loadDbConfig,
  resolveDbConfigIfExists,
  createDbInstance
};
