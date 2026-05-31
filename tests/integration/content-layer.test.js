import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { createApp } from '../../index';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('content layer integration', () => {
  /** @type {ReturnType<typeof createApp>} */
  let result;

  beforeAll(() => {
    result = createApp({
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
            tagsRoute: '/blog/tags/:tag',
          },
        },
      },
    });
  });

  it('exposes contentConfig and content service via plugin', () => {
    expect(result.contentConfig?.enabled).toBe(true);
    const pm = result.pluginManager;
    expect(pm.contentService).toBeTruthy();
    const post = pm.contentService.get('blog', 'hello-world');
    expect(post?.title).toBe('Hello World');
  });

  it('tag route lists matching posts', async () => {
    const res = await result.app.fetch(new Request('http://localhost/blog/tags/nodejs'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Hello World');
  });
});
