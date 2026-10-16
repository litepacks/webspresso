const {
  createHelpers,
  configureAssets,
  getAssetManager,
  AssetManager,
  ScriptInjector,
  getScriptInjector,
} = require('../../../src/helpers');

describe('Template Helpers Deep Scenarios & Branch Coverage', () => {
  describe('fsy Date / Time Manipulation Helpers', () => {
    const fsy = createHelpers({});

    it('handles date parsing, formatting, and relative time', () => {
      // Empty date returns current dayjs
      expect(fsy.date()).toBeDefined();

      const d1 = new Date('2025-01-01T10:00:00Z');
      const d2 = new Date('2025-01-05T10:00:00Z');

      expect(fsy.dateFormat(d1, 'YYYY-MM-DD')).toBe('2025-01-01');
      expect(fsy.dateFormat(null)).toBe('');

      expect(fsy.dateFromNow(d1)).toBeTruthy();
      expect(fsy.dateFromNow(null)).toBe('');

      expect(fsy.dateAgo(d1)).toBeTruthy();
      expect(fsy.dateAgo(null)).toBe('');

      expect(fsy.dateUntil(d2)).toBeTruthy();
      expect(fsy.dateUntil(null)).toBe('');
    });

    it('handles date comparisons: isBefore, isAfter, isSame, diff', () => {
      const d1 = new Date('2025-03-01T00:00:00Z');
      const d2 = new Date('2025-03-10T00:00:00Z');
      const dSame = new Date('2025-03-01T05:00:00Z');

      expect(fsy.dateIsBefore(d1, d2)).toBe(true);
      expect(fsy.dateIsBefore(d2, d1)).toBe(false);
      expect(fsy.dateIsBefore(null, d2)).toBe(false);

      expect(fsy.dateIsAfter(d2, d1)).toBe(true);
      expect(fsy.dateIsAfter(d1, d2)).toBe(false);
      expect(fsy.dateIsAfter(d1, null)).toBe(false);

      expect(fsy.dateIsSame(d1, dSame, 'day')).toBe(true);
      expect(fsy.dateIsSame(d1, d2, 'day')).toBe(false);
      expect(fsy.dateIsSame(null, d2)).toBe(false);

      expect(fsy.dateDiff(d2, d1, 'day')).toBe(9);
      expect(fsy.dateDiff(null, d1)).toBe(0);
    });

    it('handles date math: add, subtract, startOf, endOf', () => {
      const d = new Date('2025-06-15T12:00:00Z');

      const added = fsy.dateAdd(d, 5, 'day');
      expect(added.format('YYYY-MM-DD')).toBe('2025-06-20');
      expect(fsy.dateAdd(null, 5).isValid()).toBe(true);

      const subtracted = fsy.dateSubtract(d, 2, 'month');
      expect(subtracted.format('YYYY-MM')).toBe('2025-04');
      expect(fsy.dateSubtract(null, 2).isValid()).toBe(true);

      const start = fsy.dateStartOf(d, 'month');
      expect(start.format('YYYY-MM-DD')).toBe('2025-06-01');
      expect(fsy.dateStartOf(null, 'month').isValid()).toBe(true);

      const end = fsy.dateEndOf(d, 'month');
      expect(end.format('YYYY-MM-DD')).toBe('2025-06-30');
      expect(fsy.dateEndOf(null, 'month').isValid()).toBe(true);
    });
  });

  describe('fsy URL, CSRF & Bouncer Authorization Helpers', () => {
    it('handles url, localeUrl, route, fullUrl, and params getters', () => {
      const mockReq = {
        path: '/products',
        query: { category: 'shoes', sort: 'asc' },
        params: { id: '42' },
        headers: { 'x-trace-id': 'tr_999' },
        get(name) {
          return this.headers[name.toLowerCase()];
        },
      };

      const fsy = createHelpers({
        req: mockReq,
        baseUrl: 'https://example.com/shop',
      });

      // url()
      expect(fsy.url('cart', { item: 1 })).toBe('/cart?item=1');
      expect(fsy.url('/checkout')).toBe('/checkout');

      // localeUrl() preserves existing query and sets lang
      const trUrl = fsy.localeUrl('tr');
      expect(trUrl).toContain('lang=tr');
      expect(trUrl).toContain('category=shoes');

      // route()
      expect(fsy.route('/users/:id/items/[itemId]', { id: 'usr_1', itemId: 'item_2' }))
        .toBe('/users/usr_1/items/item_2');

      // fullUrl()
      expect(fsy.fullUrl('items', { page: 2 })).toBe('https://example.com/shop/items?page=2');

      // q(), param(), hdr()
      expect(fsy.q('category')).toBe('shoes');
      expect(fsy.q('missing', 'default_val')).toBe('default_val');
      expect(fsy.param('id')).toBe('42');
      expect(fsy.param('missing', 0)).toBe(0);
      expect(fsy.hdr('X-Trace-Id')).toBe('tr_999');
      expect(fsy.hdr('Missing-Hdr', 'none')).toBe('none');
    });

    it('handles csrf helper as input tag and raw token string', () => {
      // With csrfToken function
      const fsy1 = createHelpers({
        req: { csrfToken: () => 'token_abc_123' },
      });
      expect(fsy1.csrf()).toBe('<input type="hidden" name="_csrf" value="token_abc_123">');
      expect(fsy1.csrf(false)).toBe('token_abc_123');

      // With session _csrf
      const fsy2 = createHelpers({
        req: { session: { _csrf: 'sess_token_456' } },
      });
      expect(fsy2.csrf(false)).toBe('sess_token_456');

      // Empty csrf
      const fsy3 = createHelpers({ req: {} });
      expect(fsy3.csrf()).toBe('');
      expect(fsy3.csrf(false)).toBe('');
    });

    it('delegates can() and cannot() to req.bouncer or fallback bouncer', () => {
      const mockBouncer = {
        allows: vi.fn().mockImplementation((action) => action === 'edit_post'),
      };

      const fsyWithBouncer = createHelpers({
        req: { bouncer: mockBouncer },
      });

      expect(fsyWithBouncer.can('edit_post')).toBe(true);
      expect(fsyWithBouncer.cannot('edit_post')).toBe(false);
      expect(fsyWithBouncer.can('delete_post')).toBe(false);
      expect(fsyWithBouncer.cannot('delete_post')).toBe(true);
    });
  });

  describe('Page Assets Generation & Route Matching', () => {
    it('pageAssets() generates script and link tags with options and attribute filtering', () => {
      const am = new AssetManager();
      vi.spyOn(am, 'hasPageCss').mockReturnValue(true);
      vi.spyOn(am, 'hasPageJs').mockReturnValue(true);
      vi.spyOn(am, 'pageCssUrl').mockReturnValue('/css/pages/dashboard.css');
      vi.spyOn(am, 'pageJsUrl').mockReturnValue('/js/pages/dashboard.js');

      const html = am.pageAssets('dashboard', {
        css: true,
        js: true,
        type: 'module',
      });

      expect(html).toContain('rel="stylesheet"');
      expect(html).toContain('href="/css/pages/dashboard.css"');
      expect(html).toContain('type="module"');
      expect(html).toContain('src="/js/pages/dashboard.js"');
    });

    it('pageAssetsForRoute() matches candidates and honors css/js toggle flags', () => {
      const am = new AssetManager();
      vi.spyOn(am, 'hasPageCss').mockImplementation((cand) => cand === 'products');
      vi.spyOn(am, 'hasPageJs').mockImplementation((cand) => cand === 'products');
      vi.spyOn(am, 'pageCssUrl').mockReturnValue('/css/pages/products.css');
      vi.spyOn(am, 'pageJsUrl').mockReturnValue('/js/pages/products.js');

      // With JS disabled
      const cssOnly = am.pageAssetsForRoute('pages/products/[id].njk', '/products/:id', {
        js: false,
      });
      expect(cssOnly).toContain('href="/css/pages/products.css"');
      expect(cssOnly).not.toContain('<script');

      // With CSS disabled
      const jsOnly = am.pageAssetsForRoute('pages/products/[id].njk', '/products/:id', {
        css: false,
      });
      expect(jsOnly).toContain('src="/js/pages/products.js"');
      expect(jsOnly).not.toContain('<link');
    });
  });
});
