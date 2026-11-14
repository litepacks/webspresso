'use strict';

/**
 * Webspresso - Src Bundle Stress Lab
 * Stress-tests 250-entry manifest generation, multi-directory client/plugin discovery,
 * server-import boundary enforcement, glob expansion, and full production buildBundle().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildBundle,
  generateManifest,
  createManifestPlugin,
  findPageEntryPoints,
  discoverClientControllers,
  checkServerImportViolation,
  validateClientBundleBoundaries,
  expandGlob,
} = require('../../src/bundle');

function makeTempDir(prefix = 'webspresso-bundle-stress-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Src Bundle Stress Lab (Manifest, Discovery, Server Boundaries, Production Build)', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('1. generates deterministic manifest aliases across 250 mixed JS, CSS, chunk, and .map outputs', () => {
    const outputs = {};
    for (let i = 0; i < 100; i++) {
      outputs[`public/dist/pages/p${i}-HASH${i}.js`] = {
        entryPoint: `src/client/pages/p${i}.js`,
        bytes: 1000 + i,
      };
      outputs[`public/dist/pages/p${i}-HASH${i}.js.map`] = { bytes: 500 };
    }
    for (let i = 0; i < 30; i++) {
      outputs[`public/dist/styles/s${i}-CSS${i}.css`] = {
        entryPoint: `src/client/styles/s${i}.css`,
        bytes: 400 + i,
      };
    }
    for (let i = 0; i < 20; i++) {
      outputs[`public/dist/chunk-${i}.js`] = { bytes: 2048 + i };
    }

    const manifest = generateManifest({ outputs }, { publicDir: 'public' });

    // .map files must never appear in manifest
    for (const key of Object.keys(manifest)) {
      expect(key.endsWith('.map')).toBe(false);
      expect(manifest[key].file.endsWith('.map')).toBe(false);
    }

    // Spot-check all alias resolutions
    expect(manifest['src/client/pages/p42.js'].file).toBe('dist/pages/p42-HASH42.js');
    expect(manifest['pages/p42.js'].file).toBe('dist/pages/p42-HASH42.js');
    expect(manifest['js/pages/p42.js'].file).toBe('dist/pages/p42-HASH42.js');
    expect(manifest['pages/p42'].file).toBe('dist/pages/p42-HASH42.js');
    expect(manifest['css/styles/s10.css'].file).toBe('dist/styles/s10-CSS10.css');
    expect(manifest['chunk-5.js'].file).toBe('dist/chunk-5.js');
  });

  it('2. discovers 25 client pages/controllers/plugins while excluding .service.js and catching server boundary leaks', () => {
    const cwd = makeTempDir();
    tempDirs.push(cwd);

    // 15 page client entrypoints
    for (let i = 0; i < 15; i++) {
      const dir = path.join(cwd, 'pages', `group-${i % 3}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `view-${i}.client.js`), `export const v = ${i};`);
    }

    // Client service file must be excluded from page entries
    fs.writeFileSync(path.join(cwd, 'pages', 'billing.service.js'), `export const svc = true;`);

    // 10 controllers across root controllers/ and plugins/*/controllers/
    fs.mkdirSync(path.join(cwd, 'controllers'), { recursive: true });
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(cwd, 'controllers', `c${i}.client.js`), `export default {};`);
    }
    for (let i = 0; i < 5; i++) {
      const pDir = path.join(cwd, 'plugins', `plug-${i}`, 'controllers');
      fs.mkdirSync(pDir, { recursive: true });
      fs.writeFileSync(path.join(pDir, `p${i}.client.js`), `export default {};`);
    }

    const pageEntries = findPageEntryPoints(cwd);
    expect(Object.keys(pageEntries)).toHaveLength(15);
    expect(Object.keys(pageEntries).some((k) => k.includes('billing.service'))).toBe(false);

    const discovered = discoverClientControllers(cwd);
    expect(discovered.length).toBeGreaterThanOrEqual(10);

    // Safe relative imports pass validation
    const safeEntry = path.join(cwd, 'pages', 'group-0', 'view-0.client.js');
    expect(() => validateClientBundleBoundaries([safeEntry], cwd)).not.toThrow();

    // Server-only imports are caught
    expect(checkServerImportViolation('fs', safeEntry, cwd)).toBeTruthy();
    expect(checkServerImportViolation('webspresso/core/orm', safeEntry, cwd)).toBeTruthy();
    expect(checkServerImportViolation('knex', safeEntry, cwd)).toBeTruthy();

    const unsafeEntry = path.join(cwd, 'pages', 'group-0', 'unsafe.client.js');
    fs.writeFileSync(unsafeEntry, `import { createDatabase } from 'webspresso/core/orm';\nconsole.log(createDatabase);`);
    expect(() => validateClientBundleBoundaries([unsafeEntry], cwd)).toThrow(/server/i);
  });

  it('3. expands nested globs and writes manifest.json cleanly via createManifestPlugin()', () => {
    const cwd = makeTempDir('webspresso-glob-stress-');
    tempDirs.push(cwd);

    for (let d = 0; d < 6; d++) {
      const sub = path.join(cwd, 'src', 'client', `mod-${d}`);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'index.js'), `export const m = ${d};`);
    }

    const matches = expandGlob('src/client/**/*.js', cwd);
    expect(matches).toHaveLength(6);

    const manifestOut = path.join(cwd, 'nested', 'dist', 'manifest.json');
    let onEndCb = null;
    const plugin = createManifestPlugin({
      manifestPath: manifestOut,
      outdir: path.join(cwd, 'nested', 'dist'),
      publicDir: path.join(cwd, 'nested'),
      logger: { log: () => {} },
    });

    plugin.setup({
      onEnd(cb) {
        onEndCb = cb;
      },
    });

    onEndCb({
      errors: [],
      metafile: {
        outputs: {
          [path.join(cwd, 'nested', 'dist', 'app-123.js')]: {
            entryPoint: 'src/client/mod-0/index.js',
            bytes: 321,
          },
        },
      },
    });

    expect(fs.existsSync(manifestOut)).toBe(true);
    const written = JSON.parse(fs.readFileSync(manifestOut, 'utf8'));
    expect(written['src/client/mod-0/index.js'].file).toBe('dist/app-123.js');
  });

  it('4. executes full buildBundle() across multiple client entrypoints and produces hashed chunks + manifest.json', async () => {
    const cwd = makeTempDir('webspresso-build-stress-');
    tempDirs.push(cwd);

    fs.mkdirSync(path.join(cwd, 'src', 'client', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'pages', 'shop'), { recursive: true });

    fs.writeFileSync(
      path.join(cwd, 'src', 'client', 'shared', 'math.js'),
      `export function double(x) { return x * 2; }\n`
    );
    fs.writeFileSync(
      path.join(cwd, 'pages', 'shop', 'cart.client.js'),
      `import { double } from '../../src/client/shared/math.js';\nwindow.__cart = double(21);\n`
    );
    fs.writeFileSync(
      path.join(cwd, 'pages', 'shop', 'checkout.client.js'),
      `import { double } from '../../src/client/shared/math.js';\nwindow.__checkout = double(10);\n`
    );

    const outdir = path.join(cwd, 'public', 'dist');
    const manifestOutPath = path.join(outdir, 'manifest.json');
    const result = await buildBundle({
      cwd,
      entryPoints: [
        path.join(cwd, 'pages', 'shop', 'cart.client.js'),
        path.join(cwd, 'pages', 'shop', 'checkout.client.js'),
      ],
      outdir,
      publicDir: path.join(cwd, 'public'),
      manifestPath: manifestOutPath,
      splitting: true,
      hash: true,
      silent: true,
    });

    expect(result).toBeDefined();
    expect(fs.existsSync(manifestOutPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestOutPath, 'utf8'));
    const cartRecord = manifest['pages/shop/cart.client.js'] || manifest['cart.client.js'];
    const checkoutRecord = manifest['pages/shop/checkout.client.js'] || manifest['checkout.client.js'];
    expect(cartRecord).toBeDefined();
    expect(checkoutRecord).toBeDefined();
    expect(fs.existsSync(path.join(cwd, 'public', cartRecord.file))).toBe(true);
  });
});
