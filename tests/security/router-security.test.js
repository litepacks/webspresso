const request = require('supertest');
const { createApp } = require('../../src/server');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: Router Security & Traversal Resistance', () => {
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      setupRoutes: (expressApp) => {
        expressApp.get('/safe-endpoint', (req, res) => res.json({ safe: true }));
      },
    });
    app = result.app;
  });

  it('should not allow directory traversal via encoded dots or slashes', async () => {
    // Encoded traversal payloads
    const payloads = [
      '/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/%2e%2e%2f%2e%2e%2fpackage.json',
      '/about/..%2f..%2f..%2fpackage.json',
    ];

    for (const p of payloads) {
      const res = await request(app).get(p);
      // Must not return 200 containing package.json or system files
      if (res.status === 200) {
        expect(res.text).not.toContain('"name": "webspresso"');
      }
    }
  });

  it('should handle malformed percent encoding gracefully without server crash', async () => {
    const malformedPaths = [
      '/test%FF%FE',
      '/test%GG',
      '/test%',
      '/test%a',
      '/test%1',
    ];

    for (const p of malformedPaths) {
      const res = await request(app).get(p);
      // Express / Node should handle with 400 Bad Request or 404 without crashing
      expect([400, 404, 200]).toContain(res.status);
    }
  });

  it('should handle duplicate slashes gracefully', async () => {
    const res = await request(app).get('///safe-endpoint');
    expect([200, 404]).toContain(res.status);
  });
});
