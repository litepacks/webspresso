/**
 * Dev Bundler — esbuild context() API incremental bundling & dev watching
 *
 * Integrates esbuild's official context() API for sub-millisecond incremental
 * rebuilds, auto-detection of client entrypoints, zero zombie processes, and
 * seamless integration with Webspresso Dev Reload (SSE).
 */

const fs = require('fs');
const path = require('path');
const { deriveControllerNameFromPath } = require('../../core/client/controller');

const SERVER_ONLY_BUILTINS = new Set([
  'fs',
  'fs/promises',
  'net',
  'tls',
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'http2',
  'worker_threads',
  'v8',
  'vm',
  'async_hooks',
  'inspector',
]);

const SERVER_ONLY_PACKAGES = new Set([
  'knex',
  'better-sqlite3',
  'pg',
  'pg-native',
  'mysql',
  'mysql2',
  'sqlite3',
  'oracledb',
  'tedious',
  'mssql',
  'ioredis',
  'redis',
  'express',
  'helmet',
  'compression',
  'cookie-parser',
  'express-session',
  'nodemailer',
  'mjml',
  'bcrypt',
  'bcryptjs',
  'argon2',
]);

const SERVER_ONLY_INTERNAL_PATTERN =
  /(?:^(?:src\/)?(?:models|services|jobs|migrations|pages\/api)|(?:^|\/)(?:core\/(?:orm|services|auth|secrets|queue|mail|http|metrics|health|rate-limit)|src\/(?:server|file-router|api|pages)))(?:\/|$)/;

function isClientServiceFile(resolvedBase) {
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.js`,
    `${resolvedBase}.mjs`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.jsx`,
  ];
  for (const cand of candidates) {
    if (cand.includes('.client.')) return true;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      try {
        const content = fs.readFileSync(cand, 'utf8');
        if (/\bdefineClientService\b/.test(content)) {
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}

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

  // 2. Co-located page client files: pages/**/*.client.{js,ts,jsx,tsx} and src/pages/**/*.client.{js,ts,jsx,tsx}
  const pageDirs = [path.resolve(cwd, 'pages'), path.resolve(cwd, 'src/pages')];
  const validExts = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx']);

  for (const dirToScan of pageDirs) {
    if (!fs.existsSync(dirToScan)) continue;
    function walkPages(currentDir) {
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
          walkPages(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (validExts.has(ext) && item.name.includes('.client.') && !item.name.endsWith('.d.ts')) {
            const rel = path.relative(dirToScan, fullPath).replace(/\\/g, '/');
            const cleanName = rel.replace(/\.client\.[a-z0-9]+$/i, '');
            const entryName = 'pages/' + cleanName;
            if (!pageEntries[entryName]) {
              pageEntries[entryName] = fullPath;
            }
          }
        }
      }
    }
    walkPages(dirToScan);
  }

  // 3. Co-located component/view client files: views/**/*.client.{js,ts,jsx,tsx} and src/views/**/*.client.{js,ts,jsx,tsx}
  const viewDirs = [path.resolve(cwd, 'views'), path.resolve(cwd, 'src/views')];
  for (const dirToScan of viewDirs) {
    if (!fs.existsSync(dirToScan)) continue;
    function walkViews(currentDir) {
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
          walkViews(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (validExts.has(ext) && item.name.includes('.client.') && !item.name.endsWith('.d.ts')) {
            const rel = path.relative(dirToScan, fullPath).replace(/\\/g, '/');
            const cleanName = rel.replace(/\.client\.[a-z0-9]+$/i, '');
            const entryName = cleanName.startsWith('components/') ? cleanName : `views/${cleanName}`;
            if (!pageEntries[entryName]) {
              pageEntries[entryName] = fullPath;
            }
          }
        }
      }
    }
    walkViews(dirToScan);
  }

  return pageEntries;
}

/**
 * Discovers all `.client.{js,ts,mjs,jsx,tsx}` controller files across `pages/` and `views/`
 * and validates deterministic controller names for collisions.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {Array<{ controllerName: string, entryName: string, filePath: string, relativePath: string }>}
 */
