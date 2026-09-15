'use strict';

/**
 * Webspresso Route Mounting Layer
 * Binds compiled RouteTable descriptors to Express routes with static/dynamic phase separation
 * @module src/routing/mount-discovered-routes
 */

const { createPageHandler } = require('../pages/page-loader');
const { createApiHandler } = require('../api/api-loader');
const { getRouteSortMeta } = require('./route-table');

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
