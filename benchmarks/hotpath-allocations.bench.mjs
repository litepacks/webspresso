/**
 * Microbenchmarks: Hot-path allocations & closure creation
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, beforeAll, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHelpers } = require('../src/helpers.js');
const { loadI18n, detectLocale } = require('../src/file-router.js');
const { ModelEvents, createEventContext } = require('../core/orm/events.js');
const { AuthManager } = require('../core/auth/manager.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'pages');
const TOOLS_ROUTE_DIR = path.join(PAGES_DIR, 'tools');

describe('SSR Helpers: createHelpers & isPath', () => {
  const dummyReq = {
    path: '/tools/converter',
    originalUrl: '/tools/converter?format=json',
    query: { format: 'json' },
    params: { slug: 'converter' },
    get: (h) => (h === 'user-agent' ? 'Mozilla/5.0' : null),
  };
  const dummyRes = {};
  const ctx = { req: dummyReq, res: dummyRes, locale: 'en', baseUrl: 'http://localhost:3000' };

  bench('createHelpers (allocation per request)', () => {
    createHelpers(ctx);
  });

  const helpers = createHelpers(ctx);

  bench('helpers.isPath (wildcard glob)', () => {
    helpers.isPath('/tools/*');
  });

  bench('helpers.isPath (exact match)', () => {
    helpers.isPath('/tools/converter');
  });
});

describe('Auth: createRequestAuth & checks', () => {
  let authManager;
  const dummyReq = {
    session: { userId: 123 },
    cookies: {},
    headers: {},
  };
  const dummyRes = {};

  beforeAll(() => {
    authManager = new AuthManager({
      session: { secret: 'super-secret-key-1234567890123456' },
      findUserById: async (id) => ({ id, email: 'user@example.com' }),
    });
  });

  bench('createRequestAuth (allocation per request)', () => {
    authManager.createRequestAuth(dummyReq, dummyRes);
  });

  bench('req.auth.check / id / user', () => {
    const auth = authManager.createRequestAuth(dummyReq, dummyRes);
    auth.check();
    auth.id();
  });
});

describe('ORM: Event Context & Listener Lookup', () => {
  bench('createEventContext (allocation per query)', () => {
    createEventContext('User', 'find');
  });

  bench('ModelEvents.getMatchingListeners (0 listeners)', () => {
    ModelEvents.getMatchingListeners('User', 'beforeFind');
  });
});

describe('File Router: detectLocale & loadI18n', () => {
  beforeAll(() => {
    process.env.SUPPORTED_LOCALES = 'en,de,fr,es,tr';
    process.env.DEFAULT_LOCALE = 'en';
    loadI18n(PAGES_DIR, TOOLS_ROUTE_DIR, 'en');
  });

  const dummyReq = {
    query: { lang: 'tr' },
    get: (h) => (h.toLowerCase() === 'accept-language' ? 'tr-TR,tr;q=0.9,en;q=0.8' : null),
  };

  bench('detectLocale', () => {
    detectLocale(dummyReq);
  });

  bench('loadI18n (warm file cache)', () => {
    loadI18n(PAGES_DIR, TOOLS_ROUTE_DIR, 'en');
  });
});
