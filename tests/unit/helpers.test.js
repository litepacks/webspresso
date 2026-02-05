/**
 * Unit Tests for src/helpers.js
 */

const { 
  createHelpers, 
  utils, 
  ScriptInjector, 
  getScriptInjector, 
  resetScriptInjector,
  generateDevToolbar 
} = require('../../src/helpers');

describe('helpers.js', () => {
  describe('utils (pure functions)', () => {
    describe('slugify', () => {
      it('should convert string to slug', () => {
        expect(utils.slugify('Hello World')).toBe('hello-world');
      });

      it('should handle special characters', () => {
        expect(utils.slugify('Hello! @World#')).toBe('hello-world');
      });

      it('should handle multiple spaces', () => {
        expect(utils.slugify('Hello   World')).toBe('hello-world');
      });

      it('should handle underscores', () => {
        expect(utils.slugify('hello_world')).toBe('hello-world');
      });

      it('should trim leading/trailing hyphens', () => {
        expect(utils.slugify('  Hello World  ')).toBe('hello-world');
      });

      it('should return empty string for null/undefined', () => {
        expect(utils.slugify(null)).toBe('');
        expect(utils.slugify(undefined)).toBe('');
      });
    });

    describe('truncate', () => {
      it('should truncate long strings', () => {
        expect(utils.truncate('Hello World', 8)).toBe('Hello...');
      });

      it('should not truncate short strings', () => {
        expect(utils.truncate('Hello', 10)).toBe('Hello');
      });

      it('should use custom suffix', () => {
        expect(utils.truncate('Hello World', 8, '…')).toBe('Hello W…');
      });

      it('should return empty string for null/undefined', () => {
        expect(utils.truncate(null, 10)).toBe('');
        expect(utils.truncate(undefined, 10)).toBe('');
      });
    });

    describe('prettyBytes', () => {
      it('should format bytes', () => {
        expect(utils.prettyBytes(0)).toBe('0 B');
        expect(utils.prettyBytes(500)).toBe('500 B');
      });

      it('should format kilobytes', () => {
        expect(utils.prettyBytes(1024)).toBe('1.0 KB');
        expect(utils.prettyBytes(1536)).toBe('1.5 KB');
      });

      it('should format megabytes', () => {
        expect(utils.prettyBytes(1048576)).toBe('1.0 MB');
      });

      it('should format gigabytes', () => {
        expect(utils.prettyBytes(1073741824)).toBe('1.0 GB');
      });
    });

    describe('prettyMs', () => {
      it('should format milliseconds', () => {
        expect(utils.prettyMs(500)).toBe('500ms');
      });

      it('should format seconds', () => {
        expect(utils.prettyMs(1500)).toBe('1.5s');
      });

      it('should format minutes', () => {
        expect(utils.prettyMs(90000)).toBe('1.5m');
      });

      it('should format hours', () => {
        expect(utils.prettyMs(5400000)).toBe('1.5h');
      });
    });

    describe('isDev / isProd', () => {
      it('should detect development mode', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        expect(utils.isDev()).toBe(true);
        expect(utils.isProd()).toBe(false);
        process.env.NODE_ENV = originalEnv;
      });

      it('should detect production mode', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        expect(utils.isDev()).toBe(false);
        expect(utils.isProd()).toBe(true);
        process.env.NODE_ENV = originalEnv;
      });
    });
  });

  describe('createHelpers (context-bound)', () => {
    let helpers;
    let mockCtx;

    beforeEach(() => {
      mockCtx = {
        req: global.testUtils.createMockRequest({
          path: '/tools/test',
          originalUrl: '/tools/test?page=1',
          query: { page: '1', sort: 'name' },
          params: { slug: 'test' },
          headers: {
            'user-agent': 'TestAgent/1.0',
            'accept-language': 'en-US,en;q=0.9'
          }
        }),
        res: global.testUtils.createMockResponse(),
        locale: 'en'
      };
      helpers = createHelpers(mockCtx);
    });

    describe('url', () => {
      it('should build URL with path', () => {
        expect(helpers.url('/about')).toBe('/about');
      });

      it('should ensure leading slash', () => {
        expect(helpers.url('about')).toBe('/about');
      });

      it('should add query parameters', () => {
        expect(helpers.url('/tools', { page: 1, sort: 'name' })).toBe('/tools?page=1&sort=name');
      });
    });

    describe('fullUrl', () => {
      it('should build full URL', () => {
        expect(helpers.fullUrl('/about')).toBe('http://localhost:3001/about');
      });

      it('should include query parameters', () => {
        expect(helpers.fullUrl('/tools', { page: 1 })).toBe('http://localhost:3001/tools?page=1');
      });
    });

    describe('route', () => {
      it('should replace :params', () => {
        expect(helpers.route('/tools/:slug', { slug: 'test' })).toBe('/tools/test');
      });

      it('should replace [params]', () => {
        expect(helpers.route('/tools/[slug]', { slug: 'test' })).toBe('/tools/test');
      });

      it('should encode special characters', () => {
        expect(helpers.route('/search/:query', { query: 'hello world' })).toBe('/search/hello%20world');
      });
    });

    describe('q (query param)', () => {
      it('should get query parameter', () => {
        expect(helpers.q('page')).toBe('1');
        expect(helpers.q('sort')).toBe('name');
      });

      it('should return default for missing param', () => {
        expect(helpers.q('missing', 'default')).toBe('default');
      });
    });

    describe('param (route param)', () => {
      it('should get route parameter', () => {
        expect(helpers.param('slug')).toBe('test');
      });

      it('should return default for missing param', () => {
        expect(helpers.param('missing', 'default')).toBe('default');
      });
    });

    describe('hdr (header)', () => {
      it('should get header value', () => {
        expect(helpers.hdr('User-Agent')).toBe('TestAgent/1.0');
      });

      it('should return default for missing header', () => {
        expect(helpers.hdr('X-Missing', 'default')).toBe('default');
      });
    });

    describe('canonical', () => {
      it('should return canonical URL without query', () => {
        expect(helpers.canonical()).toBe('http://localhost:3001/tools/test');
      });
    });

    describe('jsonld', () => {
      it('should generate JSON-LD script tag', () => {
        const schema = { '@type': 'WebPage', name: 'Test' };
        const result = helpers.jsonld(schema);
        expect(result).toContain('<script type="application/ld+json">');
        expect(result).toContain('</script>');
        expect(result).toContain('"@type":"WebPage"');
      });

      it('should escape HTML characters', () => {
        const schema = { name: '<script>alert(1)</script>' };
        const result = helpers.jsonld(schema);
        expect(result).not.toContain('<script>alert');
        expect(result).toContain('\\u003cscript\\u003e');
      });
    });

    describe('asset', () => {
      it('should return asset path with leading slash', () => {
        expect(helpers.asset('css/style.css')).toBe('/css/style.css');
        expect(helpers.asset('/js/app.js')).toBe('/js/app.js');
      });
    });

    describe('locale', () => {
      it('should return current locale', () => {
        expect(helpers.locale()).toBe('en');
      });
    });

    describe('path', () => {
      it('should return current path', () => {
        expect(helpers.path()).toBe('/tools/test');
      });
    });

    describe('isPath', () => {
      it('should match exact path', () => {
        expect(helpers.isPath('/tools/test')).toBe(true);
        expect(helpers.isPath('/about')).toBe(false);
      });

      it('should match wildcard path', () => {
        expect(helpers.isPath('/tools/*')).toBe(true);
        expect(helpers.isPath('/about/*')).toBe(false);
      });
    });

    describe('injectHead', () => {
      beforeEach(() => {
        resetScriptInjector();
      });

      it('should return injected head content', () => {
        const injector = getScriptInjector();
        injector.addHead('<script>console.log("test")</script>');
        
        const content = helpers.injectHead();
        expect(content).toContain('<script>console.log("test")</script>');
      });

      it('should include injected styles', () => {
        const injector = getScriptInjector();
        injector.addStyle('.test { color: red; }');
        
        const content = helpers.injectHead();
        expect(content).toContain('.test { color: red; }');
        expect(content).toContain('webspresso-injected-styles');
      });
    });

    describe('injectBody', () => {
      beforeEach(() => {
        resetScriptInjector();
      });

      it('should return injected body content', () => {
        const injector = getScriptInjector();
        injector.addBody('<div id="modal"></div>');
        
        const content = helpers.injectBody();
        expect(content).toContain('<div id="modal"></div>');
      });
    });

    describe('devToolbar', () => {
      const originalEnv = process.env.NODE_ENV;

      afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        resetScriptInjector();
      });

      it('should return toolbar HTML in development mode', () => {
        process.env.NODE_ENV = 'development';
        
        const toolbar = helpers.devToolbar();
        expect(toolbar).toContain('webspresso-dev-toolbar');
        expect(toolbar).toContain('Dashboard');
        expect(toolbar).toContain('Admin');
        expect(toolbar).toContain('Schema');
      });

      it('should return empty string in production mode', () => {
        process.env.NODE_ENV = 'production';
        
        const toolbar = helpers.devToolbar();
        expect(toolbar).toBe('');
      });

      it('should include registered plugins', () => {
        process.env.NODE_ENV = 'development';
        
        const injector = getScriptInjector();
        injector.registerPlugin({ 
          name: 'Custom Plugin', 
          path: '/custom', 
          icon: '🔧',
          description: 'Test plugin'
        });
        
        const toolbar = helpers.devToolbar();
        expect(toolbar).toContain('Custom Plugin');
        expect(toolbar).toContain('/custom');
        expect(toolbar).toContain('🔧');
      });
    });
  });

  describe('ScriptInjector', () => {
    let injector;

    beforeEach(() => {
      injector = new ScriptInjector();
    });

    describe('addHead', () => {
      it('should add content to head scripts', () => {
        injector.addHead('<meta name="test" content="value">');
        
        const content = injector.getHeadContent();
        expect(content).toContain('<meta name="test" content="value">');
      });

      it('should sort by priority (higher first)', () => {
        injector.addHead('low', { priority: 1 });
        injector.addHead('high', { priority: 10 });
        injector.addHead('medium', { priority: 5 });
        
        const content = injector.getHeadContent();
        expect(content.indexOf('high')).toBeLessThan(content.indexOf('medium'));
        expect(content.indexOf('medium')).toBeLessThan(content.indexOf('low'));
      });
    });

    describe('addBody', () => {
      it('should add content to body scripts', () => {
        injector.addBody('<script src="/app.js"></script>');
        
        const content = injector.getBodyContent();
        expect(content).toContain('<script src="/app.js"></script>');
      });
    });

    describe('addStyle', () => {
      it('should add CSS styles', () => {
        injector.addStyle('body { margin: 0; }');
        
        const content = injector.getStylesContent();
        expect(content).toContain('body { margin: 0; }');
      });
    });

    describe('registerPlugin', () => {
      it('should register plugin for dev toolbar', () => {
        injector.registerPlugin({ name: 'Test', path: '/test' });
        
        const plugins = injector.getPlugins();
        expect(plugins).toHaveLength(1);
        expect(plugins[0].name).toBe('Test');
      });
    });

    describe('clear', () => {
      it('should clear all injections', () => {
        injector.addHead('head');
        injector.addBody('body');
        injector.addStyle('style');
        
        injector.clear();
        
        expect(injector.getHeadContent()).toBe('');
        expect(injector.getBodyContent()).toBe('');
        expect(injector.getStylesContent()).toBe('');
      });
    });
  });

  describe('generateDevToolbar', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should generate toolbar with default plugins', () => {
      process.env.NODE_ENV = 'development';
      
      const toolbar = generateDevToolbar();
      expect(toolbar).toContain('Dashboard');
      expect(toolbar).toContain('/_webspresso');
      expect(toolbar).toContain('Admin');
      expect(toolbar).toContain('/_admin');
      expect(toolbar).toContain('Schema');
      expect(toolbar).toContain('/_schema');
    });

    it('should include custom links', () => {
      process.env.NODE_ENV = 'development';
      
      const toolbar = generateDevToolbar({
        customLinks: [
          { name: 'Docs', path: '/docs', icon: '📚' }
        ]
      });
      
      expect(toolbar).toContain('Docs');
      expect(toolbar).toContain('/docs');
      expect(toolbar).toContain('📚');
    });

    it('should return empty in production', () => {
      process.env.NODE_ENV = 'production';
      
      const toolbar = generateDevToolbar();
      expect(toolbar).toBe('');
    });
  });
});

