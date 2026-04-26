/**
 * Redirect plugin integration tests
 * @vitest-environment node
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/server.js';
import { redirectPlugin } from '../../plugins/redirect/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe('redirectPlugin', () => {
  it('redirects GET with default 302 and Location', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools' }],
        }),
      ],
    });

    const res = await request(app)
      .get('/legacy')
      .expect(302);

    expect(res.headers.location).toBe('/tools');
  });

  it('preserves query string when preserveQuery is true', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools' }],
          preserveQuery: true,
        }),
      ],
    });

    const res = await request(app)
      .get('/legacy?x=1&y=two')
      .expect(302);

    expect(res.headers.location).toBe('/tools?x=1&y=two');
  });

  it('does not append query when target already has query', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools?tab=1' }],
        }),
      ],
    });

    const res = await request(app)
      .get('/legacy?x=1')
      .expect(302);

    expect(res.headers.location).toBe('/tools?tab=1');
  });

  it('skips external targets unless allowExternal', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          allowExternal: false,
          rules: [{ from: '/go-out', to: 'https://evil.example/out' }],
        }),
      ],
    });

    const res = await request(app).get('/go-out');
    expect(res.status).not.toBe(302);
    expect(res.headers.location).toBeUndefined();
  });

  it('allows external targets when allowExternal is true', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          allowExternal: true,
          rules: [{ from: '/go-out', to: 'https://example.com/ok' }],
        }),
      ],
    });

    const res = await request(app).get('/go-out').expect(302);
    expect(res.headers.location).toBe('https://example.com/ok');
  });

  it('redirects HEAD like GET by default', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools' }],
        }),
      ],
    });

    const res = await request(app)
      .head('/legacy')
      .expect(302);

    expect(res.headers.location).toBe('/tools');
  });

  it('does not redirect POST by default', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools' }],
        }),
      ],
    });

    const res = await request(app).post('/legacy').send({});
    expect(res.status).not.toBe(302);
  });

  it('redirects POST when methods is *', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/legacy', to: '/tools', methods: '*' }],
        }),
      ],
    });

    const res = await request(app).post('/legacy').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/tools');
  });

  it('uses per-rule status 301', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: '/old', to: '/tools', status: 301 }],
        }),
      ],
    });

    await request(app).get('/old').expect(301);
  });

  it('matches RegExp from', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      plugins: [
        redirectPlugin({
          rules: [{ from: /^\/wiki\/(.+)$/, to: '/tools' }],
        }),
      ],
    });

    const res = await request(app).get('/wiki/foo').expect(302);
    expect(res.headers.location).toBe('/tools');
  });
});