function discoverClientControllers(cwd = process.cwd()) {
  const pageEntries = findPageEntryPoints(cwd);
  const discovered = [];
  const byControllerName = new Map();

  for (const [entryName, filePath] of Object.entries(pageEntries)) {
    const relativePath = path.relative(cwd, filePath).replace(/\\/g, '/');
    const controllerName = deriveControllerNameFromPath(relativePath);
    if (!controllerName) continue;

    if (byControllerName.has(controllerName)) {
      const existing = byControllerName.get(controllerName);
      if (existing.filePath !== filePath) {
        const err = new Error(
          `Controller name collision: "${controllerName}" is defined by both "${existing.relativePath}" and "${relativePath}".`
        );
        err.code = 'CONTROLLER_NAME_COLLISION';
        err.controllerName = controllerName;
        err.files = [existing.relativePath, relativePath];
        throw err;
      }
    }

    const record = {
      controllerName,
      entryName,
      filePath,
      relativePath,
    };
    byControllerName.set(controllerName, record);
    discovered.push(record);
  }

  return discovered;
}

/**
 * Checks whether an import specifier or resolved path crosses into a server-only module boundary.
 *
 * @param {string} specifier - Raw import/require string
 * @param {string} importerPath - Absolute path of the importing client file
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {{ forbidden: boolean, reason?: string }}
 */
function checkServerImportViolation(specifier, importerPath, cwd = process.cwd()) {
  if (!specifier || typeof specifier !== 'string') return { forbidden: false };
  const raw = specifier.trim();

  // 1. Node built-in modules (`node:fs`, `fs`, `child_process`, etc.)
  if (raw.startsWith('node:')) {
    const modName = raw.slice(5);
    if (SERVER_ONLY_BUILTINS.has(modName) || modName.startsWith('fs') || modName.startsWith('child_process')) {
      return {
        forbidden: true,
        reason: `Node.js server built-in module "${raw}" cannot be imported into browser client bundle ("${path.relative(cwd, importerPath)}").`,
      };
    }
  }
  if (SERVER_ONLY_BUILTINS.has(raw)) {
    return {
      forbidden: true,
      reason: `Node.js server built-in module "${raw}" cannot be imported into browser client bundle ("${path.relative(cwd, importerPath)}").`,
    };
  }

  // 2. Server-only packages (`knex`, `express`, `better-sqlite3`, `pg`, etc.)
  const pkgRoot = raw.startsWith('@')
    ? raw.split('/').slice(0, 2).join('/')
    : raw.split('/')[0];
  if (!raw.startsWith('.') && !raw.startsWith('/') && SERVER_ONLY_PACKAGES.has(pkgRoot)) {
    return {
      forbidden: true,
      reason: `Server-only package "${raw}" cannot be imported into browser client bundle ("${path.relative(cwd, importerPath)}").`,
    };
  }

  // 3. Webspresso server subpath imports (`webspresso/core/orm`, `webspresso/core/services`, etc.)
  if (!raw.startsWith('.') && SERVER_ONLY_INTERNAL_PATTERN.test(raw)) {
    return {
      forbidden: true,
      reason: `Server-only Webspresso module "${raw}" cannot be imported into browser client bundle ("${path.relative(cwd, importerPath)}").`,
    };
  }

  // 4. Relative or absolute path imports into server files (`pages/api/*`, `models/*`, `services/*`, server page loaders)
  if (raw.startsWith('.') || raw.startsWith('/')) {
    const resolved = path.resolve(path.dirname(importerPath), raw);
    const relToRoot = path.relative(cwd, resolved).replace(/\\/g, '/');

    if (SERVER_ONLY_INTERNAL_PATTERN.test(relToRoot)) {
      if (/^(?:src\/)?services(?:\/|$)/.test(relToRoot) && isClientServiceFile(resolved)) {
        return { forbidden: false };
      }
      return {
        forbidden: true,
        reason: `Server module "${relToRoot}" (imported as "${raw}" in "${path.relative(cwd, importerPath)}") cannot be bundled into browser code.`,
      };
    }

    // Disallow importing a server page loader (`pages/notes.js`) from `pages/notes.client.ts`
    if (
      (relToRoot.startsWith('pages/') || relToRoot.startsWith('src/pages/')) &&
      !relToRoot.includes('.client')
    ) {
      // Check if it resolves to a non-client .js/.ts file in pages/
      const candidates = [resolved, `${resolved}.js`, `${resolved}.ts`];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile() && !cand.includes('.client.')) {
          return {
            forbidden: true,
            reason: `Server page loader "${path.relative(cwd, cand)}" cannot be imported into browser client bundle ("${path.relative(cwd, importerPath)}").`,
          };
        }
      }
    }
  }

  return { forbidden: false };
}

