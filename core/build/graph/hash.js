/**
 * Content-addressed hashing for build cache keys
 * @module core/build/graph/hash
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * @param {string|Buffer} content
 * @returns {string}
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return sha256(content);
}

/**
 * @param {string[]} parts
 * @returns {string}
 */
function hashParts(parts) {
  const sorted = [...parts].sort();
  return sha256(sorted.join('\0'));
}

/**
 * @param {string} phase
 * @param {string} inputHash
 * @param {string} adapter
 * @param {string} frameworkVersion
 * @returns {string}
 */
function cacheKey(phase, inputHash, adapter, frameworkVersion) {
  return `v3:${adapter}:${frameworkVersion}:${phase}:${inputHash}`;
}

module.exports = { sha256, hashFile, hashParts, cacheKey };
