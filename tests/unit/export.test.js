'use strict';

/**
 * Unit Tests for Static Site Export & Prerendering Subsystem
 * Tests:
 * 1. discoverExportRoutes (static scanning & dynamic route expansion via generateStaticParams)
 * 2. exportStaticSite (ephemeral rendering, file generation, asset copying, sitemap.xml)
 * 3. Clean URLs vs flat .html output
 * 4. CLI export command registration
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { program } = require('commander');
const {
  exportStaticSite,
  discoverExportRoutes,
  urlToFilePath,
  generateSitemapXml,
  copyDirRecursive,
} = require('../../index');
const { registerCommand: registerExportCommand } = require('../../bin/commands/export');

describe('Static Site Export & Prerendering (core/export)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-export-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('urlToFilePath', () => {
    it('maps root and 404 paths correctly', () => {
      expect(urlToFilePath('/', '/dist', true)).toBe(path.join('/dist', 'index.html'));
      expect(urlToFilePath('/404', '/dist', true)).toBe(path.join('/dist', '404.html'));
      expect(urlToFilePath('/404', '/dist', false)).toBe(path.join('/dist', '404.html'));
    });

    it('handles cleanUrls mode (directory/index.html)', () => {
      expect(urlToFilePath('/about', '/dist', true)).toBe(path.join('/dist', 'about', 'index.html'));
      expect(urlToFilePath('/blog/hello', '/dist', true)).toBe(path.join('/dist', 'blog', 'hello', 'index.html'));
    });

    it('handles non-cleanUrls mode (.html files)', () => {
      expect(urlToFilePath('/about', '/dist', false)).toBe(path.join('/dist', 'about.html'));
      expect(urlToFilePath('/blog/hello', '/dist', false)).toBe(path.join('/dist', 'blog', 'hello.html'));
    });
  });

  describe('generateSitemapXml', () => {
    it('generates standard XML sitemap for rendered routes', () => {
      const xml = generateSitemapXml(['/', '/about', '/blog/post-1', '/404'], 'https://mysite.com');
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<loc>https://mysite.com/</loc>');
      expect(xml).toContain('<loc>https://mysite.com/about</loc>');
      expect(xml).toContain('<loc>https://mysite.com/blog/post-1</loc>');
      // 404 is excluded from sitemap
      expect(xml).not.toContain('/404');
    });
  });

  describe('discoverExportRoutes', () => {
    it('scans static pages and expands dynamic routes with generateStaticParams', async () => {
      const pagesDir = path.join(tmpDir, 'pages');
      fs.mkdirSync(path.join(pagesDir, 'blog'), { recursive: true });

      // Static pages
      fs.writeFileSync(path.join(pagesDir, 'index.njk'), '<h1>Home</h1>');
      fs.writeFileSync(path.join(pagesDir, 'about.njk'), '<h1>About</h1>');
      fs.writeFileSync(path.join(pagesDir, '404.njk'), '<h1>Not Found</h1>');

      // Dynamic page with companion generator
      fs.writeFileSync(path.join(pagesDir, 'blog', '[slug].njk'), '<h1>Post: {{ post.title }}</h1>');
      fs.writeFileSync(
        path.join(pagesDir, 'blog', '[slug].js'),
        `module.exports = {
          async generateStaticParams() {
            return [{ slug: 'alpha' }, { slug: 'beta' }];
          },
          async load({ params }) {
            return { post: { title: params.slug.toUpperCase() } };
          }
        };`
      );

      const routes = await discoverExportRoutes({ pagesDir });
      const paths = routes.map((r) => r.path);

      expect(paths).toContain('/');
      expect(paths).toContain('/about');
      expect(paths).toContain('/404');
      expect(paths).toContain('/blog/alpha');
      expect(paths).toContain('/blog/beta');
      expect(routes.length).toBe(5);
    });
  });

  describe('exportStaticSite full lifecycle', () => {
    it('prerenders pages, copies public assets, and creates sitemap.xml', async () => {
      const pagesDir = path.join(tmpDir, 'pages');
      const publicDir = path.join(tmpDir, 'public');
      const outDir = path.join(tmpDir, 'dist');

      fs.mkdirSync(path.join(pagesDir, 'posts'), { recursive: true });
      fs.mkdirSync(publicDir, { recursive: true });

      // Public assets
      fs.writeFileSync(path.join(publicDir, 'style.css'), 'body { color: blue; }');

      // Templates
      fs.writeFileSync(path.join(pagesDir, 'index.njk'), '<h1>Welcome Home</h1>');
      fs.writeFileSync(path.join(pagesDir, 'about.njk'), '<h1>About Webspresso: {{ info }}</h1>');
      fs.writeFileSync(
        path.join(pagesDir, 'about.js'),
        `module.exports = {
          async load() {
            return { info: 'Fast SSR Framework' };
          }
        };`
      );
      fs.writeFileSync(path.join(pagesDir, '404.njk'), '<h1>Page Not Found</h1>');

      // Dynamic route
      fs.writeFileSync(path.join(pagesDir, 'posts', '[id].njk'), '<article>Post #{{ item.id }}: {{ item.title }}</article>');
      fs.writeFileSync(
        path.join(pagesDir, 'posts', '[id].js'),
        `module.exports = {
          async generateStaticParams() {
            return [{ id: 101 }, { id: 202 }];
          },
          async load({ params }) {
            return { item: { id: params.id, title: 'Item ' + params.id } };
          }
        };`
      );

      const result = await exportStaticSite({
        cwd: tmpDir,
        pagesDir,
        publicDir,
        outDir,
        cleanUrls: true,
        sitemap: true,
        baseUrl: 'https://webspresso.dev',
        silent: true,
      });

      expect(result.rendered).toBe(5);
      expect(result.errors.length).toBe(0);

      // Verify HTML files exist
      const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      expect(homeHtml).toContain('<h1>Welcome Home</h1>');

      const aboutHtml = fs.readFileSync(path.join(outDir, 'about', 'index.html'), 'utf8');
      expect(aboutHtml).toContain('<h1>About Webspresso: Fast SSR Framework</h1>');

      const p101Html = fs.readFileSync(path.join(outDir, 'posts', '101', 'index.html'), 'utf8');
      expect(p101Html).toContain('Post #101: Item 101');

      const p202Html = fs.readFileSync(path.join(outDir, 'posts', '202', 'index.html'), 'utf8');
      expect(p202Html).toContain('Post #202: Item 202');

      const notFoundHtml = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
      expect(notFoundHtml).toContain('<h1>Page Not Found</h1>');

      // Verify asset was copied
      expect(fs.existsSync(path.join(outDir, 'style.css'))).toBe(true);
      expect(fs.readFileSync(path.join(outDir, 'style.css'), 'utf8')).toContain('color: blue');

      // Verify sitemap.xml was generated
      expect(fs.existsSync(path.join(outDir, 'sitemap.xml'))).toBe(true);
      const sitemapContent = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
      expect(sitemapContent).toContain('https://webspresso.dev/about');
      expect(sitemapContent).toContain('https://webspresso.dev/posts/101');
    });

    it('supports flat .html files when cleanUrls is false', async () => {
      const pagesDir = path.join(tmpDir, 'pages');
      const outDir = path.join(tmpDir, 'dist-flat');
      fs.mkdirSync(pagesDir, { recursive: true });

      fs.writeFileSync(path.join(pagesDir, 'index.njk'), '<h1>Home</h1>');
      fs.writeFileSync(path.join(pagesDir, 'contact.njk'), '<h1>Contact Us</h1>');

      const result = await exportStaticSite({
        cwd: tmpDir,
        pagesDir,
        outDir,
        cleanUrls: false,
        copyAssets: false,
        silent: true,
      });

      expect(result.rendered).toBe(2);
      expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'contact.html'))).toBe(true);
      expect(fs.readFileSync(path.join(outDir, 'contact.html'), 'utf8')).toContain('<h1>Contact Us</h1>');
    });
  });

  describe('CLI export command registration', () => {
    it('registers export command with options on commander instance', () => {
      const testProg = new program.Command();
      registerExportCommand(testProg);

      const exportCmd = testProg.commands.find((c) => c.name() === 'export');
      expect(exportCmd).toBeDefined();
      expect(exportCmd.description()).toContain('Export and prerender');

      const optionFlags = exportCmd.options.map((o) => o.flags);
      expect(optionFlags.some((f) => f.includes('--out'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--base-url'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--clean'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--no-assets'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--no-clean-urls'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--sitemap'))).toBe(true);
    });
  });
});
