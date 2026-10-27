'use strict';

/**
 * Schema Compiler
 * Compiles schema definitions from API files
 * @module core/validation/compiler
 */

let _z = null;
function getZ() {
  if (!_z) {
    _z = require('./index').z;
  }
  return _z;
}

const schemaCache = require('./cache');

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

  let compiled;
  if (typeof schemaFn === 'function') {
    // Call schema function with { z } (extended with z.nanoid, same as generateNanoid / zdb.nanoid)
    compiled = schemaFn({ z: getZ() });
  } else if (typeof schemaFn === 'object' && schemaFn !== null) {
    // Direct schema object as documented in first-app.md and routing.md
    compiled = schemaFn;
  } else {
    throw new Error(`Schema in ${filePath} must be a function or an object`);
  }

  // Validate compiled schema structure
  if (compiled !== null && typeof compiled !== 'object') {
    throw new Error(`Schema in ${filePath} must evaluate to an object or null`);
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
  clearAllSchemas,
};
