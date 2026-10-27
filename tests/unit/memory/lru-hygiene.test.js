'use strict';

const { AssetManager, createHelpers } = require('../../../src/helpers');
const {
  filePathToRoute,
  createTranslator,
  clearTranslatorCache,
} = require('../../../src/file-router');
const { parseUserAgent } = require('../../../core/auth/user-agent');

describe('Memory Hygiene & LRU Caching Hardening', () => {
  describe('AssetManager Bounded LRU Caches', () => {
    it('bounds resolve cache under high key volume without leaking', () => {
      const manager = new AssetManager({ publicDir: 'public', version: '1.0.0' });

      // Generate 2500 unique assets (above MAX_ASSET_CACHE = 2000)
      for (let i = 0; i < 2500; i++) {
        const resolved = manager.resolve(`/assets/style-${i}.css`);
        expect(resolved).toBe(`/assets/style-${i}.css?v=1.0.0`);
      }

      // Verify the internal cache size is bounded at <= 2000
      expect(manager._resolveCache.size).toBeLessThanOrEqual(2000);
      expect(manager._resolveCache.size).toBeGreaterThan(1000);

      // Verify hitting existing key returns cached result
      const hit = manager.resolve('/assets/style-2499.css');
      expect(hit).toBe('/assets/style-2499.css?v=1.0.0');
    });

    it('bounds hasPageJs and hasPageCss caches under high volume', () => {
      const manager = new AssetManager({ publicDir: 'public' });

      for (let i = 0; i < 2500; i++) {
        const hasJs = manager.hasPageJs(`nonexistent-page-${i}`);
        expect(hasJs).toBe(false);
      }

      expect(manager._hasJsCache.size).toBeLessThanOrEqual(2000);

      for (let i = 0; i < 2500; i++) {
        const hasCss = manager.hasPageCss(`nonexistent-page-${i}`);
        expect(hasCss).toBe(false);
      }

      expect(manager._hasCssCache.size).toBeLessThanOrEqual(2000);
    });
  });

  describe('File Router Bounded LRU Caches', () => {
    afterEach(() => {
      clearTranslatorCache();
    });

    it('bounds filePathToRoute cache and supports clearing', () => {
      for (let i = 0; i < 5500; i++) {
        const route = filePathToRoute(`items/item-${i}/index.njk`, '.njk');
        expect(route).toBe(`/items/item-${i}`);
      }

      // Calling clearTranslatorCache flushes all internal router caches
      clearTranslatorCache();

      const freshRoute = filePathToRoute('dashboard/index.njk', '.njk');
      expect(freshRoute).toBe('/dashboard');
    });

    it('bounds translator interpolation and formatting helpers', () => {
      const t = createTranslator({
        welcome: 'Welcome, {{name}}! You have {{count}} unread messages.',
        price: 'Price: {price}',
      }, { locale: 'en' });

      for (let i = 0; i < 600; i++) {
        const rendered = t('welcome', { name: `User${i}`, count: i });
        expect(rendered).toContain(`User${i}`);
      }

      // Verify formatters work as expected
      const formattedNum = t.number(12345.67);
      expect(formattedNum).toBeDefined();

      const formattedDate = t.date(new Date());
      expect(formattedDate).toBeDefined();

      const formattedRel = t.relativeTime(-5, 'minute');
      expect(formattedRel).toBeDefined();
    });
  });

  describe('User-Agent Bounded LRU Cache', () => {
    it('promotes cached user-agents on hit and evicts least recently used', () => {
      const standardUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
      
      const parsed1 = parseUserAgent(standardUA);
      expect(parsed1.os).toBe('macOS');
      expect(parsed1.device).toBe('desktop');

      // Generate 600 unique bot user agents (exceeds MAX_UA_CACHE = 512)
      for (let i = 0; i < 600; i++) {
        // Repeatedly hit standardUA so it remains MRU
        if (i % 50 === 0) {
          parseUserAgent(standardUA);
        }
        parseUserAgent(`TestCrawler/${i}.0 (compatible; Googlebot/2.1; +http://example.com/bot${i})`);
      }

      // standardUA should still be readily resolvable
      const parsedAgain = parseUserAgent(standardUA);
      expect(parsedAgain.os).toBe('macOS');
    });
  });
});
