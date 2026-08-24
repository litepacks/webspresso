/**
 * Webspresso Services Discovery
 * Recursively scans directory and maps file paths to service names
 * @module src/services/discovery
 */

const fs = require('fs');
const path = require('path');

const VALID_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * Check if a file should be included as a service
 * @param {string} filename - Base name of the file
 * @returns {boolean}
 */
function isValidServiceFile(filename) {
  if (filename.startsWith('.') || filename.startsWith('_')) {
    return false;
  }
  if (filename.endsWith('.test.js') || filename.endsWith('.spec.js') || filename.endsWith('.d.ts')) {
    return false;
  }
  const ext = path.extname(filename);
  return VALID_EXTENSIONS.has(ext);
}

/**
 * Convert relative file path to dot-separated service name
 * @example
 * filePathToServiceName('user/get.js') -> 'user.get'
 * filePathToServiceName('user/profile/update.js') -> 'user.profile.update'
 * filePathToServiceName('payment/refund.js') -> 'payment.refund'
 * filePathToServiceName('health.js') -> 'health'
 * filePathToServiceName('user/index.js') -> 'user' (with alias 'user.index')
 *
 * @param {string} relativePath - Path relative to services root
 * @returns {{ name: string, aliases: string[] }}
 */
function filePathToServiceName(relativePath) {
  // Normalize slashes
  const normalized = relativePath.split(path.sep).join('/');
  const ext = path.extname(normalized);
  const withoutExt = normalized.slice(0, -ext.length);
  const segments = withoutExt.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { name: '', aliases: [] };
  }

  const isIndex = segments[segments.length - 1] === 'index';
  if (isIndex) {
    const parentSegments = segments.slice(0, -1);
    const primaryName = parentSegments.length > 0 ? parentSegments.join('.') : 'index';
    const indexName = segments.join('.');
    return {
      name: primaryName,
      aliases: primaryName !== indexName ? [indexName] : [],
    };
  }

  const name = segments.join('.');
  return {
    name,
    aliases: [],
  };
}

/**
 * Recursively discover all service files in a directory
 * @param {string} servicesDir - Absolute or relative path to services directory
 * @returns {Array<{ name: string, aliases: string[], filePath: string, relativePath: string }>}
 */
function discoverServices(servicesDir) {
  if (!servicesDir || !fs.existsSync(servicesDir)) {
    return [];
  }

  const results = [];

  function scan(currentDir, relativePrefix = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === 'node_modules') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile() && isValidServiceFile(entry.name)) {
        const { name, aliases } = filePathToServiceName(relPath);
        if (name) {
          results.push({
            name,
            aliases,
            filePath: fullPath,
            relativePath: relPath,
          });
        }
      }
    }
  }

  scan(path.resolve(servicesDir));
  return results;
}

module.exports = {
  isValidServiceFile,
  filePathToServiceName,
  discoverServices,
};
