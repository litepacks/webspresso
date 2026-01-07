/**
 * Schema Compiler
 * Compiles schema definitions from API files
 */

const z = require('zod');
const schemaCache = require('../utils/schemaCache');

/**
 * Compile schema from an API module
 * @param {string} filePath - Absolute file path to API module
 * @param {Object} apiModule - The loaded API module
 * @returns {Object|null} Compiled schema object or null if no schema
 */
function compileSchema(filePath, apiModule) {
  // Return cached schema if exists
  if (schemaCache.has(filePath)) {
    return schemaCache.get(filePath);
  }

  // Check if module exports schema
  const schemaFn = apiModule.schema;
  
  // Schema is optional
  if (schemaFn === undefined) {
    schemaCache.set(filePath, null);
    return null;
  }

  // Schema must be a function
  if (typeof schemaFn !== 'function') {
    throw new Error(`Schema in ${filePath} must be a function`);
  }

  // Call schema function with { z }
  const compiled = schemaFn({ z });

  // Validate compiled schema structure
  if (compiled !== null && typeof compiled !== 'object') {
    throw new Error(`Schema function in ${filePath} must return an object or null`);
  }

  // Cache and return
  schemaCache.set(filePath, compiled);
  return compiled;
}

/**
 * Clear schema cache for a file (for hot-reload)
 * @param {string} filePath - Absolute file path
 */
function invalidateSchema(filePath) {
  schemaCache.del(filePath);
}

/**
 * Clear all cached schemas
 */
function clearAllSchemas() {
  schemaCache.clear();
}

module.exports = {
  compileSchema,
  invalidateSchema,
  clearAllSchemas
};


