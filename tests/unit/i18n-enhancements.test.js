const { createTranslator } = require('../../src/file-router');
const { createHelpers } = require('../../src/helpers');
const { createApp } = require('../../src/server');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/views');

describe('i18n Enhancements: Pluralization, Fallback & Intl Formatters', () => {
  describe('Pluralization with Intl.PluralRules', () => {
    it('should select correct plural forms in English based on count', () => {
      const translations = {
        messages: {
          zero: 'No messages',
          one: 'One message',
          other: '{{count}} messages',
        },
      };

      const t = createTranslator(translations, { locale: 'en' });

      expect(t('messages', { count: 0 })).toBe('No messages');
      expect(t('messages', { count: 1 })).toBe('One message');
      expect(t('messages', { count: 5 })).toBe('5 messages');
    });

    it('should support explicit exact numeric keys (0, 1, etc.)', () => {
      const translations = {
        items: {
          0: 'Hiç öğe yok',
          1: 'Tam 1 öğe',
          other: '{{count}} adet öğe',
        },
      };

      const t = createTranslator(translations, { locale: 'tr' });

      expect(t('items', { count: 0 })).toBe('Hiç öğe yok');
      expect(t('items', { count: 1 })).toBe('Tam 1 öğe');
      expect(t('items', { count: 42 })).toBe('42 adet öğe');
    });

    it('should interpolate other parameters alongside count', () => {
      const translations = {
        notification: {
          one: '{{user}} sent 1 message to {{channel}}',
          other: '{{user}} sent {{count}} messages to {{channel}}',
        },
      };

      const t = createTranslator(translations, { locale: 'en' });

      expect(t('notification', { count: 1, user: 'Alice', channel: '#general' }))
        .toBe('Alice sent 1 message to #general');
      expect(t('notification', { count: 3, user: 'Bob', channel: '#dev' }))
        .toBe('Bob sent 3 messages to #dev');
    });
  });

  describe('Fallback Translations', () => {
    it('should resolve key from fallback translations when missing in primary locale', () => {
      const trTranslations = {
        nav: {
          home: 'Ana Sayfa',
        },
      };

      const enFallback = {
        nav: {
          home: 'Home',
          settings: 'Settings',
        },
        footer: {
          copyright: 'All rights reserved.',
        },
      };

      const t = createTranslator(trTranslations, {
        locale: 'tr',
        fallbackTranslations: enFallback,
        fallbackLocale: 'en',
      });

      // Present in primary
      expect(t('nav.home')).toBe('Ana Sayfa');
      // Missing in primary, present in fallback
      expect(t('nav.settings')).toBe('Settings');
      expect(t('footer.copyright')).toBe('All rights reserved.');
      // Missing in both
      expect(t('missing.key', 'Default')).toBe('Default');

      // t.has / t.exists
      expect(t.has('nav.home')).toBe(true);
      expect(t.has('nav.settings')).toBe(true);
      expect(t.has('missing.key')).toBe(false);
      expect(t.exists('footer.copyright')).toBe(true);
    });
  });

  describe('Intl Formatting Helpers on t', () => {
    it('should format numbers with t.number and t.formatNumber', () => {
      const tEn = createTranslator({}, 'en-US');
      expect(tEn.number(1234567.89)).toBe('1,234,567.89');

      const tTr = createTranslator({}, 'tr-TR');
      expect(tTr.number(1234567.89).replace(/\s/g, ' ')).toContain('1.234.567,89');
    });

    it('should format currency with t.currency and t.formatCurrency', () => {
      const t = createTranslator({}, 'en-US');
      const formatted = t.currency(199.99, 'USD');
      expect(formatted).toContain('199.99');
      expect(formatted).toContain('$');
    });

    it('should format date with t.date and t.formatDate', () => {
      const date = new Date('2026-08-24T12:00:00Z');
      const t = createTranslator({}, 'en-US');
      const res = t.date(date, { dateStyle: 'short' });
      expect(res).toBeDefined();
      expect(res.length).toBeGreaterThan(0);
    });

    it('should format relative time with t.relativeTime', () => {
      const t = createTranslator({}, 'en-US');
      expect(t.relativeTime(-1, 'day')).toBe('yesterday');
      expect(t.relativeTime(1, 'day')).toBe('tomorrow');
      expect(t.relativeTime(-2, 'day')).toBe('2 days ago');
    });

    it('should provide inline t.plural helper', () => {
      const t = createTranslator({}, 'en');
      const res1 = t.plural(1, { one: '1 apple', other: '{{count}} apples' });
      expect(res1).toBe('1 apple');

      const res5 = t.plural(5, { one: '1 apple', other: '{{count}} apples' });
      expect(res5).toBe('5 apples');
    });
  });

  describe('fsy Helpers and Nunjucks | t filter', () => {
    it('createHelpers should include locale(), t, and localeUrl', () => {
      const t = createTranslator({ site: 'My App' }, 'tr');
      const req = { path: '/catalog', query: { sort: 'asc' } };
      const helpers = createHelpers({ req, locale: 'tr', t });

      expect(helpers.locale()).toBe('tr');
      expect(helpers.t).toBe(t);
      expect(helpers.localeUrl('en')).toBe('/catalog?sort=asc&lang=en');
      expect(helpers.localeUrl('de', '/about')).toBe('/about?sort=asc&lang=de');
    });

    it('Nunjucks environment should support | t filter', () => {
      const { nunjucksEnv } = createApp({
        pagesDir: PAGES_DIR,
        viewsDir: VIEWS_DIR,
      });

      const t = createTranslator({
        'nav.home': 'Ana Sayfa',
        welcome: 'Hoşgeldin, {{name}}!',
      });

      const rendered1 = nunjucksEnv.renderString("{{ 'nav.home' | t }}", { t });
      expect(rendered1).toBe('Ana Sayfa');

      const rendered2 = nunjucksEnv.renderString("{{ 'welcome' | t({ name: 'Ahmet' }) }}", { t });
      expect(rendered2).toBe('Hoşgeldin, Ahmet!');
    });
  });
});
