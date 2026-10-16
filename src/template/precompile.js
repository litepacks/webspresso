'use strict';

/**
 * Webspresso - Nunjucks Template Pre-compiler & AOT Bundle
 * Pre-compiles Nunjucks templates into zero-parse, pure JavaScript functions to
 * eliminate disk reading and AST tokenization/parsing overhead during SSR.
 * @module src/template/precompile
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { parseNjkFrontmatter, frontmatterToPatches, seedProdRouteCache } = require('../njk-frontmatter');

const DEFAULT_PRECOMPILED_REL_PATH = path.join('.webspresso', 'templates.compiled.js');

/**
 * Recursively scans a directory for template files (.njk, .html).
 * @param {string} dir
 * @param {string} [baseDir=dir]
 * @returns {Array<{ absolutePath: string, relativePath: string }>}
 */
function scanTemplateDir(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...scanTemplateDir(full, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ext === '.njk' || ext === '.html') {
        const rel = path.relative(baseDir, full).split(path.sep).join('/');
        results.push({ absolutePath: full, relativePath: rel });
      }
    }
  }

  return results;
}

/**
 * Normalizes a template name for uniform lookup.
 * @param {string} name
 * @returns {string}
 */
function normalizeTemplateKey(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^views\//, '');
}

/**
 * Precompiles all Nunjucks templates in views/ and pages/ directories into an AOT bundle.
 *
 * @param {Object} [options={}]
 * @param {string} [options.rootDir=process.cwd()] - Project root directory
 * @param {string} [options.viewsDir] - Custom views directory path
 * @param {string} [options.pagesDir] - Custom pages directory path
 * @param {string} [options.outDir] - Directory where precompiled bundle is written
 * @param {string} [options.outFile] - Custom output file path
 * @param {import('nunjucks').Environment} [options.env] - Optional Nunjucks Environment
 * @returns {{ templateCount: number, manifestPath: string, bundle: Object }}
 */
function precompileTemplates(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const viewsDir = options.viewsDir ? path.resolve(options.viewsDir) : path.join(rootDir, 'views');
  const pagesDir = options.pagesDir ? path.resolve(options.pagesDir) : path.join(rootDir, 'pages');

  const env = options.env || new nunjucks.Environment([], { autoescape: true });

  const templates = {};
  const frontmatter = {};
  const processedKeys = new Set();

  const dirsToScan = [
    { dir: viewsDir, prefix: '', isViews: true },
    { dir: pagesDir, prefix: '', isPages: true },
  ];

  for (const { dir, isViews } of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    const files = scanTemplateDir(dir);

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file.absolutePath, 'utf8');
        const { body, fm, hasDelimiter } = parseNjkFrontmatter(raw);
        const patches = frontmatterToPatches(fm);

        const relToRoot = path.relative(rootDir, file.absolutePath).split(path.sep).join('/');
        frontmatter[relToRoot] = {
          useStringRender: false,
          templateBody: null,
          metaPatch: patches.metaPatch,
          dataPatch: patches.dataPatch,
        };

        const compiledArray = nunjucks.precompileString(body, {
          name: file.relativePath,
          asFunction: false,
          env,
          wrapper: (items) => items,
        });

        if (compiledArray && compiledArray[0] && compiledArray[0].template) {
          const code = compiledArray[0].template;
          templates[file.relativePath] = code;

          // Also register canonical stripped name for views
          const normalized = normalizeTemplateKey(file.relativePath);
          if (normalized !== file.relativePath) {
            templates[normalized] = code;
          }
          if (isViews && !file.relativePath.startsWith('views/')) {
            templates[`views/${file.relativePath}`] = code;
          }

          processedKeys.add(file.relativePath);
        }
      } catch (err) {
        console.warn(`[webspresso] Failed to precompile template "${file.relativePath}":`, err.message);
      }
    }
  }

  const bundle = {
    version: 1,
    generatedAt: new Date().toISOString(),
    templates,
    frontmatter,
  };

  const outFile = options.outFile
    ? path.resolve(options.outFile)
    : (options.outDir
        ? path.join(path.resolve(options.outDir), 'templates.compiled.js')
        : path.join(rootDir, DEFAULT_PRECOMPILED_REL_PATH));

  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const fileContent = `/**
 * Webspresso Precompiled Nunjucks Templates Bundle
 * Generated: ${bundle.generatedAt}
 * Total Templates: ${processedKeys.size}
 */
module.exports = ${JSON.stringify(bundle, null, 2)};
`;

  fs.writeFileSync(outFile, fileContent, 'utf8');

  return {
    templateCount: processedKeys.size,
    manifestPath: outFile,
    bundle,
  };
}

/**
 * Loads precompiled templates bundle from disk and constructs a PrecompiledLoader.
 *
 * @param {Object} [options={}]
 * @param {string} [options.rootDir=process.cwd()] - Project root directory
 * @param {string} [options.bundlePath] - Custom bundle file path
 * @returns {{ loader: import('nunjucks').PrecompiledLoader, templateCount: number, bundle: Object }|null}
 */
function loadPrecompiledTemplates(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const bundlePath = options.bundlePath
    ? path.resolve(options.bundlePath)
    : path.join(rootDir, DEFAULT_PRECOMPILED_REL_PATH);

  if (!fs.existsSync(bundlePath)) {
    return null;
  }

  try {
    // Delete require cache in case bundle was updated
    if (require.cache[require.resolve(bundlePath)]) {
      delete require.cache[require.resolve(bundlePath)];
    }

    const bundle = require(bundlePath);
    if (!bundle || typeof bundle.templates !== 'object') {
      return null;
    }

    const compiledMap = {};
    for (const [name, code] of Object.entries(bundle.templates)) {
      try {
        compiledMap[name] = (new Function(code))();
      } catch (compileErr) {
        console.warn(`[webspresso] Failed to evaluate precompiled template "${name}":`, compileErr.message);
      }
    }

    // Hydrate frontmatter cache for instant loadNjkRouteTemplate execution
    if (bundle.frontmatter && typeof bundle.frontmatter === 'object') {
      const absMap = {};
      for (const [relPath, fmData] of Object.entries(bundle.frontmatter)) {
        absMap[path.resolve(rootDir, relPath)] = fmData;
      }
      seedProdRouteCache(absMap);
    }

    const loader = new nunjucks.PrecompiledLoader(compiledMap);
    loader.cache = {};
    const origGetSource = loader.getSource.bind(loader);

    loader.getSource = function(name) {
      if (this.precompiled[name]) {
        return {
          src: { type: 'code', obj: this.precompiled[name] },
          path: name,
        };
      }
      const clean = normalizeTemplateKey(name);
      if (this.precompiled[clean]) {
        return {
          src: { type: 'code', obj: this.precompiled[clean] },
          path: clean,
        };
      }
      return null;
    };

    return {
      loader,
      templateCount: Object.keys(compiledMap).length,
      bundle,
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  DEFAULT_PRECOMPILED_REL_PATH,
  precompileTemplates,
  loadPrecompiledTemplates,
  normalizeTemplateKey,
};
