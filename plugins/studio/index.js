/**
 * Webspresso Studio — SSR developer visibility panel at /_webspresso
 */

const { resolveStudioConfig, DEFAULT_PATH } = require('./config');
const { createStudioGate } = require('./gate');
const { renderStudioPage } = require('./render');
const { createApiHandlers, buildStudioContext } = require('./api/handlers');
const { collectRoutes } = require('./collectors/routes');
const { collectPlugins } = require('./collectors/plugins');
const { collectHealth } = require('./collectors/health');
const { collectEnv } = require('./collectors/env');
const { collectCache } = require('./collectors/cache');
const { collectOrm } = require('./collectors/orm');
const { collectOpenapi } = require('./collectors/openapi');
const { collectSitemap } = require('./collectors/sitemap');
const { collectContent } = require('./collectors/content');
const { getRequestTimelineStore } = require('./services/request-timeline');
const { appendLog } = require('./services/log-buffer');

/**
 * @typedef {object} StudioResolvedConfig
 * @property {boolean} enabled
 * @property {string} path
 * @property {'dev-only'|'basic'|'none'} [auth]
 * @property {boolean} [exposeEnv]
 * @property {{ user: string, pass: string }} [basicAuth]
 * @property {{ enabled: boolean, maxEntries: number }} [requestTimeline]
 * @property {boolean} [cacheActions]
 * @property {number} [slowQueryThresholdMs]
 * @property {boolean} [inspectRoutes]
 */

/**
 * @param {import('./config').StudioResolvedConfig|boolean|object} [options]
 */
