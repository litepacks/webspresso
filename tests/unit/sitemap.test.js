/**
 * Sitemap Plugin Unit Tests
 */

const sitemapPlugin = require('../../plugins/sitemap');

// Extract helper functions for testing
const { escapeXml, formatLastmod, buildUrlFromPattern, generateSitemapXml, generateRobotsTxt } = sitemapPlugin;

describe('Sitemap Plugin', () => {
  describe('Helper Functions', () => {
    describe('escapeXml', () => {
      it('should escape XML special characters', () => {
        expect(escapeXml('Hello & World')).toBe('Hello &amp; World');
        expect(escapeXml('<script>')).toBe('&lt;script&gt;');
        expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
        expect(escapeXml("'single'")).toBe('&apos;single&apos;');
      });

      it('should handle null and empty strings', () => {
        expect(escapeXml(null)).toBe('');
        expect(escapeXml('')).toBe('');
        expect(escapeXml(undefined)).toBe('');
      });
    });

    describe('formatLastmod', () => {
      it('should format Date objects to YYYY-MM-DD', () => {
        const date = new Date('2024-03-15T10:30:00Z');
        expect(formatLastmod(date)).toBe('2024-03-15');
      });

      it('should format date strings', () => {
        expect(formatLastmod('2024-06-20')).toBe('2024-06-20');
        expect(formatLastmod('2024-12-25T00:00:00Z')).toBe('2024-12-25');
      });

      it('should return null for invalid dates', () => {
        expect(formatLastmod(null)).toBe(null);
        expect(formatLastmod(undefined)).toBe(null);
        expect(formatLastmod('invalid')).toBe(null);
      });
    });

    describe('buildUrlFromPattern', () => {
      it('should replace :param style placeholders', () => {
        const record = { slug: 'hello-world', id: 123 };
        expect(buildUrlFromPattern('/blog/:slug', record)).toBe('/blog/hello-world');
        expect(buildUrlFromPattern('/posts/:id', record)).toBe('/posts/123');
      });

      it('should replace [param] style placeholders', () => {
        const record = { slug: 'test-post', category: 'tech' };
        expect(buildUrlFromPattern('/blog/[slug]', record)).toBe('/blog/test-post');
        expect(buildUrlFromPattern('/[category]/[slug]', record)).toBe('/tech/test-post');
      });

      it('should use field mapping', () => {
        const record = { post_slug: 'my-post', post_id: 42 };
        const mapping = { slug: 'post_slug', id: 'post_id' };
        expect(buildUrlFromPattern('/blog/:slug', record, mapping)).toBe('/blog/my-post');
        expect(buildUrlFromPattern('/posts/:id', record, mapping)).toBe('/posts/42');
      });

      it('should encode special characters in URL', () => {
        const record = { slug: 'hello world & more' };
        expect(buildUrlFromPattern('/blog/:slug', record)).toBe('/blog/hello%20world%20%26%20more');
      });

      it('should leave unmatched placeholders', () => {
        const record = { slug: 'test' };
        expect(buildUrlFromPattern('/blog/:slug/:missing', record)).toBe('/blog/test/:missing');
      });
    });

    describe('generateSitemapXml', () => {
      it('should generate valid XML sitemap', () => {
        const urls = [
          { loc: 'https://example.com/', changefreq: 'daily', priority: 1.0 },
          { loc: 'https://example.com/about', changefreq: 'monthly', priority: 0.8 }
        ];
        
        const xml = generateSitemapXml(urls, { hostname: 'https://example.com' });
        
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(xml).toContain('<loc>https://example.com/</loc>');
        expect(xml).toContain('<changefreq>daily</changefreq>');
        expect(xml).toContain('<priority>1</priority>');
        expect(xml).toContain('</urlset>');
      });

      it('should include lastmod when provided', () => {
        const urls = [
          { loc: 'https://example.com/post', lastmod: '2024-03-15' }
        ];
        
        const xml = generateSitemapXml(urls, { hostname: 'https://example.com' });
        expect(xml).toContain('<lastmod>2024-03-15</lastmod>');
      });

      it('should include i18n alternates when present', () => {
        const urls = [
          { 
            loc: 'https://example.com/', 
            alternates: [
              { lang: 'en', href: 'https://example.com/?lang=en' },
              { lang: 'tr', href: 'https://example.com/?lang=tr' }
            ]
          }
        ];
        
        const xml = generateSitemapXml(urls, { hostname: 'https://example.com' });
        expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
        expect(xml).toContain('hreflang="en"');
        expect(xml).toContain('hreflang="tr"');
      });

      it('should use default values for changefreq and priority', () => {
        const urls = [{ loc: 'https://example.com/' }];
        
        const xml = generateSitemapXml(urls, { 
          hostname: 'https://example.com',
          defaultChangefreq: 'weekly',
          defaultPriority: 0.5
        });
        
        expect(xml).toContain('<changefreq>weekly</changefreq>');
        expect(xml).toContain('<priority>0.5</priority>');
      });
    });

    describe('generateRobotsTxt', () => {
      it('should generate valid robots.txt', () => {
        const txt = generateRobotsTxt('https://example.com', {});
        
        expect(txt).toContain('User-agent: *');
        expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
      });

      it('should include disallow rules', () => {
        const txt = generateRobotsTxt('https://example.com', {
          disallow: ['/admin/', '/api/', '/private/']
        });
        
        expect(txt).toContain('Disallow: /admin/');
        expect(txt).toContain('Disallow: /api/');
        expect(txt).toContain('Disallow: /private/');
      });
    });
  });

  describe('Plugin Creation', () => {
    it('should create plugin with default options', () => {
      const plugin = sitemapPlugin();
      
      expect(plugin.name).toBe('sitemap');
      expect(plugin.version).toBe('2.0.0');
      expect(plugin.api).toBeDefined();
      expect(typeof plugin.onRoutesReady).toBe('function');
    });

    it('should have API methods', () => {
      const plugin = sitemapPlugin();
      
      expect(typeof plugin.api.addUrl).toBe('function');
      expect(typeof plugin.api.exclude).toBe('function');
      expect(typeof plugin.api.addDynamicSource).toBe('function');
      expect(typeof plugin.api.getUrls).toBe('function');
      expect(typeof plugin.api.getDynamicSources).toBe('function');
      expect(typeof plugin.api.invalidateCache).toBe('function');
    });
  });

  describe('API Methods', () => {
    let plugin;

    beforeEach(() => {
      plugin = sitemapPlugin({ hostname: 'https://example.com' });
    });

    it('should add URL via api.addUrl', () => {
      plugin.api.addUrl('/blog/post-1', { priority: 0.9 });
      plugin.api.addUrl('/blog/post-2', { changefreq: 'daily' });
      
      const urls = plugin.api.getUrls();
      expect(urls).toHaveLength(2);
      expect(urls[0].path).toBe('/blog/post-1');
      expect(urls[0].priority).toBe(0.9);
      expect(urls[1].changefreq).toBe('daily');
    });

    it('should add dynamic source via api.addDynamicSource', () => {
      plugin.api.addDynamicSource({
        model: 'Post',
        urlPattern: '/blog/:slug',
        lastmodField: 'updated_at'
      });
      
      const sources = plugin.api.getDynamicSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].model).toBe('Post');
      expect(sources[0].urlPattern).toBe('/blog/:slug');
    });

    it('should throw error when addDynamicSource called without urlPattern', () => {
      expect(() => {
        plugin.api.addDynamicSource({ model: 'Post' });
      }).toThrow('urlPattern is required');
    });

    it('should invalidate cache', () => {
      // This is mainly for coverage - cache behavior is tested in integration
      expect(() => plugin.api.invalidateCache()).not.toThrow();
    });
  });

  describe('Dynamic Sources Configuration', () => {
    it('should accept dynamicSources in options', () => {
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        dynamicSources: [
          {
            model: 'Post',
            urlPattern: '/blog/:slug',
            priority: 0.9
          },
          {
            model: 'Product',
            urlPattern: '/products/:id',
            fields: { id: 'product_id' }
          }
        ]
      });
      
      const sources = plugin.api.getDynamicSources();
      expect(sources).toHaveLength(2);
    });
  });

  describe('Route Registration', () => {
    it('should register sitemap.xml route', () => {
      const plugin = sitemapPlugin({ hostname: 'https://example.com' });
      
      const addedRoutes = [];
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          addedRoutes.push({ method, path, handler });
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const sitemapRoute = addedRoutes.find(r => r.path === '/sitemap.xml');
      expect(sitemapRoute).toBeDefined();
      expect(sitemapRoute.method).toBe('get');
    });

    it('should register robots.txt route by default', () => {
      const plugin = sitemapPlugin({ hostname: 'https://example.com' });
      
      const addedRoutes = [];
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          addedRoutes.push({ method, path, handler });
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const robotsRoute = addedRoutes.find(r => r.path === '/robots.txt');
      expect(robotsRoute).toBeDefined();
    });

    it('should not register robots.txt when disabled', () => {
      const plugin = sitemapPlugin({ 
        hostname: 'https://example.com',
        robots: false
      });
      
      const addedRoutes = [];
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          addedRoutes.push({ method, path, handler });
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const robotsRoute = addedRoutes.find(r => r.path === '/robots.txt');
      expect(robotsRoute).toBeUndefined();
    });
  });

  describe('Dynamic Source Query', () => {
    it('should call custom query function', async () => {
      const mockRecords = [
        { slug: 'post-1', updated_at: '2024-01-15' },
        { slug: 'post-2', updated_at: '2024-02-20' }
      ];
      
      let queryCalled = false;
      const queryFn = async () => {
        queryCalled = true;
        return mockRecords;
      };
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        dynamicSources: [
          {
            query: queryFn,
            urlPattern: '/blog/:slug',
            lastmodField: 'updated_at'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      // Mock request/response
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(queryCalled).toBe(true);
      expect(responseBody).toContain('/blog/post-1');
      expect(responseBody).toContain('/blog/post-2');
      expect(responseBody).toContain('2024-01-15');
    });

    it('should use model repository when model specified', async () => {
      const mockRecords = [
        { id: 1, slug: 'product-a' },
        { id: 2, slug: 'product-b' }
      ];
      
      let findAllCalled = false;
      let getRepositoryCalled = false;
      
      const mockRepo = {
        findAll: async () => {
          findAllCalled = true;
          return mockRecords;
        }
      };
      
      const mockDb = {
        getRepository: (name) => {
          getRepositoryCalled = true;
          expect(name).toBe('Product');
          return mockRepo;
        }
      };
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        db: mockDb,
        dynamicSources: [
          {
            model: 'Product',
            urlPattern: '/products/:slug'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(getRepositoryCalled).toBe(true);
      expect(findAllCalled).toBe(true);
      expect(responseBody).toContain('/products/product-a');
      expect(responseBody).toContain('/products/product-b');
    });

    it('should apply filter function', async () => {
      const mockRecords = [
        { slug: 'published-post', published: true },
        { slug: 'draft-post', published: false }
      ];
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        dynamicSources: [
          {
            query: () => Promise.resolve(mockRecords),
            urlPattern: '/blog/:slug',
            filter: (record) => record.published === true
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(responseBody).toContain('/blog/published-post');
      expect(responseBody).not.toContain('/blog/draft-post');
    });

    it('should apply transform function', async () => {
      const mockRecords = [
        { title: 'My Post Title', id: 1 }
      ];
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        dynamicSources: [
          {
            query: () => Promise.resolve(mockRecords),
            urlPattern: '/blog/:slug',
            transform: (record) => ({
              ...record,
              slug: record.title.toLowerCase().replace(/\s+/g, '-')
            })
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(responseBody).toContain('/blog/my-post-title');
    });
  });

  describe('Caching', () => {
    it('should cache sitemap results', async () => {
      let callCount = 0;
      const queryFn = async () => {
        callCount++;
        return [{ slug: 'test' }];
      };
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        cacheMaxAge: 60000, // 1 minute
        dynamicSources: [
          {
            query: queryFn,
            urlPattern: '/blog/:slug'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      const mockRes = {
        type: function() { return this; },
        send: function() {}
      };
      
      // First call
      await sitemapHandler(mockReq, mockRes);
      expect(callCount).toBe(1);
      
      // Second call should use cache
      await sitemapHandler(mockReq, mockRes);
      expect(callCount).toBe(1); // Still 1, not 2
    });

    it('should invalidate cache when api.invalidateCache called', async () => {
      let callCount = 0;
      const queryFn = async () => {
        callCount++;
        return [{ slug: 'test' }];
      };
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        cacheMaxAge: 60000,
        dynamicSources: [
          {
            query: queryFn,
            urlPattern: '/blog/:slug'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      const mockRes = {
        type: function() { return this; },
        send: function() {}
      };
      
      // First call
      await sitemapHandler(mockReq, mockRes);
      expect(callCount).toBe(1);
      
      // Invalidate cache
      plugin.api.invalidateCache();
      
      // Third call should query again
      await sitemapHandler(mockReq, mockRes);
      expect(callCount).toBe(2);
    });
  });

  describe('i18n Support', () => {
    it('should add alternates for dynamic source URLs when i18n enabled', async () => {
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        i18n: true,
        locales: ['en', 'tr', 'de'],
        dynamicSources: [
          {
            query: () => Promise.resolve([{ slug: 'test-post' }]),
            urlPattern: '/blog/:slug'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(responseBody).toContain('hreflang="en"');
      expect(responseBody).toContain('hreflang="tr"');
      expect(responseBody).toContain('hreflang="de"');
    });

    it('should not add alternates when source has i18n: false', async () => {
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        i18n: true,
        locales: ['en', 'tr'],
        dynamicSources: [
          {
            query: () => Promise.resolve([{ slug: 'no-i18n-post' }]),
            urlPattern: '/blog/:slug',
            i18n: false
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      await sitemapHandler(mockReq, mockRes);
      
      expect(responseBody).toContain('/blog/no-i18n-post');
      // Should not have xhtml namespace since no alternates
      expect(responseBody).not.toContain('xmlns:xhtml');
    });
  });

  describe('Error Handling', () => {
    it('should handle query errors gracefully', async () => {
      const originalConsoleError = console.error;
      let errorLogged = false;
      console.error = () => { errorLogged = true; };
      
      const plugin = sitemapPlugin({
        hostname: 'https://example.com',
        dynamicSources: [
          {
            query: () => Promise.reject(new Error('Database error')),
            urlPattern: '/blog/:slug'
          }
        ]
      });
      
      let sitemapHandler;
      const mockCtx = {
        routes: [],
        options: {},
        addRoute: (method, path, handler) => {
          if (path === '/sitemap.xml') {
            sitemapHandler = handler;
          }
        }
      };
      
      plugin.onRoutesReady(mockCtx);
      
      const mockReq = {};
      let responseBody = '';
      const mockRes = {
        type: function() { return this; },
        send: function(body) { responseBody = body; }
      };
      
      // Should not throw, but log error
      await sitemapHandler(mockReq, mockRes);
      
      expect(errorLogged).toBe(true);
      expect(responseBody).toContain('</urlset>'); // Should still return valid sitemap
      
      console.error = originalConsoleError;
    });
  });
});
