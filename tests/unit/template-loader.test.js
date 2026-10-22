const path = require('path');
const fs = require('fs');
const { createApp } = require('../../src/server');
const request = require('supertest');
const { createTempDir, cleanupDir } = require('../utils/fs');

describe('Nunjucks Template Loader & Extension Guard', () => {
  let tempDir;
  let pagesDir;
  let viewsDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-tpl-test-');
    pagesDir = path.join(tempDir, 'pages');
    viewsDir = path.join(tempDir, 'views');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(viewsDir, { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('should detect self-extension in template and throw friendly error without stack overflow', async () => {
    // 404.njk extending itself
    fs.writeFileSync(
      path.join(pagesDir, '404.njk'),
      '{% extends "404.njk" %}\n{% block content %}Custom 404{% endblock %}'
    );

    const { app, nunjucksEnv } = createApp({ pagesDir, viewsDir });

    expect(() => {
      nunjucksEnv.render('404.njk');
    }).toThrow(/Circular template extension detected/i);

    // Request to missing route should gracefully catch the error and fallback
    const res = await request(app).get('/missing-page-trigger');
    expect(res.status).toBe(404);
  });

  it('should detect circular dependency cycle between multiple templates', async () => {
    fs.writeFileSync(
      path.join(viewsDir, 'circA.njk'),
      '{% extends "circB.njk" %}\n{% block content %}A{% endblock %}'
    );
    fs.writeFileSync(
      path.join(viewsDir, 'circB.njk'),
      '{% extends "circA.njk" %}\n{% block content %}B{% endblock %}'
    );

    const { nunjucksEnv } = createApp({ pagesDir, viewsDir });

    expect(() => {
      nunjucksEnv.render('circA.njk');
    }).toThrow(/Circular template extension detected/i);
  });

  it('should allow multiple includes of the same partial without false positives', () => {
    fs.writeFileSync(path.join(viewsDir, 'badge.njk'), '<span class="badge">New</span>');
    fs.writeFileSync(
      path.join(viewsDir, 'list.njk'),
      'Item 1: {% include "badge.njk" %}, Item 2: {% include "badge.njk" %}'
    );

    const { nunjucksEnv } = createApp({ pagesDir, viewsDir });
    const output = nunjucksEnv.render('list.njk');

    expect(output).toBe('Item 1: <span class="badge">New</span>, Item 2: <span class="badge">New</span>');
  });

  it('should prioritize viewsDir over pagesDir for shared layout templates', async () => {
    fs.writeFileSync(
      path.join(viewsDir, 'layout.njk'),
      '<!DOCTYPE html><html><body>[VIEWS LAYOUT]{% block content %}{% endblock %}</body></html>'
    );
    fs.writeFileSync(
      path.join(pagesDir, 'layout.njk'),
      '<!DOCTYPE html><html><body>[PAGES LAYOUT]{% block content %}{% endblock %}</body></html>'
    );
    fs.writeFileSync(
      path.join(pagesDir, 'index.njk'),
      '{% extends "layout.njk" %}\n{% block content %}<h1>Home</h1>{% endblock %}'
    );

    const { app } = createApp({ pagesDir, viewsDir });
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('[VIEWS LAYOUT]');
    expect(res.text).not.toContain('[PAGES LAYOUT]');
  });

  it('should not produce /views/views/ loop when templates inside viewsDir include using views/ prefix', async () => {
    fs.mkdirSync(path.join(viewsDir, 'partials'), { recursive: true });
    fs.writeFileSync(path.join(viewsDir, 'partials', 'header.njk'), '<header>App Header</header>');
    fs.writeFileSync(
      path.join(viewsDir, 'layout.njk'),
      '{% include "views/partials/header.njk" %}\n<main>{% block content %}{% endblock %}</main>'
    );
    fs.writeFileSync(
      path.join(pagesDir, 'dashboard.njk'),
      '{% extends "views/layout.njk" %}\n{% block content %}<h1>Dashboard</h1>{% endblock %}'
    );

    const { nunjucksEnv } = createApp({
      pagesDir,
      viewsDir,
      nunjucks: { watch: true, noCache: true },
    });

    // Multiple render passes simulating watch re-evaluation
    const output1 = nunjucksEnv.render('dashboard.njk');
    expect(output1).toContain('<header>App Header</header>');
    expect(output1).toContain('<h1>Dashboard</h1>');

    const output2 = nunjucksEnv.render('dashboard.njk');
    expect(output2).toContain('<header>App Header</header>');

    // Directly rendering views/layout.njk should also work without /views/views
    const output3 = nunjucksEnv.render('views/layout.njk');
    expect(output3).toContain('<header>App Header</header>');
  });
});
