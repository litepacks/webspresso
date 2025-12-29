/**
 * Webspresso Sitemap Plugin
 * Generates XML sitemap from registered routes
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
    robotsDisallow = []
  } = options;
  
  // Storage for dynamic URLs and exclusions
  const dynamicUrls = [];
  const dynamicExclusions = [...exclude];
  
  return {
    name: 'sitemap',
    version: '1.0.0',
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
      },
      
      /**
       * Exclude a pattern from the sitemap
       * @param {string} pattern - Glob pattern to exclude
       */
      exclude(pattern) {
        dynamicExclusions.push(pattern);
      },
      
      /**
       * Get all sitemap URLs
       */
      getUrls() {
        return [...dynamicUrls];
      }
    },
    
    /**
     * Called after routes are mounted
     */
    onRoutesReady(ctx) {
      // Filter routes for sitemap
      const sitemapRoutes = ctx.routes
        .filter(r => r.type === 'ssr')
        .filter(r => !r.isDynamic) // Exclude dynamic routes
        .filter(r => {
          // Check exclusion patterns
          for (const pattern of dynamicExclusions) {
            if (matchPattern(r.pattern, pattern)) {
              return false;
            }
          }
          return true;
        });
      
      // Build URLs
      const urls = [];
      
      for (const route of sitemapRoutes) {
        const baseUrl = `${hostname.replace(/\/$/, '')}${route.pattern}`;
        
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
      
      // Add dynamic URLs
      for (const dynUrl of dynamicUrls) {
        const urlEntry = {
          loc: `${hostname.replace(/\/$/, '')}${dynUrl.path}`,
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
      
      // Register sitemap route
      ctx.addRoute('get', '/sitemap.xml', (req, res) => {
        res.type('application/xml');
        res.send(generateSitemapXml(urls, { hostname, defaultChangefreq: changefreq, defaultPriority: priority }));
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

module.exports = sitemapPlugin;

