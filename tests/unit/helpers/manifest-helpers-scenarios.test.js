/**
 * Extended Scenarios for AssetManager & View Helpers
 * (src/helpers.js)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  AssetManager,
  configureAssets,
  createHelpers,
} from '../../../src/helpers.js';

describe.sequential('AssetManager & Helper Scenarios', () => {
  const tempDir = path.join(process.cwd(), 'tmp', 'test-assets-manifest');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    // Write sample Vite and Webpack manifests
    const viteManifest = {
      'src/client/app.js': {
        file: 'assets/app-1a2b3c.js',
        src: 'src/client/app.js',
        isEntry: true,
      },
      'src/client/style.css': {
        file: 'assets/style-4d5e6f.css',
        src: 'src/client/style.css',
      },
      'home.css': {
        file: 'assets/home-7g8h9i.css',
      },
    };
    fs.writeFileSync(path.join(tempDir, 'vite-manifest.json'), JSON.stringify(viteManifest));

    const webpackManifest = {
      'bundle.js': '/static/bundle.hash123.js',
      'styles.css': '/static/styles.hash456.css',
    };
    fs.writeFileSync(path.join(tempDir, 'webpack-manifest.json'), JSON.stringify(webpackManifest));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('AssetManager Manifest Resolution & Fallbacks', () => {
    it('resolves assets from Vite manifest (file property)', () => {
      const manager = new AssetManager({
        manifestPath: path.join(tempDir, 'vite-manifest.json'),
      });

      // Direct match
      expect(manager.resolve('src/client/app.js')).toBe('/assets/app-1a2b3c.js');
      // Basename fallback
      expect(manager.resolve('app.js')).toBe('/assets/app-1a2b3c.js');
      // Trailing slash / query handling
      expect(manager.resolve('/home.css')).toBe('/assets/home-7g8h9i.css');
    });

    it('resolves assets from Webpack manifest (string values)', () => {
      const manager = new AssetManager({
        manifestPath: path.join(tempDir, 'webpack-manifest.json'),
        prefix: 'https://cdn.example.com',
      });

      expect(manager.resolve('bundle.js')).toBe('https://cdn.example.com/static/bundle.hash123.js');
      expect(manager.resolve('/styles.css')).toBe('https://cdn.example.com/static/styles.hash456.css');
    });

    it('applies version query parameter when asset is not in manifest', () => {
      const manager = new AssetManager({
        version: '2.5.0',
        prefix: 'https://cdn.test.io',
      });

      expect(manager.resolve('/images/logo.png')).toBe('https://cdn.test.io/images/logo.png?v=2.5.0');
      // Handles existing query params correctly
      expect(manager.resolve('/images/icon.svg?color=red')).toBe(
        'https://cdn.test.io/images/icon.svg?color=red&v=2.5.0'
      );
    });

    it('handles malformed manifest gracefully without throwing', () => {
      const badPath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(badPath, '{ invalid json');

      const manager = new AssetManager({ manifestPath: badPath });
      expect(manager.manifest).toBeNull();
      // Falls back to direct path
      expect(manager.resolve('main.js')).toBe('/main.js');
    });

    it('builds HTML tags with proper attribute escaping and boolean flags', () => {
      const manager = new AssetManager();
      const cssTag = manager.css('/styles/site.css', { media: 'print' });
      expect(cssTag).toContain('rel="stylesheet"');
      expect(cssTag).toContain('href="/styles/site.css"');
      expect(cssTag).toContain('media="print"');

      const jsTag = manager.js('/scripts/app.js', { defer: true, async: true, 'data-test': '<unsafe>' });
      expect(jsTag).toContain('src="/scripts/app.js"');
      expect(jsTag).toContain('defer');
      expect(jsTag).toContain('async');
      expect(jsTag).toContain('data-test="&lt;unsafe&gt;"');

      const imgTag = manager.img('/logo.png', 'Company "Logo"', { width: 100 });
      expect(imgTag).toContain('src="/logo.png"');
      expect(imgTag).toContain('alt="Company &quot;Logo&quot;"');
      expect(imgTag).toContain('width="100"');
    });
  });

  describe('createHelpers (fsy View Helpers)', () => {
    it('handles old() input helpers with function and flash fallback', () => {
      const reqWithOldFn = {
        old(name, fallback) {
          return name === 'username' ? 'saved_user' : fallback;
        },
      };
      const fsy1 = createHelpers({ req: reqWithOldFn });
      expect(fsy1.old('username')).toBe('saved_user');
      expect(fsy1.old('age', 18)).toBe(18);

      const reqWithFlash = {
        __flash: { old: { email: 'test@example.com' } },
      };
      const fsy2 = createHelpers({ req: reqWithFlash });
      expect(fsy2.old('email')).toBe('test@example.com');
      expect(fsy2.old('missing', 'default')).toBe('default');
      expect(fsy2.old()).toEqual({ email: 'test@example.com' });
    });

    it('handles validation error() and errors() helpers', () => {
      const req = {
        __flash: {
          errors: {
            email: ['Invalid email address', 'Email is already taken'],
            age: 'Age must be positive',
          },
        },
      };

      const fsy = createHelpers({ req });
      expect(fsy.error('email')).toBe('Invalid email address');
      expect(fsy.error('age')).toBe('Age must be positive');
      expect(fsy.error('nonexistent')).toBeNull();

      expect(fsy.errors('email')).toEqual(['Invalid email address', 'Email is already taken']);
      expect(fsy.errors('age')).toEqual(['Age must be positive']);
      expect(fsy.hasError('email')).toBe(true);
      expect(fsy.hasError('unknown')).toBe(false);
    });

    it('handles string formatting: truncate and slugify', () => {
      const fsy = createHelpers({});

      expect(fsy.truncate('The quick brown fox jumps', 10)).toBe('The qui...');
      expect(fsy.truncate('Short', 10)).toBe('Short');
      expect(fsy.truncate('', 10)).toBe('');

      expect(fsy.slugify('Hello World! 2026 @Test')).toBe('hello-world-2026-test');
      expect(fsy.slugify('')).toBe('');
    });

    it('handles number and date formatting helpers', () => {
      const fsy = createHelpers({ locale: 'en' });

      expect(fsy.prettyBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
      expect(fsy.prettyBytes(0)).toBe('0 B');

      expect(fsy.prettyMs(500)).toBe('500ms');
      expect(fsy.prettyMs(3500)).toBe('3.5s');

      const dateStr = '2026-05-15T12:00:00.000Z';
      expect(fsy.dateFormat(dateStr, 'YYYY-MM-DD')).toBe('2026-05-15');
      expect(typeof fsy.dateFromNow(dateStr)).toBe('string');
      expect(typeof fsy.dateAgo(dateStr)).toBe('string');
    });

    it('evaluates isPath pattern matching and regex caching', () => {
      const req = { path: '/admin/users/123/edit' };
      const fsy = createHelpers({ req });

      expect(fsy.isPath('/admin/users/123/edit')).toBe(true);
      expect(fsy.isPath('/admin/users/*')).toBe(true);
      expect(fsy.isPath('/products/*')).toBe(false);
      expect(fsy.isPath('/admin/other')).toBe(false);
    });

    it('handles canonical URL, environment flags, and request helpers', () => {
      const req = {
        originalUrl: '/blog/post-1?tag=web',
        query: { tag: 'web' },
        params: { id: 'post-1' },
        get: (h) => (h === 'User-Agent' ? 'TestBrowser' : null),
      };
      const fsy = createHelpers({ req, baseUrl: 'https://mysite.com/' });

      expect(fsy.canonical()).toBe('https://mysite.com/blog/post-1');
      expect(fsy.q('tag')).toBe('web');
      expect(fsy.q('missing', 'def')).toBe('def');
      expect(fsy.param('id')).toBe('post-1');
      expect(fsy.hdr('User-Agent')).toBe('TestBrowser');
      expect(typeof fsy.isDev()).toBe('boolean');
      expect(typeof fsy.isProd()).toBe('boolean');
    });
  });
});
