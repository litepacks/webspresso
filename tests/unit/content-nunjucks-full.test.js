import { describe, it, expect } from 'vitest';
import path from 'path';
import nunjucks from 'nunjucks';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';
import { registerContentNunjucks } from '../../plugins/content/nunjucks';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('content nunjucks helpers', () => {
  const svc = () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'development',
      fixtureRoot
    );
    return createContentService(new ContentIndex(config), config);
  };

  it('exposes all helper functions', () => {
    const env = nunjucks.configure({ autoescape: true, noCache: true });
    const helpers = registerContentNunjucks(svc(), env);
    expect(helpers.content_get('blog', 'hello-world')?.slug).toBe('hello-world');
    expect(helpers.content_tags('blog').length).toBeGreaterThan(0);
    const post = helpers.content_get('blog', 'hello-world');
    expect(helpers.content_related(post, 2)).toBeTruthy();
    expect(helpers.content_search('webspresso').length).toBeGreaterThan(0);
    expect(helpers.content_collection('blog').whereTag('nodejs').length).toBeGreaterThan(0);
    expect(helpers.content_collection('blog').findBySlug('hello-world')).toBeTruthy();
    expect(helpers.content_collection('blog').all().length).toBeGreaterThan(0);
    expect(env.getGlobal('content').collections().length).toBeGreaterThan(0);
  });
});
