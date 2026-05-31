import { describe, it, expect } from 'vitest';
import path from 'path';
import { collectContent } from '../../plugins/studio/collectors/content';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('studio collectContent', () => {
  it('returns disabled when content service missing', () => {
    expect(collectContent({}).enabled).toBe(false);
  });

  it('returns collection stats when enabled', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'development',
      fixtureRoot
    );
    const svc = createContentService(new ContentIndex(config), config);
    const data = collectContent({
      options: { content: config },
      pluginManager: { contentService: svc },
    });
    expect(data.enabled).toBe(true);
    expect(data.collections.some((c) => c.name === 'blog')).toBe(true);
  });
});
