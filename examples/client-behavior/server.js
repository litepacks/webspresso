'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createApp } = require('../../index');

function createClientBehaviorExampleApp(options = {}) {
  const rootDir = __dirname;
  return createApp({
    rootDir,
    pagesDir: path.join(rootDir, 'pages'),
    viewsDir: path.join(rootDir, 'views'),
    publicDir: path.join(rootDir, 'public'),
    logging: false,
    ...options,
  });
}

/**
 * Zero-dependency browser bundle compiler using TypeScript's built-in transpiler
 * when optional `esbuild` peer dependency is not installed.
 */
function buildBrowserDemoBundle(rootDir) {
  const repoRoot = path.resolve(rootDir, '../..');
  const outDir = path.join(rootDir, 'public', 'js');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'client-demo.js');

  const moduleFiles = {
    './utils': path.join(repoRoot, 'core/client/utils.js'),
    '../utils': path.join(repoRoot, 'core/client/utils.js'),
    './adapter/datastar': path.join(repoRoot, 'core/client/adapter/datastar.js'),
    './api': path.join(repoRoot, 'core/client/api.js'),
    './forms': path.join(repoRoot, 'core/client/forms.js'),
    './storage': path.join(repoRoot, 'core/client/storage.js'),
    './host': path.join(repoRoot, 'core/client/host.js'),
    './services': path.join(repoRoot, 'core/client/services.js'),
    './devtool': path.join(repoRoot, 'core/client/devtool.js'),
    './controller': path.join(repoRoot, 'core/client/controller.js'),
    './fragments': path.join(repoRoot, 'core/client/fragments.js'),
    './debug': path.join(repoRoot, 'core/client/debug.js'),
    '../../core/client': path.join(repoRoot, 'core/client/index.js'),
    '../../../core/client': path.join(repoRoot, 'core/client/index.js'),
    '../../index': path.join(repoRoot, 'core/client/index.js'),
    '../../../index': path.join(repoRoot, 'core/client/index.js'),
    'webspresso/core/client': path.join(repoRoot, 'core/client/index.js'),
    'webspresso/client': path.join(repoRoot, 'core/client/index.js'),
    'webspresso': path.join(repoRoot, 'core/client/index.js'),
    './services/toast': path.join(rootDir, 'services/toast.ts'),
    './services/clipboard': path.join(rootDir, 'services/clipboard.ts'),
    './components/quick-share.client': path.join(rootDir, 'components/quick-share.client.ts'),
    './pages/todos.client': path.join(rootDir, 'pages/todos.client.ts'),
    './client-entry': path.join(rootDir, 'client-entry.ts'),
  };

  const compiledModules = [];
  for (const [modId, filePath] of Object.entries(moduleFiles)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const code = filePath.endsWith('.ts')
      ? ts.transpileModule(raw, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
          },
          fileName: path.basename(filePath),
        }).outputText
      : raw;

    compiledModules.push(
      `${JSON.stringify(modId)}: function(module, exports, require) {\n${code}\n}`
    );
  }

  const bundleSource = `(function() {
  var modules = {
    ${compiledModules.join(',\n    ')}
  };
  var cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    var fn = modules[id];
    if (!fn) throw new Error('Module not found in browser bundle: ' + id);
    var module = { exports: {} };
    cache[id] = module;
    fn(module, module.exports, require);
    return module.exports;
  }
  require('./client-entry');
})();\n`;

  fs.writeFileSync(outFile, bundleSource, 'utf8');
  return outFile;
}

async function startDevServer() {
  const rootDir = __dirname;
  buildBrowserDemoBundle(rootDir);

  const port = Number(process.env.PORT || 3456);
  const instance = createClientBehaviorExampleApp({
    isDev: true,
    logging: true,
    server: { port },
  });
  if (typeof instance.listen === 'function') {
    await instance.listen(port);
  } else {
    instance.app.listen(port, () => {
      console.log(`🚀 Client Behavior Demo running at http://localhost:${port}`);
    });
  }
}

if (require.main === module) {
  startDevServer().catch((err) => {
    console.error('Failed to start Client Behavior demo server:', err);
    process.exit(1);
  });
}

module.exports = {
  createClientBehaviorExampleApp,
  buildBrowserDemoBundle,
};
