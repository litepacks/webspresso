const {
  createTempDir,
  cleanupDir
} = require('../utils');
/**
 * Unit & Integration tests for Dev Bundler (esbuild context() API & client bundling)
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { createDevBundler, findDefaultEntryPoints } = require('../../src/bundle');
const { createApp } = require('../../index');
const { registerCommand: registerAddEsbuild } = require('../../bin/commands/add-esbuild');

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

describe('Dev Bundler (esbuild context() API)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-bundler-test');
  });

  afterEach(() => {
    try {
      cleanupDir(tempDir);
    } catch (_) {}
  });

  it('reports isAvailable() false and throws informative error when esbuild is not found', async () => {
    const bundler = createDevBundler({
      cwd: tempDir,
      esbuild: null,
      entryPoints: ['src/client/main.js'],
    });

    expect(bundler.isAvailable()).toBe(false);
    await expect(bundler.startWatch()).rejects.toThrow(/esbuild is not installed/);
  });

  it('auto-detects entrypoints in src/client/main.js', () => {
    const clientDir = path.join(tempDir, 'src', 'client');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'main.js'), '// main client entry');

    const entryPoints = findDefaultEntryPoints(tempDir);
    expect(entryPoints.length).toBe(1);
    expect(entryPoints[0]).toBe(path.join(clientDir, 'main.js'));

    const bundler = createDevBundler({ cwd: tempDir });
    expect(bundler.getEntryPoints()).toEqual([path.join(clientDir, 'main.js')]);
  });

  it('uses esbuild.context() API to watch, rebuild and dispose cleanly', async () => {
    let watchCalled = false;
    let rebuildCalled = false;
    let disposeCalled = false;
    let passedConfig = null;

    const mockContext = {
      watch: async () => {
        watchCalled = true;
      },
      rebuild: async () => {
        rebuildCalled = true;
        return { errors: [], warnings: [] };
      },
      dispose: async () => {
        disposeCalled = true;
      },
    };

    const mockEsbuild = {
      context: async (config) => {
        passedConfig = config;
        return mockContext;
      },
    };

    const bundler = createDevBundler({
      cwd: tempDir,
      esbuild: mockEsbuild,
      entryPoints: ['src/client/main.js'],
      outdir: 'public/js',
      format: 'esm',
      minify: false,
    });

    expect(bundler.isAvailable()).toBe(true);
    expect(bundler.isWatching()).toBe(false);
    expect(bundler.isDisposed()).toBe(false);

    // 1. Start watch
    await bundler.startWatch();
    expect(watchCalled).toBe(true);
    expect(bundler.isWatching()).toBe(true);
    expect(passedConfig).toBeDefined();
    expect(passedConfig.entryPoints).toEqual(['src/client/main.js']);
    expect(passedConfig.bundle).toBe(true);
    expect(passedConfig.plugins).toBeDefined();

    // 2. Rebuild
    await bundler.rebuild();
    expect(rebuildCalled).toBe(true);

    // 3. Dispose
    await bundler.dispose();
    expect(disposeCalled).toBe(true);
    expect(bundler.isDisposed()).toBe(true);
    expect(bundler.isWatching()).toBe(false);
  });

  it('broadcasts devReload SSE events upon incremental rebuild', async () => {
    let devReloadPlugin = null;
    const broadcastEvents = [];
    const mockDevReloadHub = {
      broadcast: (type, payload) => {
        broadcastEvents.push({ type, payload });
      },
    };

    const mockEsbuild = {
      context: async (config) => {
        devReloadPlugin = config.plugins.find((p) => p.name === 'webspresso-dev-reload');
        return {
          watch: async () => {},
          dispose: async () => {},
        };
      },
    };

    const bundler = createDevBundler(
      {
        cwd: tempDir,
        esbuild: mockEsbuild,
        entryPoints: ['src/client/main.js'],
        logger: null,
      },
      mockDevReloadHub
    );

    await bundler.startWatch();
    expect(devReloadPlugin).toBeDefined();

    // Simulate esbuild plugin lifecycle
    let onEndCallback = null;
    devReloadPlugin.setup({
      onStart: () => {},
      onEnd: (cb) => {
        onEndCallback = cb;
      },
    });

    // 1. Rebuild with JS output -> should broadcast 'full'
    onEndCallback({
      errors: [],
      metafile: {
        outputs: {
          'public/js/main.js': {},
        },
      },
    });
    expect(broadcastEvents).toEqual([{ type: 'full', payload: undefined }]);

    // 2. Rebuild with only CSS output -> should broadcast 'css'
    broadcastEvents.length = 0;
    onEndCallback({
      errors: [],
      metafile: {
        outputs: {
          'public/js/bundle.css': {},
        },
      },
    });
    expect(broadcastEvents).toEqual([{ type: 'css', payload: undefined }]);

    // 3. Rebuild with errors -> broadcasts 'error' with code location for browser overlay
    broadcastEvents.length = 0;
    onEndCallback({
      errors: [
        {
          text: 'Syntax error',
          location: { file: 'src/client/main.js', line: 12, column: 5, lineText: 'const x = ;' },
        },
      ],
    });
    expect(broadcastEvents.length).toBe(1);
    expect(broadcastEvents[0].type).toBe('error');
    expect(broadcastEvents[0].payload.title).toBe('esbuild Build Error');
    expect(broadcastEvents[0].payload.message).toBe('Syntax error');
    expect(broadcastEvents[0].payload.file).toBe('src/client/main.js');
    expect(broadcastEvents[0].payload.line).toBe(12);

    // 4. Subsequent rebuild without errors -> broadcasts 'clear-error' then reload
    broadcastEvents.length = 0;
    onEndCallback({
      errors: [],
      metafile: {
        outputs: {
          'public/js/main.js': {},
        },
      },
    });
    expect(broadcastEvents.length).toBe(2);
    expect(broadcastEvents[0].type).toBe('clear-error');
    expect(broadcastEvents[1].type).toBe('full');
  });

  it('integrates with createApp options.bundle and shuts down cleanly', async () => {
    let disposeCalled = false;
    const mockEsbuild = {
      context: async () => ({
        watch: async () => {},
        rebuild: async () => ({ errors: [] }),
        dispose: async () => {
          disposeCalled = true;
        },
      }),
    };

    const { app } = createApp({
      pagesDir: './tests/fixtures/empty-pages',
      bundle: {
        enabled: true,
        esbuild: mockEsbuild,
        entryPoints: ['src/client/main.js'],
        watch: false,
      },
    });

    expect(app.devBundler).toBeDefined();
    expect(app.devBundler.isAvailable()).toBe(true);

    await app.devBundler.rebuild();

    // Test shutdown hook
    await app.close();
    expect(disposeCalled).toBe(true);
  });

  it('add esbuild CLI command scaffolds package.json, src/client/main.js, and views/layout.njk', async () => {
    // Setup test project
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'esbuild-test-app',
      version: '1.0.0',
    }, null, 2));

    fs.mkdirSync(path.join(tempDir, 'views'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'views', 'layout.njk'), '<!DOCTYPE html><html><head></head><body></body></html>');

    const result = await runCli(registerAddEsbuild, 'add esbuild', { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Adding esbuild client bundler');

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8'));
    expect(pkg.devDependencies.esbuild).toBeDefined();
    expect(pkg.scripts['build:js']).toContain('esbuild src/client/main.js');
    expect(pkg.scripts['watch:js']).toContain('esbuild src/client/main.js');

    expect(fs.existsSync(path.join(tempDir, 'src', 'client', 'main.js'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'public', 'js'))).toBe(true);

    const layout = fs.readFileSync(path.join(tempDir, 'views', 'layout.njk'), 'utf8');
    expect(layout).toContain('<script defer src="/js/main.js"></script>');
  });
});