/**
 * Statically scans client entry files and their local relative dependency graph
 * to reject any runtime import/require of server-only modules (ignores `import type`).
 *
 * @param {string[]|Record<string, string>} entryPoints
 * @param {string} [cwd=process.cwd()]
 */
function validateClientBundleBoundaries(entryPoints, cwd = process.cwd()) {
  const fileList = Array.isArray(entryPoints)
    ? entryPoints
    : entryPoints && typeof entryPoints === 'object'
    ? Object.values(entryPoints)
    : [];

  const visited = new Set();

  function scanFile(filePath) {
    const absPath = path.resolve(cwd, filePath);
    if (visited.has(absPath) || !fs.existsSync(absPath)) return;
    visited.add(absPath);

    let source;
    try {
      source = fs.readFileSync(absPath, 'utf8');
    } catch (_) {
      return;
    }

    // Strip block and line comments so commented-out imports don't trigger false positives
    const cleanSource = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const specs = [];

    // Match runtime ESM imports (excluding `import type ...` and `export type ...`)
    const esmImportRegex = /\b(?:import|export)\s+(?!type\b)(?:[\s\S]*?\bfrom\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = esmImportRegex.exec(cleanSource)) !== null) {
      const fullMatch = m[0];
      // Skip `import { type Foo } from '...'` if ALL imported bindings are `type`
      const braceMatch = fullMatch.match(/\{([^}]+)\}/);
      if (braceMatch && !/^[^{]+\{/.test(fullMatch.replace(/^(?:import|export)\s+/, ''))) {
        const items = braceMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.length > 0 && items.every((item) => /^type\s+/.test(item))) {
          continue;
        }
      }
      specs.push(m[1]);
    }

    // Match CommonJS require('...') and dynamic import('...')
    const callImportRegex = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = callImportRegex.exec(cleanSource)) !== null) {
      specs.push(m[1]);
    }

    for (const spec of specs) {
      const check = checkServerImportViolation(spec, absPath, cwd);
      if (check.forbidden) {
        const err = new Error(check.reason);
        err.code = 'SERVER_DEPENDENCY_IN_CLIENT';
        err.importer = absPath;
        err.specifier = spec;
        throw err;
      }

      // Follow relative client imports recursively
      if (spec.startsWith('.')) {
        const baseResolved = path.resolve(path.dirname(absPath), spec);
        const candidates = [
          baseResolved,
          `${baseResolved}.ts`,
          `${baseResolved}.js`,
          `${baseResolved}.mjs`,
          `${baseResolved}.tsx`,
          `${baseResolved}.jsx`,
          path.join(baseResolved, 'index.ts'),
          path.join(baseResolved, 'index.js'),
        ];
        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            scanFile(cand);
            break;
          }
        }
      }
    }
  }

  for (const entry of fileList) {
    scanFile(entry);
  }
}

/**
 * Creates an esbuild plugin that blocks server-only modules from entering browser bundles.
 *
 * @param {string} [cwd=process.cwd()]
 */
