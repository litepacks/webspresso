const {
  createTempDir,
  cleanupDir
} = require('../utils');
/**
 * Unit & Integration tests for Zero-Config Auto Page Asset Resolution
 * Tests automatic route-matching CSS & JS detection, AssetManager candidate generation,
 * fsy.pageAssets() template helper, and SSR <head> auto-injection via createApp({ pageAssets: true })
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { AssetManager, createHelpers, utils } = require('../../src/helpers');
const {
  resolvePageAssets,
  applyPageAssetsToTemplateData,
} = require('../../src/file-router');
const { createApp } = require('../../src/server');

describe('Zero-Config Auto Page Assets', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-page-assets');
  });

  afterEach(() => {
    try {
      cleanupDir(tempDir);
    } catch (_) {}
  });

  describe('AssetManager candidate generation', () => {
    const manager = new AssetManager();

    it('derives candidates from simple route files', () => {
      const candidates = manager.getRouteAssetCandidates('checkout.njk', '/checkout');
      expect(candidates).toContain('checkout');
    });

    it('derives candidates from nested and bracketed dynamic route files', () => {
      const candidates = manager.getRouteAssetCandidates('products/[id].njk', '/products/:id');
      expect(candidates).toContain('products/[id]');
      expect(candidates).toContain('products');
    });

    it('derives candidates from index route files', () => {
      const candidates = manager.getRouteAssetCandidates('index.njk', '/');
      expect(candidates).toContain('index');
      expect(candidates).toContain('home');
    });

    it('derives candidates from nested directory index files', () => {
      const candidates = manager.getRouteAssetCandidates('blog/index.njk', '/blog');
      expect(candidates).toContain('blog/index');
      expect(candidates).toContain('blog');
    });

    it('handles deep paths with multiple static segments', () => {
      const candidates = manager.getRouteAssetCandidates('admin/users/settings.njk', '/admin/users/settings');
      expect(candidates).toContain('admin/users/settings');
    });
  });

  describe('AssetManager hasPageJs & hasPageCss detection', () => {
    it('detects page JS on disk in dev mode', () => {
      const clientPagesDir = path.join(tempDir, 'src', 'client', 'pages');
      fs.mkdirSync(clientPagesDir, { recursive: true });
      fs.writeFileSync(path.join(clientPagesDir, 'checkout.js'), 'console.log("checkout");');

      const manager = new AssetManager({ srcDir: path.join(tempDir, 'src'), publicDir: path.join(tempDir, 'public') });

      expect(manager.hasPageJs('checkout')).toBe(true);
      expect(manager.hasPageJs('pages/checkout.js')).toBe(true);
      expect(manager.hasPageJs('nonexistent')).toBe(false);
    });

    it('detects page CSS on disk in dev mode', () => {
      const publicCssDir = path.join(tempDir, 'public', 'css', 'pages');
      fs.mkdirSync(publicCssDir, { recursive: true });
      fs.writeFileSync(path.join(publicCssDir, 'checkout.css'), '.checkout { color: red; }');

      const manager = new AssetManager({ publicDir: path.join(tempDir, 'public') });

      expect(manager.hasPageCss('checkout')).toBe(true);
      expect(manager.hasPageCss('pages/checkout.css')).toBe(true);
      expect(manager.hasPageCss('nonexistent')).toBe(false);
    });

    it('detects page JS and CSS from production manifest', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.js': { file: 'dist/pages/checkout.HASH123.js' },
        'pages/checkout.css': { file: 'dist/pages/checkout.HASH456.css' },
      };
      const manifestPath = path.join(distDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath });

      expect(manager.hasPageJs('checkout')).toBe(true);
      expect(manager.hasPageCss('checkout')).toBe(true);
      expect(manager.hasPageJs('nonexistent')).toBe(false);
      expect(manager.pageJsUrl('checkout')).toBe('/dist/pages/checkout.HASH123.js');
      expect(manager.pageCssUrl('checkout')).toBe('/dist/pages/checkout.HASH456.css');
    });
  });

  describe('pageAssets tag generator & helper parity', () => {
    it('generates combined CSS and JS tags', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.js': { file: 'dist/pages/checkout.h1.js' },
        'pages/checkout.css': { file: 'dist/pages/checkout.h2.css' },
      };
      const manifestPath = path.join(distDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath });
      const tags = manager.pageAssets('checkout');

      expect(tags).toContain('<link rel="stylesheet" href="/dist/pages/checkout.h2.css">');
      expect(tags).toContain('<script src="/dist/pages/checkout.h1.js" defer></script>');
    });

    it('supports options to filter JS or CSS or add custom script attributes', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.js': { file: 'dist/pages/checkout.h1.js' },
        'pages/checkout.css': { file: 'dist/pages/checkout.h2.css' },
      };
      fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });

      // CSS only
      const cssOnly = manager.pageAssets('checkout', { js: false });
      expect(cssOnly).toContain('<link rel="stylesheet"');
      expect(cssOnly).not.toContain('<script');

      // JS only with module type
      const jsOnly = manager.pageAssets('checkout', { css: false, type: 'module' });
      expect(jsOnly).not.toContain('<link');
      expect(jsOnly).toContain('<script src="/dist/pages/checkout.h1.js" defer type="module"></script>');
    });

    it('fsy.pageAssets and utils.pageAssets parity', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/cart.js': { file: 'dist/pages/cart.h1.js' },
      };
      fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });
      const fsy = createHelpers({ req: { path: '/cart', context: { file: 'cart.njk', path: '/cart' } } });

      expect(manager.hasPageJs('cart')).toBe(true);
      expect(manager.hasPageCss('cart')).toBe(false);

      // Explicit name
      const cartTags = manager.pageAssets('cart');
      expect(cartTags).toContain('<script src="/dist/pages/cart.h1.js" defer></script>');
    });
  });

  describe('applyPageAssetsToTemplateData with auto discovery', () => {
    it('returns unmodified data and null pageHead when pageAssets is disabled', () => {
      const data = { title: 'Test', stylesheets: ['/custom.css'] };
      const res = applyPageAssetsToTemplateData({ enabled: false, stylesheets: true, scripts: true }, data);
      expect(res.pageAssets).toBe(false);
      expect(res.pageHead).toBeNull();
      expect(res.data).toBe(data);
    });

    it('auto-discovers and adds route assets when auto is true', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.js': { file: 'dist/pages/checkout.XYZ.js' },
        'pages/checkout.css': { file: 'dist/pages/checkout.XYZ.css' },
      };
      fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });
      const cfg = resolvePageAssets(true); // enabled: true, auto: true

      const res = applyPageAssetsToTemplateData(cfg, { title: 'Checkout' }, { file: 'checkout.njk', routePath: '/checkout' }, manager);

      expect(res.pageAssets).toBe(true);
      expect(res.pageHead.stylesheets).toContain('/dist/pages/checkout.XYZ.css');
      expect(res.pageHead.scripts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ src: '/dist/pages/checkout.XYZ.js', defer: true }),
        ])
      );
    });

    it('does not auto-discover when auto is explicitly false', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.js': { file: 'dist/pages/checkout.XYZ.js' },
      };
      fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });
      const cfg = resolvePageAssets({ enabled: true, auto: false });

      const res = applyPageAssetsToTemplateData(cfg, { title: 'Checkout' }, { file: 'checkout.njk', routePath: '/checkout' }, manager);

      expect(res.pageAssets).toBe(true);
      expect(res.pageHead.scripts).toEqual([]);
    });

    it('deduplicates auto assets if manual load() already included them', () => {
      const distDir = path.join(tempDir, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const manifestContent = {
        'pages/checkout.css': { file: 'dist/pages/checkout.XYZ.css' },
      };
      fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

      const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });
      const cfg = resolvePageAssets(true);

      const res = applyPageAssetsToTemplateData(
        cfg,
        { stylesheets: ['/dist/pages/checkout.XYZ.css'] },
        { file: 'checkout.njk', routePath: '/checkout' },
        manager
      );

      // Should only appear once
      expect(res.pageHead.stylesheets.filter((s) => s === '/dist/pages/checkout.XYZ.css')).toHaveLength(1);
    });
  });

  describe('Full SSR End-to-End Route Matching with createApp({ pageAssets: true })', () => {
    it('automatically injects route-matching CSS and JS into <head> without template edits', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const viewsDir = path.join(tempDir, 'views');
      const publicDir = path.join(tempDir, 'public');
      const srcDir = path.join(tempDir, 'src');

      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(viewsDir, { recursive: true });
      fs.mkdirSync(path.join(publicDir, 'css', 'pages'), { recursive: true });
      fs.mkdirSync(path.join(srcDir, 'client', 'pages'), { recursive: true });

      // Layout with standard pageAssets & pageHead block
      fs.writeFileSync(
        path.join(viewsDir, 'layout.njk'),
        `<!DOCTYPE html>
<html>
<head>
  <title>{{ title }}</title>
  {% if pageAssets and pageHead %}
    {% for item in pageHead.stylesheets %}
      <link rel="stylesheet" href="{{ item }}">
    {% endfor %}
    {% for item in pageHead.scripts %}
      <script src="{{ item.src }}" defer></script>
    {% endfor %}
  {% endif %}
</head>
<body>
  {% block content %}{% endblock %}
</body>
</html>`
      );

      // Page templates
      fs.writeFileSync(
        path.join(pagesDir, 'checkout.njk'),
        `{% extends "layout.njk" %}
{% block content %}
  <div id="checkout-container">Checkout Page Content</div>
{% endblock %}`
      );

      fs.writeFileSync(
        path.join(pagesDir, 'about.njk'),
        `{% extends "layout.njk" %}
{% block content %}
  <div id="about-container">About Page Content</div>
{% endblock %}`
      );

      // Assets on disk:
      // Checkout has both CSS and JS
      fs.writeFileSync(path.join(publicDir, 'css', 'pages', 'checkout.css'), '.checkout { display: block; }');
      fs.writeFileSync(path.join(srcDir, 'client', 'pages', 'checkout.js'), 'console.log("checkout");');
      // About has NO matching assets

      const { app } = createApp({
        pagesDir,
        viewsDir,
        publicDir,
        pageAssets: true,
        logging: false,
      });

      // 1. Visit /checkout -> should have auto-injected link and script
      const resCheckout = await request(app).get('/checkout').expect(200);
      expect(resCheckout.text).toContain('Checkout Page Content');
      expect(resCheckout.text).toContain('<link rel="stylesheet" href="/css/pages/checkout.css">');
      expect(resCheckout.text).toContain('<script src="/js/pages/checkout.js" defer></script>');

      // 2. Visit /about -> should have NO page assets injected
      const resAbout = await request(app).get('/about').expect(200);
      expect(resAbout.text).toContain('About Page Content');
      expect(resAbout.text).not.toContain('/css/pages/about.css');
      expect(resAbout.text).not.toContain('/js/pages/about.js');
    });

    it('falls back to parent asset for dynamic bracketed routes (e.g. products/[id] -> products.js)', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const viewsDir = path.join(tempDir, 'views');
      const publicDir = path.join(tempDir, 'public');
      const srcDir = path.join(tempDir, 'src');

      fs.mkdirSync(path.join(pagesDir, 'products'), { recursive: true });
      fs.mkdirSync(viewsDir, { recursive: true });
      fs.mkdirSync(path.join(srcDir, 'client', 'pages'), { recursive: true });

      fs.writeFileSync(
        path.join(viewsDir, 'layout.njk'),
        `<!DOCTYPE html>
<html>
<head>
  {% if pageAssets and pageHead %}
    {% for item in pageHead.scripts %}
      <script src="{{ item.src }}" defer></script>
    {% endfor %}
  {% endif %}
</head>
<body>{% block content %}{% endblock %}</body>
</html>`
      );

      fs.writeFileSync(
        path.join(pagesDir, 'products', '[id].njk'),
        `{% extends "layout.njk" %}
{% block content %}<h1>Product Details</h1>{% endblock %}`
      );

      // Only parent 'products.js' exists in client pages
      fs.writeFileSync(path.join(srcDir, 'client', 'pages', 'products.js'), 'console.log("products parent script");');

      const { app } = createApp({
        pagesDir,
        viewsDir,
        publicDir,
        pageAssets: true,
        logging: false,
      });

      const res = await request(app).get('/products/99').expect(200);
      expect(res.text).toContain('Product Details');
      // Should automatically pick parent products.js fallback
      expect(res.text).toContain('<script src="/js/pages/products.js" defer></script>');
    });

    it('supports direct {{ fsy.pageAssets() | safe }} call in Nunjucks templates without pageHead block', async () => {
      const pagesDir = path.join(tempDir, 'pages');
      const viewsDir = path.join(tempDir, 'views');
      const publicDir = path.join(tempDir, 'public');
      const srcDir = path.join(tempDir, 'src');

      fs.mkdirSync(pagesDir, { recursive: true });
      fs.mkdirSync(viewsDir, { recursive: true });
      fs.mkdirSync(path.join(publicDir, 'css', 'pages'), { recursive: true });
      fs.mkdirSync(path.join(srcDir, 'client', 'pages'), { recursive: true });

      // Layout using direct {{ fsy.pageAssets() | safe }}
      fs.writeFileSync(
        path.join(viewsDir, 'layout.njk'),
        `<!DOCTYPE html>
<html>
<head>
  {{ fsy.pageAssets() | safe }}
</head>
<body>{% block content %}{% endblock %}</body>
</html>`
      );

      fs.writeFileSync(
        path.join(pagesDir, 'settings.njk'),
        `{% extends "layout.njk" %}
{% block content %}<div>Settings Content</div>{% endblock %}`
      );

      fs.writeFileSync(path.join(publicDir, 'css', 'pages', 'settings.css'), '.settings { color: blue; }');
      fs.writeFileSync(path.join(srcDir, 'client', 'pages', 'settings.js'), 'console.log("settings");');

      const { app } = createApp({
        pagesDir,
        viewsDir,
        publicDir,
        logging: false,
      });

      const res = await request(app).get('/settings').expect(200);
      expect(res.text).toContain('Settings Content');
      expect(res.text).toContain('<link rel="stylesheet" href="/css/pages/settings.css">');
      expect(res.text).toContain('<script src="/js/pages/settings.js" defer></script>');
    });
  });
});
