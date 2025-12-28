/**
 * Webspresso Template Helpers
 * Laravel-ish utilities for Nunjucks templates
 */

const querystring = require('querystring');

/**
 * Create the fsy helper object bound to the current request context
 * @param {Object} ctx - Request context { req, res, baseUrl, locale }
 * @returns {Object} fsy helper object
 */
function createHelpers(ctx) {
  const { req, res, baseUrl = process.env.BASE_URL || 'http://localhost:3000' } = ctx;

  return {
    /**
     * Build a URL path with optional query parameters
     * @param {string} path - URL path
     * @param {Object} query - Query parameters
     * @returns {string}
     */
    url(path, query = null) {
      let url = path.startsWith('/') ? path : `/${path}`;
      if (query && Object.keys(query).length > 0) {
        url += '?' + querystring.stringify(query);
      }
      return url;
    },

    /**
     * Build a route path by replacing pattern params
     * @param {string} pattern - Route pattern like /tools/:slug
     * @param {Object} params - Parameters to replace
     * @returns {string}
     */
    route(pattern, params = {}) {
      let result = pattern;
      for (const [key, value] of Object.entries(params)) {
        result = result.replace(`:${key}`, encodeURIComponent(value));
        result = result.replace(`[${key}]`, encodeURIComponent(value));
      }
      return result;
    },

    /**
     * Build a full URL including the base URL
     * @param {string} path - URL path
     * @param {Object} query - Query parameters
     * @returns {string}
     */
    fullUrl(path, query = null) {
      const base = baseUrl.replace(/\/$/, '');
      return base + this.url(path, query);
    },

    /**
     * Get a query parameter from the request
     * @param {string} name - Parameter name
     * @param {*} def - Default value
     * @returns {*}
     */
    q(name, def = null) {
      return req.query[name] !== undefined ? req.query[name] : def;
    },

    /**
     * Get a route parameter from the request
     * @param {string} name - Parameter name
     * @param {*} def - Default value
     * @returns {*}
     */
    param(name, def = null) {
      return req.params[name] !== undefined ? req.params[name] : def;
    },

    /**
     * Get a header from the request
     * @param {string} name - Header name
     * @param {*} def - Default value
     * @returns {*}
     */
    hdr(name, def = null) {
      return req.get(name) || def;
    },

    /**
     * Check if running in development mode
     * @returns {boolean}
     */
    isDev() {
      return process.env.NODE_ENV !== 'production';
    },

    /**
     * Check if running in production mode
     * @returns {boolean}
     */
    isProd() {
      return process.env.NODE_ENV === 'production';
    },

    /**
     * Convert a string to URL-friendly slug
     * @param {string} s - Input string
     * @returns {string}
     */
    slugify(s) {
      if (!s) return '';
      return s
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    },

    /**
     * Truncate a string to n characters
     * @param {string} s - Input string
     * @param {number} n - Max length
     * @param {string} suffix - Suffix to append if truncated
     * @returns {string}
     */
    truncate(s, n, suffix = '...') {
      if (!s) return '';
      if (s.length <= n) return s;
      return s.substring(0, n - suffix.length) + suffix;
    },

    /**
     * Format bytes to human-readable string
     * @param {number} bytes - Number of bytes
     * @returns {string}
     */
    prettyBytes(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      const value = bytes / Math.pow(1024, i);
      return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
    },

    /**
     * Format milliseconds to human-readable string
     * @param {number} ms - Milliseconds
     * @returns {string}
     */
    prettyMs(ms) {
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
      return `${(ms / 3600000).toFixed(1)}h`;
    },

    /**
     * Get the canonical URL for the current request
     * @returns {string}
     */
    canonical() {
      const base = baseUrl.replace(/\/$/, '');
      return base + req.originalUrl.split('?')[0];
    },

    /**
     * Generate a JSON-LD script tag (returns safe HTML)
     * @param {Object} obj - JSON-LD object
     * @returns {string}
     */
    jsonld(obj) {
      const json = JSON.stringify(obj, null, 0)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      return `<script type="application/ld+json">${json}</script>`;
    },

    /**
     * Get the path to a static asset
     * @param {string} path - Asset path
     * @returns {string}
     */
    asset(path) {
      const assetPath = path.startsWith('/') ? path : `/${path}`;
      return assetPath;
    },

    /**
     * Get the current locale
     * @returns {string}
     */
    locale() {
      return ctx.locale || process.env.DEFAULT_LOCALE || 'en';
    },

    /**
     * Get the current path
     * @returns {string}
     */
    path() {
      return req.path;
    },

    /**
     * Check if the current path matches a pattern
     * @param {string} pattern - Path pattern (supports * wildcard)
     * @returns {boolean}
     */
    isPath(pattern) {
      const currentPath = req.path;
      if (pattern === currentPath) return true;
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(currentPath);
      }
      return false;
    }
  };
}

/**
 * Pure utility functions (can be used without request context)
 */
const utils = {
  slugify(s) {
    if (!s) return '';
    return s
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  },

  truncate(s, n, suffix = '...') {
    if (!s) return '';
    if (s.length <= n) return s;
    return s.substring(0, n - suffix.length) + suffix;
  },

  prettyBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  },

  prettyMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  },

  isDev() {
    return process.env.NODE_ENV !== 'production';
  },

  isProd() {
    return process.env.NODE_ENV === 'production';
  }
};

module.exports = {
  createHelpers,
  utils
};