function studioPlugin(options = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const resolved = resolveStudioConfig(
    options === true ? { enabled: true } : options,
    nodeEnv
  );

  if (!resolved || !resolved.enabled) {
    return {
      name: 'studio',
      version: '1.0.0',
      description: 'Webspresso Studio (disabled)',
      onRoutesReady() {},
    };
  }

  const studioPath = resolved.path || DEFAULT_PATH;
  const api = createApiHandlers(resolved);
  const gate = createStudioGate(resolved, nodeEnv);

  /** @type {object|null} */
  let studioCtxRef = null;

  return {
    name: 'studio',
    version: '1.0.0',
    description: 'Webspresso Studio — developer visibility panel',
    studioConfigKeys: ['enabled', 'path', 'auth', 'exposeEnv', 'requestTimeline', 'cacheActions'],

    onRoutesReady(ctx) {
      ctx.options.pluginManager = ctx.options?.pluginManager;
      const pm = ctx.options?.pluginManager;
      if (pm && !pm.studioPluginRef) {
        pm.studioPluginRef = resolved;
      }

      const studioCtx = buildStudioContext(
        {
          ...ctx,
          pluginManager: pm,
          options: { ...ctx.options, pluginManager: pm, pagesDir: ctx.options?.pagesDir },
        },
        resolved
      );
      studioCtxRef = studioCtx;

      const db = ctx.db || ctx.options?.db;
      if (db?.knex && resolved.requestTimeline?.enabled) {
        const store = getRequestTimelineStore(resolved);
        store.attachKnex(db.knex);
      }

      appendLog('info', 'studio', 'Studio mounted', { path: studioPath });

      const wrap = (handler) => (req, res, next) => {
        gate(req, res, () => handler(req, res, next));
      };

      const mount = (method, routePath, handler) => {
        ctx.addRoute(method, routePath, wrap(handler));
      };

      mount('get', studioPath, async (req, res) => {
        const health = await collectHealth(studioCtx);
        const routes = collectRoutes(studioCtx);
        const plugins = collectPlugins(studioCtx.pluginManager);
        const store = getRequestTimelineStore(resolved);
        const html = renderStudioPage('overview', {
          studioPath,
          title: 'Overview',
          routeCount: routes.total,
          pluginCount: plugins.total,
          healthStatus: health.status,
          requestCount: store.getAll().length,
          recentRequests: store.getAll().slice(0, 20),
        });
        res.type('text/html');
        res.send(html);
      });

      mount('get', studioPath + '/routes', async (req, res) => {
        const data = collectRoutes(studioCtx, req.query);
        const html = renderStudioPage('routes', {
          studioPath,
          title: 'Routes',
          routes: data.routes,
          total: data.total,
        });
        res.type('text/html');
        res.send(html);
      });

      mount('get', studioPath + '/plugins', async (req, res) => {
        const data = collectPlugins(studioCtx.pluginManager);
        res.type('text/html');
        res.send(
          renderStudioPage('plugins', { studioPath, title: 'Plugins', plugins: data.plugins })
        );
      });

      mount('get', studioPath + '/health', async (req, res) => {
        const health = await collectHealth(studioCtx);
        res.type('text/html');
        res.send(renderStudioPage('health', { studioPath, title: 'Health', health }));
      });

      mount('get', studioPath + '/orm', async (req, res) => {
        const orm = await collectOrm(studioCtx);
        res.type('text/html');
        res.send(renderStudioPage('orm', { studioPath, title: 'ORM', orm }));
      });

      mount('get', studioPath + '/cache', async (req, res) => {
        const cache = collectCache(studioCtx);
        res.type('text/html');
        res.send(
          renderStudioPage('cache', {
            studioPath,
            title: 'Cache',
            cache,
            cacheActionsEnabled: resolved.cacheActions,
          })
        );
      });

      mount('get', studioPath + '/env', async (req, res) => {
        const envData = collectEnv(studioCtx);
        res.type('text/html');
        res.send(
          renderStudioPage('env', {
            studioPath,
            title: 'Environment',
            entries: envData.entries,
            missing: envData.missing,
            warnings: envData.warnings,
            exposeValues: envData.exposeValues,
          })
        );
      });

      mount('get', studioPath + '/openapi', async (req, res) => {
        const openapi = collectOpenapi(studioCtx);
        res.type('text/html');
        res.send(renderStudioPage('openapi', { studioPath, title: 'OpenAPI', openapi }));
      });

      mount('get', studioPath + '/sitemap', async (req, res) => {
        const sitemap = collectSitemap(studioCtx);
        res.type('text/html');
        res.send(renderStudioPage('sitemap', { studioPath, title: 'Sitemap', sitemap }));
      });

      mount('get', studioPath + '/content', async (req, res) => {
        const contentData = collectContent(studioCtx);
        res.type('text/html');
        res.send(renderStudioPage('content', { studioPath, title: 'Content', content: contentData }));
      });

      mount('get', studioPath + '/logs', async (req, res) => {
        const { getLogs } = require('./services/log-buffer');
        res.type('text/html');
        res.send(
          renderStudioPage('logs', {
            studioPath,
            title: 'Logs',
            logs: getLogs(req.query),
          })
        );
      });

      mount('get', studioPath + '/api/routes', (req, res) => api.routes(req, res, studioCtx));
      mount('get', studioPath + '/api/plugins', (req, res) => api.plugins(req, res, studioCtx));
      mount('get', studioPath + '/api/health', async (req, res) => api.health(req, res, studioCtx));
      mount('get', studioPath + '/api/env', (req, res) => api.env(req, res, studioCtx));
      mount('get', studioPath + '/api/cache', (req, res) => api.cache(req, res, studioCtx));
      mount('get', studioPath + '/api/orm', async (req, res) => api.orm(req, res, studioCtx));
      mount('get', studioPath + '/api/requests', (req, res) => api.requests(req, res));
      mount('get', studioPath + '/api/content', (req, res) => api.content(req, res, studioCtx));

      mount('get', studioPath + '/api/cache/clear', (req, res) => {
        res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
      });

      mount('post', studioPath + '/api/cache/clear', async (req, res) => {
        if (!resolved.cacheActions) {
          return res.status(403).json({ error: 'Cache actions disabled' });
        }
        const isProd = nodeEnv === 'production';
        const confirm =
          req.headers['x-studio-confirm'] === '1' ||
          req.body?.confirm === '1' ||
          req.body?.confirm === 1;
        if (isProd && !confirm) {
          return res.status(400).json({
            error: 'Production cache clear requires X-Studio-Confirm: 1 or body.confirm',
          });
        }
        const db = studioCtx.db;
        if (db?.cache?.clear) {
          db.cache.clear();
          appendLog('info', 'studio', 'Cache cleared');
          return res.json({ ok: true });
        }
        return res.status(400).json({ error: 'No cache to clear' });
      });

      if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        console.log(`\n  Studio: http://localhost:${process.env.PORT || 3000}${studioPath}\n`);
      }
    },
  };
}

module.exports = studioPlugin;
module.exports.resolveStudioConfig = resolveStudioConfig;
