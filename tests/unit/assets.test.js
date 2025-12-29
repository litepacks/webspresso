/**
 * Asset Manager Tests
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { AssetManager, configureAssets, getAssetManager, createHelpers } = require('../../src/helpers');

describe('AssetManager', () => {
  describe('basic asset resolution', () => {
    it('should resolve asset path with leading slash', () => {
      const manager = new AssetManager();
      expect(manager.asset('/css/style.css')).toBe('/css/style.css');
    });

    it('should add leading slash if missing', () => {
      const manager = new AssetManager();
      expect(manager.asset('css/style.css')).toBe('/css/style.css');
    });

    it('should add prefix to asset path', () => {
      const manager = new AssetManager({ prefix: '/assets' });
      expect(manager.asset('/css/style.css')).toBe('/assets/css/style.css');
    });
  });

  describe('versioning', () => {
    it('should add version query string', () => {
      const manager = new AssetManager({ version: '1.2.3' });
      expect(manager.asset('/css/style.css')).toBe('/css/style.css?v=1.2.3');
    });

    it('should append version to existing query string', () => {
      const manager = new AssetManager({ version: 'abc123' });
      expect(manager.asset('/js/app.js?t=1234')).toBe('/js/app.js?t=1234&v=abc123');
    });
  });

  describe('manifest support', () => {
    let tempDir;
    let manifestPath;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should resolve from Vite manifest', () => {
      // Vite-style manifest
      const manifest = {
        'css/style.css': {
          file: 'assets/style-abc123.css',
          src: 'css/style.css'
        },
        'js/app.js': {
          file: 'assets/app-xyz789.js',
          src: 'js/app.js'
        }
      };
      
      manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      
      const manager = new AssetManager({ manifestPath });
      expect(manager.asset('/css/style.css')).toBe('/assets/style-abc123.css');
      expect(manager.asset('js/app.js')).toBe('/assets/app-xyz789.js');
    });

    it('should resolve from Webpack manifest (string values)', () => {
      const manifest = {
        '/css/style.css': '/dist/style.abc123.css',
        '/js/app.js': '/dist/app.xyz789.js'
      };
      
      manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      
      const manager = new AssetManager({ manifestPath });
      expect(manager.asset('/css/style.css')).toBe('/dist/style.abc123.css');
    });

    it('should fallback to original path if not in manifest', () => {
      const manifest = {
        'css/style.css': { file: 'assets/style-abc123.css' }
      };
      
      manifestPath = path.join(tempDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      
      const manager = new AssetManager({ manifestPath });
      expect(manager.asset('/js/unknown.js')).toBe('/js/unknown.js');
    });

    it('should handle missing manifest file gracefully', () => {
      const manager = new AssetManager({ 
        manifestPath: path.join(tempDir, 'nonexistent.json') 
      });
      expect(manager.asset('/css/style.css')).toBe('/css/style.css');
    });
  });

  describe('HTML tag generation', () => {
    let manager;

    beforeEach(() => {
      manager = new AssetManager();
    });

    describe('css()', () => {
      it('should generate link tag', () => {
        const tag = manager.css('/css/style.css');
        expect(tag).toBe('<link rel="stylesheet" href="/css/style.css">');
      });

      it('should include additional attributes', () => {
        const tag = manager.css('/css/style.css', { media: 'print', id: 'print-styles' });
        expect(tag).toContain('media="print"');
        expect(tag).toContain('id="print-styles"');
      });

      it('should handle integrity attribute', () => {
        const tag = manager.css('/css/style.css', { 
          integrity: 'sha384-abc123',
          crossorigin: 'anonymous'
        });
        expect(tag).toContain('integrity="sha384-abc123"');
        expect(tag).toContain('crossorigin="anonymous"');
      });
    });

    describe('js()', () => {
      it('should generate script tag', () => {
        const tag = manager.js('/js/app.js');
        expect(tag).toBe('<script src="/js/app.js"></script>');
      });

      it('should include async attribute', () => {
        const tag = manager.js('/js/app.js', { async: true });
        expect(tag).toContain('async');
        expect(tag).not.toContain('async="');
      });

      it('should include defer attribute', () => {
        const tag = manager.js('/js/app.js', { defer: true });
        expect(tag).toContain('defer');
      });

      it('should include type module', () => {
        const tag = manager.js('/js/app.js', { type: 'module' });
        expect(tag).toContain('type="module"');
      });
    });

    describe('img()', () => {
      it('should generate img tag with alt', () => {
        const tag = manager.img('/images/logo.png', 'Logo');
        expect(tag).toBe('<img src="/images/logo.png" alt="Logo">');
      });

      it('should handle empty alt', () => {
        const tag = manager.img('/images/decorative.png');
        expect(tag).toContain('alt=""');
      });

      it('should include additional attributes', () => {
        const tag = manager.img('/images/hero.jpg', 'Hero image', {
          class: 'hero-image',
          width: 1200,
          height: 600,
          loading: 'lazy'
        });
        expect(tag).toContain('class="hero-image"');
        expect(tag).toContain('width="1200"');
        expect(tag).toContain('height="600"');
        expect(tag).toContain('loading="lazy"');
      });
    });
  });

  describe('HTML escaping', () => {
    it('should escape special characters in attributes', () => {
      const manager = new AssetManager();
      const tag = manager.img('/img.png', 'Test "image" & <stuff>');
      expect(tag).toContain('alt="Test &quot;image&quot; &amp; &lt;stuff&gt;"');
    });
  });
});

describe('Global Asset Manager', () => {
  it('should configure and retrieve global manager', () => {
    configureAssets({ version: 'test123' });
    const manager = getAssetManager();
    expect(manager.asset('/css/style.css')).toBe('/css/style.css?v=test123');
  });
});

describe('fsy asset helpers', () => {
  let helpers;

  beforeEach(() => {
    // Reset global asset manager
    configureAssets({ version: null, prefix: '' });
    
    const mockReq = { path: '/', protocol: 'http', get: () => 'localhost' };
    const mockRes = {};
    helpers = createHelpers({ req: mockReq, res: mockRes });
  });

  it('should have asset() method', () => {
    expect(helpers.asset('/css/style.css')).toBe('/css/style.css');
  });

  it('should have css() method', () => {
    expect(helpers.css('/css/style.css')).toContain('<link');
    expect(helpers.css('/css/style.css')).toContain('href="/css/style.css"');
  });

  it('should have js() method', () => {
    expect(helpers.js('/js/app.js')).toContain('<script');
    expect(helpers.js('/js/app.js')).toContain('src="/js/app.js"');
  });

  it('should have img() method', () => {
    expect(helpers.img('/img/logo.png', 'Logo')).toContain('<img');
    expect(helpers.img('/img/logo.png', 'Logo')).toContain('alt="Logo"');
  });
});

