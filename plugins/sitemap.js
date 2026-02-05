/**
 * Webspresso Sitemap Plugin
 * Generates XML sitemap from registered routes with dynamic database support
 */

const { matchPattern } = require('../src/plugin-manager');

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date to ISO string for sitemap
 */
function formatLastmod(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0]; // YYYY-MM-DD format
}

/**
 * Replace URL pattern placeholders with values
 * @param {string} pattern - URL pattern (e.g., '/blog/:slug' or '/posts/[id]')
 * @param {Object} record - Record with values
 * @param {Object} fieldMapping - Mapping of param names to field names
 */
function buildUrlFromPattern(pattern, record, fieldMapping = {}) {
  let url = pattern;
  
  // Handle :param style
  url = url.replace(/:(\w+)/g, (match, param) => {
    const field = fieldMapping[param] || param;
    return record[field] !== undefined ? encodeURIComponent(record[field]) : match;
  });
  
  // Handle [param] style
  url = url.replace(/\[(\w+)\]/g, (match, param) => {
    const field = fieldMapping[param] || param;
    return record[field] !== undefined ? encodeURIComponent(record[field]) : match;
  });
  
  return url;
}

/**
 * Generate sitemap XML content
 */
function generateSitemapXml(urls, options = {}) {
  const { hostname, defaultChangefreq = 'weekly', defaultPriority = 0.8 } = options;
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  
  // Add i18n namespace if needed
  if (urls.some(u => u.alternates && u.alternates.length > 0)) {
    xml += ' xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  }
  xml += '>\n';
  
  for (const url of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(url.loc)}</loc>\n`;
    
    if (url.lastmod) {
      xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    }
    
    xml += `    <changefreq>${url.changefreq || defaultChangefreq}</changefreq>\n`;
    xml += `    <priority>${url.priority || defaultPriority}</priority>\n`;
    
    // Add hreflang alternates for i18n
    if (url.alternates && url.alternates.length > 0) {
      for (const alt of url.alternates) {
        xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.lang)}" href="${escapeXml(alt.href)}"/>\n`;
      }
    }
    
    xml += '  </url>\n';
  }
  
  xml += '</urlset>';
  return xml;
}

/**
 * Generate robots.txt content
 */
function generateRobotsTxt(hostname, options = {}) {
  const { sitemapPath = '/sitemap.xml', disallow = [] } = options;
  
  let txt = 'User-agent: *\n';
  
  for (const path of disallow) {
    txt += `Disallow: ${path}\n`;
  }
  
  txt += '\n';
  txt += `Sitemap: ${hostname}${sitemapPath}\n`;
  
  return txt;
}

/**
 * @typedef {Object} DynamicSource
 * @property {string} [model] - Model name to query from database
 * @property {Function} [query] - Custom query function: (db) => Promise<Array>
 * @property {string} urlPattern - URL pattern with placeholders (e.g., '/blog/:slug' or '/posts/[id]')
 * @property {Object} [fields] - Field mapping { urlParam: recordField }
 * @property {string} [lastmodField] - Field name for lastmod date
 * @property {string} [changefreq] - Change frequency for these URLs
 * @property {number} [priority] - Priority for these URLs (0.0 - 1.0)
 * @property {boolean} [i18n] - Enable i18n for these URLs (default: true)
 * @property {Function} [filter] - Filter function: (record) => boolean
 * @property {Function} [transform] - Transform function: (record) => record
 */

/**
 * Create the sitemap plugin
 * @param {Object} options - Plugin options
 * @param {string} options.hostname - Base URL (e.g., 'https://example.com')
 * @param {Array<string>} options.exclude - Patterns to exclude (e.g., ['/admin/*', '/api/*'])
 * @param {string} options.changefreq - Default change frequency
 * @param {number} options.priority - Default priority (0.0 - 1.0)
 * @param {boolean} options.i18n - Enable i18n hreflang support
 * @param {Array<string>} options.locales - Supported locales (defaults to env SUPPORTED_LOCALES)
 * @param {boolean} options.robots - Generate robots.txt endpoint
 * @param {Array<string>} options.robotsDisallow - Paths to disallow in robots.txt
 * @param {Array<DynamicSource>} options.dynamicSources - Dynamic URL sources from database
 * @param {Object} options.db - Database instance for dynamic queries
 */