function createServerBoundaryPlugin(cwd = process.cwd()) {
  return {
    name: 'webspresso-server-boundary',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer) return null;
        const check = checkServerImportViolation(args.path, args.importer, cwd);
        if (check.forbidden) {
          return {
            errors: [
              {
                text: check.reason,
              },
            ],
          };
        }
        return null;
      });
    },
  };
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

    discoverClientControllers(cwd);
    validateClientBundleBoundaries(entryPoints, cwd);

    const outbase = options.outbase || (fs.existsSync(path.resolve(cwd, 'src/client')) ? path.resolve(cwd, 'src/client') : undefined);
    const splitting = options.splitting !== undefined ? Boolean(options.splitting) : format === 'esm';
    const chunkNames = options.chunkNames || 'chunks/[name]-[hash]';
    const esbuildConfig = {
      entryPoints,
      outdir,
      bundle,
      sourcemap,
      minify,
      target,
      format,
      splitting,
      ...(splitting ? { chunkNames } : {}),
      define: {
        'process.env.NODE_ENV': '"development"',
        ...(options.define || {}),
      },
      metafile,
      outbase,
      plugins: [createServerBoundaryPlugin(cwd), devReloadPlugin, ...userPlugins],
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
  const entryPoints = resolveEntryPoints(options.entryPoints, cwd);

  discoverClientControllers(cwd);
  validateClientBundleBoundaries(entryPoints, cwd);

  const hasEntryPoints = Array.isArray(entryPoints)
    ? entryPoints.length > 0
    : Boolean(entryPoints && Object.keys(entryPoints).length > 0);

  if (!hasEntryPoints) {
    throw new Error("No client entry points found in 'src/client/main.js' or 'src/client/pages/'. Specify entryPoints option.");
  }

  const outdir = options.outdir ? path.resolve(cwd, options.outdir) : path.resolve(cwd, 'public/dist');
  const publicDir = options.publicDir ? path.resolve(cwd, options.publicDir) : path.resolve(cwd, 'public');
  const manifestPath = options.manifestPath || path.join(outdir, 'manifest.json');

  const esbuild = resolveEsbuild(options, cwd);
  if (!esbuild) {
    if (options.esbuild === null) {
      throw new Error("esbuild is not installed. Run 'npm install --save-dev esbuild' to build assets.");
    }
    return buildBundleFallback({
      cwd,
      entryPoints,
      outdir,
      publicDir,
      manifestPath,
      hash: options.hash !== false,
      splitting: options.splitting !== false && (options.format || 'esm') === 'esm',
    });
  }

  const bundle = options.bundle !== false;
  const minify = options.minify !== undefined ? options.minify : true;
  const sourcemap = options.sourcemap !== undefined ? options.sourcemap : true;
  const target = options.target || ['es2020'];
  const format = options.format || 'esm';
  const splitting = options.splitting !== undefined ? Boolean(options.splitting) : format === 'esm';
  const outbase = options.outbase || (fs.existsSync(path.resolve(cwd, 'src/client')) ? path.resolve(cwd, 'src/client') : undefined);
  const entryNames = options.entryNames || (options.hash !== false ? '[dir]/[name].[hash]' : '[dir]/[name]');
  const chunkNames = options.chunkNames || (options.hash !== false ? 'chunks/[name].[hash]' : 'chunks/[name]');
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
    treeShaking: true,
    legalComments: options.legalComments || 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
      ...(options.define || {}),
    },
    drop: options.drop !== undefined ? options.drop : ['debugger'],
    sourcemap,
    target,
    format,
    splitting,
    ...(splitting ? { chunkNames } : {}),
    entryNames,
    outbase,
    metafile: true,
    plugins: [createServerBoundaryPlugin(cwd), manifestPlugin, ...userPlugins],
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

function resolveLocalModuleFile(importerAbsPath, specifier) {
  if (!specifier || !specifier.startsWith('.')) return null;
  const baseResolved = path.resolve(path.dirname(importerAbsPath), specifier);
  const candidates = [
    baseResolved,
    `${baseResolved}.ts`,
    `${baseResolved}.js`,
    `${baseResolved}.mjs`,
    `${baseResolved}.tsx`,
    `${baseResolved}.jsx`,
    `${baseResolved}.css`,
    path.join(baseResolved, 'index.ts'),
    path.join(baseResolved, 'index.js'),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }
  return null;
}

/**
 * Built-in fallback asset builder when esbuild is not installed in node_modules.
 * Compiles `.ts` / `.js` client entrypoints, splits dynamic `import()` modules
 * and shared chunks into `chunks/`, hashes filenames for cache-busting, and writes `manifest.json`.
 */
