import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { registerContentSitemapUrls } from '../../core/content/routes';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('content sitemap', () => {
  it('registers published URLs via sitemap plugin api', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: { sitemap: true } } },
      'production',
      fixtureRoot
    );
    const index = new ContentIndex(config);
    const added = [];
    const ctx = {
      usePlugin: () => ({
        api: {
          addUrl: (p, opts) => added.push({ path: p, ...opts }),
        },
      }),
    };
    registerContentSitemapUrls(ctx, index, config);
    expect(added.some((u) => u.path === '/blog/hello-world')).toBe(true);
    expect(added.some((u) => u.path.includes('draft'))).toBe(false);
  });
});
