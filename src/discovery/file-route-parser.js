'use strict';

/**
 * Webspresso File Route Parser
 * Converts relative filesystem paths into Express route paths and HTTP methods
 * @module src/discovery/file-route-parser
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const SUPPORTED_EXTENSIONS = new Set(['.js', '.njk']);
const METHOD_SUFFIX_REGEX = /\.([a-zA-Z]+)\.js$/;
const TEMPORARY_FILE_REGEX = /(?:~|\.swp|\.tmp|\.bak|\.DS_Store)$/;

/**
 * Safely scans a directory recursively for route files
 * @param {string} dirPath - Absolute directory path
 * @param {string} [baseDir=dirPath] - Base directory for computing relative paths
 * @returns {Array<{ absolutePath: string, relativePath: string }>}
 */
function scanDirSafely(dirPath, baseDir = dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      if (isPrivateOrIgnored(name)) continue;

      const fullPath = path.join(dirPath, name);
      const relPath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        results.push(...scanDirSafely(fullPath, baseDir));
      } else if (entry.isFile()) {
        const ext = path.extname(name);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push({
            absolutePath: fullPath,
            relativePath: relPath,
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[webspresso] Failed to scan directory ${dirPath}:`, err.message);
  }

  return results;
}

/**
 * Checks if a filename or directory name should be ignored (private or temporary)
 * @param {string} name - File or directory basename
 * @returns {boolean}
 */
function isPrivateOrIgnored(name) {
  if (!name || typeof name !== 'string') return true;
  // Hidden files/directories (.git, .DS_Store, .login.js.swp)
  if (name.startsWith('.')) return true;
  // Private files/directories (_components, _helpers, _private.js)
  if (name.startsWith('_')) return true;
  // Temporary editor files
  if (TEMPORARY_FILE_REGEX.test(name)) return true;
  return false;
}

/**
 * Converts parameter markers [id] -> :id and catch-all [...path] -> *
 * @param {string} segment
 * @returns {string}
 */
function transformDynamicSegment(segment) {
  if (!segment || typeof segment !== 'string') return segment || '';
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    const paramName = segment.slice(4, -1).trim();
    return paramName ? `*${paramName}` : '*';
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    const paramName = segment.slice(1, -1).trim();
    return paramName ? `:${paramName}` : segment;
  }
  return segment;
}

/**
 * Normalizes a URL prefix to have a leading slash and no trailing slash
 * @param {string} [prefix='']
 * @returns {string}
 */
function normalizePrefix(prefix = '') {
  if (!prefix || typeof prefix !== 'string') return '';
  let clean = prefix.trim().replace(/\\/g, '/');
  clean = clean.replace(/\/+/g, '/');
  if (clean === '/' || !clean) return '';
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (clean.endsWith('/')) clean = clean.slice(0, -1);
  return clean === '/' ? '' : clean;
}

/**
 * Parses a relative file path for an API or Page route
 * @param {string} relativePath - Relative path from directory root (e.g. 'users/[id].get.js' or 'blog/[slug].js')
 * @param {Object} [options]
 * @param {string} [options.type='page'] - 'page' | 'api'
 * @param {string} [options.prefix=''] - Base prefix (e.g. '/api' or '/auth')
 * @returns {{ path: string, method: string, isValid: boolean, isPrivate: boolean, originalMethodPart?: string }}
 */
function parseFileRoute(relativePath, options = {}) {
  if (!relativePath || typeof relativePath !== 'string') {
    return { path: '', method: '', isValid: false, isPrivate: false };
  }

  const { type = 'page', prefix = '' } = options;

  // Normalize path separators to forward slashes
  const normalizedPath = relativePath.split(path.sep).join('/').replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);

  // Check if any segment is private or ignored
  for (const seg of segments) {
    if (isPrivateOrIgnored(seg)) {
      return { path: '', method: '', isValid: false, isPrivate: true };
    }
  }

  const filename = segments[segments.length - 1];
  if (!filename) {
    return { path: '', method: '', isValid: false, isPrivate: false };
  }

  let method = 'get';
  let cleanFilename = filename;
  let originalMethodPart = null;

  // Check for HTTP method suffix: e.g. health.get.js, [id].patch.js
  const methodMatch = filename.match(METHOD_SUFFIX_REGEX);
  if (methodMatch) {
    const rawMethod = methodMatch[1].toLowerCase();
    originalMethodPart = rawMethod;
    if (SUPPORTED_METHODS.has(rawMethod)) {
      method = rawMethod;
      cleanFilename = filename.replace(`.${methodMatch[1]}.js`, '');
    } else {
      // Invalid HTTP method in filename
      return { path: '', method: rawMethod, isValid: false, isPrivate: false, invalidMethod: true };
    }
  } else if (filename.endsWith('.js')) {
    cleanFilename = filename.slice(0, -3);
  } else if (filename.endsWith('.njk')) {
    cleanFilename = filename.slice(0, -4);
  }

  // Replace last segment with cleanFilename
  const routeSegments = [...segments.slice(0, -1), cleanFilename];

  // Filter out route group segments (e.g. (marketing), (auth))
  const filteredSegments = routeSegments.filter((seg) => !isRouteGroupSegment(seg));

  // Process dynamic brackets in segments
  const transformedSegments = filteredSegments.map(transformDynamicSegment);

  // Handle 'index' at the end of path
  if (transformedSegments[transformedSegments.length - 1] === 'index') {
    transformedSegments.pop();
  }

  let routePath = '/' + transformedSegments.join('/');
  if (routePath === '//' || routePath === '') {
    routePath = '/';
  }

  // Combine with prefix
  const cleanPrefix = normalizePrefix(prefix);
  if (cleanPrefix) {
    if (routePath === '/') {
      routePath = cleanPrefix;
    } else {
      routePath = `${cleanPrefix}${routePath}`;
    }
  }

  return {
    path: routePath,
    method: method.toUpperCase(),
    isValid: true,
    isPrivate: false,
    originalMethodPart,
  };
}

/**
 * Checks if a path segment is a route group, e.g. '(marketing)', '(auth)'
 * @param {string} segment
 * @returns {boolean}
 */
function isRouteGroupSegment(segment) {
  return (
    typeof segment === 'string' &&
    segment.length > 2 &&
    segment.charCodeAt(0) === 40 /* '(' */ &&
    segment.charCodeAt(segment.length - 1) === 41 /* ')' */
  );
}

/**
 * Checks if a file path belongs to an API route, accounting for optional parent route groups.
 * E.g., 'api/users.get.js' -> true
 *       'api/(v1)/users.get.js' -> true
 *       '(marketing)/api/newsletter.post.js' -> true
 *       'about.njk' -> false
 * @param {string} file
 * @returns {boolean}
 */
function isApiRouteFile(file) {
  if (!file || typeof file !== 'string') return false;
  const normalized = file.split(/[/\\]/).join('/');
  if (normalized.startsWith('api/')) return true;
  const parts = normalized.split('/');
  const apiIndex = parts.indexOf('api');
  if (apiIndex > 0) {
    const prefix = parts.slice(0, apiIndex);
    if (prefix.every(isRouteGroupSegment)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  parseFileRoute,
  isRouteGroupSegment,
  isApiRouteFile,
  isPrivateOrIgnored,
  normalizePrefix,
  transformDynamicSegment,
  scanDirSafely,
  SUPPORTED_METHODS,
  SUPPORTED_EXTENSIONS,
};
