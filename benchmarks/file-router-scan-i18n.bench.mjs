/**
 * Microbenchmarks: scanDirectory, loadI18n, createTranslator, detectLocale
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, beforeAll, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  scanDirectory,
  loadI18n,
  createTranslator,
  detectLocale,
} = require('../src/file-router.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'pages');
const TOOLS_ROUTE_DIR = path.join(PAGES_DIR, 'tools');

describe('scanDirectory', () => {
  bench('tests/fixtures/pages', () => {
    scanDirectory(PAGES_DIR);
  });
});

describe('loadI18n', () => {
  beforeAll(() => {
    loadI18n(PAGES_DIR, TOOLS_ROUTE_DIR, 'en');
  });

  bench('tools + en (warm cache)', () => {
    loadI18n(PAGES_DIR, TOOLS_ROUTE_DIR, 'en');
  });
});

describe('createTranslator', () => {
  let t;

  beforeAll(() => {
    const merged = loadI18n(PAGES_DIR, TOOLS_ROUTE_DIR, 'en');
    t = createTranslator(merged);
  });

  bench('top-level key', () => {
    t('welcome');
  });

  bench('nested key', () => {
    t('nav.home');
  });

  bench('missing key (fallback)', () => {
    t('definitely.missing.key');
  });
});

describe('detectLocale', () => {
  beforeAll(() => {
    process.env.SUPPORTED_LOCALES = 'en,de';
    process.env.DEFAULT_LOCALE = 'en';
  });

  bench('query lang=de', () => {
    detectLocale({
      query: { lang: 'de' },
      get: () => null,
    });
  });

  bench('Accept-Language de', () => {
    detectLocale({
      query: {},
      get: (name) => (String(name).toLowerCase() === 'accept-language' ? 'de,en;q=0.9' : null),
    });
  });

  bench('default locale', () => {
    detectLocale({
      query: {},
      get: () => null,
    });
  });
});
