/**
 * Dev Bundler — esbuild context() API incremental bundling & dev watching
 *
 * Integrates esbuild's official context() API for sub-millisecond incremental
 * rebuilds, auto-detection of client entrypoints, zero zombie processes, and
 * seamless integration with Webspresso Dev Reload (SSE).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ENTRYPOINTS = [
  'src/client/main.js',
  'src/client/main.ts',
  'src/client/index.js',
  'src/client/index.ts',
  'src/client/app.js',
  'src/client/app.ts',
];

/**
 * Recursively scans directory for page script entrypoints (.js, .mjs, .ts, .jsx, .tsx)
 * Excludes .d.ts, .test.*, .spec.*, and hidden files
 * @param {string} dir - Directory to scan (e.g. src/client/pages)
 * @param {string} baseDir - Base client directory (e.g. src/client)
 * @returns {Array<{ entryName: string, filePath: string }>}
 */
function scanClientPages(dir, baseDir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  const validExts = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx']);

  function walk(currentDir) {
    let list;
    try {
      list = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const item of list) {
      if (item.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (validExts.has(ext)) {
          if (item.name.endsWith('.d.ts') || item.name.includes('.test.') || item.name.includes('.spec.')) {
            continue;
          }
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
          const entryName = relPath.slice(0, -ext.length);
          entries.push({ entryName, filePath: fullPath });
        }
      }
    }
  }

  walk(dir);
  return entries;
}

/**
 * Discovers page-specific client entrypoints in src/client/pages/ or src/pages/
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {Record<string, string>} Map of entry names to absolute file paths (e.g. { 'pages/home': '.../src/client/pages/home.js' })
 */
