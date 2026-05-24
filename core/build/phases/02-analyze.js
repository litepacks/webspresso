/**
 * Phase 2 — Static analysis (imports, njk deps, edge constraints)
 * @module core/build/phases/02-analyze
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN_EDGE = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
  'child_process',
  'better-sqlite3',
  'bcrypt',
  'sharp',
]);

const NJK_DIRECTIVE = /\{%-?\s*(extends|include|import)\s+["']([^"']+)["']/g;

/**
 * @param {string} source
 * @returns {string[]}
 */
function extractRequires(source) {
  const imports = [];
  const re = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  const re2 = /from\s+['"]([^'"]+)['"]/g;
  while ((m = re2.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * @param {string} content
 * @returns {{ extends: string | null, includes: string[], imports: string[] }}
 */
function parseNjkDirectives(content) {
  /** @type {string | null} */
  let extendsTarget = null;
  const includes = [];
  const imports = [];
  let m;
  while ((m = NJK_DIRECTIVE.exec(content)) !== null) {
    const kind = m[1];
    const target = m[2];
    if (kind === 'extends') extendsTarget = target;
    else if (kind === 'include') includes.push(target);
    else if (kind === 'import') imports.push(target);
  }
  return { extends: extendsTarget, includes, imports };
}

/**
 * Resolve njk path against pagesDir and viewsDir
 * @param {string} ref
 * @param {string} fromFile
 * @param {string} pagesDir
 * @param {string | null} viewsDir
 */
function resolveNjkPath(ref, fromFile, pagesDir, viewsDir) {
  const candidates = [];
  const fromDir = path.dirname(fromFile);
  candidates.push(path.join(fromDir, ref));
  if (viewsDir) {
    candidates.push(path.join(viewsDir, ref));
    candidates.push(path.join(viewsDir, path.basename(ref)));
  }
  candidates.push(path.join(pagesDir, ref));

  for (const c of candidates) {
    const withExt = c.endsWith('.njk') ? c : `${c}.njk`;
    if (fs.existsSync(withExt)) return withExt;
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * @param {import('../index').BuildContextInternal} ctx
 * @param {object[]} routes
 */
function analyzeRoutes(ctx, routes) {
  const pagesDir = path.resolve(ctx.cwd, ctx.config.pagesDir || 'pages');
  const viewsDir = ctx.config.viewsDir
    ? path.resolve(ctx.cwd, ctx.config.viewsDir)
    : fs.existsSync(path.join(ctx.cwd, 'views'))
      ? path.join(ctx.cwd, 'views')
      : null;

  /** @type {object[]} */
  const analyzed = [];
  /** @type {import('../errors/build-error').BuildError[]} */
  const edgeIssues = [];

  for (const route of routes) {
    const entry = { ...route, imports: [], njk: null, unresolvedTemplates: [] };

    if (route.type === 'api' && fs.existsSync(route.absPath)) {
      const src = fs.readFileSync(route.absPath, 'utf8');
      entry.imports = extractRequires(src);
      for (const imp of entry.imports) {
        if (ctx.adapter.name === 'cloudflare' && FORBIDDEN_EDGE.has(imp)) {
          edgeIssues.push({
            code: 'WS_BUILD_EDGE_INCOMPATIBLE',
            message: `${route.sourceFile} imports "${imp}"`,
            file: route.sourceFile,
            hint: 'Use edge-compatible APIs or switch adapter to "node".',
          });
        }
      }
    }

    if (route.type === 'ssr' && fs.existsSync(route.absPath)) {
      const src = fs.readFileSync(route.absPath, 'utf8');
      entry.njk = parseNjkDirectives(src);
      for (const inc of entry.njk.includes) {
        const resolved = resolveNjkPath(inc, route.absPath, pagesDir, viewsDir);
        if (resolved) {
          const rel = path.relative(ctx.cwd, resolved).split(path.sep).join('/');
          ctx.graph.addEdge(`tpl:${route.sourceFile}`, `tpl:${rel}`, 'include');
        } else {
          entry.unresolvedTemplates.push(inc);
        }
      }
      if (entry.njk.extends) {
        const resolved = resolveNjkPath(entry.njk.extends, route.absPath, pagesDir, viewsDir);
        if (resolved) {
          const rel = path.relative(ctx.cwd, resolved).split(path.sep).join('/');
          ctx.graph.addEdge(`tpl:${route.sourceFile}`, `tpl:${rel}`, 'extends');
        } else {
          entry.unresolvedTemplates.push(entry.njk.extends);
        }
      }
    }

    if (route.configAbsPath && fs.existsSync(route.configAbsPath)) {
      const src = fs.readFileSync(route.configAbsPath, 'utf8');
      entry.configImports = extractRequires(src);
      const mwMatch = src.match(/middleware\s*:\s*(\[[\s\S]*?\])/);
      entry.middlewareRaw = mwMatch ? mwMatch[1] : null;
      try {
        const mod = require(route.configAbsPath);
        entry.middleware = Array.isArray(mod.middleware) ? mod.middleware : [];
      } catch {
        entry.middleware = [];
      }
    } else {
      entry.middleware = [];
    }

    analyzed.push(entry);
  }

  const hooksPath = path.join(pagesDir, '_hooks.js');
  let globalHooks = null;
  if (fs.existsSync(hooksPath)) {
    globalHooks = 'pages/_hooks.js';
    ctx.graph.addNode('file:pages/_hooks.js', 'hooks', require('../graph/hash').hashFile(hooksPath));
  }

  return { analyzed, globalHooks, edgeIssues, viewsDir };
}

module.exports = {
  analyzeRoutes,
  extractRequires,
  parseNjkDirectives,
  resolveNjkPath,
  FORBIDDEN_EDGE,
};
