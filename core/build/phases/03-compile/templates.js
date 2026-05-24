/**
 * Template bundling — frontmatter, include flatten (v1: renderString body)
 * @module core/build/phases/03-compile/templates
 */

const fs = require('fs');
const path = require('path');
const { parseNjkFrontmatter, frontmatterToPatches } = require('../../../../src/njk-frontmatter');
const { parseNjkDirectives, resolveNjkPath } = require('../02-analyze');
const { sha256, hashFile } = require('../../graph/hash');

/**
 * Inline {% include %} directives (simple v1 — no block extends merge)
 * @param {string} body
 * @param {string} absPath
 * @param {string} pagesDir
 * @param {string|null} viewsDir
 * @param {Set<string>} visited
 */
function flattenIncludes(body, absPath, pagesDir, viewsDir, visited = new Set()) {
  let result = body;
  const { includes } = parseNjkDirectives(body);
  for (const inc of includes) {
    const resolved = resolveNjkPath(inc, absPath, pagesDir, viewsDir);
    if (!resolved || visited.has(resolved)) continue;
    visited.add(resolved);
    const incContent = fs.readFileSync(resolved, 'utf8');
    const { body: incBody } = parseNjkFrontmatter(incContent);
    const flattened = flattenIncludes(incBody, resolved, pagesDir, viewsDir, visited);
    const tag = new RegExp(`\\{%-?\\s*include\\s+["']${inc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*-?%\\}`, 'g');
    result = result.replace(tag, flattened);
  }
  return result;
}

/**
 * @param {import('../../index').BuildContextInternal} ctx
 * @param {object[]} ssrRoutes
 * @param {string|null} viewsDir
 */
function compileTemplates(ctx, ssrRoutes, viewsDir) {
  const pagesDir = path.resolve(ctx.cwd, ctx.config.pagesDir || 'pages');
  /** @type {Record<string, object>} */
  const templates = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const i18n = {};

  for (const route of ssrRoutes) {
    if (!fs.existsSync(route.absPath)) continue;
    const raw = fs.readFileSync(route.absPath, 'utf8');
    const { body, fm } = parseNjkFrontmatter(raw);
    const patches = frontmatterToPatches(fm);
    let flatBody = flattenIncludes(body, route.absPath, pagesDir, viewsDir);
    const tplId = `tpl:${route.sourceFile}`;

    templates[tplId] = {
      body: flatBody,
      includes: route.njk?.includes || [],
      extends: route.njk?.extends || null,
      frontmatter: patches,
      hash: sha256(flatBody),
    };

    ctx.graph.addNode(tplId, 'template', templates[tplId].hash);

    const routeDir = path.dirname(route.absPath);
    const localesDir = path.join(routeDir, 'locales');
    if (fs.existsSync(localesDir)) {
      for (const f of fs.readdirSync(localesDir)) {
        if (!f.endsWith('.json')) continue;
        const locale = f.replace('.json', '');
        const ns = `route:${path.dirname(route.sourceFile)}:${locale}`;
        i18n[ns] = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
      }
    }
  }

  const globalLocales = path.join(pagesDir, 'locales');
  if (fs.existsSync(globalLocales)) {
    for (const f of fs.readdirSync(globalLocales)) {
      if (!f.endsWith('.json')) continue;
      const locale = f.replace('.json', '');
      i18n[`global:${locale}`] = JSON.parse(fs.readFileSync(path.join(globalLocales, f), 'utf8'));
    }
  }

  return { templates, i18n };
}

module.exports = { compileTemplates, flattenIncludes };
