'use strict';

/**
 * Webspresso - Native Filesystem & Directory Walking Utilities
 * Zero-dependency recursive and flat directory scanner with configurable filters.
 * @module core/utils/fs
 */

const fs = require('fs');
const path = require('path');

/**
 * Standard test file extensions and type declarations to ignore by default
 */
const DEFAULT_TEST_SUFFIXES = [
  '.test.js',
  '.test.cjs',
  '.test.mjs',
  '.test.ts',
  '.spec.js',
  '.spec.cjs',
  '.spec.mjs',
  '.spec.ts',
  '.d.ts',
];

/**
 * Recursively (or flatly) scans a directory for files matching specified criteria.
 *
 * @param {string} dir - Directory path to scan
 * @param {Object} [options]
 * @param {string[]|Set<string>|null} [options.extensions] - Allowed extensions (e.g. ['.js', '.cjs']). Null allows any extension.
 * @param {boolean} [options.recursive=true] - Whether to scan subdirectories recursively
 * @param {boolean} [options.ignoreTests=true] - Whether to ignore test files (.test.js, .spec.js, .d.ts)
 * @param {string[]} [options.ignorePrefixes=['.', '_']] - Prefixes of files/directories to ignore
 * @param {string[]} [options.ignoreNames=['node_modules']] - Exact file or directory names to ignore
 * @param {Function} [options.filter] - Custom filter function (fullPath, dirent) => boolean
 * @param {string} [options.baseDir] - Base directory for computing relative paths (defaults to dir)
 * @param {boolean} [options.detailed=false] - If true, returns array of objects with { absolutePath, relativePath, name, ext }
 * @returns {string[]|Array<{ absolutePath: string, relativePath: string, name: string, ext: string }>}
 */
function walkDirectory(dir, options = {}) {
  const {
    extensions = null,
    recursive = true,
    ignoreTests = true,
    ignorePrefixes = ['.', '_'],
    ignoreNames = ['node_modules'],
    filter = null,
    baseDir = dir,
    detailed = false,
  } = options;

  if (!dir || typeof dir !== 'string') return [];

  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) return [];

  const extSet = extensions
    ? new Set(Array.from(extensions).map(e => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
    : null;

  const results = [];
  const resolvedBase = path.resolve(baseDir);

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      // Ignore specified exact names (e.g. 'node_modules')
      if (ignoreNames && ignoreNames.includes(name)) {
        continue;
      }

      // Ignore specified prefixes (e.g. '.' or '_')
      if (ignorePrefixes && ignorePrefixes.some(prefix => name.startsWith(prefix))) {
        continue;
      }

      const fullPath = path.join(currentDir, name);

      if (entry.isDirectory()) {
        if (recursive) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();

        // Check extensions if specified
        if (extSet && !extSet.has(ext)) {
          continue;
        }

        // Check test file suffixes
        if (ignoreTests && DEFAULT_TEST_SUFFIXES.some(suffix => name.toLowerCase().endsWith(suffix))) {
          continue;
        }

        // Custom filter function
        if (typeof filter === 'function' && !filter(fullPath, entry)) {
          continue;
        }

        if (detailed) {
          const relPath = path.relative(resolvedBase, fullPath).split(path.sep).join('/');
          results.push({
            absolutePath: fullPath,
            relativePath: relPath,
            name,
            ext,
          });
        } else {
          results.push(fullPath);
        }
      }
    }
  }

  walk(resolvedDir);
  return results;
}

/**
 * Convenient wrapper for walkDirectory with detailed: true
 * @param {string} dir
 * @param {Object} [options]
 * @returns {Array<{ absolutePath: string, relativePath: string, name: string, ext: string }>}
 */
function walkDirectoryDetailed(dir, options = {}) {
  return walkDirectory(dir, { ...options, detailed: true });
}

module.exports = {
  walkDirectory,
  walkDirectoryDetailed,
  DEFAULT_TEST_SUFFIXES,
};
