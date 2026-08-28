/**
 * Webspresso Services Discovery
 * Recursively scans directory and maps file paths to service names with cross-platform normalization & camelCase aliases
 * @module src/services/discovery
 */

const fs = require('fs');
const path = require('path');
const { trimUrlPathSlashes } = require('../../core/url-path-normalize');

const VALID_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * Convert kebab-case or snake_case segment to camelCase
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
  return str.replace(/[-_]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase());
}

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
 * Convert relative file path to dot-separated service name with cross-platform normalization & aliases
 * @example
 * filePathToServiceName('user/get.js') -> { name: 'user.get', aliases: [] }
 * filePathToServiceName('order-items/get-by-id.js') -> { name: 'order-items.get-by-id', aliases: ['orderItems.getById'] }
 * filePathToServiceName('user/index.js') -> { name: 'user', aliases: ['user.index'] }
 *
 * @param {string} relativePath - Path relative to services root
 * @returns {{ name: string, aliases: string[] }}
 */
function filePathToServiceName(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return { name: '', aliases: [] };
  }

  // Cross-platform slash normalization (Windows \ to Unix /)
  const normalized = trimUrlPathSlashes(relativePath.replace(/\\/g, '/'));
  const ext = path.extname(normalized);
  const withoutExt = ext ? normalized.slice(0, -ext.length) : normalized;
  const segments = withoutExt.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { name: '', aliases: [] };
  }

  const aliases = new Set();
  const isIndex = segments[segments.length - 1] === 'index';

  let primarySegments;
  if (isIndex) {
    primarySegments = segments.slice(0, -1);
    if (primarySegments.length === 0) {
      primarySegments = ['index'];
    } else {
      aliases.add(segments.join('.')); // e.g. user.index alias
    }
  } else {
    primarySegments = segments;
  }

  const primaryName = primarySegments.join('.');

  // Generate camelCase alias if segments contain kebab-case or snake_case
  const camelSegments = primarySegments.map(toCamelCase);
  const camelName = camelSegments.join('.');
  if (camelName !== primaryName) {
    aliases.add(camelName);
  }

  return {
    name: primaryName,
    aliases: Array.from(aliases),
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
            relativePath: relPath.replace(/\\/g, '/'),
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
  toCamelCase,
  filePathToServiceName,
  discoverServices,
};
