/**
 * clientRuntime: Alpine + swup E2E (HTMX-free)
 */

const { test, expect } = require('@playwright/test');
const { createApp } = require('../../src/server');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PARTIAL_SRC = path.join(__dirname, '../../views/partials/webspresso-client-runtime.njk');

let serverOff;
let serverOn;
let baseURLOff;
let baseURLOn;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFixtureLayout(viewsDir) {
  const partialDir = path.join(viewsDir, 'partials');
  mkdirp(partialDir);
  fs.copyFileSync(PARTIAL_SRC, path.join(partialDir, 'webspresso-client-runtime.njk'));
  fs.writeFileSync(
    path.join(viewsDir, 'layout.njk'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{ meta.title or 'swup e2e' }}</title>
</head>
<body>
<nav>
  <a href="/swup-a" data-testid="link-a">A</a>
  <a href="/swup-b" data-testid="link-b">B</a>
  <a href="/swup-b" data-testid="link-b-noswup" data-no-swup>B no swup</a>
</nav>
<main {% if clientRuntime and clientRuntime.swup %}id="swup"{% endif %}>
{% block content %}{% endblock %}
</main>
{% include "partials/webspresso-client-runtime.njk" %}
</body>
</html>
`
  );
}

function writeSwupPages(pagesDir) {
  mkdirp(pagesDir);
  fs.writeFileSync(
    path.join(pagesDir, 'swup-a.njk'),
    `{% extends "layout.njk" %}
{% block content %}
<div data-testid="page-label">page-a</div>
<div x-data="{ open: false }">
  <button type="button" data-testid="alpine-toggle" @click="open = !open">toggle</button>
  <span x-show="open" data-testid="alpine-panel">panel</span>
</div>
{% endblock %}
`
  );
  fs.writeFileSync(
    path.join(pagesDir, 'swup-b.njk'),
    `{% extends "layout.njk" %}
{% block content %}
<div data-testid="page-label">page-b</div>
{% endblock %}
`
  );
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const s = app.listen(0);
    s.once('error', reject);
    s.once('listening', () => {
      const addr = s.address();
      const port = typeof addr === 'object' ? addr.port : addr;
      resolve({ server: s, baseURL: `http://localhost:${port}` });
    });
  });
}

test.describe('clientRuntime swup + Alpine', () => {
  test.beforeAll(async () => {
    const tempOff = path.join(os.tmpdir(), 'webspresso-swup-e2e-off');
    const tempOn = path.join(os.tmpdir(), 'webspresso-swup-e2e-on');
    for (const t of [tempOff, tempOn]) {
      if (fs.existsSync(t)) fs.rmSync(t, { recursive: true, force: true });
    }

    const pagesOff = path.join(tempOff, 'pages');
    const viewsOff = path.join(tempOff, 'views');
    mkdirp(pagesOff);
    mkdirp(viewsOff);
    writeFixtureLayout(viewsOff);
    writeSwupPages(pagesOff);

    const pagesOn = path.join(tempOn, 'pages');
    const viewsOn = path.join(tempOn, 'views');
    mkdirp(pagesOn);
    mkdirp(viewsOn);
    writeFixtureLayout(viewsOn);
    writeSwupPages(pagesOn);

    const { app: appOff } = createApp({
      pagesDir: pagesOff,
      viewsDir: viewsOff,
      helmet: false,
      logging: false,
    });
    const { app: appOn } = createApp({
      pagesDir: pagesOn,
      viewsDir: viewsOn,
      helmet: false,
      logging: false,
      clientRuntime: { alpine: true, swup: true },
    });

    const off = await listen(appOff);
    serverOff = off.server;
    baseURLOff = off.baseURL;
    const on = await listen(appOn);
    serverOn = on.server;
    baseURLOn = on.baseURL;
  });

  test.afterAll(async () => {
    if (serverOff) serverOff.close();
    if (serverOn) serverOn.close();
  });

  test('with clientRuntime off, HTML has no client-runtime scripts', async ({ request }) => {
    const res = await request.get(`${baseURLOff}/swup-a`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).not.toContain('/__webspresso/client-runtime/');
    expect(html).not.toContain('id="swup"');
  });

  test('with clientRuntime on, HTML includes swup container and scripts', async ({ request }) => {
    const res = await request.get(`${baseURLOn}/swup-a`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('id="swup"');
    expect(html).toContain('/__webspresso/client-runtime/alpine.min.js');
    expect(html).toContain('/__webspresso/client-runtime/swup.umd.js');
  });

  test('swup navigation keeps window state; data-no-swup reloads', async ({ page }) => {
    await page.goto(`${baseURLOn}/swup-a`);
    await expect(page.locator('[data-testid="page-label"]')).toHaveText('page-a');

    await page.evaluate(() => {
      window.__e2eMarker = 'keep';
    });
    await page.click('[data-testid="link-b"]');
    await expect(page.locator('[data-testid="page-label"]')).toHaveText('page-b');
    expect(await page.evaluate(() => window.__e2eMarker)).toBe('keep');

    await page.goto(`${baseURLOn}/swup-a`);
    await page.evaluate(() => {
      window.__e2eMarker = 'before-noswup';
    });
    await Promise.all([
      page.waitForURL(`**/swup-b`),
      page.click('[data-testid="link-b-noswup"]'),
    ]);
    await expect(page.locator('[data-testid="page-label"]')).toHaveText('page-b');
    expect(await page.evaluate(() => window.__e2eMarker)).toBeUndefined();
  });

  test('Alpine works after swup navigation', async ({ page }) => {
    await page.goto(`${baseURLOn}/swup-a`);
    await page.click('[data-testid="alpine-toggle"]');
    await expect(page.locator('[data-testid="alpine-panel"]')).toBeVisible();
    await page.click('[data-testid="link-b"]');
    await expect(page.locator('[data-testid="page-label"]')).toHaveText('page-b');
    await page.click('[data-testid="link-a"]');
    await expect(page.locator('[data-testid="page-label"]')).toHaveText('page-a');
    await page.click('[data-testid="alpine-toggle"]');
    await expect(page.locator('[data-testid="alpine-panel"]')).toBeVisible();
  });
});
