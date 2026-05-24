/**
 * Phase 3 — Compile orchestrator
 * @module core/build/phases/03-compile/index
 */

const path = require('path');
const { compileApiRoutes } = require('./routes-api');
const { compileSsrRoutes } = require('./routes-ssr');
const { compileTemplates } = require('./templates');
const { buildMiddlewareManifest } = require('./middleware');
const { compilePlugins, runPluginBuildHooks } = require('./plugins');
const { configKey } = require('./routes-ssr');
const { handlerKey } = require('./routes-api');

/**
 * @param {import('../../index').BuildContextInternal} ctx
 * @param {object[]} analyzed
 * @param {string|null} viewsDir
 * @param {string|null} globalHooks
 */
async function compilePhase(ctx, analyzed, viewsDir, globalHooks) {
  await runPluginBuildHooks(ctx, 'build:analyze');

  const outSubdir = ctx.adapter.name === 'cloudflare' ? 'worker' : 'server';
  const outputDir = path.join(ctx.cwd, '.webspresso', outSubdir);

  const apiRoutes = analyzed.filter((r) => r.type === 'api');
  const ssrRoutes = analyzed.filter((r) => r.type === 'ssr');

  const api = compileApiRoutes(ctx, apiRoutes, outputDir);
  const ssr = compileSsrRoutes(ctx, ssrRoutes, outputDir);
  const tpl = compileTemplates(ctx, ssrRoutes, viewsDir);
  const middleware = buildMiddlewareManifest(analyzed);
  const { plugins } = await compilePlugins(ctx, ctx.config.plugins || []);

  const handlersSource = [api.handlersSource, ssr.ssrConfigSource].filter(Boolean).join('\n\n');

  /** @type {object[]} */
  const routeEntries = [];

  for (const route of analyzed) {
    if (route.type === 'api') {
      const hk = handlerKey(route, route.registrationIndex);
      routeEntries.push({
        id: route.id,
        type: 'api',
        method: route.method,
        pattern: route.pattern,
        tier: route.tier,
        registrationIndex: route.registrationIndex,
        source: { file: route.sourceFile },
        handler: { export: hk },
        middleware: route.middleware || [],
        schema: api.schemas[hk] || { compiled: false, jsonSchema: null },
      });
    } else {
      const ck = route.configAbsPath && require('fs').existsSync(route.configAbsPath)
        ? configKey(route)
        : null;
      const tplId = `tpl:${route.sourceFile}`;
      const namespaces = [];
      for (const key of Object.keys(tpl.i18n)) {
        if (key.startsWith('route:') && key.includes(pathDir(route.sourceFile))) {
          namespaces.push(key);
        }
      }
      for (const key of Object.keys(tpl.i18n)) {
        if (key.startsWith('global:')) namespaces.push(key);
      }

      routeEntries.push({
        id: route.id,
        type: 'ssr',
        method: 'GET',
        pattern: route.pattern,
        tier: route.tier,
        registrationIndex: route.registrationIndex,
        source: { page: route.sourceFile, config: route.configFile || null },
        handler: { configExport: ck, hooks: ['beforeLoad', 'load', 'afterRender'] },
        template: { id: tplId, renderMode: 'string' },
        middleware: route.middleware || [],
        i18n: { namespaces },
        seo: tpl.templates[tplId]?.frontmatter?.metaPatch || {},
      });
    }
  }

  return {
    handlersSource,
    routeEntries,
    templates: tpl.templates,
    i18n: tpl.i18n,
    middleware,
    plugins,
    hooks: { global: globalHooks },
  };
}

function pathDir(sourceFile) {
  const dir = sourceFile.replace(/\/[^/]+$/, '');
  return dir === sourceFile ? '' : dir;
}

module.exports = { compilePhase };
