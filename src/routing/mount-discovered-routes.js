'use strict';

/**
 * Webspresso Route Mounting Layer
 * Binds compiled RouteTable descriptors to Express routes with static/dynamic phase separation
 * @module src/routing/mount-discovered-routes
 */

const { createPageHandler } = require('../pages/page-loader');
const { createApiHandler } = require('../api/api-loader');
const { getRouteSortMeta } = require('./route-table');
const { createFragmentRefreshHandler } = require('../../core/client/server-fragments');
const { createHelpers } = require('../helpers');
const { resolveMiddlewares } = require('../file-router');

const NOOP = () => {};

/**
 * Mounts discovered routes onto the Express application
 * @param {import('express').Application} app
 * @param {import('./route-table').RouteTable} routeTable
 * @param {Object} context - Server context
 * @returns {{ routeMetadata: Array, registerDynamicDiscoveredRoutes: Function }}
 */
function mountDiscoveredRoutes(app, routeTable, context) {
  const { silent = false } = context;
  const log = silent ? NOOP : console.log.bind(console);

  const staticRoutes = [];
  const dynamicRoutes = [];
  const routeMetadata = [];

  for (const descriptor of routeTable.routes) {
    const sortMeta = descriptor._sortMeta || getRouteSortMeta(descriptor.path);
    if (sortMeta.tier === 0) {
      staticRoutes.push(descriptor);
    } else {
      dynamicRoutes.push(descriptor);
    }

    routeMetadata.push({
      file: descriptor.source || descriptor.file,
      method: descriptor.method.toUpperCase(),
      path: descriptor.path,
      type: descriptor.type,
      module: descriptor.module || null,
    });
  }

  function bindRoute(descriptor) {
    const method = descriptor.method.toLowerCase();
    const handler =
      descriptor.type === 'page'
        ? createPageHandler(descriptor, context)
        : createApiHandler(descriptor, context);

    app[method](descriptor.path, handler);
    log(`  ${descriptor.method.toUpperCase().padEnd(6)} ${descriptor.path} -> ${descriptor.source || descriptor.file}`);
  }

  // Record discovered page entries for `/__webspresso/fragments` refresh handler
  const discoveredPageEntries = routeTable.routes
    .filter((r) => r.type === 'page')
    .map((r) => ({
      routePath: r.path,
      file: r.file,
      getPageMod: () => {
        if (!r.file || !r.file.endsWith('.js')) return null;
        try {
          if (context.isDev && require.cache[require.resolve(r.file)]) {
            delete require.cache[require.resolve(r.file)];
          }
          const mod = require(r.file);
          return typeof mod === 'function' ? { load: mod } : mod.default || mod;
        } catch (_e) {
          return null;
        }
      },
      cascadingMiddlewares: [],
    }));

  app.__discoveredPageEntries = discoveredPageEntries;

  if (!app.__fragmentRefreshMounted && context.nunjucks) {
    app.__fragmentRefreshMounted = true;
    const fragmentRefreshHandler = createFragmentRefreshHandler({
      getPageEntries: () => [
        ...(app.__ssrPageEntries || []),
        ...(app.__discoveredPageEntries || []),
      ],
      nunjucksEnv: context.nunjucks,
      buildFsy: (req) => createHelpers({ req, res: req.res }),
      buildContext: (req, res, { fsy }) => {
        const ctx = {
          req,
          res,
          db: context.db || null,
          fsy,
          params: req.params || {},
          query: req.query || {},
          user: req.user,
          auth: req.auth,
          session: req.session,
          service: (name, input, opts) => {
            if (context.serviceRegistry) {
              return context.serviceRegistry.call(name, input, ctx, opts);
            }
            throw new Error(`Services not configured. Cannot call service '${name}'.`);
          },
        };
        ctx.ctx = ctx;
        req.context = ctx;
        req.ctx = ctx;
        req.req = req;
        req.res = res;
        if (context.db && !req.db) req.db = context.db;
        if (!req.service) req.service = ctx.service;
        return ctx;
      },
      resolveMiddlewareList: (mwList) => resolveMiddlewares(mwList, context.middlewares || {}),
    });

    const { rateLimit } = require('../../core/rate-limit');
    const fragmentLimiter = rateLimit({
      window: 60000,
      limit: 300,
      skip: () => process.env.NODE_ENV === 'test',
    });

    app.get('/__webspresso/fragments', fragmentLimiter, fragmentRefreshHandler);
    app.post('/__webspresso/fragments', fragmentLimiter, fragmentRefreshHandler);
  }

  // Phase 1: Mount static routes immediately
  for (const r of staticRoutes) {
    bindRoute(r);
  }

  // Phase 2: Deferred function to mount dynamic and catch-all routes after plugins
  function registerDynamicDiscoveredRoutes() {
    for (const r of dynamicRoutes) {
      bindRoute(r);
    }
  }

  return {
    routeMetadata,
    registerDynamicDiscoveredRoutes,
  };
}

module.exports = {
  mountDiscoveredRoutes,
};