function buildBundleFallback({ cwd, entryPoints, outdir, publicDir, manifestPath, hash = true, splitting = true }) {
  const crypto = require('crypto');
  let ts = null;
  try {
    ts = require('typescript');
  } catch (_) {}

  const entriesMap = Array.isArray(entryPoints)
    ? Object.fromEntries(
        entryPoints.map((fp) => {
          const base = path.basename(fp, path.extname(fp)).replace(/\.client$/i, '');
          return [base, fp];
        })
      )
    : entryPoints;

  const metafile = { inputs: {}, outputs: {} };
  const emittedChunksBySource = new Map(); // absSourcePath -> { absOut, relFromOutdir, relOutput }

  function transpileSource(absFile, rawCode) {
    let code = rawCode;
    if ((absFile.endsWith('.ts') || absFile.endsWith('.tsx')) && ts) {
      const transpiled = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
        },
        fileName: absFile,
      });
      code = transpiled.outputText;
    }
    return code.replace(/\bprocess\.env\.NODE_ENV\b/g, '"production"');
  }

  function extractCjsExportNames(code) {
    const match = code.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/);
    if (!match) return [];
    const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const names = new Set();
    const propRegex = /^\s*(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|:|\()/gm;
    let m;
    while ((m = propRegex.exec(body)) !== null) {
      const name = m[1];
      if (name && name !== 'get' && name !== 'set' && name !== 'function') {
        names.add(name);
      }
    }
    return Array.from(names);
  }

  function emitChunkModule(absModulePath) {
    if (emittedChunksBySource.has(absModulePath)) {
      return emittedChunksBySource.get(absModulePath);
    }
    if (!fs.existsSync(absModulePath)) return null;

    const rawCode = fs.readFileSync(absModulePath, 'utf8');
    const isCss = absModulePath.endsWith('.css');
    let outCode = isCss ? rawCode : transpileSource(absModulePath, rawCode);

    // Reserve placeholder to prevent infinite recursion on circular imports
    const baseName = path.basename(absModulePath, path.extname(absModulePath)).replace(/\.client$/i, '');
    const placeholder = { absOut: '', relFromOutdir: '', relOutput: '' };
    emittedChunksBySource.set(absModulePath, placeholder);

    const chunkImports = [];
    if (!isCss && splitting) {
      const placeholderOutDir = path.join(outdir, 'chunks');
      outCode = rewriteModuleImports(absModulePath, outCode, placeholderOutDir, chunkImports);
    }

    const digest = hash
      ? '.' + crypto.createHash('sha256').update(outCode).digest('hex').slice(0, 8).toUpperCase()
      : '';
    const ext = isCss ? '.css' : '.js';
    const relFromOutdir = `chunks/${baseName}${digest}${ext}`;
    const absOut = path.join(outdir, relFromOutdir);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, outCode, 'utf8');

    const relInput = path.relative(cwd, absModulePath).replace(/\\/g, '/');
    const relOutput = path.relative(cwd, absOut).replace(/\\/g, '/');
    metafile.inputs[relInput] = { bytes: Buffer.byteLength(rawCode, 'utf8') };
    metafile.outputs[relOutput] = {
      bytes: Buffer.byteLength(outCode, 'utf8'),
      imports: chunkImports,
      inputs: {
        [relInput]: { bytesInOutput: Buffer.byteLength(outCode, 'utf8') },
      },
    };

    placeholder.absOut = absOut;
    placeholder.relFromOutdir = relFromOutdir;
    placeholder.relOutput = relOutput;
    return placeholder;
  }

  function rewriteModuleImports(importerAbsPath, code, emitterOutDir, collectedImports) {
    // 1. Rewrite dynamic `import('./...')`
    let rewritten = code.replace(
      /\bimport\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g,
      (fullMatch, quote, spec) => {
        const resolved = resolveLocalModuleFile(importerAbsPath, spec);
        if (!resolved) return fullMatch;
        const chunkInfo = emitChunkModule(resolved);
        if (!chunkInfo || !chunkInfo.absOut) return fullMatch;
        let relSpec = path.relative(emitterOutDir, chunkInfo.absOut).replace(/\\/g, '/');
        if (!relSpec.startsWith('.')) relSpec = './' + relSpec;
        collectedImports.push({ path: chunkInfo.relOutput, kind: 'dynamic-import' });
        return `import(${quote}${relSpec}${quote})`;
      }
    );

    // 2. Rewrite static relative `import ... from './...'` / `export ... from './...'`
    rewritten = rewritten.replace(
      /(\b(?:import|export)\s+(?:[\s\S]*?\bfrom\s+)?)(['"])(\.[^'"]+)\2/g,
      (fullMatch, prefix, quote, spec) => {
        const resolved = resolveLocalModuleFile(importerAbsPath, spec);
        if (!resolved) return fullMatch;
        const chunkInfo = emitChunkModule(resolved);
        if (!chunkInfo || !chunkInfo.absOut) return fullMatch;
        let relSpec = path.relative(emitterOutDir, chunkInfo.absOut).replace(/\\/g, '/');
        if (!relSpec.startsWith('.')) relSpec = './' + relSpec;
        collectedImports.push({ path: chunkInfo.relOutput, kind: 'import-statement' });
        if (resolved.endsWith('.css')) {
          return `/* css: ${relSpec} */`;
        }
        return `${prefix}${quote}${relSpec}${quote}`;
      }
    );

    // 3. Transform CommonJS modules (`module.exports = ...` / `require('./...')`) into native ESM chunks
    if (/\bmodule\.exports\b/.test(rewritten)) {
      const cjsImports = [];
      let depSeq = 0;
      const depVarBySpec = new Map();
      const exportNames = extractCjsExportNames(rewritten);

      rewritten = rewritten.replace(
        /\b(?:reqFn|require)\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g,
        (fullMatch, quote, spec) => {
          if (spec === './debug' || spec === './devtool' || spec === './server-fragments') {
            return '{}';
          }
          const resolved = resolveLocalModuleFile(importerAbsPath, spec);
          if (!resolved) return fullMatch;
          const chunkInfo = emitChunkModule(resolved);
          if (!chunkInfo || !chunkInfo.absOut) return fullMatch;
          let relSpec = path.relative(emitterOutDir, chunkInfo.absOut).replace(/\\/g, '/');
          if (!relSpec.startsWith('.')) relSpec = './' + relSpec;
          let depVar = depVarBySpec.get(relSpec);
          if (!depVar) {
            depVar = `__cjs_dep_${++depSeq}`;
            depVarBySpec.set(relSpec, depVar);
            cjsImports.push(`import ${depVar} from ${quote}${relSpec}${quote};`);
            collectedImports.push({ path: chunkInfo.relOutput, kind: 'import-statement' });
          }
          return depVar;
        }
      );

      const strippedBody = rewritten.replace(/^\s*['"]use strict['"];?\s*/, '');
      const namedExportLines = exportNames.map(
        (name) => `export const ${name} = __cjs_exports.${name};`
      );
      rewritten = [
        ...cjsImports,
        'const __cjs_exports = (() => {',
        'const module = { exports: {} };',
        'const exports = module.exports;',
        strippedBody,
        'return module.exports;',
        '})();',
        'export default __cjs_exports;',
        ...namedExportLines,
      ].join('\n');
    }

    return rewritten;
  }

  for (const [entryKey, rawFilePath] of Object.entries(entriesMap)) {
    const absIn = path.resolve(cwd, rawFilePath);
    if (!fs.existsSync(absIn)) continue;
    const rawCode = fs.readFileSync(absIn, 'utf8');
    let outCode = transpileSource(absIn, rawCode);

    const entryOutDir = path.dirname(path.join(outdir, `${entryKey}.js`));
    const entryImports = [];
    if (splitting) {
      outCode = rewriteModuleImports(absIn, outCode, entryOutDir, entryImports);
    }

    const digest = hash
      ? '.' + crypto.createHash('sha256').update(outCode).digest('hex').slice(0, 8).toUpperCase()
      : '';
    const relOutFile = `${entryKey}${digest}.js`;
    const absOut = path.join(outdir, relOutFile);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, outCode, 'utf8');

    const relInput = path.relative(cwd, absIn).replace(/\\/g, '/');
    const relOutput = path.relative(cwd, absOut).replace(/\\/g, '/');
    metafile.inputs[relInput] = { bytes: Buffer.byteLength(rawCode, 'utf8') };
    metafile.outputs[relOutput] = {
      entryPoint: relInput,
      bytes: Buffer.byteLength(outCode, 'utf8'),
      imports: entryImports,
      inputs: {
        [relInput]: { bytesInOutput: Buffer.byteLength(outCode, 'utf8') },
      },
    };
  }

  const relOutdir = path.relative(cwd, outdir).replace(/\\/g, '/') || 'public/dist';
  const relPublicDir = path.relative(cwd, publicDir).replace(/\\/g, '/') || 'public';
  const manifest = generateManifest(metafile, { outdir: relOutdir, publicDir: relPublicDir });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    result: { errors: [], warnings: [], metafile },
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
  discoverClientControllers,
  checkServerImportViolation,
  validateClientBundleBoundaries,
  createServerBoundaryPlugin,
  scanClientPages,
  expandGlob,
  resolveEntryPoints,
  DEFAULT_ENTRYPOINTS,
};
