const {
  createTempDir,
  cleanupDir
} = require('../utils');
/**
 * Unit tests for Page-Specific Client Entrypoints & esbuild Multi-Bundle Support
 * Tests:
 * 1. findPageEntryPoints auto-discovers src/client/pages/ (.js, .ts, etc.) and src/pages/*.client.js
 * 2. findDefaultEntryPoints returns backward-compatible array when only main.js exists,
 *    and multi-entry dictionary when page entrypoints are present
 * 3. expandGlob & resolveEntryPoints expand wildcards (* and **) cleanly without external packages
 * 4. esbuild createDevBundler & buildBundle multi-entry compilation with outbase and [dir]/[name].[hash]
 * 5. generateManifest registers client-relative, js-prefixed, and extensionless page entry mappings
 * 6. AssetManager & fsy helpers: pageJs, pageJsUrl, pageCss, and pageCssUrl in dev and prod
 */

const fs = require('fs');
const path = require('path');
const {
  findPageEntryPoints,
  findDefaultEntryPoints,
  scanClientPages,
  expandGlob,
  resolveEntryPoints,
  createDevBundler,
  buildBundle,
  generateManifest,
} = require('../../src/bundle');
const { AssetManager, createHelpers, utils } = require('../../src/helpers');

describe('Page-Specific Client Entrypoints (Multi-Bundle esbuild)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-page-entries');
  });

  afterEach(() => {
    try {
      cleanupDir(tempDir);
    } catch (_) {}
  });

  it('findDefaultEntryPoints returns single-item array when only main.js exists (backward compatibility)', () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'main.js'), '// main client');

    const entries = findDefaultEntryPoints(tempDir);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(1);
    expect(entries[0]).toBe(path.join(clientDir, 'main.js'));
  });

  it('auto-discovers page entrypoints in src/client/pages/ including nested subdirectories', () => {
    const clientPagesDir = path.join(tempDir, 'src', 'client', 'pages');
    const adminPagesDir = path.join(clientPagesDir, 'admin');
    fs.mkdirSync(adminPagesDir, { recursive: true });

    fs.writeFileSync(path.join(clientPagesDir, 'home.js'), '// home page client');
    fs.writeFileSync(path.join(clientPagesDir, 'checkout.ts'), '// checkout page client');
    fs.writeFileSync(path.join(adminPagesDir, 'dashboard.js'), '// admin dashboard');
    // Files to ignore
    fs.writeFileSync(path.join(clientPagesDir, 'home.test.js'), '// test file');
    fs.writeFileSync(path.join(clientPagesDir, 'types.d.ts'), '// type definition');

    const pageEntries = findPageEntryPoints(tempDir);
    expect(pageEntries['pages/home']).toBe(path.join(clientPagesDir, 'home.js'));
    expect(pageEntries['pages/checkout']).toBe(path.join(clientPagesDir, 'checkout.ts'));
    expect(pageEntries['pages/admin/dashboard']).toBe(path.join(adminPagesDir, 'dashboard.js'));
    expect(pageEntries['pages/home.test']).toBeUndefined();
    expect(pageEntries['pages/types']).toBeUndefined();
  });

  it('discovers *.client.js files inside src/pages/', () => {
    const srcPagesDir = path.join(tempDir, 'src', 'pages');
    fs.mkdirSync(srcPagesDir, { recursive: true });

    fs.writeFileSync(path.join(srcPagesDir, 'contact.client.js'), '// contact client');
    fs.writeFileSync(path.join(srcPagesDir, 'contact.njk'), '<h1>Contact</h1>');

    const pageEntries = findPageEntryPoints(tempDir);
    expect(pageEntries['pages/contact']).toBe(path.join(srcPagesDir, 'contact.client.js'));
  });

  it('combines main entry and page entrypoints into entry map when both exist', () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    const pagesDir = path.join(clientDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, 'main.js'), '// main');
    fs.writeFileSync(path.join(pagesDir, 'product.js'), '// product page');

    const entries = findDefaultEntryPoints(tempDir);
    expect(typeof entries).toBe('object');
    expect(Array.isArray(entries)).toBe(false);
    expect(entries['main']).toBe(path.join(clientDir, 'main.js'));
    expect(entries['pages/product']).toBe(path.join(pagesDir, 'product.js'));
  });

  it('expandGlob resolves * and ** patterns without external dependencies', () => {
    const clientDir = path.join(tempDir, 'src', 'client', 'pages');
    const subDir = path.join(clientDir, 'blog');
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, 'a.js'), '');
    fs.writeFileSync(path.join(clientDir, 'b.js'), '');
    fs.writeFileSync(path.join(subDir, 'c.js'), '');

    // 1. Single directory wildcard
    const singleLevel = expandGlob('src/client/pages/*.js', tempDir);
    expect(singleLevel.length).toBe(2);
    expect(singleLevel).toContain(path.join(clientDir, 'a.js'));
    expect(singleLevel).toContain(path.join(clientDir, 'b.js'));

    // 2. Recursive wildcard
    const recursive = expandGlob('src/client/pages/**/*.js', tempDir);
    expect(recursive.length).toBe(3);
    expect(recursive).toContain(path.join(subDir, 'c.js'));
  });

  it('resolveEntryPoints supports glob strings in array', () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    const pagesDir = path.join(clientDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, 'main.js'), '');
    fs.writeFileSync(path.join(pagesDir, 'home.js'), '');

    const resolved = resolveEntryPoints(['src/client/main.js', 'src/client/pages/*.js'], tempDir);
    expect(Array.isArray(resolved)).toBe(true);
    expect(resolved).toContain('src/client/main.js');
    expect(resolved).toContain(path.join(pagesDir, 'home.js'));
  });

  it('createDevBundler configures outbase when src/client directory exists', async () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    const pagesDir = path.join(clientDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'main.js'), '');
    fs.writeFileSync(path.join(pagesDir, 'home.js'), '');

    let passedConfig = null;
    const mockEsbuild = {
      context: async (config) => {
        passedConfig = config;
        return {
          watch: async () => {},
          dispose: async () => {},
        };
      },
    };

    const bundler = createDevBundler({
      cwd: tempDir,
      esbuild: mockEsbuild,
    });

    await bundler.startWatch();
    expect(passedConfig).toBeDefined();
    expect(passedConfig.outbase).toBe(clientDir);
    expect(passedConfig.entryPoints['pages/home']).toBe(path.join(pagesDir, 'home.js'));

    await bundler.dispose();
  });

  it('generateManifest creates comprehensive mappings for page entrypoints', () => {
    const sampleMetafile = {
      inputs: {
        'src/client/main.js': { bytes: 200 },
        'src/client/pages/checkout.js': { bytes: 350 },
      },
      outputs: {
        'public/dist/main.ABC123.js': {
          entryPoint: 'src/client/main.js',
          bytes: 400,
        },
        'public/dist/pages/checkout.XYZ789.js': {
          entryPoint: 'src/client/pages/checkout.js',
          bytes: 650,
        },
      },
    };

    const manifest = generateManifest(sampleMetafile, {
      publicDir: 'public',
      outdir: 'public/dist',
    });

    // Check main entry mappings
    expect(manifest['main.js'].file).toBe('dist/main.ABC123.js');
    expect(manifest['js/main.js'].file).toBe('dist/main.ABC123.js');

    // Check page entry mappings across formats
    expect(manifest['src/client/pages/checkout.js'].file).toBe('dist/pages/checkout.XYZ789.js');
    expect(manifest['pages/checkout.js'].file).toBe('dist/pages/checkout.XYZ789.js');
    expect(manifest['js/pages/checkout.js'].file).toBe('dist/pages/checkout.XYZ789.js');
    expect(manifest['pages/checkout'].file).toBe('dist/pages/checkout.XYZ789.js');
    expect(manifest['checkout.js'].file).toBe('dist/pages/checkout.XYZ789.js');
  });

  it('AssetManager and fsy.pageJs / fsy.pageCss helpers resolve properly in dev mode', () => {
    const manager = new AssetManager({ publicDir: tempDir });
    const fsy = createHelpers({ req: { path: '/' } });

    // 1. pageJs URL resolution
    expect(manager.pageJsUrl('checkout')).toBe('/js/pages/checkout.js');
    expect(manager.pageJsUrl('pages/checkout.js')).toBe('/js/pages/checkout.js');
    expect(manager.pageJsUrl('admin/dashboard')).toBe('/js/pages/admin/dashboard.js');

    // 2. pageJs script tag generation with defer
    const scriptTag = fsy.pageJs('checkout');
    expect(scriptTag).toContain('src="/js/pages/checkout.js"');
    expect(scriptTag).toContain('defer');

    // Extra attributes
    const moduleTag = fsy.pageJs('checkout', { type: 'module' });
    expect(moduleTag).toContain('type="module"');

    // 3. pageCss URL and link tag generation
    expect(manager.pageCssUrl('checkout')).toBe('/css/pages/checkout.css');
    const linkTag = fsy.pageCss('checkout');
    expect(linkTag).toContain('href="/css/pages/checkout.css"');
    expect(linkTag).toContain('rel="stylesheet"');

    // 4. utils helpers parity
    expect(utils.pageJsUrl('checkout')).toBe('/js/pages/checkout.js');
    expect(utils.pageCssUrl('checkout')).toBe('/css/pages/checkout.css');
  });

  it('AssetManager and fsy.pageJs resolve hashed production filenames via manifest', () => {
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const manifestContent = {
      'pages/checkout.js': {
        file: 'dist/pages/checkout.prod999.js',
        src: 'src/client/pages/checkout.js',
      },
      'pages/checkout.css': {
        file: 'dist/pages/checkout.prod888.css',
        src: 'src/client/pages/checkout.css',
      },
    };
    fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

    const manager = new AssetManager({ manifestPath: path.join(distDir, 'manifest.json') });

    expect(manager.pageJsUrl('checkout')).toBe('/dist/pages/checkout.prod999.js');
    expect(manager.pageJs('checkout')).toContain('src="/dist/pages/checkout.prod999.js"');

    expect(manager.pageCssUrl('checkout')).toBe('/dist/pages/checkout.prod888.css');
    expect(manager.pageCss('checkout')).toContain('href="/dist/pages/checkout.prod888.css"');
  });

  it('buildBundle builds multiple page entrypoints and preserves subdirectories in manifest', async () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    const pagesDir = path.join(clientDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'main.js'), 'console.log("main");');
    fs.writeFileSync(path.join(pagesDir, 'home.js'), 'console.log("home");');

    const outdir = path.join(tempDir, 'public', 'dist');

    let buildPassedConfig = null;
    const mockEsbuild = {
      build: async (config) => {
        buildPassedConfig = config;
        for (const p of config.plugins || []) {
          if (p.name === 'webspresso-manifest') {
            p.setup({
              onEnd: (cb) => {
                cb({
                  errors: [],
                  metafile: {
                    outputs: {
                      [path.join(outdir, 'main.M123.js')]: {
                        entryPoint: path.join(clientDir, 'main.js'),
                        bytes: 100,
                      },
                      [path.join(outdir, 'pages/home.H456.js')]: {
                        entryPoint: path.join(pagesDir, 'home.js'),
                        bytes: 150,
                      },
                    },
                  },
                });
              },
            });
          }
        }

        return {
          metafile: {
            outputs: {
              [path.join(outdir, 'main.M123.js')]: {
                entryPoint: path.join(clientDir, 'main.js'),
                bytes: 100,
              },
              [path.join(outdir, 'pages/home.H456.js')]: {
                entryPoint: path.join(pagesDir, 'home.js'),
                bytes: 150,
              },
            },
          },
        };
      },
    };

    const buildResult = await buildBundle({
      cwd: tempDir,
      esbuild: mockEsbuild,
      outdir,
      logger: null,
    });

    expect(buildPassedConfig).toBeDefined();
    expect(buildPassedConfig.entryNames).toBe('[dir]/[name].[hash]');
    expect(buildPassedConfig.outbase).toBe(clientDir);
    expect(buildResult.manifest['pages/home.js']).toBeDefined();
    expect(buildResult.manifest['pages/home.js'].file).toContain('pages/home.H456.js');
  });
});
