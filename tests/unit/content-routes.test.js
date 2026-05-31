import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createApp } from '../../index';
const sitemapPlugin = require('../../plugins/sitemap');

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('content routes', () => {
  /** @type {ReturnType<typeof createApp>} */
  let app;

  beforeAll(() => {
    const result = createApp({
      pagesDir: path.join(fixtureRoot, 'pages'),
      viewsDir: path.join(fixtureRoot, 'views'),
      publicDir: false,
      logging: false,
      helmet: false,
      timeout: false,
      studio: false,
      content: {
        enabled: true,
        dir: path.join(fixtureRoot, 'content'),
        collections: {
          blog: {
            route: '/blog/:slug',
            indexRoute: '/blog',
            sitemap: true,
          },
        },
      },
      plugins: [
        sitemapPlugin({ hostname: 'http://localhost:3000', robots: false }),
      ],
    });
    app = result.app;
  });

  it('renders content post page', async () => {
    const res = await app.fetch(new Request('http://localhost/blog/hello-world'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Hello World');
    expect(text).toContain('Markdown content');
  });

  it('renders collection index', async () => {
    const res = await app.fetch(new Request('http://localhost/blog'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('blog posts');
    expect(text).toContain('Hello World');
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.fetch(new Request('http://localhost/blog/no-such-post'));
    expect(res.status).toBe(404);
  });
});