function findPageEntryPoints(cwd = process.cwd()) {
  const pageEntries = {};
  
  // 1. Primary convention: src/client/pages/
  const clientPagesDir = path.resolve(cwd, 'src/client/pages');
  const clientDir = path.resolve(cwd, 'src/client');
  if (fs.existsSync(clientPagesDir)) {
    const scanned = scanClientPages(clientPagesDir, clientDir);
    for (const item of scanned) {
      pageEntries[item.entryName] = item.filePath;
    }
  }

  // 2. Secondary convention: src/pages/ with *.client.{js,ts,jsx,tsx}
  const srcPagesDir = path.resolve(cwd, 'src/pages');
  if (fs.existsSync(srcPagesDir)) {
    const validExts = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx']);
    function walkSrcPages(currentDir) {
      let list;
      try {
        list = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const item of list) {
        if (item.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
          walkSrcPages(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (validExts.has(ext) && item.name.includes('.client.')) {
            const rel = path.relative(srcPagesDir, fullPath).replace(/\\/g, '/');
            const cleanName = rel.replace(/\.client\.[a-z0-9]+$/i, '');
            const entryName = 'pages/' + cleanName;
            if (!pageEntries[entryName]) {
              pageEntries[entryName] = fullPath;
            }
          }
        }
      }
    }
    walkSrcPages(srcPagesDir);
  }

  return pageEntries;
}

/**
 * Simple glob expansion for client entrypoints (supports single and double wildcards)
 * @param {string} pattern - Glob pattern (e.g. 'src/client/pages/*.js')
 * @param {string} [cwd=process.cwd()] - Base directory
 * @returns {string[]} Matching absolute file paths
 */
function expandGlob(pattern, cwd = process.cwd()) {
  const normalized = pattern.replace(/\\/g, '/');
  const starIndex = normalized.indexOf('*');
  if (starIndex === -1) {
    const p = path.resolve(cwd, pattern);
    return fs.existsSync(p) ? [p] : [];
  }
  const prefix = normalized.slice(0, starIndex);
  const baseDir = path.resolve(cwd, prefix.endsWith('/') ? prefix : path.dirname(prefix));
  if (!fs.existsSync(baseDir)) return [];

  const isRecursive = normalized.includes('**');
  const regexPattern = '^' + normalized
    .replace(/\\/g, '\\\\')
    .replace(/[.+?^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*') + '$';
  const regex = new RegExp(regexPattern);

  const matched = [];
  function walk(dir) {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');
      if (item.isDirectory()) {
        if (isRecursive) walk(fullPath);
      } else if (item.isFile()) {
        if (regex.test(relPath)) {
          matched.push(fullPath);
        }
      }
    }
  }
  walk(baseDir);
  return matched;
}

/**
 * Resolves entry points from options, expanding globs or discovering defaults
 * @param {string[]|Record<string, string>|string} [entryPoints]
 * @param {string} [cwd=process.cwd()]
 * @returns {string[]|Record<string, string>}
 */
function resolveEntryPoints(entryPoints, cwd = process.cwd()) {
  if (!entryPoints || (Array.isArray(entryPoints) && entryPoints.length === 0)) {
    return findDefaultEntryPoints(cwd);
  }

  // Object mapping (e.g. { 'main': 'src/client/main.js', 'pages/home': 'src/client/pages/home.js' })
  if (typeof entryPoints === 'object' && !Array.isArray(entryPoints)) {
    return entryPoints;
  }

  // Array of paths / globs
  const list = Array.isArray(entryPoints) ? entryPoints : [entryPoints];
  const expanded = [];
  for (const item of list) {
    if (typeof item === 'string' && item.includes('*')) {
      expanded.push(...expandGlob(item, cwd));
    } else if (typeof item === 'string') {
      expanded.push(item);
    }
  }

  return expanded;
}

/**
 * Finds default client entry points if none were specified
 * Discovers main bundle and page-specific entrypoints in src/client/pages/
 * @param {string} [cwd=process.cwd()]
 * @returns {string[]|Record<string, string>}
 */
function findDefaultEntryPoints(cwd = process.cwd()) {
  let mainEntry = null;
  for (const entry of DEFAULT_ENTRYPOINTS) {
    const fullPath = path.resolve(cwd, entry);
    if (fs.existsSync(fullPath)) {
      mainEntry = fullPath;
      break;
    }
  }

  const pageEntries = findPageEntryPoints(cwd);
  const pageEntryKeys = Object.keys(pageEntries);

  // If no page entries exist, return single-item array or empty array (100% backward compatible)
  if (pageEntryKeys.length === 0) {
    return mainEntry ? [mainEntry] : [];
  }

  // If page entries exist, return an entrypoints dictionary
  const entryMap = {};
  if (mainEntry) {
    const ext = path.extname(mainEntry);
    const mainBase = path.basename(mainEntry, ext); // 'main', 'index', or 'app'
    entryMap[mainBase] = mainEntry;
  }
  for (const [key, filePath] of Object.entries(pageEntries)) {
    entryMap[key] = filePath;
  }

  return entryMap;
}

/**
 * Resolves esbuild module dynamically from project or options
 * @param {object} options
 * @param {string} cwd
 * @returns {object|null}
 */
function resolveEsbuild(options = {}, cwd = process.cwd()) {
  if (options.esbuild) return options.esbuild;
  try {
    return require('esbuild');
  } catch (_) {
    try {
      return require(path.join(cwd, 'node_modules', 'esbuild'));
    } catch (_) {
      return null;
    }
  }
}

/**
 * Creates an esbuild-powered dev bundler using esbuild context() API
 *
 * @param {object} [options={}]
 * @param {object} [devReloadHub=null]
 * @returns {DevBundler}
 */
function createDevBundler(options = {}, devReloadHub = null) {
  const cwd = options.cwd || process.cwd();
  const esbuild = resolveEsbuild(options, cwd);
  const isAvailable = Boolean(esbuild);

  const entryPoints = resolveEntryPoints(options.entryPoints, cwd);

  const outdir = options.outdir ? path.resolve(cwd, options.outdir) : path.resolve(cwd, 'public/js');
  const bundle = options.bundle !== false;
  const sourcemap = options.sourcemap !== undefined ? options.sourcemap : true;
  const minify = options.minify !== undefined ? options.minify : false;
  const target = options.target || ['es2020'];
  const format = options.format || 'esm';
  const metafile = options.metafile !== false;
  const userPlugins = Array.isArray(options.plugins) ? options.plugins : [];
  const logger = options.logger !== undefined ? options.logger : console;

  let ctx = null;
  let isWatching = false;
  let isDisposed = false;

  // Custom dev-reload plugin for esbuild
  const devReloadPlugin = {
    name: 'webspresso-dev-reload',
    setup(build) {
      let startTime = 0;
      let hadError = false;

      build.onStart(() => {
        startTime = Date.now();
      });

      build.onEnd((result) => {
        const duration = Date.now() - startTime;
        if (result.errors && result.errors.length > 0) {
          hadError = true;
          if (logger && logger.error) {
            logger.error(`❌ [Webspresso esbuild] Build failed (${duration}ms):`, result.errors);
          }
          if (devReloadHub && typeof devReloadHub.broadcast === 'function') {
            const firstErr = result.errors[0] || {};
            const loc = firstErr.location || {};
            devReloadHub.broadcast('error', {
              title: 'esbuild Build Error',
              message: firstErr.text || 'Build failed with syntax error',
              file: loc.file,
              line: loc.line,
              column: loc.column,
              lineText: loc.lineText,
              errors: result.errors.map((e) => ({
                text: e.text,
                file: e.location && e.location.file,
                line: e.location && e.location.line,
                column: e.location && e.location.column,
                lineText: e.location && e.location.lineText,
              })),
            });
          }
          return;
        }

        if (logger && logger.log) {
          logger.log(`⚡ [Webspresso esbuild] Incremental rebuild finished in ${duration}ms`);
        }

        if (devReloadHub && typeof devReloadHub.broadcast === 'function') {
          if (hadError) {
            devReloadHub.broadcast('clear-error');
            hadError = false;
          }

          let hasCssOnly = false;
          if (result.metafile && result.metafile.outputs) {
            const outputFiles = Object.keys(result.metafile.outputs);
            const hasJs = outputFiles.some((f) => f.endsWith('.js') || f.endsWith('.mjs'));
            const hasCss = outputFiles.some((f) => f.endsWith('.css'));
            if (hasCss && !hasJs) {
              hasCssOnly = true;
            }
          }

          if (hasCssOnly) {
            devReloadHub.broadcast('css');
          } else {
            devReloadHub.broadcast('full');
          }
        }
      });
    },
  };

  async function getOrInitContext() {
    if (ctx) return ctx;
    if (!isAvailable) {
      throw new Error(
        "esbuild is not installed. Run 'npm install --save-dev esbuild' or 'npx webspresso add esbuild' to enable client bundling."
      );
    }

    const hasEntryPoints = Array.isArray(entryPoints)
      ? entryPoints.length > 0
      : Boolean(entryPoints && Object.keys(entryPoints).length > 0);

    if (!hasEntryPoints) {
      throw new Error(
        "No entrypoints found for esbuild bundler. Place your entry script in 'src/client/main.js' or specify 'entryPoints' option."
      );
    }

    const outbase = options.outbase || (fs.existsSync(path.resolve(cwd, 'src/client')) ? path.resolve(cwd, 'src/client') : undefined);
    const esbuildConfig = {
      entryPoints,
      outdir,
      bundle,
      sourcemap,
      minify,
      target,
      format,
      metafile,
      outbase,
      plugins: [devReloadPlugin, ...userPlugins],
      ...(options.esbuildOptions || {}),
    };

    if (typeof esbuild.context !== 'function') {
      throw new Error("esbuild.context() is not available. Please ensure esbuild >= 0.17.0 is installed.");
    }

    ctx = await esbuild.context(esbuildConfig);
    return ctx;
  }

  async function startWatch() {
    if (isDisposed) throw new Error('DevBundler has already been disposed.');
    if (isWatching) return ctx;
    const context = await getOrInitContext();
    await context.watch();
    isWatching = true;
    if (logger && logger.log) {
      logger.log('⚡ [Webspresso esbuild] Incremental watch mode active using context() API');
    }
    return context;
  }

  async function rebuild() {
    if (isDisposed) throw new Error('DevBundler has already been disposed.');
    const context = await getOrInitContext();
    return await context.rebuild();
  }

  async function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    isWatching = false;
    if (ctx) {
      try {
        await ctx.dispose();
      } catch (_) {}
      ctx = null;
    }
  }

  return {
    isAvailable: () => isAvailable,
    isWatching: () => isWatching,
    isDisposed: () => isDisposed,
    getEntryPoints: () => entryPoints,
    getOutdir: () => outdir,
    startWatch,
    rebuild,
    dispose,
    getContext: () => ctx,
  };
}

const { generateManifest, createManifestPlugin } = require('./manifest');

/**
 * One-shot production bundle builder with automatic metafile: true and manifest.json generation
 *
 * @param {object} [options={}]
 * @returns {Promise<{ result: any, manifest: any, manifestPath: string }>}
 */
async function buildBundle(options = {}) {
  const cwd = options.cwd || process.cwd();
  const esbuild = resolveEsbuild(options, cwd);
  if (!esbuild) {
    throw new Error("esbuild is not installed. Run 'npm install --save-dev esbuild' to build assets.");
  }

  const entryPoints = resolveEntryPoints(options.entryPoints, cwd);
  const hasEntryPoints = Array.isArray(entryPoints)
    ? entryPoints.length > 0
    : Boolean(entryPoints && Object.keys(entryPoints).length > 0);

  if (!hasEntryPoints) {
    throw new Error("No client entry points found in 'src/client/main.js' or 'src/client/pages/'. Specify entryPoints option.");
  }

  const outdir = options.outdir ? path.resolve(cwd, options.outdir) : path.resolve(cwd, 'public/dist');
  const publicDir = options.publicDir ? path.resolve(cwd, options.publicDir) : path.resolve(cwd, 'public');
  const bundle = options.bundle !== false;
  const minify = options.minify !== undefined ? options.minify : true;
  const sourcemap = options.sourcemap !== undefined ? options.sourcemap : true;
  const target = options.target || ['es2020'];
  const format = options.format || 'esm';
  const outbase = options.outbase || (fs.existsSync(path.resolve(cwd, 'src/client')) ? path.resolve(cwd, 'src/client') : undefined);
  const entryNames = options.entryNames || (options.hash !== false ? '[dir]/[name].[hash]' : '[dir]/[name]');
  const manifestPath = options.manifestPath || path.join(outdir, 'manifest.json');
  const userPlugins = Array.isArray(options.plugins) ? options.plugins : [];

  const manifestPlugin = createManifestPlugin({
    outdir,
    publicDir,
    manifestPath,
    logger: options.logger,
  });

  const buildConfig = {
    entryPoints,
    outdir,
    bundle,
    minify,
    sourcemap,
    target,
    format,
    entryNames,
    outbase,
    metafile: true,
    plugins: [manifestPlugin, ...userPlugins],
    ...(options.esbuildOptions || {}),
  };

  const result = await esbuild.build(buildConfig);
  const manifest = generateManifest(result.metafile, {
    outdir,
    publicDir,
  });

  return {
    result,
    manifest,
    manifestPath,
  };
}

module.exports = {
  createDevBundler,
  buildBundle,
  generateManifest,
  createManifestPlugin,
  findDefaultEntryPoints,
  findPageEntryPoints,
  scanClientPages,
  expandGlob,
  resolveEntryPoints,
  DEFAULT_ENTRYPOINTS,
};
