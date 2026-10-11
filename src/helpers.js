/**
 * Webspresso Template Helpers
 * Laravel-ish utilities for Nunjucks templates
 */

const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

// Extend dayjs with plugins
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

// Cache for isPath regex patterns
const isPathRegexCache = new Map();

/**
 * Asset Manager - handles asset paths, versioning, and manifest
 */
class AssetManager {
  constructor(options = {}) {
    this.publicDir = options.publicDir || 'public';
    this.srcDir = options.srcDir || 'src';
    this.pagesDir = options.pagesDir || 'pages';
    this.manifestPath = options.manifestPath || null;
    this.manifest = null;
    this.version = options.version || null;
    this.prefix = options.prefix || '';
    
    // Auto-detect manifest if not explicitly provided
    if (!this.manifestPath) {
      const candidates = [
        path.join(this.publicDir, 'dist', 'manifest.json'),
        path.join(this.publicDir, 'manifest.json'),
        path.join(this.publicDir, '.vite', 'manifest.json'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          this.manifestPath = candidate;
          break;
        }
      }
    }

    // Load manifest if path provided
    if (this.manifestPath) {
      this.loadManifest();
    }
  }
  
  /**
   * Load asset manifest file (Vite, Webpack, etc.)
   */
  loadManifest() {
    try {
      const fullPath = path.resolve(this.manifestPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        this.manifest = JSON.parse(content);
      }
    } catch (err) {
      console.warn('Failed to load asset manifest:', err.message);
      this.manifest = null;
    }
  }
  
