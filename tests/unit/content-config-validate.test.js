import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { validateContentItem } from '../../core/content/validate';
import { parseMarkdownContent } from '../../core/content/parse';

describe('content config and validate', () => {
  it('resolveContentConfig returns disabled shell when enabled false', () => {
    const c = resolveContentConfig({ enabled: false }, 'development');
    expect(c.enabled).toBe(false);
  });

  it('resolveContentConfig auto-discovers collection dirs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-content-'));
    fs.mkdirSync(path.join(dir, 'news'));
    fs.writeFileSync(
      path.join(dir, 'news', 'a.md'),
      '---\ntitle: A\n---\n\n# A'
    );
    const c = resolveContentConfig({ enabled: true, dir: '.' }, 'development', dir);
    expect(c.collections.news).toBeTruthy();
    expect(c.collections.news.route).toBe('/news/:slug');
  });

  it('validateContentItem reports zod errors', () => {
    const schema = z.object({ title: z.string().min(3), date: z.string() });
    const { errors } = validateContentItem(
      { title: 'ab', date: null, tags: [], slug: 'x' },
      { schema },
      { failOnInvalid: false }
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('parseMarkdownContent throws on bad yaml', () => {
    expect(() =>
      parseMarkdownContent('---\n  title: [unclosed\n  nested: {\n---\n\n# x')
    ).toThrow(/YAML/);
  });

  it('ContentIndex failOnInvalid throws in production', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-inv-'));
    fs.mkdirSync(path.join(dir, 'content', 'blog'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'content', 'blog', 'bad.md'),
      '---\ntitle: ok\n---\n\nx'
    );
    const config = resolveContentConfig(
      {
        enabled: true,
        dir: 'content',
        failOnInvalid: true,
        collections: {
          blog: {
            schema: z.object({
              title: z.number(),
            }),
          },
        },
      },
      'production',
      dir
    );
    expect(() => new ContentIndex(config)).toThrow(/validation failed/i);
  });

  it('ContentIndex loads from manifest items', () => {
    const config = resolveContentConfig({ enabled: true }, 'test');
    const index = new ContentIndex(config, [
      {
        collection: 'blog',
        slug: 'from-manifest',
        title: 'Manifest',
        route: '/blog/:slug',
        body: '',
        html: '<p>x</p>',
        excerpt: '',
        draft: false,
        tags: [],
        path: 'content/blog/from-manifest.md',
      },
    ]);
    expect(index.findBySlug('blog', 'from-manifest')?.title).toBe('Manifest');
  });
});
