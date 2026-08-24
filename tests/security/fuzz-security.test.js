const request = require('supertest');
const { createApp } = require('../../src/server');
const { createTranslator } = require('../../src/file-router');
const { deepClone } = require('../../core/orm/utils');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: Lightweight Fuzz & Property Tests', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      setupRoutes: (expressApp) => {
        expressApp.get('/fuzz-target', (req, res) => {
          res.json({
            query: req.query,
            headers: Object.keys(req.headers).length,
          });
        });
      },
    });
    app = result.app;
  });

  it('should not crash when bombarded with randomized query strings and control characters', async () => {
    const fuzzPayloads = [
      '\x00\x01\x02\x03\x04\x05\x06\x07',
      '\uFEFF\u200B\u200C\u200D',
      'a'.repeat(2000),
      '"><script>alert(String.fromCharCode(88,83,83))</script>',
      '{{7*7}}',
      '${7*7}',
      '__proto__[admin]=1',
      'constructor[prototype][admin]=1',
      Array.from({ length: 50 }, (_, i) => `p${i}=val${i}`).join('&'),
    ];

    for (const payload of fuzzPayloads) {
      const res = await request(app).get(`/fuzz-target?q=${encodeURIComponent(payload)}`);
      expect([200, 400, 404]).toContain(res.status);
    }
  });

  it('translator should never crash on random or recursive translation tokens', () => {
    const t = createTranslator({
      nested: '{{a}} -> {{b}} -> {{c}}',
    });

    const fuzzParams = [
      { a: '{{b}}', b: '{{c}}', c: '{{a}}' },
      { a: null, b: undefined, c: 123 },
      { a: '\x00', b: '$$$$', c: "$'" },
      { a: { toString: () => 'custom' }, b: [1, 2], c: 'ok' },
    ];

    for (const params of fuzzParams) {
      expect(() => t('nested', params)).not.toThrow();
    }
  });

  it('deepClone should never throw or pollute on adversarial objects', () => {
    const adversarial = [
      { a: null, b: undefined, c: [1, null, { d: 'test' }] },
      { __proto__: { evil: 'yes' }, constructor: { prototype: { bad: 'yes' } } },
      { date: new Date(), regex: /abc/g },
    ];

    for (const obj of adversarial) {
      expect(() => deepClone(obj)).not.toThrow();
      expect({}.evil).toBeUndefined();
      expect({}.bad).toBeUndefined();
    }
  });
});
