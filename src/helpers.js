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

/**
 * Asset Manager - handles asset paths, versioning, and manifest
 */
class AssetManager {
  constructor(options = {}) {
    this.publicDir = options.publicDir || 'public';
    this.manifestPath = options.manifestPath || null;
    this.manifest = null;
    this.version = options.version || null;
    this.prefix = options.prefix || '';
    
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
      // Vite manifest format
      if (this.manifest[lookupPath]) {
        const entry = this.manifest[lookupPath];
        const resolved = typeof entry === 'string' ? entry : entry.file;
        return this.prefix + '/' + resolved;
      }
      
      // Webpack manifest format (direct mapping)
      if (this.manifest[assetPath]) {
        return this.prefix + this.manifest[assetPath];
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
   * Build HTML attributes string
   */
  buildAttributes(attrs) {
    return Object.entries(attrs)
      .filter(([_, v]) => v !== undefined && v !== null && v !== false)
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
     * Get injected head content
     * @returns {string} HTML content for head section
     */
    injectHead() {
      const injector = getScriptInjector();
      let content = '';
      
      // Add styles
      const styles = injector.getStylesContent();
      if (styles) {
        content += `<style id="webspresso-injected-styles">\n${styles}\n</style>\n`;
      }
      
      // Add head scripts
      content += injector.getHeadContent();
      
      return content;
    },

    /**
     * Get injected body content (for end of body)
     * @returns {string} HTML content for body end
     */
    injectBody() {
      return getScriptInjector().getBodyContent();
    },

    /**
     * Get dev toolbar HTML (only in development mode)
     * @param {Object} options - { plugins: Array, customLinks: Array }
     * @returns {string} Dev toolbar HTML
     */
    devToolbar(options = {}) {
      const injector = getScriptInjector();
      const registeredPlugins = injector.getPlugins();
      return generateDevToolbar({
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
   */
  getHeadContent() {
    const sorted = [...this.headScripts].sort((a, b) => b.priority - a.priority);
    return sorted.map(s => s.content).join('\n');
  }

  /**
   * Get body content sorted by priority
   */
  getBodyContent() {
    const sorted = [...this.bodyScripts].sort((a, b) => b.priority - a.priority);
    return sorted.map(s => s.content).join('\n');
  }

  /**
   * Get styles content
   */
  getStylesContent() {
    return this.styles.map(s => s.content).join('\n');
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
 * Generate dev toolbar HTML
 * @param {Object} options - { plugins: Array, routes: Array }
 */
function generateDevToolbar(options = {}) {
  const { plugins = [], customLinks = [] } = options;
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (!isDev) return '';

  // Default plugin links
  const defaultPlugins = [
    { name: 'Dashboard', path: '/_webspresso', icon: '📊', description: 'Development Dashboard' },
    { name: 'Admin', path: '/_admin', icon: '⚙️', description: 'Admin Panel' },
    { name: 'Schema', path: '/_schema', icon: '🗂️', description: 'Schema Explorer' },
  ];

  const allPlugins = [...defaultPlugins, ...plugins, ...customLinks];

  const toolbarStyles = `
    <style id="webspresso-dev-toolbar-styles">
      #webspresso-dev-toolbar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-top: 1px solid #0f3460;
        padding: 0;
        z-index: 99999;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
        font-size: 12px;
        transform: translateY(calc(100% - 32px));
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #webspresso-dev-toolbar:hover,
      #webspresso-dev-toolbar.expanded {
        transform: translateY(0);
      }
      #webspresso-dev-toolbar-toggle {
        position: absolute;
        top: -24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f3460;
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        padding: 4px 16px;
        cursor: pointer;
        color: #e94560;
        font-weight: 600;
        font-size: 10px;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      #webspresso-dev-toolbar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid #0f3460;
        background: rgba(0,0,0,0.2);
      }
      #webspresso-dev-toolbar-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #e94560;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.5px;
      }
      #webspresso-dev-toolbar-brand svg {
        width: 16px;
        height: 16px;
      }
      #webspresso-dev-toolbar-info {
        color: #a1a1aa;
        font-size: 10px;
      }
      #webspresso-dev-toolbar-content {
        display: flex;
        align-items: stretch;
        gap: 0;
        padding: 0;
        overflow-x: auto;
      }
      .webspresso-dev-toolbar-section {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 16px;
        border-right: 1px solid #0f3460;
      }
      .webspresso-dev-toolbar-section:last-child {
        border-right: none;
      }
      .webspresso-dev-toolbar-section-title {
        color: #a1a1aa;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-right: 8px;
      }
      .webspresso-dev-toolbar-link {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(233, 69, 96, 0.1);
        border: 1px solid rgba(233, 69, 96, 0.2);
        border-radius: 6px;
        color: #f1f1f1;
        text-decoration: none;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      .webspresso-dev-toolbar-link:hover {
        background: rgba(233, 69, 96, 0.2);
        border-color: #e94560;
        color: #fff;
        transform: translateY(-1px);
      }
      .webspresso-dev-toolbar-link-icon {
        font-size: 14px;
      }
      .webspresso-dev-toolbar-link-text {
        font-weight: 500;
      }
      .webspresso-dev-toolbar-close {
        background: none;
        border: none;
        color: #a1a1aa;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 16px;
        transition: color 0.2s;
      }
      .webspresso-dev-toolbar-close:hover {
        color: #e94560;
      }
      @media (max-width: 768px) {
        #webspresso-dev-toolbar {
          font-size: 11px;
        }
        .webspresso-dev-toolbar-link {
          padding: 4px 8px;
        }
      }
    </style>
  `;

  const pluginLinks = allPlugins.map(p => `
    <a href="${p.path}" class="webspresso-dev-toolbar-link" title="${p.description || p.name}">
      <span class="webspresso-dev-toolbar-link-icon">${p.icon || '🔗'}</span>
      <span class="webspresso-dev-toolbar-link-text">${p.name}</span>
    </a>
  `).join('');

  const toolbarHtml = `
    ${toolbarStyles}
    <div id="webspresso-dev-toolbar">
      <div id="webspresso-dev-toolbar-toggle">⚡ DEV</div>
      <div id="webspresso-dev-toolbar-header">
        <div id="webspresso-dev-toolbar-brand">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          WEBSPRESSO DEV
        </div>
        <div id="webspresso-dev-toolbar-info">
          Node ${process.version} | ${new Date().toLocaleTimeString()}
        </div>
      </div>
      <div id="webspresso-dev-toolbar-content">
        <div class="webspresso-dev-toolbar-section">
          <span class="webspresso-dev-toolbar-section-title">Quick Links</span>
          ${pluginLinks}
        </div>
      </div>
    </div>
    <script>
      (function() {
        const toolbar = document.getElementById('webspresso-dev-toolbar');
        const toggle = document.getElementById('webspresso-dev-toolbar-toggle');
        if (toolbar && toggle) {
          toggle.addEventListener('click', function() {
            toolbar.classList.toggle('expanded');
          });
        }
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