  /**
   * Resolve asset path from manifest or add version
   * @param {string} assetPath - Asset path
   * @returns {string}
   */
  resolve(assetPath) {
    // Remove leading slash for manifest lookup
    const lookupPath = assetPath.replace(/^\//, '');
    
    // Check manifest first
    if (this.manifest) {
      // 1. Direct match with lookupPath or assetPath
      let entry = this.manifest[lookupPath] || this.manifest[assetPath];

      // 2. Flexible fallback: match by basename or trailing path
      if (!entry) {
        const baseName = path.basename(lookupPath);
        for (const [key, val] of Object.entries(this.manifest)) {
          if (
            key === baseName ||
            path.basename(key) === baseName ||
            key.endsWith('/' + lookupPath) ||
            lookupPath.endsWith('/' + key)
          ) {
            entry = val;
            break;
          }
        }
      }

      if (entry) {
        // Webpack string format (e.g. "/dist/app.xyz789.js")
        if (typeof entry === 'string') {
          return this.prefix + entry;
        }
        // Vite / esbuild metafile format (e.g. { file: "assets/app-xyz789.js" })
        if (entry.file) {
          const file = entry.file.startsWith('/') ? entry.file : '/' + entry.file;
          return this.prefix ? (this.prefix + file).replace(/\/+/g, '/') : file;
        }
      }
    }
    
    // Add version query string if provided
    let finalPath = assetPath.startsWith('/') ? assetPath : '/' + assetPath;
    finalPath = this.prefix + finalPath;
    
    if (this.version) {
      const separator = finalPath.includes('?') ? '&' : '?';
      finalPath += `${separator}v=${this.version}`;
    }
    
    return finalPath;
  }
  
  /**
   * Get asset URL
   */
  asset(assetPath) {
    return this.resolve(assetPath);
  }
  
  /**
   * Generate CSS link tag
   */
  css(href, attributes = {}) {
    const resolvedHref = this.resolve(href);
    const attrs = this.buildAttributes({
      rel: 'stylesheet',
      href: resolvedHref,
      ...attributes
    });
    return `<link ${attrs}>`;
  }
  
  /**
   * Generate JS script tag
   */
  js(src, attributes = {}) {
    const resolvedSrc = this.resolve(src);
    const attrs = this.buildAttributes({
      src: resolvedSrc,
      ...attributes
    });
    return `<script ${attrs}></script>`;
  }
  
  /**
   * Generate image tag
   */
  img(src, alt = '', attributes = {}) {
    const resolvedSrc = this.resolve(src);
    const attrs = this.buildAttributes({
      src: resolvedSrc,
      alt,
      ...attributes
    });
    return `<img ${attrs}>`;
  }
  
  /**
   * Resolve page-specific JS script URL
   * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/home.js')
   * @returns {string} Resolved script URL
   */
  pageJsUrl(name) {
    let clean = String(name || '').trim().replace(/^\/+/, '');
    if (!clean.endsWith('.js') && !clean.endsWith('.mjs')) {
      clean += '.js';
    }
    let pagePath = clean;
    if (!pagePath.startsWith('pages/') && !pagePath.startsWith('dist/')) {
      pagePath = 'pages/' + pagePath;
    }
    if (this.manifest) {
      if (this.manifest[pagePath] || this.manifest['js/' + pagePath]) {
        return this.resolve(pagePath);
      }
    }
    const devPath = pagePath.startsWith('js/') ? pagePath : 'js/' + pagePath;
    return this.resolve(devPath);
  }

  /**
   * Generate page-specific JS script tag
   * Resolves pages/<name>.js with defer attribute by default
   * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/checkout.js')
   * @param {Object} [attributes={}] - Additional HTML attributes (e.g. { type: 'module' })
   * @returns {string} Script tag
   */
  pageJs(name, attributes = {}) {
    const resolvedUrl = this.pageJsUrl(name);
    const attrs = this.buildAttributes({
      src: resolvedUrl,
      defer: true,
      ...attributes,
    });
    return `<script ${attrs}></script>`;
  }

  /**
   * Resolve page-specific CSS stylesheet URL
   * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/home.css')
   * @returns {string} Resolved stylesheet URL
   */
  pageCssUrl(name) {
    let clean = String(name || '').trim().replace(/^\/+/, '');
    if (!clean.endsWith('.css')) {
      clean += '.css';
    }
    let pagePath = clean;
    if (!pagePath.startsWith('pages/') && !pagePath.startsWith('dist/')) {
      pagePath = 'pages/' + pagePath;
    }
    if (this.manifest) {
      if (this.manifest[pagePath] || this.manifest['css/' + pagePath]) {
        return this.resolve(pagePath);
      }
    }
    const devPath = pagePath.startsWith('css/') ? pagePath : 'css/' + pagePath;
    return this.resolve(devPath);
  }

  /**
   * Generate page-specific CSS link tag
   * Resolves pages/<name>.css
   * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/checkout.css')
   * @param {Object} [attributes={}] - Additional HTML attributes
   * @returns {string} Link tag
   */
  pageCss(name, attributes = {}) {
    const resolvedUrl = this.pageCssUrl(name);
    const attrs = this.buildAttributes({
      rel: 'stylesheet',
      href: resolvedUrl,
      ...attributes,
    });
    return `<link ${attrs}>`;
  }

  /**
   * Derive candidate page asset names from route file and path
   * @param {string} [routeFile] - e.g. 'checkout.njk', 'pages/products/[id].njk'
   * @param {string} [routePath] - e.g. '/checkout', '/products/:id', '/'
   * @returns {string[]} Ordered candidate asset names
   */
  getRouteAssetCandidates(routeFile, routePath) {
    const candidates = new Set();

    if (routeFile) {
      let cleanFile = String(routeFile).trim().replace(/^\/+/, '');
      if (cleanFile.startsWith('pages/')) {
        cleanFile = cleanFile.slice(6);
      }
      cleanFile = cleanFile.replace(/\.(njk|html|ejs|hbs|js)$/, '');
      if (cleanFile) {
        candidates.add(cleanFile);
        if (cleanFile.endsWith('/index')) {
          candidates.add(cleanFile.slice(0, -6));
        }
        if (cleanFile.includes('[')) {
          const parts = cleanFile.split('/');
          const staticParts = parts.filter(p => !p.startsWith('['));
          if (staticParts.length > 0) {
            candidates.add(staticParts.join('/'));
          }
        }
        if (cleanFile === 'index') {
          candidates.add('home');
        }
      }
    }

    if (routePath) {
      let cleanPath = String(routePath).trim().replace(/^\/+/, '').replace(/\/+$/, '');
      if (cleanPath) {
        candidates.add(cleanPath);
        if (cleanPath.includes(':')) {
          const bracketed = cleanPath.split('/').map(seg => seg.startsWith(':') ? `[${seg.slice(1)}]` : seg).join('/');
          candidates.add(bracketed);
          const withoutParams = cleanPath.split('/').filter(seg => !seg.startsWith(':')).join('/');
          if (withoutParams) candidates.add(withoutParams);
        }
      } else {
        candidates.add('index');
        candidates.add('home');
      }
    }

    return Array.from(candidates);
  }

  /**
   * Check if a page-specific JS script exists (in manifest or on filesystem)
   * @param {string} name - Page name
   * @returns {boolean}
   */
  hasPageJs(name) {
    if (!name || typeof name !== 'string') return false;
    let clean = String(name).trim().replace(/^\/+/, '');
    if (clean.startsWith('pages/')) clean = clean.slice(6);
    if (clean.startsWith('dist/pages/')) clean = clean.slice(11);
    if (clean.startsWith('js/pages/')) clean = clean.slice(9);
    const base = clean.replace(/\.(js|mjs|ts)$/, '');
    const pagePath = 'pages/' + base + '.js';

    // 1. Check in manifest (production or dev manifest)
    if (this.manifest) {
      if (
        this.manifest[pagePath] ||
        this.manifest['js/' + pagePath] ||
        this.manifest['pages/' + base] ||
        this.manifest[base + '.js'] ||
        this.manifest[base] ||
        this.manifest['src/client/' + pagePath] ||
        this.manifest['client/' + pagePath]
      ) {
        return true;
      }
    }

    // 2. Check filesystem
    const publicDir = this.publicDir || 'public';
    const srcDir = this.srcDir || 'src';
    const pagesDir = this.pagesDir || 'pages';

    const diskChecks = [
      path.join(publicDir, 'js', pagePath),
      path.join(publicDir, pagePath),
      path.join(publicDir, 'dist', pagePath),
      path.join(srcDir, 'client', pagePath),
      path.join(srcDir, 'client', 'pages', base + '.ts'),
      path.join('src', 'client', 'pages', base + '.js'),
      path.join('src', 'client', 'pages', base + '.ts'),
      path.join('client', 'pages', base + '.js'),
      path.join('client', 'pages', base + '.ts'),
      path.join(pagesDir, base + '.client.js'),
      path.join(pagesDir, base + '.client.ts'),
      path.join('pages', base + '.client.js'),
      path.join('pages', base + '.client.ts'),
    ];

    for (const p of diskChecks) {
      try {
        if (fs.existsSync(p)) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  /**
   * Check if a page-specific CSS stylesheet exists (in manifest or on filesystem)
   * @param {string} name - Page name
   * @returns {boolean}
   */
  hasPageCss(name) {
    if (!name || typeof name !== 'string') return false;
    let clean = String(name).trim().replace(/^\/+/, '');
    if (clean.startsWith('pages/')) clean = clean.slice(6);
    if (clean.startsWith('dist/pages/')) clean = clean.slice(11);
    if (clean.startsWith('css/pages/')) clean = clean.slice(10);
    const base = clean.replace(/\.css$/, '');
    const pagePath = 'pages/' + base + '.css';

    // 1. Check in manifest
    if (this.manifest) {
      if (
        this.manifest[pagePath] ||
        this.manifest['css/' + pagePath] ||
        this.manifest['pages/' + base] ||
        this.manifest[base + '.css'] ||
        this.manifest[base] ||
        this.manifest['src/client/' + pagePath] ||
        this.manifest['client/' + pagePath]
      ) {
        return true;
      }
    }

    // 2. Check filesystem
    const publicDir = this.publicDir || 'public';
    const srcDir = this.srcDir || 'src';
    const pagesDir = this.pagesDir || 'pages';

    const diskChecks = [
      path.join(publicDir, 'css', pagePath),
      path.join(publicDir, pagePath),
      path.join(publicDir, 'dist', pagePath),
      path.join(srcDir, 'client', pagePath),
      path.join('src', 'client', 'pages', base + '.css'),
      path.join('client', 'pages', base + '.css'),
      path.join(pagesDir, base + '.css'),
      path.join('pages', base + '.css'),
      path.join('public', 'css', 'pages', base + '.css'),
    ];

    for (const p of diskChecks) {
      try {
        if (fs.existsSync(p)) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  /**
   * Generate combined page asset tags (link and/or script) for a given page name
   * @param {string|Object} [nameOrOptions] - Page name or options
   * @param {Object} [options={}] - Options ({ js?: boolean, css?: boolean, cssAttrs?: Object, ...jsAttrs })
   * @returns {string} HTML tags joined with newline
   */
  pageAssets(nameOrOptions, options = {}) {
    let name = nameOrOptions;
    let opts = options;
    if (typeof nameOrOptions === 'object' && nameOrOptions !== null) {
      opts = nameOrOptions;
      name = null;
    }

    if (!name) return '';

    const tags = [];
    const includeCss = opts.css !== false;
    const includeJs = opts.js !== false;

    if (includeCss && this.hasPageCss(name)) {
      tags.push(this.pageCss(name, opts.cssAttrs || {}));
    }

    if (includeJs && this.hasPageJs(name)) {
      const { css: _c, js: _j, cssAttrs: _ca, ...jsAttrs } = opts;
      tags.push(this.pageJs(name, jsAttrs));
    }

    return tags.join('\n');
  }

  /**
   * Generate combined page asset tags automatically matching a route
   * @param {string} [routeFile] - Route template file
   * @param {string} [routePath] - Route path
   * @param {Object} [options={}] - Options ({ js?: boolean, css?: boolean, cssAttrs?: Object, ...jsAttrs })
   * @returns {string} HTML tags joined with newline
   */
  pageAssetsForRoute(routeFile, routePath, options = {}) {
    const candidates = this.getRouteAssetCandidates(routeFile, routePath);
    const tags = [];
    const includeCss = options.css !== false;
    const includeJs = options.js !== false;

    if (includeCss) {
      for (const cand of candidates) {
        if (this.hasPageCss(cand)) {
          tags.push(this.pageCss(cand, options.cssAttrs || {}));
          break;
        }
      }
    }

    if (includeJs) {
      for (const cand of candidates) {
        if (this.hasPageJs(cand)) {
          const { css: _c, js: _j, cssAttrs: _ca, ...jsAttrs } = options;
          tags.push(this.pageJs(cand, jsAttrs));
          break;
        }
      }
    }

    return tags.join('\n');
  }

  /**
   * Build HTML attributes string
   */
  buildAttributes(attrs) {
    return Object.entries(attrs)
      .filter(([k, v]) => v !== undefined && v !== null && v !== false && /^[a-zA-Z0-9_\-:]+$/.test(k))
      .map(([k, v]) => v === true ? k : `${k}="${this.escapeHtml(String(v))}"`)
      .join(' ');
  }
  
  /**
   * Escape HTML special characters
   */
  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Global asset manager instance
let globalAssetManager = null;

/**
 * Configure global asset manager
 * @param {Object} options - Asset manager options
 */
function configureAssets(options = {}) {
  globalAssetManager = new AssetManager(options);
  return globalAssetManager;
}

/**
 * Get or create asset manager
 */
function getAssetManager() {
  if (!globalAssetManager) {
    globalAssetManager = new AssetManager();
  }
  return globalAssetManager;
}

/**
 * Create the fsy helper object bound to the current request context
 * @param {Object} ctx - Request context { req, res, baseUrl, locale }
 * @returns {Object} fsy helper object
 */
function createHelpers(ctx) {
  const { req, res, baseUrl = process.env.BASE_URL || 'http://localhost:3000', locale = 'en', t = null } = ctx || {};

  return {
    /** Active request locale */
    locale,

    /** Active i18n translator function */
    t,

    /**
     * Generate URL for switching to a target locale with current query parameters preserved
     * @param {string} targetLocale - Locale code to switch to (e.g. 'en', 'tr')
     * @param {string} [customPath] - Optional custom path (defaults to current req.path)
     * @returns {string} URL string with updated locale query param
     */
    localeUrl(targetLocale, customPath) {
      const p = customPath || (req && req.path ? req.path : '/');
      const q = { ...(req && req.query ? req.query : {}), lang: targetLocale };
      return this.url(p, q);
    },

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
      return req && req.query && req.query[name] !== undefined ? req.query[name] : def;
    },

    /**
     * Get a route parameter from the request
     * @param {string} name - Parameter name
     * @param {*} def - Default value
     * @returns {*}
     */
    param(name, def = null) {
      return req && req.params && req.params[name] !== undefined ? req.params[name] : def;
    },

    /**
     * Get a header from the request
     * @param {string} name - Header name
     * @param {*} def - Default value
     * @returns {*}
     */
    hdr(name, def = null) {
      if (!req) return def;
      return (typeof req.get === 'function' ? req.get(name) : (req.headers && req.headers[name.toLowerCase()])) || def;
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
        let regex = isPathRegexCache.get(pattern);
        if (regex === undefined) {
          regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          if (isPathRegexCache.size < 500) {
            isPathRegexCache.set(pattern, regex);
          }
        }
        return regex.test(currentPath);
      }
      return false;
    },

    // Asset helpers
    /**
     * Get asset URL with versioning/manifest support
     * @param {string} assetPath - Asset path
     * @returns {string}
     */
    asset(assetPath) {
      return getAssetManager().asset(assetPath);
    },

    /**
     * Generate CSS link tag
     * @param {string} href - CSS file path
     * @param {Object} attrs - Additional attributes
     * @returns {string}
     */
    css(href, attrs = {}) {
      return getAssetManager().css(href, attrs);
    },

    /**
     * Generate JS script tag
     * @param {string} src - JS file path
     * @param {Object} attrs - Additional attributes
     * @returns {string}
     */
    js(src, attrs = {}) {
      return getAssetManager().js(src, attrs);
    },

    /**
     * Generate image tag
     * @param {string} src - Image file path
     * @param {string} alt - Alt text
     * @param {Object} attrs - Additional attributes
     * @returns {string}
     */
    img(src, alt = '', attrs = {}) {
      return getAssetManager().img(src, alt, attrs);
    },

    /**
     * Generate Dev Live/Hot Reload script tag in development mode
     * @returns {string} Script tag or empty string
     */
    devReload() {
      const isDev = process.env.NODE_ENV !== 'production';
      if (!isDev) return '';
      return '<script defer src="/__webspresso/dev-reload.js"></script>';
    },

    /**
     * Generate page-specific JS script tag
     * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/checkout.js')
     * @param {Object} [attrs={}] - Additional HTML attributes
     * @returns {string}
     */
    pageJs(name, attrs = {}) {
      return getAssetManager().pageJs(name, attrs);
    },

    /**
     * Resolve page-specific JS script URL
     * @param {string} name - Page name
     * @returns {string}
     */
    pageJsUrl(name) {
      return getAssetManager().pageJsUrl(name);
    },

    /**
     * Generate page-specific CSS link tag
     * @param {string} name - Page name (e.g. 'home', 'checkout', 'pages/checkout.css')
     * @param {Object} [attrs={}] - Additional HTML attributes
     * @returns {string}
     */
    pageCss(name, attrs = {}) {
      return getAssetManager().pageCss(name, attrs);
    },

    /**
     * Resolve page-specific CSS stylesheet URL
     * @param {string} name - Page name
     * @returns {string}
     */
    pageCssUrl(name) {
      return getAssetManager().pageCssUrl(name);
    },

    /**
     * Check if a page-specific JS script exists
     * @param {string} name - Page name
     * @returns {boolean}
     */
    hasPageJs(name) {
      return getAssetManager().hasPageJs(name);
    },

    /**
     * Check if a page-specific CSS stylesheet exists
     * @param {string} name - Page name
     * @returns {boolean}
     */
    hasPageCss(name) {
      return getAssetManager().hasPageCss(name);
    },

    /**
     * Generate combined page asset tags (link and/or script) for a given page name or current route
     * @param {string|Object} [nameOrAttrs] - Page name (e.g. 'checkout') or options object
     * @param {Object} [attrs={}] - Additional attributes
     * @returns {string} HTML string
     */
    pageAssets(nameOrAttrs, attrs) {
      if (typeof nameOrAttrs === 'string' && nameOrAttrs.trim()) {
        return getAssetManager().pageAssets(nameOrAttrs, attrs);
      }
      const opts = (typeof nameOrAttrs === 'object' && nameOrAttrs !== null) ? nameOrAttrs : (attrs || {});
      const routeFile = req?.context?.file;
      const routePath = req?.context?.path || req?.path;
      return getAssetManager().pageAssetsForRoute(routeFile, routePath, opts);
    },

    /**
     * Date/time helpers using dayjs
     */
    
    /**
     * Create a dayjs instance from a date
     * @param {string|Date|number} date - Date to parse
     * @param {string} format - Optional format string
     * @returns {Object} dayjs instance
     */
    date(date, format) {
      if (!date) return dayjs();
      if (format) {
        return dayjs(date, format);
      }
      return dayjs(date);
    },

    /**
     * Format a date
     * @param {string|Date|number} date - Date to format
     * @param {string} format - Format string (default: 'YYYY-MM-DD')
     * @returns {string}
     */
    dateFormat(date, format = 'YYYY-MM-DD') {
      if (!date) return '';
      return dayjs(date).format(format);
    },

    /**
     * Get relative time (e.g., "2 hours ago")
     * @param {string|Date|number} date - Date to format
     * @returns {string}
     */
    dateFromNow(date) {
      if (!date) return '';
      return dayjs(date).fromNow();
    },

    /**
     * Get time ago (e.g., "2 hours ago")
     * @param {string|Date|number} date - Date to format
     * @returns {string}
     */
    dateAgo(date) {
      if (!date) return '';
      return dayjs(date).fromNow();
    },

    /**
     * Get time until (e.g., "in 2 hours")
     * @param {string|Date|number} date - Date to format
     * @returns {string}
     */
    dateUntil(date) {
      if (!date) return '';
      return dayjs(date).toNow();
    },

    /**
     * Check if date is before another date
     * @param {string|Date|number} date1 - First date
     * @param {string|Date|number} date2 - Second date
     * @returns {boolean}
     */
    dateIsBefore(date1, date2) {
      if (!date1 || !date2) return false;
      return dayjs(date1).isBefore(date2);
    },

    /**
     * Check if date is after another date
     * @param {string|Date|number} date1 - First date
     * @param {string|Date|number} date2 - Second date
     * @returns {boolean}
     */
    dateIsAfter(date1, date2) {
      if (!date1 || !date2) return false;
      return dayjs(date1).isAfter(date2);
    },

    /**
     * Check if date is same as another date
     * @param {string|Date|number} date1 - First date
     * @param {string|Date|number} date2 - Second date
     * @param {string} unit - Unit to compare (day, month, year, etc.)
     * @returns {boolean}
     */
    dateIsSame(date1, date2, unit = 'day') {
      if (!date1 || !date2) return false;
      return dayjs(date1).isSame(date2, unit);
    },

    /**
     * Get difference between two dates
     * @param {string|Date|number} date1 - First date
     * @param {string|Date|number} date2 - Second date
     * @param {string} unit - Unit (day, month, year, hour, minute, second)
     * @returns {number}
     */
    dateDiff(date1, date2, unit = 'day') {
      if (!date1 || !date2) return 0;
      return dayjs(date1).diff(date2, unit);
    },

    /**
     * Add time to a date
     * @param {string|Date|number} date - Date to add to
     * @param {number} amount - Amount to add
     * @param {string} unit - Unit (day, month, year, hour, minute, second)
     * @returns {Object} dayjs instance
     */
    dateAdd(date, amount, unit = 'day') {
      if (!date) return dayjs();
      return dayjs(date).add(amount, unit);
    },

    /**
     * Subtract time from a date
     * @param {string|Date|number} date - Date to subtract from
     * @param {number} amount - Amount to subtract
     * @param {string} unit - Unit (day, month, year, hour, minute, second)
     * @returns {Object} dayjs instance
     */
    dateSubtract(date, amount, unit = 'day') {
      if (!date) return dayjs();
      return dayjs(date).subtract(amount, unit);
    },

    /**
     * Get start of a time period
     * @param {string|Date|number} date - Date
     * @param {string} unit - Unit (day, month, year, week)
     * @returns {Object} dayjs instance
     */
    dateStartOf(date, unit = 'day') {
      if (!date) return dayjs();
      return dayjs(date).startOf(unit);
    },

    /**
     * Get end of a time period
     * @param {string|Date|number} date - Date
     * @param {string} unit - Unit (day, month, year, week)
     * @returns {Object} dayjs instance
     */
    dateEndOf(date, unit = 'day') {
      if (!date) return dayjs();
      return dayjs(date).endOf(unit);
    },

    // ============================================
    // Script Injection Helpers
    // ============================================

    /**
     * Get CSP nonce if available from request context
     * @returns {string} Nonce string or empty string
     */
    nonce() {
      return (
        req?.res?.locals?.cspNonce ||
        req?.res?.locals?.nonce ||
        res?.locals?.cspNonce ||
        res?.locals?.nonce ||
        req?.cspNonce ||
        req?.nonce ||
        ''
      );
    },

    /**
     * Get injected head content (CSS, scripts)
     * @param {Object|string} [options] - Optional { nonce: string } or nonce string
     * @returns {string} HTML content for head section
     */
    injectHead(options) {
      const explicitNonce = typeof options === 'string' ? options : options?.nonce;
      const nonce = explicitNonce || this.nonce();
      const injector = getScriptInjector();
      let content = '';
      
      // Add styles
      const styles = injector.getStylesContent(nonce ? { nonce } : options);
      if (styles) {
        const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
        content += `<style id="webspresso-injected-styles"${nonceAttr}>\n${styles}\n</style>\n`;
      }
      
      // Add head scripts
      content += injector.getHeadContent(nonce ? { nonce } : options);
      
      return content;
    },

    /**
     * Get injected body content (for end of body)
     * @param {Object|string} [options] - Optional { nonce: string } or nonce string
     * @returns {string} HTML content for body end
     */
    injectBody(options) {
      const explicitNonce = typeof options === 'string' ? options : options?.nonce;
      const nonce = explicitNonce || this.nonce();
      return getScriptInjector().getBodyContent(nonce ? { nonce } : options);
    },

    /**
     * Get dev toolbar HTML (only in development mode)
     * @param {Object} options - { plugins: Array, customLinks: Array }
     * @returns {string} Dev toolbar HTML
     */
    devToolbar(options = {}) {
      if (options && options.enabled === false) return '';
      const injector = getScriptInjector();
      const registeredPlugins = injector.getPlugins();
      return generateDevToolbar({
        req,
        res,
        ...options,
        plugins: [...registeredPlugins, ...(options.plugins || [])]
      });
    },

    /**
     * Get the script injector instance for advanced usage
     * @returns {ScriptInjector}
     */
    getInjector() {
      return getScriptInjector();
    }
  };
}

/**
 * Script Injector - manages script/style injection for templates
 */
class ScriptInjector {
  constructor() {
    this.headScripts = [];
    this.bodyScripts = [];
    this.styles = [];
    this.plugins = [];
  }

  /**
   * Add content to head section
   * @param {string} content - HTML/script content
   * @param {Object} options - { priority: number, id: string }
   */
  addHead(content, options = {}) {
    this.headScripts.push({
      content,
      priority: options.priority || 0,
      id: options.id || null
    });
  }

  /**
   * Add content to body end section
   * @param {string} content - HTML/script content
   * @param {Object} options - { priority: number, id: string }
   */
  addBody(content, options = {}) {
    this.bodyScripts.push({
      content,
      priority: options.priority || 0,
      id: options.id || null
    });
  }

  /**
   * Add CSS styles
   * @param {string} css - CSS content
   * @param {Object} options - { id: string }
   */
  addStyle(css, options = {}) {
    this.styles.push({
      content: css,
      id: options.id || null
    });
  }

  /**
   * Register a plugin for dev toolbar
   * @param {Object} plugin - { name, path, icon, description }
   */
  registerPlugin(plugin) {
    this.plugins.push(plugin);
  }

  /**
   * Get head content sorted by priority
   * @param {Object|string} [options] - Optional { nonce: string } or nonce string
   */
  getHeadContent(options = {}) {
    const nonce = typeof options === 'string' ? options : (options?.nonce || '');
    const sorted = [...this.headScripts].sort((a, b) => b.priority - a.priority);
    return sorted.map(s => {
      let content = typeof s.content === 'function' ? s.content(options) : s.content;
      if (nonce && typeof content === 'string') {
        content = content.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
      }
      return content;
    }).join('\n');
  }

  /**
   * Get body content sorted by priority
   * @param {Object|string} [options] - Optional { nonce: string } or nonce string
   */
  getBodyContent(options = {}) {
    const nonce = typeof options === 'string' ? options : (options?.nonce || '');
    const sorted = [...this.bodyScripts].sort((a, b) => b.priority - a.priority);
    return sorted.map(s => {
      let content = typeof s.content === 'function' ? s.content(options) : s.content;
      if (nonce && typeof content === 'string') {
        content = content.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
      }
      return content;
    }).join('\n');
  }

  /**
   * Get styles content
   * @param {Object|string} [options] - Optional { nonce: string } or nonce string
   */
  getStylesContent(options = {}) {
    const nonce = typeof options === 'string' ? options : (options?.nonce || '');
    return this.styles.map(s => {
      let content = typeof s.content === 'function' ? s.content(options) : s.content;
      if (nonce && typeof content === 'string') {
        content = content.replace(/<style(?![^>]*\bnonce=)/gi, `<style nonce="${nonce}"`);
      }
      return content;
    }).join('\n');
  }

  /**
   * Get registered plugins
   */
  getPlugins() {
    return [...this.plugins];
  }

  /**
   * Clear all injections
   */
  clear() {
    this.headScripts = [];
    this.bodyScripts = [];
    this.styles = [];
  }
}

// Global script injector instance
let globalInjector = new ScriptInjector();

/**
 * Get or create the global script injector
 */
function getScriptInjector() {
  return globalInjector;
}

/**
 * Reset the global script injector (useful for testing)
 */
function resetScriptInjector() {
  globalInjector = new ScriptInjector();
  return globalInjector;
}

/**
 * Safely escape HTML string
 * @param {string} str
 * @returns {string}
 */
function safeEscapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate dev toolbar HTML
 * @param {Object} options - { plugins: Array, routes: Array, req: Object, res: Object }
 */
function generateDevToolbar(options = {}) {
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (!isDev) return '';

  const { req = null, res = null } = options;

  // Normalize custom links & plugins
  const rawCustomLinks = options.customLinks || options.links || [];
  const normalizedCustomLinks = rawCustomLinks.map(link => ({
    name: link.name || link.label || link.title || 'Link',
    path: link.path || link.url || link.href || '#',
    icon: link.icon || '🔗',
    description: link.description || '',
  }));

  const rawPlugins = options.plugins || [];
  const normalizedPlugins = rawPlugins.map(p => ({
    name: p.name || p.label || p.title || 'Plugin',
    path: p.path || p.url || p.href || '#',
    icon: p.icon || '🔗',
    description: p.description || '',
  }));

  // 1. Gather active request profiler metrics & DB queries
  let queries = [];
  let queryDurationMs = 0;
  let nPlusOneWarnings = [];

  try {
    const { profilerStorage, detectNPlusOne } = require('./dev/profiler');
    const store = profilerStorage.getStore();
    if (store && Array.isArray(store.queries)) {
      queries = store.queries;
      queryDurationMs = queries.reduce((acc, q) => acc + (q.durationMs || 0), 0);
      nPlusOneWarnings = (Array.isArray(store.nPlusOneWarnings) && store.nPlusOneWarnings.length > 0)
        ? store.nPlusOneWarnings
        : detectNPlusOne(queries, { threshold: 4 });
    }
  } catch {
    // Profiler not active or async context lost
  }

  // 2. Request context details
  const currentPath = (req && (req.originalUrl || req.path)) || '/';
  const currentMethod = (req && req.method) || 'GET';
  const routeFile = req?._webspressoRoute?.file || (req?.route && req.route.path) || '';
  const templateName = res?.locals?._template || req?._webspressoTemplate || '';
  const statusCode = res?.statusCode || 200;
  const urlParams = req?.params || {};
  const queryParams = req?.query || {};

  // 3. Default plugin links
  const defaultPlugins = [
    { name: 'Dashboard', path: '/_webspresso', icon: '📊', description: 'Development Dashboard' },
    { name: 'Admin', path: '/_admin', icon: '⚙️', description: 'Admin Panel' },
    { name: 'API Docs', path: '/_swagger', icon: '📖', description: 'Interactive API Docs & Playground' },
    { name: 'Schema', path: '/_schema', icon: '🗂️', description: 'Schema Explorer' },
  ];

  const allPlugins = [...defaultPlugins, ...normalizedPlugins, ...normalizedCustomLinks];

  const toolbarStyles = `
    <style id="webspresso-dev-toolbar-styles">
      #webspresso-dev-toolbar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #0f172a;
        border-top: 1px solid #1e293b;
        padding: 0;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Mono", monospace;
        font-size: 12px;
        color: #f1f5f9;
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
        transform: translateY(calc(100% - 36px));
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      #webspresso-dev-toolbar.expanded {
        transform: translateY(0);
      }
      #webspresso-dev-toolbar-toggle {
        position: absolute;
        top: -24px;
        left: 20px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-bottom: none;
        border-radius: 6px 6px 0 0;
        padding: 3px 12px;
        cursor: pointer;
        color: #38bdf8;
        font-weight: 700;
        font-size: 10px;
        letter-spacing: 0.5px;
        user-select: none;
      }
      #webspresso-dev-toolbar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 14px;
        height: 36px;
        border-bottom: 1px solid #1e293b;
        background: #0f172a;
        cursor: pointer;
        user-select: none;
      }
      .ws-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
      }
      #webspresso-dev-toolbar-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #38bdf8;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.5px;
        white-space: nowrap;
      }
      #webspresso-dev-toolbar-brand svg {
        width: 14px;
        height: 14px;
      }
      .ws-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        background: #1e293b;
        border: 1px solid #334155;
        white-space: nowrap;
      }
      .ws-pill.clickable:hover {
        border-color: #38bdf8;
        cursor: pointer;
      }
      .ws-method {
        font-weight: 700;
        color: #38bdf8;
      }
      .ws-status-200 { color: #4ade80; }
      .ws-status-404, .ws-status-500 { color: #f87171; }
      .ws-query-pill {
        color: #cbd5e1;
      }
      .ws-warn-pill {
        background: rgba(234, 179, 8, 0.15);
        color: #facc15;
        border-color: rgba(234, 179, 8, 0.4);
      }
      #webspresso-dev-toolbar-info {
        color: #64748b;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .ws-expand-icon {
        font-size: 10px;
        color: #94a3b8;
        padding: 2px 6px;
        border-radius: 4px;
        background: #1e293b;
      }
      #webspresso-dev-toolbar-content {
        display: none;
      }
      .webspresso-dev-toolbar-section {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .webspresso-dev-toolbar-section-title {
        color: #64748b;
        font-size: 9px;
        text-transform: uppercase;
        margin-right: 6px;
      }
      .webspresso-dev-toolbar-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 4px;
        color: #e2e8f0;
        text-decoration: none;
        font-size: 11px;
        transition: all 0.15s ease;
        white-space: nowrap;
      }
      .webspresso-dev-toolbar-link:hover {
        background: #334155;
        border-color: #38bdf8;
        color: #fff;
      }
      .webspresso-dev-toolbar-link-icon { font-size: 12px; }
      .webspresso-dev-toolbar-link-text { font-weight: 500; }
      
      /* Drawer */
      .ws-drawer {
        height: 290px;
        display: flex;
        flex-direction: column;
        background: #090d16;
      }
      .ws-drawer-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 6px 12px;
        background: #0f172a;
        border-bottom: 1px solid #1e293b;
      }
      .ws-tab-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: all 0.15s ease;
      }
      .ws-tab-btn:hover {
        color: #f1f5f9;
        background: #1e293b;
      }
      .ws-tab-btn.active {
        color: #38bdf8;
        background: #1e293b;
        font-weight: 600;
      }
      .ws-drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
      }
      .ws-panel {
        display: none;
      }
      .ws-panel.active {
        display: block;
      }
      .ws-query-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .ws-query-table th {
        text-align: left;
        color: #64748b;
        padding: 6px 8px;
        border-bottom: 1px solid #1e293b;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 10px;
      }
      .ws-query-table td {
        padding: 6px 8px;
        border-bottom: 1px solid #141c2e;
        vertical-align: top;
      }
      .ws-table-pill {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        font-size: 10px;
        font-weight: 600;
      }
      .ws-duration-fast { color: #4ade80; font-weight: 600; }
      .ws-duration-slow { color: #facc15; font-weight: 700; }
      .ws-sql-code {
        font-family: 'SF Mono', monospace;
        color: #cbd5e1;
        word-break: break-all;
      }
      .ws-warn-box {
        background: rgba(234, 179, 8, 0.1);
        border: 1px solid rgba(234, 179, 8, 0.3);
        border-radius: 6px;
        padding: 8px 12px;
        margin-bottom: 10px;
        color: #facc15;
        font-size: 11px;
      }
      .ws-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 10px;
      }
      .ws-meta-card {
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 6px;
        padding: 10px;
      }
      .ws-meta-card h4 {
        margin: 0 0 6px 0;
        font-size: 11px;
        color: #94a3b8;
        text-transform: uppercase;
      }
      .ws-meta-val {
        font-family: 'SF Mono', monospace;
        font-size: 12px;
        color: #e2e8f0;
        word-break: break-all;
      }
      .ws-tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 10px;
      }
      .ws-tool-card {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 6px;
        padding: 10px 12px;
        color: #e2e8f0;
        text-decoration: none;
        transition: all 0.15s ease;
      }
      .ws-tool-card:hover {
        background: #1e293b;
        border-color: #38bdf8;
        color: #fff;
      }
    </style>
  `;

  // Render plugin links
  const pluginLinks = allPlugins.map(p => `
    <a href="${p.path}" class="webspresso-dev-toolbar-link" title="${safeEscapeHtml(p.description || p.name)}">
      <span class="webspresso-dev-toolbar-link-icon">${p.icon || '🔗'}</span>
      <span class="webspresso-dev-toolbar-link-text">${safeEscapeHtml(p.name)}</span>
    </a>
  `).join('');

  // Render Queries list
  const queriesHtml = queries.length === 0
    ? `<div style="color: #64748b; padding: 20px 0; text-align: center;">No database queries recorded for this page request.</div>`
    : `
      ${nPlusOneWarnings.map(w => `
        <div class="ws-warn-box">
          <strong>⚠️ Potential N+1 Query Warning:</strong> ${safeEscapeHtml(w.recommendation)}
        </div>
      `).join('')}
      <table class="ws-query-table">
        <thead>
          <tr>
            <th style="width: 70px;">Time</th>
            <th style="width: 110px;">Table</th>
            <th>SQL Query</th>
          </tr>
        </thead>
        <tbody>
          ${queries.map(q => `
            <tr>
              <td><span class="${(q.durationMs || 0) > 40 ? 'ws-duration-slow' : 'ws-duration-fast'}">${(q.durationMs || 0).toFixed(1)}ms</span></td>
              <td><span class="ws-table-pill">${safeEscapeHtml(q.table || 'raw')}</span></td>
              <td><span class="ws-sql-code">${safeEscapeHtml(q.sql || '')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  const toolbarHtml = `
    ${toolbarStyles}
    <div id="webspresso-dev-toolbar">
      <div id="webspresso-dev-toolbar-toggle" title="Toggle DevTools (Alt+D)">⚡ DEV</div>
      <div id="webspresso-dev-toolbar-header">
        <div class="ws-header-left">
          <div id="webspresso-dev-toolbar-brand">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            WEBSPRESSO DEV
          </div>
          <div class="ws-pill" title="Current Route">
            <span class="ws-method">${safeEscapeHtml(currentMethod)}</span>
            <span class="ws-status-${statusCode}">${statusCode}</span>
            <span style="color: #94a3b8;">${safeEscapeHtml(currentPath)}</span>
          </div>
          ${queries.length > 0 ? `
            <div class="ws-pill clickable ws-query-pill" data-open-tab="queries" title="View ${queries.length} queries">
              <span>🗄️ ${queries.length} queries</span>
              <span style="color: #64748b;">(${queryDurationMs.toFixed(1)}ms)</span>
            </div>
          ` : ''}
          ${nPlusOneWarnings.length > 0 ? `
            <div class="ws-pill clickable ws-warn-pill" data-open-tab="queries" title="${nPlusOneWarnings.length} N+1 Warning(s)">
              ⚠️ N+1 (${nPlusOneWarnings.length})
            </div>
          ` : ''}
        </div>
        <div id="webspresso-dev-toolbar-info">
          <span style="display: none;" id="webspresso-dev-toolbar-content">
            <span class="webspresso-dev-toolbar-section">
              <span class="webspresso-dev-toolbar-section-title">Quick Links</span>
              ${pluginLinks}
            </span>
          </span>
          <span>Node ${process.version}</span>
          <span class="ws-expand-icon" id="ws-expand-arrow">▲</span>
        </div>
      </div>

      <!-- Drawer Content -->
      <div class="ws-drawer" id="webspresso-dev-toolbar-drawer">
        <div class="ws-drawer-tabs">
          <button class="ws-tab-btn active" data-tab="queries">🗄️ SQL Queries (${queries.length})</button>
          <button class="ws-tab-btn" data-tab="page">📄 Route & Page</button>
          <button class="ws-tab-btn" data-tab="tools">🚀 Quick Links</button>
          <button class="ws-tab-btn" data-tab="system">💻 System</button>
        </div>
        <div class="ws-drawer-body">
          <!-- Tab 1: Queries -->
          <div class="ws-panel active" data-panel="queries">
            ${queriesHtml}
          </div>

          <!-- Tab 2: Route & Page -->
          <div class="ws-panel" data-panel="page">
            <div class="ws-meta-grid">
              <div class="ws-meta-card">
                <h4>Route Path</h4>
                <div class="ws-meta-val">${safeEscapeHtml(currentPath)}</div>
              </div>
              <div class="ws-meta-card">
                <h4>Route File</h4>
                <div class="ws-meta-val">${safeEscapeHtml(routeFile || 'pages/index.njk')}</div>
              </div>
              ${templateName ? `
                <div class="ws-meta-card">
                  <h4>Template</h4>
                  <div class="ws-meta-val">${safeEscapeHtml(templateName)}</div>
                </div>
              ` : ''}
              <div class="ws-meta-card">
                <h4>Parameters</h4>
                <div class="ws-meta-val">${safeEscapeHtml(JSON.stringify(urlParams))}</div>
              </div>
              <div class="ws-meta-card">
                <h4>Query</h4>
                <div class="ws-meta-val">${safeEscapeHtml(JSON.stringify(queryParams))}</div>
              </div>
            </div>
          </div>

          <!-- Tab 3: Tools -->
          <div class="ws-panel" data-panel="tools">
            <div class="ws-tools-grid">
              ${allPlugins.map(p => `
                <a href="${p.path}" class="ws-tool-card webspresso-dev-toolbar-link" title="${safeEscapeHtml(p.description || p.name)}">
                  <span class="webspresso-dev-toolbar-link-icon" style="font-size: 18px;">${p.icon || '🔗'}</span>
                  <div>
                    <div class="webspresso-dev-toolbar-link-text" style="font-weight: 600;">${safeEscapeHtml(p.name)}</div>
                    <div style="font-size: 10px; color: #64748b;">${safeEscapeHtml(p.path)}</div>
                  </div>
                </a>
              `).join('')}
            </div>
          </div>

          <!-- Tab 4: System -->
          <div class="ws-panel" data-panel="system">
            <div class="ws-meta-grid">
              <div class="ws-meta-card">
                <h4>Node Version</h4>
                <div class="ws-meta-val">${process.version} (${process.platform} ${process.arch})</div>
              </div>
              <div class="ws-meta-card">
                <h4>Environment</h4>
                <div class="ws-meta-val">${process.env.NODE_ENV || 'development'}</div>
              </div>
              <div class="ws-meta-card">
                <h4>Memory Usage</h4>
                <div class="ws-meta-val">${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB</div>
              </div>
              <div class="ws-meta-card">
                <h4>Process Uptime</h4>
                <div class="ws-meta-val">${Math.round(process.uptime())}s</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      (function() {
        const toolbar = document.getElementById('webspresso-dev-toolbar');
        const toggle = document.getElementById('webspresso-dev-toolbar-toggle');
        const header = document.getElementById('webspresso-dev-toolbar-header');
        const arrow = document.getElementById('ws-expand-arrow');
        const tabBtns = toolbar.querySelectorAll('.ws-tab-btn');
        const panels = toolbar.querySelectorAll('.ws-panel');

        function toggleToolbar() {
          toolbar.classList.toggle('expanded');
          if (arrow) arrow.textContent = toolbar.classList.contains('expanded') ? '▼' : '▲';
        }

        function switchTab(targetTab) {
          tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
          });
          panels.forEach(p => {
            p.classList.toggle('active', p.getAttribute('data-panel') === targetTab);
          });
        }

        if (toggle) toggle.addEventListener('click', toggleToolbar);
        if (header) {
          header.addEventListener('click', function(e) {
            if (e.target.closest('[data-open-tab]')) return;
            toggleToolbar();
          });
        }

        toolbar.querySelectorAll('[data-open-tab]').forEach(elem => {
          elem.addEventListener('click', function(e) {
            e.stopPropagation();
            const tab = elem.getAttribute('data-open-tab');
            switchTab(tab);
            if (!toolbar.classList.contains('expanded')) toggleToolbar();
          });
        });

        tabBtns.forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            switchTab(btn.getAttribute('data-tab'));
          });
        });

        // Keyboard shortcut: Alt + D
        window.addEventListener('keydown', function(e) {
          if (e.altKey && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            toggleToolbar();
          }
        });
      })();
    </script>
  `;

  return toolbarHtml;
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
  },

  devReload() {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) return '';
    return '<script defer src="/__webspresso/dev-reload.js"></script>';
  },

  pageJs(name, attrs = {}) {
    return getAssetManager().pageJs(name, attrs);
  },

  pageJsUrl(name) {
    return getAssetManager().pageJsUrl(name);
  },

  pageCss(name, attrs = {}) {
    return getAssetManager().pageCss(name, attrs);
  },

  pageCssUrl(name) {
    return getAssetManager().pageCssUrl(name);
  },

  hasPageJs(name) {
    return getAssetManager().hasPageJs(name);
  },

  hasPageCss(name) {
    return getAssetManager().hasPageCss(name);
  },

  pageAssets(nameOrAttrs, attrs) {
    return getAssetManager().pageAssets(nameOrAttrs, attrs);
  }
};

module.exports = {
  createHelpers,
  utils,
  AssetManager,
  configureAssets,
  getAssetManager,
  ScriptInjector,
  getScriptInjector,
  resetScriptInjector,
  generateDevToolbar
};

