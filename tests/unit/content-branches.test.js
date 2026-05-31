import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { parseMarkdownContent } from '../../core/content/parse';
import { buildSeoFromItem } from '../../core/content/seo';
import { resolveSlug } from '../../core/content/slug';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { mountContentRoutes } from '../../core/content/routes';
import { createContentService } from '../../core/content/service';

describe('content layer branches', () => {
  it('parseMarkdownContent handles file without frontmatter', () => {
    const r = parseMarkdownContent('# Only md\n\nParagraph.');
    expect(r.fm).toBeNull();
    expect(r.html).toContain('<h1');
  });

  it('buildSeoFromItem uses absolute canonical and robots indexable', () => {
    const seo = buildSeoFromItem({
      title: 'T',
      canonical: 'https://cdn.example.com/x',
      robots: 'index, follow',
      url: '/x',
      tags: [],
    });
    expect(seo.canonical).toBe('https://cdn.example.com/x');
    expect(seo.indexable).toBe(true);
  });

  it('resolveSlug uses frontmatter slug', () => {
    expect(resolveSlug({ frontmatterSlug: 'My-Slug', fileBaseName: 'file' })).toBe('my-slug');
  });

  it('ContentIndex parses tags string and nested paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nested-'));
    const nested = path.join(dir, 'content', 'blog', '2026');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'nested.md'),
      '---\ntitle: Nested\ntags: "a, b"\ndraft: false\n---\n\n# Nested'
    );
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: { draft: true } } },
      'development',
      dir
    );
    const index = new ContentIndex(config);
    const item = index.findBySlug('blog', 'nested');
    expect(item.tags).toEqual(['a', 'b']);
  });

  it('mountContentRoutes handles tag route', async () => {
    const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');
    const config = resolveContentConfig(
      {
        enabled: true,
        dir: path.join(fixtureRoot, 'content'),
        collections: {
          blog: {
            route: '/blog/:slug',
            tagsRoute: '/blog/tags/:tag',
          },
        },
      },
      'development',
      fixtureRoot
    );
    const svc = createContentService(new ContentIndex(config), config);
    const handlers = {};
    mountContentRoutes(
      { get: (p, h) => { handlers[p] = h; } },
      {
        nunjucksEnv: { render: () => '<tag/>' },
        templateDirs: [path.join(fixtureRoot, 'views')],
        silent: true,
      },
      svc,
      config
    );
    const tagRoute = Object.keys(handlers).find((k) => k.includes(':tag'));
    const send = vi.fn();
    await handlers[tagRoute](
      { path: '/blog/tags/nodejs', query: {}, params: { tag: 'nodejs' }, get: () => null },
      { send },
      () => {}
    );
    expect(send).toHaveBeenCalled();
  });
});
