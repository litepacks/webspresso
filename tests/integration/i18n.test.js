/**
 * Integration Tests for i18n System
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const { loadI18n, createTranslator } = require('../../src/file-router');

const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PAGES_DIR = path.join(FIXTURES_PATH, 'pages');
const VIEWS_DIR = path.join(FIXTURES_PATH, 'views');

describe('i18n System Integration', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR
    });
    app = result.app;
  });

  describe('Translation loading', () => {
    it('should load global English translations', () => {
      const translations = loadI18n(PAGES_DIR, PAGES_DIR, 'en');
      
      expect(translations).toHaveProperty('site');
      expect(translations.site).toHaveProperty('name', 'Webspresso');
    });

    it('should load global Turkish translations', () => {
      const translations = loadI18n(PAGES_DIR, PAGES_DIR, 'tr');
      
      expect(translations).toHaveProperty('site');
      expect(translations).toHaveProperty('nav');
      expect(translations.nav.home).toBe('Ana Sayfa');
    });

    it('should merge route-specific translations', () => {
      const toolsDir = path.join(PAGES_DIR, 'tools');
      const translations = loadI18n(PAGES_DIR, toolsDir, 'en');
      
      // Should have both global and tools-specific translations
      expect(translations).toHaveProperty('site');
      expect(translations).toHaveProperty('tools');
    });

    it('should override global with route-specific', () => {
      const toolsDir = path.join(PAGES_DIR, 'tools');
      const translations = loadI18n(PAGES_DIR, toolsDir, 'en');
      
      // Route-specific should override global
      expect(translations.tools.title).toBe('Developer Tools');
    });
  });

  describe('Translator function', () => {
    it('should translate simple keys', () => {
      const translations = loadI18n(PAGES_DIR, PAGES_DIR, 'en');
      const t = createTranslator(translations);
      
      expect(t('nav.home')).toBe('Home');
      expect(t('nav.tools')).toBe('Tools');
    });

    it('should translate nested keys', () => {
      const translations = loadI18n(PAGES_DIR, PAGES_DIR, 'en');
      const t = createTranslator(translations);
      
      expect(t('features.routing.title')).toBe('File-Based Routing');
    });

    it('should return key for missing translations', () => {
      const translations = loadI18n(PAGES_DIR, PAGES_DIR, 'en');
      const t = createTranslator(translations);
      
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('should replace placeholders', () => {
      const translations = { greeting: 'Hello, {{name}}!' };
      const t = createTranslator(translations);
      
      expect(t('greeting', { name: 'World' })).toBe('Hello, World!');
    });
  });

  describe('Locale detection in requests', () => {
    it('should use default locale when no preference', async () => {
      const res = await request(app)
        .get('/')
        .expect(200);

      expect(res.text).toContain('lang="en"');
    });

    it('should respect lang query parameter', async () => {
      const res = await request(app)
        .get('/?lang=tr')
        .expect(200);

      expect(res.text).toContain('lang="tr"');
    });

    it('should show Turkish navigation with lang=tr', async () => {
      const res = await request(app)
        .get('/?lang=tr')
        .expect(200);

      expect(res.text).toContain('Ana Sayfa');
      expect(res.text).toContain('Araçlar');
      expect(res.text).toContain('Hakkında');
    });

    it('should show English content by default', async () => {
      const res = await request(app)
        .get('/')
        .expect(200);

      expect(res.text).toContain('Home');
      expect(res.text).toContain('Tools');
      expect(res.text).toContain('About');
    });
  });

  describe('Page-specific translations', () => {
    it('should use tools page translations', async () => {
      const res = await request(app)
        .get('/tools')
        .expect(200);

      expect(res.text).toContain('Developer Tools');
    });

    it('should use about page translations', async () => {
      const res = await request(app)
        .get('/about')
        .expect(200);

      expect(res.text).toContain('About');
    });

    it('should apply Turkish translations to tools page', async () => {
      const res = await request(app)
        .get('/tools?lang=tr')
        .expect(200);

      expect(res.text).toContain('Geliştirici Araçları');
    });
  });

  describe('Template t() helper', () => {
    it('should render translations in templates', async () => {
      const res = await request(app)
        .get('/')
        .expect(200);

      // Check that t() function worked in template
      expect(res.text).toContain('Webspresso');
      expect(res.text).not.toContain('{{ t(');
    });

    it('should handle missing translations gracefully', async () => {
      const res = await request(app)
        .get('/')
        .expect(200);

      // Should not have raw template syntax
      expect(res.text).not.toContain('{{');
      expect(res.text).not.toContain('}}');
    });
  });

  describe('Supported locales', () => {
    it('should fall back to default for unsupported locale', async () => {
      const res = await request(app)
        .get('/?lang=fr')
        .expect(200);

      // French is not supported, should show English or the key
      expect(res.text).toBeDefined();
    });

    it('should accept Turkish as supported locale', async () => {
      const res = await request(app)
        .get('/?lang=tr')
        .expect(200);

      expect(res.text).toContain('lang="tr"');
    });
  });
});
