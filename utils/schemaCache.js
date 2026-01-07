/**
 * Schema Cache
 * Caches compiled Zod schemas per file path
 */

const cache = new Map();

/**
 * Get cached schema for a file path
 * @param {string} filePath - Absolute file path
 * @returns {Object|undefined} Compiled schema or undefined
 */
function get(filePath) {
  return cache.get(filePath);
}

/**
 * Set compiled schema for a file path
 * @param {string} filePath - Absolute file path
 * @param {Object} schema - Compiled schema object
 */
function set(filePath, schema) {
  cache.set(filePath, schema);
}

/**
 * Check if schema exists in cache
 * @param {string} filePath - Absolute file path
 * @returns {boolean}
 */
function has(filePath) {
  return cache.has(filePath);
}

/**
 * Clear all cached schemas
 * Useful for development hot-reload
 */
function clear() {
  cache.clear();
}

/**
 * Delete a specific schema from cache
 * @param {string} filePath - Absolute file path
 * @returns {boolean} True if deleted
 */
function del(filePath) {
  return cache.delete(filePath);
}

module.exports = {
  get,
  set,
  has,
  clear,
  del
};


