import { describe, it, expect } from 'vitest';
import path from 'path';
import nunjucks from 'nunjucks';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';
import { registerContentNunjucks } from '../../plugins/content/nunjucks';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

describe('content nunjucks', () => {
  it('exposes content global with latest', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'development',
      fixtureRoot
    );
    const index = new ContentIndex(config);
    const svc = createContentService(index, config);
    const env = nunjucks.configure({ autoescape: true, noCache: true });
    registerContentNunjucks(svc, env);
    const html = env.renderString(
      '{% set posts = content.latest("blog", 5) %}{{ posts|length }}'
    );
    expect(Number(html.trim())).toBeGreaterThan(0);
  });
});
