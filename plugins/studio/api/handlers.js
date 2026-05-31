const { collectRoutes } = require('../collectors/routes');
const { collectPlugins } = require('../collectors/plugins');
const { collectHealth } = require('../collectors/health');
const { collectEnv } = require('../collectors/env');
const { collectCache } = require('../collectors/cache');
const { collectOrm } = require('../collectors/orm');
const { collectOpenapi } = require('../collectors/openapi');
const { collectSitemap } = require('../collectors/sitemap');
const { getRequestTimelineStore } = require('../services/request-timeline');
const { getLogs } = require('../services/log-buffer');

/**
 * Build studio context from plugin onRoutesReady ctx.
 * @param {object} ctx
 * @param {object} studioConfig
 */
function buildStudioContext(ctx, studioConfig) {
  return {
    ...ctx,
    studioConfig,
    routes: ctx.routes,
    pluginManager: ctx.options?.pluginManager || ctx.pluginManager,
    options: ctx.options,
    db: ctx.db,
  };
}

function createApiHandlers(studioConfig) {
  return {
    async routes(req, res, studioCtx) {
      const data = collectRoutes(studioCtx, req.query);
      return res.json(data);
    },
    async plugins(req, res, studioCtx) {
      return res.json(collectPlugins(studioCtx.pluginManager));
    },
    async health(req, res, studioCtx) {
      return res.json(await collectHealth(studioCtx));
    },
    async env(req, res, studioCtx) {
      return res.json(collectEnv(studioCtx));
    },
    async cache(req, res, studioCtx) {
      return res.json(collectCache(studioCtx));
    },
    async orm(req, res, studioCtx) {
      return res.json(await collectOrm(studioCtx));
    },
    async openapi(req, res, studioCtx) {
      return res.json(collectOpenapi(studioCtx));
    },
    async requests(req, res) {
      const store = getRequestTimelineStore(studioConfig);
      return res.json({ total: store.getAll().length, requests: store.getAll() });
    },
    async logs(req, res) {
      return res.json({ logs: getLogs(req.query) });
    },
  };
}

module.exports = { createApiHandlers, buildStudioContext };
