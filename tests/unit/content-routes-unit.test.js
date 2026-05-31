import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { resolveContentConfig } from '../../core/content/config';
import { ContentIndex } from '../../core/content/index';
import { createContentService } from '../../core/content/service';
import {
  mountContentRoutes,
  registerContentSitemapUrls,
  renderContentPage,
} from '../../core/content/routes';
import { buildSeoFromItem } from '../../core/content/seo';

const fixtureRoot = path.join(__dirname, '../fixtures/content-layer');

function mockReq(overrides = {}) {
  return {
    path: '/',
    query: {},
    params: {},
    get: () => null,
    ...overrides,
  };
}

describe('content routes (unit)', () => {
  it('renderContentPage uses fallback html when no layout', async () => {
    const item = {
      title: 'T & <test>',
      html: '<p>body</p>',
      url: '/blog/t',
    };
    const send = vi.fn();
    await renderContentPage({
      req: mockReq({ path: '/blog/t' }),
      res: { send },
      item,
      collCfg: { layout: null },
      collectionName: 'blog',
      nunjucksEnv: { render: () => '<layout/>' },
      templateDirs: [path.join(os.tmpdir(), 'no-views')],
      kind: 'post',
    });
    expect(send).toHaveBeenCalled();
    const html = send.mock.calls[0][0];
    expect(html).toContain('T &amp;');
    expect(html).toContain('<p>body</p>');
  });

  it('renderContentPage renders list fallback without layout', async () => {
    const send = vi.fn();
    await renderContentPage({
      req: mockReq({ path: '/blog' }),
      res: { send },
      item: null,
      items: [{ title: 'A', url: '/blog/a' }],
      collCfg: { indexRoute: '/blog' },
      collectionName: 'blog',
      nunjucksEnv: { render: () => '' },
      templateDirs: [],
      kind: 'list',
    });
    const html = send.mock.calls[0][0];
    expect(html).toContain('/blog/a');
  });

  it('buildSeoFromItem handles robots noindex and relative canonical', () => {
    const seo = buildSeoFromItem(
      {
        title: 'T',
        description: 'D',
        robots: 'noindex, nofollow',
        canonical: '/custom',
        url: '/blog/t',
        tags: [],
      },
      { baseUrl: 'https://example.com' }
    );
    expect(seo.indexable).toBe(false);
    expect(seo.canonical).toBe('https://example.com/custom');
  });

  it('registerContentSitemapUrls uses absolute canonical path', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: { sitemap: true, indexRoute: '/blog' } } },
      'production',
      fixtureRoot
    );
    const index = new ContentIndex(config);
    const item = index.published()[0];
    if (item) {
      item.canonical = 'https://example.com/blog/canonical';
    }
    const added = [];
    registerContentSitemapUrls(
      {
        usePlugin: () => ({
          api: { addUrl: (p, o) => added.push({ path: p, ...o }) },
        }),
      },
      index,
      config
    );
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((u) => u.path === '/blog')).toBe(true);
  });

  it('mountContentRoutes returns 404 when item removed', async () => {
    const config = resolveContentConfig(
      {
        enabled: true,
        dir: 'content',
        collections: { blog: { route: '/blog/:slug' } },
      },
      'production',
      fixtureRoot
    );
    const index = new ContentIndex(config);
    const svc = createContentService(index, config);
    const routes = {};
    const app = {
      get: (pattern, handler) => {
        routes[pattern] = handler;
      },
    };
    mountContentRoutes(
      app,
      {
        nunjucksEnv: { render: () => 'ok' },
        templateDirs: [path.join(fixtureRoot, 'views')],
        silent: true,
      },
      svc,
      config
    );
    const pattern = Object.keys(routes).find((k) => k.includes('hello-world'));
    const next = vi.fn();
    const res = { status: vi.fn(() => res), send: vi.fn() };
    index.items.delete('blog/hello-world');
    await routes[pattern]({ path: pattern, query: {}, params: { slug: 'hello-world' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).toHaveBeenCalled();
  });

  it('mountContentRoutes logs when not silent', () => {
    const config = resolveContentConfig(
      { enabled: true, dir: 'content', collections: { blog: {} } },
      'development',
      fixtureRoot
    );
    const svc = createContentService(new ContentIndex(config), config);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mountContentRoutes(
      { get: () => {} },
      { nunjucksEnv: { render: () => '' }, templateDirs: [], silent: false },
      svc,
      config
    );
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('GET'))).toBe(true);
    logSpy.mockRestore();
  });
});
