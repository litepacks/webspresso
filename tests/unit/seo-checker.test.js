/**
 * SEO Checker Plugin Tests
 */

const seoCheckerPlugin = require('../../plugins/seo-checker');
const { defaultSettings, checkDefinitions, categories } = require('../../plugins/seo-checker/checks');
const { generatePanelStyles, generatePanelHtml } = require('../../plugins/seo-checker/panel');
const analyzerScript = require('../../plugins/seo-checker/analyzer');

describe('SEO Checker Plugin', () => {
  describe('Plugin Factory', () => {
    it('should create plugin with default options', () => {
      const plugin = seoCheckerPlugin();
      
      expect(plugin.name).toBe('seo-checker');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('Client-side SEO analysis tool for development');
    });

    it('should have required lifecycle hooks', () => {
      const plugin = seoCheckerPlugin();
      
      expect(typeof plugin.onInit).toBe('function');
      expect(typeof plugin.onBeforeRender).toBe('function');
    });

    it('should expose API methods', () => {
      const plugin = seoCheckerPlugin();
      
      expect(typeof plugin.api.getSettings).toBe('function');
      expect(typeof plugin.api.getChecks).toBe('function');
      expect(typeof plugin.api.isEnabled).toBe('function');
    });

    it('should merge custom settings with defaults', () => {
      const plugin = seoCheckerPlugin({
        settings: {
          titleLength: [20, 70],
          minContentWords: 500
        }
      });
      
      const settings = plugin.api.getSettings();
      expect(settings.titleLength).toEqual([20, 70]);
      expect(settings.minContentWords).toBe(500);
      // Should keep other defaults
      expect(settings.descriptionLength).toEqual([50, 160]);
    });

    it('should respect enabled option', () => {
      const pluginEnabled = seoCheckerPlugin({ enabled: true });
      const pluginDisabled = seoCheckerPlugin({ enabled: false });
      
      expect(pluginEnabled.api.isEnabled()).toBe(true);
      expect(pluginDisabled.api.isEnabled()).toBe(false);
    });

    it('should be disabled in production by default', () => {
      const originalEnv = process.env.NODE_ENV;
      
      process.env.NODE_ENV = 'production';
      const plugin = seoCheckerPlugin();
      expect(plugin.api.isEnabled()).toBe(false);
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should be enabled in development by default', () => {
      const originalEnv = process.env.NODE_ENV;
      
      process.env.NODE_ENV = 'development';
      const plugin = seoCheckerPlugin();
      expect(plugin.api.isEnabled()).toBe(true);
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('onInit Hook', () => {
    it('should register dev link when enabled', () => {
      const plugin = seoCheckerPlugin({ enabled: true });
      const ctx = {
        registerDevLink: vi.fn()
      };
      
      plugin.onInit(ctx);
      
      expect(ctx.registerDevLink).toHaveBeenCalledWith({
        name: 'SEO Check',
        path: '#seo-checker',
        icon: '🔍',
        description: 'Analyze page SEO'
      });
    });

    it('should not register dev link when disabled', () => {
      const plugin = seoCheckerPlugin({ enabled: false });
      const ctx = {
        registerDevLink: vi.fn()
      };
      
      plugin.onInit(ctx);
      
      expect(ctx.registerDevLink).not.toHaveBeenCalled();
    });
  });

  describe('onBeforeRender Hook', () => {
    it('should inject styles and scripts when enabled', () => {
      const plugin = seoCheckerPlugin({ enabled: true });
      const ctx = {
        injectHead: vi.fn(),
        injectBody: vi.fn()
      };
      
      plugin.onBeforeRender(ctx);
      
      expect(ctx.injectHead).toHaveBeenCalled();
      expect(ctx.injectBody).toHaveBeenCalled();
    });

    it('should not inject when disabled', () => {
      const plugin = seoCheckerPlugin({ enabled: false });
      const ctx = {
        injectHead: vi.fn(),
        injectBody: vi.fn()
      };
      
      plugin.onBeforeRender(ctx);
      
      expect(ctx.injectHead).not.toHaveBeenCalled();
      expect(ctx.injectBody).not.toHaveBeenCalled();
    });

    it('should inject settings and checks as JSON', () => {
      const plugin = seoCheckerPlugin({ enabled: true });
      let injectedBody = '';
      const ctx = {
        injectHead: vi.fn(),
        injectBody: vi.fn((content) => { injectedBody = content; })
      };
      
      plugin.onBeforeRender(ctx);
      
      expect(injectedBody).toContain('window.__SEO_CHECKER_SETTINGS__');
      expect(injectedBody).toContain('window.__SEO_CHECKER_CHECKS__');
    });
  });

  describe('Check Definitions', () => {
    it('should export default settings', () => {
      expect(defaultSettings).toBeDefined();
      expect(defaultSettings.titleLength).toEqual([30, 60]);
      expect(defaultSettings.descriptionLength).toEqual([50, 160]);
      expect(defaultSettings.minContentWords).toBe(300);
    });

    it('should export check definitions', () => {
      expect(Array.isArray(checkDefinitions)).toBe(true);
      expect(checkDefinitions.length).toBeGreaterThan(30);
    });

    it('should have required properties for each check', () => {
      checkDefinitions.forEach(check => {
        expect(check.id).toBeDefined();
        expect(check.category).toBeDefined();
        expect(check.name).toBeDefined();
        expect(check.description).toBeDefined();
        expect(check.weight).toBeDefined();
        expect(check.check).toBeDefined();
      });
    });

    it('should cover all categories', () => {
      const usedCategories = [...new Set(checkDefinitions.map(c => c.category))];
      const expectedCategories = ['meta', 'headings', 'content', 'links', 'images', 'structured', 'url'];
      
      expectedCategories.forEach(cat => {
        expect(usedCategories).toContain(cat);
      });
    });

    it('should have unique check IDs', () => {
      const ids = checkDefinitions.map(c => c.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('should export categories', () => {
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBe(7);
      
      categories.forEach(cat => {
        expect(cat.id).toBeDefined();
        expect(cat.name).toBeDefined();
        expect(cat.icon).toBeDefined();
      });
    });
  });

  describe('Panel Generation', () => {
    it('should generate panel styles', () => {
      const styles = generatePanelStyles();
      
      expect(styles).toContain('<style');
      expect(styles).toContain('#seo-checker-panel');
      expect(styles).toContain('.seo-score-circle');
      expect(styles).toContain('.seo-check-item');
    });

    it('should generate panel HTML', () => {
      const html = generatePanelHtml(checkDefinitions);
      
      expect(html).toContain('id="seo-checker-panel"');
      expect(html).toContain('id="seo-checker-toggle"');
      expect(html).toContain('seo-score-value');
      expect(html).toContain('seo-tabs');
    });

    it('should include all category tabs', () => {
      const html = generatePanelHtml(checkDefinitions);
      
      categories.forEach(cat => {
        expect(html).toContain(`data-category="${cat.id}"`);
        expect(html).toContain(cat.icon);
      });
    });

    it('should have refresh and close buttons', () => {
      const html = generatePanelHtml(checkDefinitions);
      
      expect(html).toContain('seo-refresh-btn');
      expect(html).toContain('seo-panel-close');
    });
  });

  describe('Analyzer Script', () => {
    it('should be a non-empty string', () => {
      expect(typeof analyzerScript).toBe('string');
      expect(analyzerScript.length).toBeGreaterThan(1000);
    });

    it('should be wrapped in IIFE', () => {
      expect(analyzerScript).toContain('(function()');
      expect(analyzerScript).toContain('})();');
    });

    it('should reference settings and checks', () => {
      expect(analyzerScript).toContain('window.__SEO_CHECKER_SETTINGS__');
      expect(analyzerScript).toContain('window.__SEO_CHECKER_CHECKS__');
    });

    it('should define all check functions', () => {
      // Meta checks
      expect(analyzerScript).toContain('titleExists()');
      expect(analyzerScript).toContain('titleLength()');
      expect(analyzerScript).toContain('descriptionExists()');
      expect(analyzerScript).toContain('canonicalExists()');
      
      // Heading checks
      expect(analyzerScript).toContain('h1Exists()');
      expect(analyzerScript).toContain('headingHierarchy()');
      
      // Content checks
      expect(analyzerScript).toContain('wordCount()');
      expect(analyzerScript).toContain('keywordInContent()');
      
      // Link checks
      expect(analyzerScript).toContain('internalLinks()');
      expect(analyzerScript).toContain('externalLinks()');
      
      // Image checks
      expect(analyzerScript).toContain('imageAlt()');
      expect(analyzerScript).toContain('imageDimensions()');
      
      // Structured data checks
      expect(analyzerScript).toContain('ogTitle()');
      expect(analyzerScript).toContain('jsonLd()');
      
      // URL checks
      expect(analyzerScript).toContain('urlLength()');
      expect(analyzerScript).toContain('urlHttps()');
    });

    it('should have runAllChecks function', () => {
      expect(analyzerScript).toContain('function runAllChecks()');
    });

    it('should have updateUI function', () => {
      expect(analyzerScript).toContain('function updateUI(data)');
    });

    it('should have init function', () => {
      expect(analyzerScript).toContain('function init()');
    });

    it('should handle DOMContentLoaded', () => {
      expect(analyzerScript).toContain('DOMContentLoaded');
    });
  });

  describe('Integration with Plugin System', () => {
    it('should be exported from plugins index', () => {
      const plugins = require('../../plugins');
      expect(plugins.seoCheckerPlugin).toBeDefined();
      expect(typeof plugins.seoCheckerPlugin).toBe('function');
    });
  });
});

describe('SEO Check Coverage', () => {
  // Test that each category has appropriate checks
  
  describe('Meta Category', () => {
    const metaChecks = checkDefinitions.filter(c => c.category === 'meta');
    
    it('should have title checks', () => {
      const titles = metaChecks.filter(c => c.id.includes('title'));
      expect(titles.length).toBeGreaterThanOrEqual(2);
    });

    it('should have description checks', () => {
      const descs = metaChecks.filter(c => c.id.includes('description'));
      expect(descs.length).toBeGreaterThanOrEqual(2);
    });

    it('should have canonical check', () => {
      expect(metaChecks.some(c => c.id === 'meta-canonical')).toBe(true);
    });

    it('should have viewport check', () => {
      expect(metaChecks.some(c => c.id === 'meta-viewport')).toBe(true);
    });
  });

  describe('Headings Category', () => {
    const headingChecks = checkDefinitions.filter(c => c.category === 'headings');
    
    it('should have H1 existence check', () => {
      expect(headingChecks.some(c => c.id === 'heading-h1-exists')).toBe(true);
    });

    it('should have hierarchy check', () => {
      expect(headingChecks.some(c => c.id === 'heading-hierarchy')).toBe(true);
    });
  });

  describe('Content Category', () => {
    const contentChecks = checkDefinitions.filter(c => c.category === 'content');
    
    it('should have word count check', () => {
      expect(contentChecks.some(c => c.id === 'content-word-count')).toBe(true);
    });

    it('should have keyword checks', () => {
      const keywords = contentChecks.filter(c => c.id.includes('keyword'));
      expect(keywords.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Links Category', () => {
    const linkChecks = checkDefinitions.filter(c => c.category === 'links');
    
    it('should have internal links check', () => {
      expect(linkChecks.some(c => c.id === 'links-internal')).toBe(true);
    });

    it('should have external links check', () => {
      expect(linkChecks.some(c => c.id === 'links-external')).toBe(true);
    });
  });

  describe('Images Category', () => {
    const imageChecks = checkDefinitions.filter(c => c.category === 'images');
    
    it('should have alt text check', () => {
      expect(imageChecks.some(c => c.id === 'images-alt')).toBe(true);
    });

    it('should have dimensions check', () => {
      expect(imageChecks.some(c => c.id === 'images-dimensions')).toBe(true);
    });
  });

  describe('Structured Category', () => {
    const structuredChecks = checkDefinitions.filter(c => c.category === 'structured');
    
    it('should have Open Graph checks', () => {
      const og = structuredChecks.filter(c => c.id.includes('og-'));
      expect(og.length).toBeGreaterThanOrEqual(3);
    });

    it('should have JSON-LD check', () => {
      expect(structuredChecks.some(c => c.id === 'structured-json-ld')).toBe(true);
    });

    it('should have Twitter Card check', () => {
      expect(structuredChecks.some(c => c.id === 'structured-twitter-card')).toBe(true);
    });
  });

  describe('URL Category', () => {
    const urlChecks = checkDefinitions.filter(c => c.category === 'url');
    
    it('should have URL length check', () => {
      expect(urlChecks.some(c => c.id === 'url-length')).toBe(true);
    });

    it('should have HTTPS check', () => {
      expect(urlChecks.some(c => c.id === 'url-https')).toBe(true);
    });
  });
});
