const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createTranslator,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
  extractMethodFromFilename,
  compareRouteRegistrationOrder,
  routeRegistrationMeta,
  filePathToRoute,
} = require('../../../src/file-router');

describe('File Router Deep Scenarios & Branch Coverage', () => {
  describe('createTranslator() Deep Scenarios', () => {
    it('resolves nested dot keys, handles cache, and falls back gracefully', () => {
      const primary = {
        app: {
          title: 'My App',
          nested: {
            deep: 'Deep Value',
          },
        },
        simple: 'Simple Value',
      };
      const fallback = {
        app: {
          onlyInFallback: 'Fallback Value',
        },
        fallbackSimple: 'Fallback Simple',
      };

      const t = createTranslator(primary, {
        locale: 'en',
        fallbackTranslations: fallback,
      });

      // Primary top-level & nested
      expect(t('simple')).toBe('Simple Value');
      expect(t('app.title')).toBe('My App');
      expect(t('app.nested.deep')).toBe('Deep Value');

      // Fallback top-level & nested
      expect(t('fallbackSimple')).toBe('Fallback Simple');
      expect(t('app.onlyInFallback')).toBe('Fallback Value');

      // Missing with default value
      expect(t('nonexistent.key', 'Default Fallback')).toBe('Default Fallback');
      // Missing without default value returns key
      expect(t('nonexistent.key')).toBe('nonexistent.key');

      // Check t.has() and t.exists()
      expect(t.has('app.title')).toBe(true);
      expect(t.has('app.onlyInFallback')).toBe(true);
      expect(t.has('missing.key')).toBe(false);
      expect(t.exists('simple')).toBe(true);
      expect(t.exists('missing.key')).toBe(false);
    });

    it('interpolates parameters with {{param}} and escapes regex characters', () => {
      const dict = {
        welcome: 'Hello, {{name}}! You have {{count}} messages.',
        special: 'Testing special {{user-name}} and {{a.b}}.',
      };
      const t = createTranslator(dict, 'en');

      expect(t('welcome', { name: 'Alice', count: 5 })).toBe('Hello, Alice! You have 5 messages.');
      expect(t('special', { 'user-name': 'Bob', 'a.b': 'NestedParam' })).toBe('Testing special Bob and NestedParam.');
    });

    it('handles pluralization with object forms, cardinal counts and zero', () => {
      const dict = {
        items: {
          zero: 'No items',
          one: 'One item',
          other: '{{count}} items',
        },
        customNumeric: {
          '0': 'Zero items exactly',
          '1': 'Single item',
          other: 'Many items',
        },
      };
      const t = createTranslator(dict, 'en');

      // Zero handling
      expect(t('items', { count: 0 })).toBe('No items');
      expect(t('customNumeric', { count: 0 })).toBe('Zero items exactly');

      // One item
      expect(t('items', { count: 1 })).toBe('One item');
      expect(t('customNumeric', { count: 1 })).toBe('Single item');

      // Other / multiple
      expect(t('items', { count: 5 })).toBe('5 items');
      expect(t('customNumeric', { count: 10 })).toBe('Many items');

      // With n or cardinal alias
      expect(t('items', { n: 1 })).toBe('One item');
      expect(t('items', { count: 2, cardinal: 2 })).toBe('2 items');
    });

    it('provides formatting helpers: number, currency, date, relativeTime, and inline plural', () => {
      const t = createTranslator({}, 'en');

      // t.number
      expect(t.number(1234567.89)).toContain('1,234,567.89');
      expect(t.number(null)).toBe('');
      expect(t.number(NaN)).toBe('');
      expect(t.formatNumber(42)).toBe('42');

      // t.currency
      const usd = t.currency(99.5, 'USD');
      expect(usd).toContain('99.50');
      expect(t.currency(null)).toBe('');
      expect(t.currency(NaN)).toBe('');

      // t.date
      const testDate = new Date('2025-06-15T12:00:00Z');
      expect(t.date(testDate)).toBeTruthy();
      expect(t.date(null)).toBe('');
      expect(t.date('invalid-date')).toBe('');

      // t.relativeTime
      expect(t.relativeTime(-1, 'day')).toBeTruthy();
      expect(t.relativeTime(null)).toBe('');
      expect(t.relativeTime(NaN)).toBe('');

      // t.plural
      const pluralRes = t.plural(3, {
        one: 'One apple',
        other: '{{count}} apples',
      });
      expect(pluralRes).toBe('3 apples');

      const zeroRes = t.plural(0, {
        zero: 'No apples',
        other: '{{count}} apples',
      });
      expect(zeroRes).toBe('No apples');
    });
  });

  describe('Page Assets Resolution & Application', () => {
    it('resolves pageAssets configurations properly', () => {
      expect(resolvePageAssets(true)).toEqual({
        enabled: true,
        stylesheets: true,
        scripts: true,
        auto: true,
      });

      expect(resolvePageAssets(false)).toEqual({
        enabled: false,
        stylesheets: false,
        scripts: false,
        auto: false,
      });

      expect(resolvePageAssets(null)).toEqual({
        enabled: false,
        stylesheets: false,
        scripts: false,
        auto: false,
      });

      expect(resolvePageAssets({ enabled: false })).toEqual({
        enabled: false,
        stylesheets: false,
        scripts: false,
        auto: false,
      });

      expect(resolvePageAssets({ enabled: true, auto: false })).toEqual({
        enabled: true,
        stylesheets: true,
        scripts: true,
        auto: false,
      });
    });

    it('promotes stylesheets and scripts from template data into pageHead', () => {
      const cfg = { enabled: true, stylesheets: true, scripts: true, auto: false };
      const rawData = {
        title: 'Dashboard',
        stylesheets: ['/css/custom.css'],
        scripts: [{ src: '/js/chart.js', defer: true }],
      };

      const result = applyPageAssetsToTemplateData(cfg, rawData);
      expect(result.data.title).toBe('Dashboard');
      expect(result.data.stylesheets).toBeUndefined();
      expect(result.data.scripts).toBeUndefined();
      expect(result.pageHead.stylesheets).toEqual(['/css/custom.css']);
      expect(result.pageHead.scripts).toEqual([{ src: '/js/chart.js', defer: true }]);
      expect(result.pageAssets).toBe(true);
    });

    it('auto-discovers page assets via assetManager when auto is enabled', () => {
      const cfg = { enabled: true, stylesheets: true, scripts: true, auto: true };
      const mockAssetManager = {
        getRouteAssetCandidates: vi.fn().mockReturnValue(['pages/products']),
        hasPageCss: vi.fn().mockImplementation((cand) => cand === 'pages/products'),
        pageCssUrl: vi.fn().mockReturnValue('/assets/pages/products.css'),
        hasPageJs: vi.fn().mockImplementation((cand) => cand === 'pages/products'),
        pageJsUrl: vi.fn().mockReturnValue('/assets/pages/products.js'),
      };

      const result = applyPageAssetsToTemplateData(
        cfg,
        { title: 'Products' },
        { file: 'pages/products.njk', routePath: '/products' },
        mockAssetManager
      );

      expect(result.pageHead.stylesheets).toContain('/assets/pages/products.css');
      expect(result.pageHead.scripts).toEqual([
        { src: '/assets/pages/products.js', defer: true },
      ]);
    });
  });

  describe('Route Sorting & Registration Metadata', () => {
    it('compares route registration order prioritizing literal segments over params and catch-alls', () => {
      const rLiteral = routeRegistrationMeta('/api/users/profile');
      const rParam = routeRegistrationMeta('/api/users/:id');
      const rCatchAll = routeRegistrationMeta('/api/*path');

      // Literal segments sort before param segments
      const diff1 = compareRouteRegistrationOrder(rLiteral, rParam);
      expect(diff1).toBeLessThan(0);

      // Param segments sort before catch-all
      const diff2 = compareRouteRegistrationOrder(rParam, rCatchAll);
      expect(diff2).toBeLessThan(0);
    });

    it('extractMethodFromFilename supports head, options, delete, and multi-dot filenames', () => {
      expect(extractMethodFromFilename('ping.head.js')).toEqual({
        method: 'head',
        baseName: 'ping',
      });
      expect(extractMethodFromFilename('cors.options.js')).toEqual({
        method: 'options',
        baseName: 'cors',
      });
      expect(extractMethodFromFilename('v1.users.delete.js')).toEqual({
        method: 'delete',
        baseName: 'v1.users',
      });
      // Default to get when no method suffix
      expect(extractMethodFromFilename('plain-route.js')).toEqual({
        method: 'get',
        baseName: 'plain-route',
      });
    });

    it('converts file paths into routes with route groups and brackets', () => {
      expect(filePathToRoute('(marketing)/about.njk', '.njk')).toBe('/about');
      expect(filePathToRoute('(auth)/login/index.njk', '.njk')).toBe('/login');
      expect(filePathToRoute('shop/[category]/[item].njk', '.njk')).toBe('/shop/:category/:item');
    });
  });
});
