/**
 * E2E: createApp({ pageAssets }) — per-route load() stylesheets in <head> and real CSS in browser
 */

const { test, expect } = require('@playwright/test');
const { createApp } = require('../../src/server');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PAGE_HEAD_BLOCK = `{% if pageAssets and pageHead %}
    {% for item in pageHead.stylesheets %}
      {% if item is string %}
        <link rel="stylesheet" href="{{ item }}">
      {% else %}
        <link rel="stylesheet" href="{{ item.href }}"{% if item.media %} media="{{ item.media }}"{% endif %}>
      {% endif %}
    {% endfor %}
    {% for item in pageHead.scripts %}
      {% if item is string %}
        <script src="{{ item }}" defer></script>
      {% else %}
        <script src="{{ item.src }}"{% if item.defer != false %} defer{% endif %}{% if item.async %} async{% endif %}{% if item.type %} type="{{ item.type }}"{% endif %}></script>
      {% endif %}
    {% endfor %}
  {% endif %}`;

let serverOff;
let serverOn;
let baseURLOff;
let baseURLOn;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeLayout(viewsDir) {
  fs.writeFileSync(
    path.join(viewsDir, 'layout.njk'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{ meta.title or 'page-assets e2e' }}</title>
${PAGE_HEAD_BLOCK}
</head>
<body>
{% block content %}{% endblock %}
</body>
</html>
`
  );
}

function writePageWithAssets(pagesDir) {
  fs.writeFileSync(
    path.join(pagesDir, 'pa.njk'),
    `{% extends "layout.njk" %}
{% block content %}
<p class="e2e-page-assets-marker" data-testid="marker">per-page assets</p>
{% endblock %}
`
  );
  fs.writeFileSync(
    path.join(pagesDir, 'pa.js'),
    `module.exports = {
  load() {
    return {
      stylesheets: ['/e2e-page-assets.css'],
      scripts: [{ src: '/e2e-page-assets.js', defer: true }],
    };
  },
};
`
  );
}

function writePublicCss(publicDir) {
  fs.writeFileSync(
    path.join(publicDir, 'e2e-page-assets.css'),
    `.e2e-page-assets-marker { color: rgb(199, 37, 78); }`
  );
  fs.writeFileSync(
    path.join(publicDir, 'e2e-page-assets.js'),
    `window.__E2E_PAGE_ASSETS_JS = 1;`
  );
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const s = app.listen(0);
    s.once('error', reject);
    s.once('listening', () => {
      const addr = s.address();
      const port = typeof addr === 'object' ? addr.port : addr;
      resolve({ server: s, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

test.describe('pageAssets e2e', () => {
  test.beforeAll(async () => {
    const tempOff = path.join(os.tmpdir(), 'webspresso-page-assets-e2e-off');
    const tempOn = path.join(os.tmpdir(), 'webspresso-page-assets-e2e-on');
    for (const t of [tempOff, tempOn]) {
      if (fs.existsSync(t)) fs.rmSync(t, { recursive: true, force: true });
    }

    for (const temp of [tempOff, tempOn]) {
      const pagesDir = path.join(temp, 'pages');
      const viewsDir = path.join(temp, 'views');
      const publicDir = path.join(temp, 'public');
      mkdirp(pagesDir);
      mkdirp(viewsDir);
      mkdirp(publicDir);
      writeLayout(viewsDir);
      writePageWithAssets(pagesDir);
      writePublicCss(publicDir);
    }

    const { app: appOff } = createApp({
      pagesDir: path.join(tempOff, 'pages'),
      viewsDir: path.join(tempOff, 'views'),
      publicDir: path.join(tempOff, 'public'),
      helmet: false,
      logging: false,
    });
    const { app: appOn } = createApp({
      pagesDir: path.join(tempOn, 'pages'),
      viewsDir: path.join(tempOn, 'views'),
      publicDir: path.join(tempOn, 'public'),
      helmet: false,
      logging: false,
      pageAssets: true,
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

  test('pageAssets off: no extra link tags; marker color not from per-page CSS', async ({ page }) => {
    await page.goto(`${baseURLOff}/pa`);
    await expect(page.locator('[data-testid="marker"]')).toBeVisible();
    const links = page.locator('head link[rel="stylesheet"]');
    await expect(links).toHaveCount(0);
    const color = await page.locator('.e2e-page-assets-marker').evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // default black-ish, not our rgb(199, 37, 78)
    expect(color).not.toBe('rgb(199, 37, 78)');
  });

  test('pageAssets on: head has link + script; CSS applies in document', async ({ page }) => {
    await page.goto(`${baseURLOn}/pa`);
    await expect(page.locator('[data-testid="marker"]')).toBeVisible();
    const linkHref = await page.locator('head link[rel="stylesheet"][href$="e2e-page-assets.css"]').getAttribute('href');
    expect(linkHref).toBe('/e2e-page-assets.css');
    await expect(page.locator('head script[src$="e2e-page-assets.js"]')).toHaveCount(1);
    const color = await page.locator('.e2e-page-assets-marker').evaluate((el) => {
      return getComputedStyle(el).color;
    });
    expect(color).toBe('rgb(199, 37, 78)');
  });

  test('pageAssets on: deferred script runs', async ({ page }) => {
    await page.goto(`${baseURLOn}/pa`);
    const marker = await page.evaluate(() => window.__E2E_PAGE_ASSETS_JS);
    expect(marker).toBe(1);
  });
});
