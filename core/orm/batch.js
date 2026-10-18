'use strict';

/**
 * Webspresso ORM - Batch & Bulk Operation Utilities
 * Manages SQL parameter variable limit protection, auto-chunking, and bulk operations.
 *
 * @module core/orm/batch
 */

/**
 * Calculates a safe chunk size based on dialect and column count to prevent
 * SQLITE_ERROR: too many SQL variables or max query length packet issues.
 *
 * @param {import('knex').Knex|Object} knexInstance - Knex or transaction instance
 * @param {number} columnCount - Number of columns per inserted row
 * @param {number} [requestedChunkSize] - User-specified chunk size
 * @returns {number} Safe chunk size
 */
function calculateSafeChunkSize(knexInstance, columnCount = 10, requestedChunkSize = null) {
  const cols = Math.max(1, columnCount || 10);
  const clientName = (
    knexInstance?.client?.dialect ||
    knexInstance?.client?.config?.client ||
    ''
  ).toLowerCase();
  const isSqlite = clientName.includes('sqlite');

  // SQLite variable limits:
  // Legacy SQLite: 999
  // Modern SQLite (>= 3.32.0): 32,766
  // We use 990 as a conservative threshold for maximum compatibility across any SQLite build.
  const safeParamLimit = isSqlite ? 990 : 10000;
  const maxRowsByParamLimit = Math.max(1, Math.floor(safeParamLimit / cols));

  if (typeof requestedChunkSize === 'number' && requestedChunkSize > 0) {
    if (isSqlite) {
      // Ensure requested chunk size doesn't exceed SQLite variable limit
      return Math.min(requestedChunkSize, maxRowsByParamLimit);
    }
    return requestedChunkSize;
  }

  // Default optimal chunk sizes
  if (isSqlite) {
    return Math.min(500, maxRowsByParamLimit);
  }
  return 1000;
}

/**
 * Splits an array into sub-arrays of specified chunk size
 * @template T
 * @param {T[]} array - Source array
 * @param {number} size - Chunk size
 * @returns {T[][]}
 */
function chunkArray(array, size) {
  if (!Array.isArray(array) || array.length === 0) return [];
  const chunkSize = Math.max(1, Math.floor(size || 500));
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

module.exports = {
  calculateSafeChunkSize,
  chunkArray,
};
