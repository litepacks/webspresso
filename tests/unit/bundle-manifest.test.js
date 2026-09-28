/**
 * Unit tests for esbuild metafile manifest generation & AssetManager integration
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Command } = require('commander');
const {
  generateManifest,
  createManifestPlugin,
  buildBundle,
} = require('../../src/bundle');
const { AssetManager } = require('../../src/helpers');
const { registerCommand: registerBuild } = require('../../bin/commands/build');

class ProcessExitError extends Error {
  constructor(code) {
    super(`Process exited with code ${code}`);
    this.exitCode = code;
  }
}

async function runCli(registerFn, args, options = {}) {
  const origCwd = process.cwd();
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origExit = process.exit;

  let stdout = '';
  let stderr = '';

  console.log = (...msgs) => {
    stdout += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };
  console.error = (...msgs) => {
    stderr += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };
  console.warn = (...msgs) => {
    stdout += msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ') + '\n';
  };

  process.exit = (code = 0) => {
    throw new ProcessExitError(code);
  };

  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => { stdout += str; },
    writeErr: (str) => { stderr += str; },
  });

  registerFn(program);

  let exitCode = 0;
  try {
    if (options.cwd) {
      process.chdir(options.cwd);
    }
    const argList = Array.isArray(args) ? args : args.split(' ').filter(Boolean);
    await program.parseAsync(['node', 'webspresso', ...argList]);
  } catch (err) {
    if (err instanceof ProcessExitError) {
      exitCode = err.exitCode;
    } else if (err && err.exitCode !== undefined) {
      exitCode = err.exitCode;
    } else {
      exitCode = 1;
      stderr += (err?.message || String(err)) + '\n';
    }
  } finally {
    process.chdir(origCwd);
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exit = origExit;
  }

  return {
    stdout: `${stdout}${stderr}`,
    stderr,
    exitCode,
  };
}

describe('esbuild Metafile Manifest & AssetManager Integration', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-manifest-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('generateManifest extracts entrypoints, outputs, and creates multi-key mappings', () => {
    const sampleMetafile = {
      inputs: {
        'src/client/main.js': { bytes: 200 },
        'src/client/style.css': { bytes: 150 },
      },
      outputs: {
        'public/dist/main.8F9B2C.js': {
          entryPoint: 'src/client/main.js',
          bytes: 420,
        },
        'public/dist/main.8F9B2C.js.map': {
          bytes: 800,
        },
        'public/dist/style.A1B2C3.css': {
          entryPoint: 'src/client/style.css',
          bytes: 310,
        },
      },
    };

    const manifest = generateManifest(sampleMetafile, {
      publicDir: 'public',
      outdir: 'public/dist',
    });

    // 1. Should ignore .map files
    expect(manifest['main.8F9B2C.js.map']).toBeUndefined();

    // 2. Maps main.js entry across formats
    expect(manifest['src/client/main.js']).toBeDefined();
    expect(manifest['src/client/main.js'].file).toBe('dist/main.8F9B2C.js');
    expect(manifest['main.js'].file).toBe('dist/main.8F9B2C.js');
    expect(manifest['js/main.js'].file).toBe('dist/main.8F9B2C.js');

    // 3. Maps CSS entry across formats
    expect(manifest['src/client/style.css'].file).toBe('dist/style.A1B2C3.css');
    expect(manifest['style.css'].file).toBe('dist/style.A1B2C3.css');
    expect(manifest['css/style.css'].file).toBe('dist/style.A1B2C3.css');
  });

  it('AssetManager auto-detects and resolves hashed manifest files without configuration', () => {
    const distDir = path.join(tempDir, 'public', 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const manifestContent = {
      'src/client/main.js': {
        file: 'dist/main.hash123.js',
        src: 'src/client/main.js',
      },
      'main.js': {
        file: 'dist/main.hash123.js',
        src: 'src/client/main.js',
      },
      'css/style.css': {
        file: 'dist/style.hash456.css',
        src: 'src/client/style.css',
      },
    };

    fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestContent));

    // Notice: NO manifestPath passed! AssetManager auto-detects public/dist/manifest.json
    const manager = new AssetManager({ publicDir: path.join(tempDir, 'public') });

    expect(manager.manifest).toBeDefined();
    expect(manager.asset('main.js')).toBe('/dist/main.hash123.js');
    expect(manager.asset('/main.js')).toBe('/dist/main.hash123.js');
    expect(manager.asset('src/client/main.js')).toBe('/dist/main.hash123.js');
    expect(manager.css('css/style.css')).toContain('href="/dist/style.hash456.css"');
    expect(manager.js('main.js')).toContain('src="/dist/main.hash123.js"');
  });

  it('buildBundle creates hashed assets and writes manifest.json', async () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'main.js'), 'console.log("built app");');

    const outdir = path.join(tempDir, 'public', 'dist');

    const mockEsbuild = {
      build: async (config) => {
        // simulate plugin onEnd
        for (const p of config.plugins || []) {
          if (p.name === 'webspresso-manifest') {
            p.setup({
              onEnd: (cb) => {
                cb({
                  errors: [],
                  metafile: {
                    outputs: {
                      [path.join(outdir, 'main.HASH777.js')]: {
                        entryPoint: path.join(clientDir, 'main.js'),
                        bytes: 120,
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
              [path.join(outdir, 'main.HASH777.js')]: {
                entryPoint: path.join(clientDir, 'main.js'),
                bytes: 120,
              },
            },
          },
        };
      },
    };

    const buildResult = await buildBundle({
      cwd: tempDir,
      esbuild: mockEsbuild,
      entryPoints: [path.join(clientDir, 'main.js')],
      outdir,
      logger: null,
    });

    expect(buildResult.manifest).toBeDefined();
    expect(fs.existsSync(path.join(outdir, 'manifest.json'))).toBe(true);

    const writtenManifest = JSON.parse(fs.readFileSync(path.join(outdir, 'manifest.json'), 'utf8'));
    expect(writtenManifest['main.js']).toBeDefined();
  });

  it('webspresso build CLI command runs without errors', async () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'build-test-project',
      scripts: {
        'build:css': 'echo "CSS built"',
      },
    }, null, 2));

    const result = await runCli(registerBuild, 'build', { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Building Webspresso production assets');
    expect(result.stdout).toContain('Asset build complete');
  });
});
