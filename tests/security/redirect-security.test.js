const request = require('supertest');
const { createApp } = require('../../src/server');
const { redirectPlugin } = require('../../plugins/redirect');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');

describe('Security: Redirect Plugin & Open Redirect Defense', () => {
  it('should block external redirects with protocol-relative // when allowExternal is false', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      plugins: [
        redirectPlugin({
          allowExternal: false,
          rules: [
            { from: '/old-link', to: '//evil.com' },
          ],
        }),
      ],
    });

    const res = await request(app).get('/old-link');
    expect(res.status).not.toBe(302);
    expect(res.headers.location).not.toBe('//evil.com');
  });

  it('should block external redirects with backslash \\\\ or /\\ when allowExternal is false', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      plugins: [
        redirectPlugin({
          allowExternal: false,
          rules: [
            { from: '/evil-backslash', to: '\\\\evil.com' },
            { from: '/evil-mixed', to: '/\\evil.com' },
          ],
        }),
      ],
    });

    const res1 = await request(app).get('/evil-backslash');
    expect(res1.status).not.toBe(302);

    const res2 = await request(app).get('/evil-mixed');
    expect(res2.status).not.toBe(302);
  });

  it('should block javascript: and data: pseudo-protocol URIs when allowExternal is false', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      plugins: [
        redirectPlugin({
          allowExternal: false,
          rules: [
            { from: '/js-uri', to: 'javascript:alert(1)' },
            { from: '/data-uri', to: 'data:text/html,<script>alert(1)</script>' },
          ],
        }),
      ],
    });

    const res1 = await request(app).get('/js-uri');
    expect(res1.status).not.toBe(302);

    const res2 = await request(app).get('/data-uri');
    expect(res2.status).not.toBe(302);
  });

  it('should allow internal relative redirects safely', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      plugins: [
        redirectPlugin({
          allowExternal: false,
          rules: [
            { from: '/legacy-about', to: '/about' },
          ],
        }),
      ],
    });

    const res = await request(app).get('/legacy-about').expect(302);
    expect(res.headers.location).toBe('/about');
  });
});
