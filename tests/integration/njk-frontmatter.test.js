/**
 * Integration: YAML frontmatter on pages/*.njk (createApp SSR)
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const PAGES_FM = path.join(FIXTURES, 'pages-njk-frontmatter');
const VIEWS = path.join(FIXTURES, 'views');

describe('njk YAML frontmatter (integration)', () => {
  /** @type {import('express').Application} */
  let app;

  beforeAll(() => {
    const { app: raw } = createApp({
      pagesDir: PAGES_FM,
      viewsDir: VIEWS,
    });
    app = raw;
  });

  it('GET /fm-about applies meta from frontmatter', async () => {
    const res = await request(app).get('/fm-about').expect(200).expect('Content-Type', /html/);
    expect(res.text).toContain('<title>FM About Title</title>');
    expect(res.text).toContain('content="FM About description"');
    expect(res.text).toContain('href="https://fm.example.com/about"');
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(res.text).toContain('FM About Title');
    expect(res.text).toContain('id="fm-about"');
  });

  it('GET /plain works without frontmatter', async () => {
    const res = await request(app).get('/plain').expect(200);
    expect(res.text).toContain('id="plain-marker"');
  });

  it('GET /fm-data merges data.staticVar into ctx', async () => {
    const res = await request(app).get('/fm-data').expect(200);
    expect(res.text).toContain('id="data-marker">injected-from-frontmatter');
  });

  it('GET /fm-overlap: route .js meta() overrides YAML title', async () => {
    const res = await request(app).get('/fm-overlap').expect(200);
    expect(res.text).toContain('<title>Title From JS Route File</title>');
    expect(res.text).toContain('id="overlap"');
  });
});