function sitemapPlugin(options = {}) {
  const {
    hostname = process.env.BASE_URL || 'http://localhost:3000',
    exclude = ['/api/*'],
    changefreq = 'weekly',
    priority = 0.8,
    i18n = false,
    locales = (process.env.SUPPORTED_LOCALES || 'en').split(','),
    robots = true,
    robotsDisallow = [],
    dynamicSources = [],
    db = null
  } = options;
  
  // Storage for dynamic URLs and exclusions
  const dynamicUrls = [];
  const dynamicExclusions = [...exclude];
  const registeredSources = [...dynamicSources];
  
  // Cached URLs (for dynamic sources)
  let cachedUrls = null;
  let cacheTime = null;
  const cacheMaxAge = options.cacheMaxAge || 5 * 60 * 1000; // 5 minutes default
  
  /**
   * Fetch URLs from dynamic sources
   */
  async function fetchDynamicSourceUrls(dbInstance) {
    const urls = [];
    
    for (const source of registeredSources) {
      try {
        let records = [];
        
        // Get records from model or custom query
        if (source.query && typeof source.query === 'function') {
          records = await source.query(dbInstance);
        } else if (source.model && dbInstance) {
          const repo = dbInstance.getRepository(source.model);
          if (repo) {
            records = await repo.findAll();
          }
        }
        
        // Apply filter if provided
        if (source.filter && typeof source.filter === 'function') {
          records = records.filter(source.filter);
        }
        
        // Transform records to URLs
        for (let record of records) {
          // Apply transform if provided
          if (source.transform && typeof source.transform === 'function') {
            record = source.transform(record);
          }
          
          const path = buildUrlFromPattern(
            source.urlPattern,
            record,
            source.fields || {}
          );
          
          // Get lastmod from record if field specified
          let lastmod = null;
          if (source.lastmodField && record[source.lastmodField]) {
            lastmod = formatLastmod(record[source.lastmodField]);
          }
          
          urls.push({
            path,
            changefreq: source.changefreq || changefreq,
            priority: source.priority || priority,
            lastmod,
            i18n: source.i18n !== false,
            _source: source.model || 'custom'
          });
        }
      } catch (err) {
        console.error(`Sitemap: Error fetching from source ${source.model || 'custom'}:`, err.message);
      }
    }
    
    return urls;
  }
  
  /**
   * Build all sitemap URLs
   */
  async function buildAllUrls(routes, dbInstance) {
    const urls = [];
    const hostnameNormalized = hostname.replace(/\/$/, '');
    
    // Filter static routes for sitemap
    const sitemapRoutes = routes
      .filter(r => r.type === 'ssr')
      .filter(r => !r.isDynamic) // Exclude dynamic routes (they come from dynamicSources)
      .filter(r => {
        // Check exclusion patterns
        for (const pattern of dynamicExclusions) {
          if (matchPattern(r.pattern, pattern)) {
            return false;
          }
        }
        return true;
      });
    
    // Add static route URLs
    for (const route of sitemapRoutes) {
      const baseUrl = `${hostnameNormalized}${route.pattern}`;
      
      const urlEntry = {
        loc: baseUrl,
        changefreq,
        priority
      };
      
      // Add i18n alternates
      if (i18n && locales.length > 1) {
        urlEntry.alternates = locales.map(lang => ({
          lang,
          href: `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}lang=${lang}`
        }));
      }
      
      urls.push(urlEntry);
    }
    
    // Add manually added dynamic URLs
    for (const dynUrl of dynamicUrls) {
      const urlEntry = {
        loc: `${hostnameNormalized}${dynUrl.path}`,
        changefreq: dynUrl.changefreq || changefreq,
        priority: dynUrl.priority || priority,
        lastmod: dynUrl.lastmod
      };
      
      if (i18n && locales.length > 1 && dynUrl.i18n !== false) {
        urlEntry.alternates = locales.map(lang => ({
          lang,
          href: `${urlEntry.loc}${urlEntry.loc.includes('?') ? '&' : '?'}lang=${lang}`
        }));
      }
      
      urls.push(urlEntry);
    }
    
    // Fetch URLs from dynamic sources (database or custom queries)
    if (registeredSources.length > 0) {
      const sourceUrls = await fetchDynamicSourceUrls(dbInstance);
      
      for (const dynUrl of sourceUrls) {
        const urlEntry = {
          loc: `${hostnameNormalized}${dynUrl.path}`,
          changefreq: dynUrl.changefreq,
          priority: dynUrl.priority,
          lastmod: dynUrl.lastmod
        };
        
        if (i18n && locales.length > 1 && dynUrl.i18n !== false) {
          urlEntry.alternates = locales.map(lang => ({
            lang,
            href: `${urlEntry.loc}${urlEntry.loc.includes('?') ? '&' : '?'}lang=${lang}`
          }));
        }
        
        urls.push(urlEntry);
      }
    }
    
    return urls;
  }
  
  return {
    name: 'sitemap',
    version: '2.0.0',
    _options: options,
    
    /**
     * Public API for other plugins
     */
    api: {
      /**
       * Add a URL to the sitemap
       * @param {string} path - URL path
       * @param {Object} opts - URL options (changefreq, priority, lastmod)
       */
      addUrl(path, opts = {}) {
        dynamicUrls.push({ path, ...opts });
        cachedUrls = null; // Invalidate cache
      },
      
      /**
       * Exclude a pattern from the sitemap
       * @param {string} pattern - Glob pattern to exclude
       */
      exclude(pattern) {
        dynamicExclusions.push(pattern);
        cachedUrls = null; // Invalidate cache
      },
      
      /**
       * Add a dynamic source for URLs from database
       * @param {DynamicSource} source - Dynamic source configuration
       */
      addDynamicSource(source) {
        if (!source.urlPattern) {
          throw new Error('urlPattern is required for dynamic source');
        }
        registeredSources.push(source);
        cachedUrls = null; // Invalidate cache
      },
      
      /**
       * Get all manually added URLs
       */
      getUrls() {
        return [...dynamicUrls];
      },
      
      /**
       * Get all registered dynamic sources
       */
      getDynamicSources() {
        return [...registeredSources];
      },
      
      /**
       * Invalidate URL cache (useful after database changes)
       */
      invalidateCache() {
        cachedUrls = null;
        cacheTime = null;
      }
    },
    
    /**
     * Called after routes are mounted
     */
    onRoutesReady(ctx) {
      const dbInstance = db || ctx.options?.db;
      
      // Register sitemap route (async handler for dynamic sources)
      ctx.addRoute('get', '/sitemap.xml', async (req, res) => {
        try {
          // Check cache
          const now = Date.now();
          if (cachedUrls && cacheTime && (now - cacheTime) < cacheMaxAge) {
            res.type('application/xml');
            return res.send(generateSitemapXml(cachedUrls, { 
              hostname, 
              defaultChangefreq: changefreq, 
              defaultPriority: priority 
            }));
          }
          
          // Build URLs
          const urls = await buildAllUrls(ctx.routes, dbInstance);
          
          // Cache results
          cachedUrls = urls;
          cacheTime = now;
          
          res.type('application/xml');
          res.send(generateSitemapXml(urls, { 
            hostname, 
            defaultChangefreq: changefreq, 
            defaultPriority: priority 
          }));
        } catch (err) {
          console.error('Sitemap generation error:', err);
          res.status(500).send('Error generating sitemap');
        }
      });
      
      // Register robots.txt route
      if (robots) {
        ctx.addRoute('get', '/robots.txt', (req, res) => {
          res.type('text/plain');
          res.send(generateRobotsTxt(hostname, { disallow: robotsDisallow }));
        });
      }
    }
  };
}

// Export helpers for testing
sitemapPlugin.escapeXml = escapeXml;
sitemapPlugin.formatLastmod = formatLastmod;
sitemapPlugin.buildUrlFromPattern = buildUrlFromPattern;
sitemapPlugin.generateSitemapXml = generateSitemapXml;
sitemapPlugin.generateRobotsTxt = generateRobotsTxt;

module.exports = sitemapPlugin;



