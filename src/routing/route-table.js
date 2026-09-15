'use strict';

/**
 * Webspresso Route Table & Compiler
 * Compiles route descriptors, performs conflict checks, sorts deterministically, and provides introspection
 * @module src/routing/route-table
 */

/**
 * Computes route sorting priority metadata
 * @param {string} routePath
 * @returns {{ tier: number, literalSegCount: number, paramSegCount: number, depth: number, routePath: string }}
 */
function getRouteSortMeta(routePath) {
  let hasStar = false;
  let hasColon = false;
  let depth = 0;
  let literalSegCount = 0;
  let paramSegCount = 0;

  const clean = routePath.split('?')[0];
  const segments = clean.split('/').filter(Boolean);

  for (const seg of segments) {
    depth++;
    if (seg.includes('*')) {
      hasStar = true;
    } else if (seg.includes(':')) {
      hasColon = true;
      paramSegCount++;
    } else {
      literalSegCount++;
    }
  }

  // Tier 0: Pure static (/about, /users)
  // Tier 1: Parameterized (/users/:id)
  // Tier 2: Catch-all (/docs/*)
  let tier = 0;
  if (hasStar) tier = 2;
  else if (hasColon) tier = 1;

  return {
    tier,
    literalSegCount,
    paramSegCount,
    depth,
    routePath,
  };
}

/**
 * Comparator for deterministic route registration order
 * @param {Object} a - Route descriptor
 * @param {Object} b - Route descriptor
 * @returns {number}
 */
function compareRouteOrder(a, b) {
  const ma = a._sortMeta || getRouteSortMeta(a.path);
  const mb = b._sortMeta || getRouteSortMeta(b.path);

  if (ma.tier !== mb.tier) return ma.tier - mb.tier;
  if (ma.literalSegCount !== mb.literalSegCount) return mb.literalSegCount - ma.literalSegCount;
  if (ma.depth !== mb.depth) return mb.depth - ma.depth;
  if (ma.paramSegCount !== mb.paramSegCount) return ma.paramSegCount - mb.paramSegCount;
  return ma.routePath.localeCompare(mb.routePath);
}

/**
 * Immutable Route Table representing all compiled application routes
 */
class RouteTable {
  /**
   * @param {Array<Object>} routes - Sorted, validated route descriptors
   */
  constructor(routes = []) {
    this.routes = Object.freeze([...routes]);
    this._map = new Map();

    for (const r of this.routes) {
      const key = `${r.method.toUpperCase()} ${r.path}`;
      this._map.set(key, r);
    }
  }

  /**
   * Returns a copy of route introspection metadata
   * @returns {Array<{ method: string, path: string, type: string, module: string|null, source: string, description?: string, tags?: string[] }>}
   */
  list() {
    return this.routes.map((r) => ({
      method: r.method.toUpperCase(),
      path: r.path,
      type: r.type,
      module: r.module || null,
      source: r.source || r.file,
      description: r.description,
      tags: r.tags,
    }));
  }

  /**
   * Retrieves a route descriptor by method and path
   * @param {string} method
   * @param {string} path
   * @returns {Object|undefined}
   */
  get(method, path) {
    return this._map.get(`${method.toUpperCase()} ${path}`);
  }

  /**
   * Checks if a route exists in the table
   * @param {string} method
   * @param {string} path
   * @returns {boolean}
   */
  has(method, path) {
    return this._map.has(`${method.toUpperCase()} ${path}`);
  }

  /**
   * Returns the count of routes
   * @returns {number}
   */
  get size() {
    return this.routes.length;
  }
}

/**
 * Compiles discovered route descriptors into an immutable RouteTable
 * @param {Array<Object>} descriptors - Discovered route descriptors
 * @param {Object} [options]
 * @param {Array<Object>} [options.explicitRoutes=[]] - Manual user-configured routes
 * @param {boolean} [options.isDev=false] - Development mode flag
 * @returns {RouteTable}
 */
function compileRouteTable(descriptors = [], options = {}) {
  const { explicitRoutes = [], isDev = process.env.NODE_ENV !== 'production' } = options;

  const routeMap = new Map();
  const explicitKeys = new Set(
    explicitRoutes.map((r) => `${(r.method || 'GET').toUpperCase()} ${r.path}`)
  );

  const safeDescriptors = Array.isArray(descriptors) ? descriptors : [];
  for (const descriptor of safeDescriptors) {
    if (!descriptor || typeof descriptor !== 'object' || !descriptor.path || !descriptor.method) continue;

    const method = descriptor.method.toUpperCase();
    const key = `${method} ${descriptor.path}`;

    // 1. Check if overridden by explicit route
    if (explicitKeys.has(key)) {
      if (isDev) {
        console.warn(`[webspresso] Generated route ${key} was overridden by an explicit route.`);
      }
      continue;
    }

    // 2. Conflict detection: check for duplicate route registrations
    if (routeMap.has(key)) {
      const existing = routeMap.get(key);
      const existingSrc = existing.source || existing.file;
      const currentSrc = descriptor.source || descriptor.file;

      throw new Error(
        `Route conflict detected:\n\n` +
          `${key}\n\n` +
          `  ${existingSrc}\n` +
          `  ${currentSrc}\n`
      );
    }

    descriptor._sortMeta = getRouteSortMeta(descriptor.path);
    routeMap.set(key, descriptor);
  }

  // Sort routes deterministically
  const sortedRoutes = Array.from(routeMap.values()).sort(compareRouteOrder);

  return new RouteTable(sortedRoutes);
}

module.exports = {
  RouteTable,
  compileRouteTable,
  compareRouteOrder,
  getRouteSortMeta,
};
