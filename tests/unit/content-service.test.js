import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('createContentService', () => {
  it('exposes all service methods', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'development',
      fixtureRoot
    );
    const index = new ContentIndex(config);
    const svc = createContentService(index, config);
    expect(svc.collection('blog').latest(1).length).toBe(1);
    expect(svc.get('blog', 'hello-world')?.slug).toBe('hello-world');
    expect(svc.collections().length).toBeGreaterThan(0);
    expect(svc.search('webspresso').length).toBeGreaterThan(0);
    const post = svc.get('blog', 'hello-world');
    expect(svc.related(post, 2)).toBeTruthy();
    expect(svc.tags('blog').length).toBeGreaterThan(0);
    svc.rebuild();
    expect(svc.index.getCollectionItems('blog').length).toBeGreaterThan(0);
  });
});
