/**
 * Unit Tests for src/file-router.js
 */

const path = require('path');
const {
  filePathToRoute,
  extractMethodFromFilename,
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale,
  compareRouteRegistrationOrder,
  routeRegistrationMeta,
} = require('../../src/file-router');

describe('file-router.js', () => {
  describe('filePathToRoute', () => {
    it('should convert index.njk to /', () => {
      expect(filePathToRoute('index.njk', '.njk')).toBe('/');
    });

    it('should convert about/index.njk to /about', () => {
      expect(filePathToRoute('about/index.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('about\\index.njk', '.njk')).toBe('/about');
    });

    it('should convert about.njk to /about', () => {
      expect(filePathToRoute('about.njk', '.njk')).toBe('/about');
    });

    it('should convert nested paths', () => {
      expect(filePathToRoute('tools/category/index.njk', '.njk')).toBe('/tools/category');
    });

    it('should convert [param] to :param', () => {
      expect(filePathToRoute('tools/[slug].njk', '.njk')).toBe('/tools/:slug');
      expect(filePathToRoute('users/[id]/posts.njk', '.njk')).toBe('/users/:id/posts');
    });

    it('should convert [...rest] to catch-all *', () => {
      expect(filePathToRoute('docs/[...rest].njk', '.njk')).toBe('/docs/*');
    });

    it('should handle multiple dynamic params', () => {
      expect(filePathToRoute('users/[userId]/posts/[postId].njk', '.njk'))
        .toBe('/users/:userId/posts/:postId');
    });

    it('should handle Windows path separators', () => {
      expect(filePathToRoute('tools\\[slug].njk', '.njk')).toBe('/tools/:slug');
    });
  });

  describe('extractMethodFromFilename', () => {
    it('should extract GET method', () => {
      const result = extractMethodFromFilename('health.get.js');
      expect(result.method).toBe('get');
      expect(result.baseName).toBe('health');
    });

    it('should extract POST method', () => {
      const result = extractMethodFromFilename('create.post.js');
      expect(result.method).toBe('post');
      expect(result.baseName).toBe('create');
    });

    it('should extract PUT method', () => {
      const result = extractMethodFromFilename('update.put.js');
      expect(result.method).toBe('put');
      expect(result.baseName).toBe('update');
    });

    it('should extract DELETE method', () => {
      const result = extractMethodFromFilename('remove.delete.js');
      expect(result.method).toBe('delete');
      expect(result.baseName).toBe('remove');
    });

    it('should default to GET for no method suffix', () => {
      const result = extractMethodFromFilename('handler.js');
      expect(result.method).toBe('get');
      expect(result.baseName).toBe('handler');
    });

    it('should handle filenames with dots', () => {
      const result = extractMethodFromFilename('api.v2.get.js');
      expect(result.method).toBe('get');
      expect(result.baseName).toBe('api.v2');
    });

    it('should handle case insensitivity', () => {
      const result = extractMethodFromFilename('health.GET.js');
      expect(result.method).toBe('get');
    });
  });

  describe('scanDirectory', () => {
    const fixturesPath = path.join(__dirname, '..', 'fixtures', 'pages');

    it('should return empty array for non-existent directory', () => {
      const result = scanDirectory('/non/existent/path');
      expect(result).toEqual([]);
    });

    it('should scan existing directory', () => {
      const result = scanDirectory(fixturesPath);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should skip locales directories', () => {
      const result = scanDirectory(fixturesPath);
      const hasLocales = result.some(f => f.includes('locales'));
      expect(hasLocales).toBe(false);
    });

    it('should skip files starting with underscore', () => {
      const result = scanDirectory(fixturesPath);
      const hasUnderscore = result.some(f => path.basename(f).startsWith('_'));
      expect(hasUnderscore).toBe(false);
    });
  });

  describe('createTranslator', () => {
    const translations = {
      'hello': 'Hello',
      'greeting': 'Hello, {{name}}!',
      'nested': {
        'key': 'Nested Value',
        'deep': {
          'key': 'Deep Nested Value'
        }
      }
    };

    it('should translate simple key', () => {
      const t = createTranslator(translations);
      expect(t('hello')).toBe('Hello');
    });

    it('should return key for missing translation', () => {
      const t = createTranslator(translations);
      expect(t('missing.key')).toBe('missing.key');
    });

    it('should support nested keys', () => {
      const t = createTranslator(translations);
      expect(t('nested.key')).toBe('Nested Value');
      expect(t('nested.deep.key')).toBe('Deep Nested Value');
    });

    it('should replace parameters', () => {
      const t = createTranslator(translations);
      expect(t('greeting', { name: 'World' })).toBe('Hello, World!');
    });

    it('should handle multiple parameters', () => {
      const translations = { msg: 'Hello {{name}}, welcome to {{place}}!' };
      const t = createTranslator(translations);
      expect(t('msg', { name: 'John', place: 'Paris' })).toBe('Hello John, welcome to Paris!');
    });
  });

  describe('detectLocale', () => {
    it('should prefer query parameter', () => {
      const req = global.testUtils.createMockRequest({
        query: { lang: 'de' },
        headers: { 'accept-language': 'en-US' }
      });
      expect(detectLocale(req)).toBe('de');
    });

    it('should use Accept-Language header', () => {
      const req = global.testUtils.createMockRequest({
        headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' }
      });
      // Note: This depends on SUPPORTED_LOCALES env var
      const result = detectLocale(req);
      expect(['de', 'en']).toContain(result);
    });

    it('should fall back to default locale', () => {
      const req = global.testUtils.createMockRequest({
        headers: { 'accept-language': 'fr-FR' }
      });
      expect(detectLocale(req)).toBe('en');
    });

    it('should use DEFAULT_LOCALE from env', () => {
      const originalLocale = process.env.DEFAULT_LOCALE;
      process.env.DEFAULT_LOCALE = 'de';
      
      const req = global.testUtils.createMockRequest({});
      expect(detectLocale(req)).toBe('de');
      
      process.env.DEFAULT_LOCALE = originalLocale;
    });
  });

  describe('loadI18n', () => {
    const fixturesPath = path.join(__dirname, '..', 'fixtures', 'pages');
    
    it('should load global translations', () => {
      const translations = loadI18n(fixturesPath, fixturesPath, 'en');
      expect(typeof translations).toBe('object');
    });

    it('should return empty object for non-existent locale', () => {
      const translations = loadI18n(fixturesPath, fixturesPath, 'nonexistent');
      expect(translations).toEqual({});
    });
  });

  describe('routeRegistrationMeta', () => {
    it('classifies static vs dynamic vs catch-all tiers', () => {
      expect(routeRegistrationMeta('/about')).toMatchObject({
        tier: 0,
        literalSegCount: 1,
        paramSegCount: 0,
      });
      expect(routeRegistrationMeta('/users/:id')).toMatchObject({
        tier: 1,
        paramSegCount: 1,
      });
      expect(routeRegistrationMeta('/docs/*')).toMatchObject({
        tier: 2,
      });
    });

    it('counts literal and param segments', () => {
      const m = routeRegistrationMeta('/catalog/special/:id');
      expect(m.literalSegCount).toBe(2);
      expect(m.paramSegCount).toBe(1);
      expect(m.depth).toBe(3);
    });

    it('handles root path', () => {
      const m = routeRegistrationMeta('/');
      expect(m.depth).toBe(0);
      expect(m.tier).toBe(0);
    });
  });

  describe('compareRouteRegistrationOrder', () => {
    const r = (routePath) => ({ routePath });

    it('static before dynamic', () => {
      expect(compareRouteRegistrationOrder(r('/about'), r('/:slug'))).toBeLessThan(0);
      expect(compareRouteRegistrationOrder(r('/:slug'), r('/about'))).toBeGreaterThan(0);
    });

    it('more literal segments before sibling :param (static wins)', () => {
      expect(compareRouteRegistrationOrder(r('/catalog/special'), r('/catalog/:id'))).toBeLessThan(0);
      expect(compareRouteRegistrationOrder(r('/catalog/:id'), r('/catalog/special'))).toBeGreaterThan(0);
    });

    it('deeper dynamic path before shallower when literals tie', () => {
      expect(compareRouteRegistrationOrder(r('/items/:id/edit'), r('/items/:id'))).toBeLessThan(0);
    });

    it('nested :param before root :param', () => {
      expect(compareRouteRegistrationOrder(r('/catalog/:id'), r('/:slug'))).toBeLessThan(0);
    });

    it('catch-all after non-catch-all dynamic', () => {
      expect(compareRouteRegistrationOrder(r('/docs/:id'), r('/docs/*'))).toBeLessThan(0);
    });
  });
});

