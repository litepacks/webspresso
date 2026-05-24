/**
 * router-edge — edge-safe routing helpers (no fs)
 */

const {
  detectLocale,
  createTranslator,
  resolveMiddlewares,
  resolvePageAssets,
  applyPageAssetsToTemplateData,
  routeRegistrationMeta,
  compareRouteRegistrationOrder,
  normalizeLocaleCandidate,
  pickMatchingLocale,
} = require('../../src/router-edge');

describe('router-edge', () => {
  describe('normalizeLocaleCandidate / pickMatchingLocale', () => {
    it('normalizes and matches supported locales', () => {
      const supported = new Set(['en', 'de']);
      expect(normalizeLocaleCandidate('EN')).toBe('en');
      expect(pickMatchingLocale('en-US', supported)).toBe('en');
      expect(pickMatchingLocale('xxConstants', supported)).toBeNull();
      expect(normalizeLocaleCandidate('')).toBeNull();
    });
  });

  describe('detectLocale', () => {
    it('prefers query lang then Accept-Language then default', () => {
      process.env.SUPPORTED_LOCALES = 'en,de';
      process.env.DEFAULT_LOCALE = 'en';
      const req = {
        query: { lang: 'de' },
        get: () => null,
      };
      expect(detectLocale(req)).toBe('de');

      const req2 = {
        query: {},
        get: (h) => (h === 'Accept-Language' ? 'de-DE,en;q=0.9' : null),
      };
      expect(detectLocale(req2)).toBe('de');
    });
  });

  describe('createTranslator', () => {
    it('interpolates params in translation strings', () => {
      const t = createTranslator({ greeting: 'Hello {{ name }}' });
      expect(t('greeting', { name: 'Ada' })).toBe('Hello Ada');
      expect(t('missing')).toBe('missing');
    });
  });

  describe('resolveMiddlewares', () => {
    it('resolves string names and tuple factories', () => {
      const mw = (req, res, next) => next();
      const factory = () => mw;
      const named = (opts) => (req, res, next) => next();
      const list = resolveMiddlewares(
        [mw, 'auth', ['guest', { api: true }]],
        { auth: factory, guest: named }
      );
      expect(list).toHaveLength(3);
      expect(typeof list[0]).toBe('function');
      expect(typeof list[1]).toBe('function');
      expect(typeof list[2]).toBe('function');
    });

    it('throws on invalid middleware entry', () => {
      expect(() => resolveMiddlewares([123], {})).toThrow(/Invalid middleware/);
    });
  });

  describe('resolvePageAssets / applyPageAssetsToTemplateData', () => {
    it('promotes stylesheets and scripts when enabled', () => {
      const cfg = resolvePageAssets({ enabled: true, scripts: false });
      const out = applyPageAssetsToTemplateData(cfg, {
        title: 'x',
        stylesheets: '/a.css',
        scripts: '/a.js',
      });
      expect(out.pageAssets).toBe(true);
      expect(out.pageHead.stylesheets).toEqual(['/a.css']);
      expect(out.pageHead.scripts).toEqual([]);
      expect(out.data.scripts).toBe('/a.js');
    });

    it('returns unchanged data when page assets disabled', () => {
      const out = applyPageAssetsToTemplateData(resolvePageAssets(false), { a: 1 });
      expect(out.pageAssets).toBe(false);
      expect(out.data).toEqual({ a: 1 });
    });
  });

  describe('routeRegistrationMeta / compareRouteRegistrationOrder', () => {
    it('orders static before dynamic routes', () => {
      const a = { routePath: '/users/:id' };
      const b = { routePath: '/users/me' };
      expect(compareRouteRegistrationOrder(b, a)).toBeLessThan(0);
      expect(routeRegistrationMeta('/files/*').tier).toBe(2);
    });
  });
});
