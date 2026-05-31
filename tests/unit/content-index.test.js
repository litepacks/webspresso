import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('ContentIndex', () => {
  /** @type {import('../../core/content/config').ContentResolvedConfig} */
  let config;

  beforeEach(() => {
    config = resolveContentConfig(
      {
        enabled: true,
        dir: 'content',
        collections: {
          blog: { route: '/blog/:slug', indexRoute: '/blog', sitemap: true },
        },
      },
      'development',
      fixtureRoot
    );
  });

  it('indexes markdown files in collection', () => {
    const index = new ContentIndex(config);
    const item = index.findBySlug('blog', 'hello-world');
    expect(item).toBeTruthy();
    expect(item.title).toBe('Hello World');
    expect(item.url).toBe('/blog/hello-world');
    expect(item.tags).toContain('webspresso');
  });

  it('filters drafts in production mode', () => {
    const prodConfig = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'production',
      fixtureRoot
    );
    const index = new ContentIndex(prodConfig);
    expect(index.findBySlug('blog', 'draft-post')).toBeNull();
    expect(index.getCollectionItems('blog').some((i) => i.slug === 'draft-post')).toBe(false);
  });

  it('includes drafts in development', () => {
    const index = new ContentIndex(config);
    expect(index.findBySlug('blog', 'draft-post')).toBeTruthy();
  });

  it('latest and whereTag work via service', () => {
    const index = new ContentIndex(config);
    const svc = createContentService(index, config);
    const latest = svc.collection('blog').latest(5);
    expect(latest.length).toBeGreaterThanOrEqual(1);
    const tagged = svc.collection('blog').whereTag('nodejs');
    expect(tagged.some((p) => p.slug === 'hello-world')).toBe(true);
  });

  it('search finds by title and body', () => {
    const index = new ContentIndex(config);
    const svc = createContentService(index, config);
    const hits = svc.search('webspresso');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('related ranks by shared tags', () => {
    const index = new ContentIndex(config);
    const item = index.findBySlug('blog', 'hello-world');
    const related = index.related(item, 3);
    expect(Array.isArray(related)).toBe(true);
  });
});
