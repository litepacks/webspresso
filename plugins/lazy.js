/**
 * Webspresso On-Demand (Lazy) Plugin Wrapper
 *
 * Defers execution of heavy plugin initialization, filesystem scans, route mounting,
 * and dependency loading until the plugin is actually accessed via:
 * 1. HTTP request matching its configured URL prefix (e.g. /_admin)
 * 2. Service execution (e.g. ctx.service('email.send'))
 * 3. Direct inter-plugin API access (e.g. ctx.usePlugin('admin-panel'))
 * 4. Template helper execution (e.g. fsy.adminHelper())
 * 5. Explicit programmatic hydration (lazyPlugin.hydrate())
 *
 * @module plugins/lazy
 */

const express = require('express');
const { ensureArray } = require('../core/utils/object');

/**
 * Wraps a plugin definition or factory function into an on-demand lazy plugin.
 *
 * @param {Function|Object} pluginFactory - Factory `() => plugin` or plugin definition object
 * @param {Object} [lazyOptions={}]
 * @param {string} [lazyOptions.name] - Plugin name (inferred if not provided)
 * @param {string|string[]} [lazyOptions.prefix] - URL path prefix(es) that trigger on-demand hydration (e.g. '/_admin')
 * @param {string[]} [lazyOptions.services=[]] - Service names that trigger on-demand hydration
 * @param {string[]} [lazyOptions.helpers=[]] - Template helpers that trigger on-demand hydration
 * @param {string[]} [lazyOptions.events=[]] - Event names that trigger on-demand hydration
 * @param {Object} [lazyOptions.dependencies] - Plugin dependencies
 * @param {Object} [lazyOptions.csp] - Content Security Policy requirements
 * @param {Function} [lazyOptions.onHydrate] - Callback invoked when hydration finishes
 * @returns {Object} Webspresso Lazy Plugin definition
 */
function lazyPlugin(pluginFactory, lazyOptions = {}) {
  let realPlugin = null;
  let isHydrated = false;
  let isHydrating = false;

  let regCtx = null;
  let routesCtx = null;
  const router = express.Router();

  const name =
    lazyOptions.name ||
    (typeof pluginFactory === 'object' && pluginFactory ? pluginFactory.name : null) ||
    'anonymous-lazy-plugin';

  const rawPrefixes = ensureArray(lazyOptions.prefix);
  // Normalize prefixes: ensure leading slash, remove trailing slash (except root '/')
  const prefixes = rawPrefixes.map(p => {
    let norm = String(p).trim();
    if (!norm.startsWith('/')) norm = '/' + norm;
    if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    return norm;
  });

  const lazyServices = ensureArray(lazyOptions.services);
  const lazyHelpers = ensureArray(lazyOptions.helpers);
  const lazyEvents = ensureArray(lazyOptions.events);

  function hydrate() {
    if (isHydrated) return realPlugin;
    if (isHydrating) return realPlugin;
    isHydrating = true;

    try {
      realPlugin = typeof pluginFactory === 'function' ? pluginFactory() : pluginFactory;
      if (!realPlugin) {
        throw new Error(`[lazyPlugin] Factory for plugin "${name}" did not return a valid plugin object`);
      }

      // 1. Call setup hook if present
      if (typeof realPlugin.setup === 'function' && regCtx?.app) {
        const disposer = realPlugin.setup(regCtx.app);
        if (typeof disposer === 'function' && regCtx.onDispose) {
          regCtx.onDispose(disposer);
        }
      }

      // 2. Call register hook
      if (typeof realPlugin.register === 'function' && regCtx) {
        const disposer = realPlugin.register(regCtx);
        if (typeof disposer === 'function' && regCtx.onDispose) {
          regCtx.onDispose(disposer);
        }
      }

      // 3. Register real routes onto the lazy router
      if (typeof realPlugin.onRoutesReady === 'function' && routesCtx) {
        const customRoutesCtx = {
          ...routesCtx,
          addRoute(method, routePath, ...handlers) {
            const m = String(method).toLowerCase();
            let matchedPrefix = null;
            for (const p of prefixes) {
              if (routePath === p || routePath.startsWith(p + '/')) {
                matchedPrefix = p;
                break;
              }
            }

            if (matchedPrefix) {
              // Convert absolute route path to router-relative subpath
              let subPath = routePath.slice(matchedPrefix.length);
              if (!subPath || !subPath.startsWith('/')) {
                subPath = '/' + (subPath || '');
              }
              if (router[m]) {
                router[m](subPath, ...handlers);
              } else if (router.all) {
                router.all(subPath, ...handlers);
              }
            } else {
              // Route is outside configured prefix: mount directly on app
              if (routesCtx.addRoute) {
                routesCtx.addRoute(method, routePath, ...handlers);
              } else if (routesCtx.app && routesCtx.app[m]) {
                routesCtx.app[m](routePath, ...handlers);
              }
            }
          },
        };

        const disposer = realPlugin.onRoutesReady(customRoutesCtx);
        if (typeof disposer === 'function' && routesCtx.onDispose) {
          routesCtx.onDispose(disposer);
        }
      }

      // 4. Update exposed API
      if (realPlugin.api && lazyWrapper.api) {
        Object.assign(lazyWrapper.api, realPlugin.api);
      }

      // 5. Fire optional callback
      if (typeof lazyOptions.onHydrate === 'function') {
        try {
          lazyOptions.onHydrate(realPlugin);
        } catch (_) {}
      }

      isHydrated = true;
      return realPlugin;
    } finally {
      isHydrating = false;
    }
  }

  // Create API Proxy that auto-hydrates on property access
  const apiProxy = new Proxy({}, {
    get(target, prop, receiver) {
      if (prop === '_isLazyProxy') return true;
      if (prop === 'hydrate') return hydrate;
      if (prop === 'isHydrated') return isHydrated;
      hydrate();
      if (realPlugin && realPlugin.api) {
        const val = Reflect.get(realPlugin.api, prop, receiver);
        return typeof val === 'function' ? val.bind(realPlugin.api) : val;
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      hydrate();
      return realPlugin && realPlugin.api ? Reflect.has(realPlugin.api, prop) : Reflect.has(target, prop);
    },
    set(target, prop, value, receiver) {
      hydrate();
      if (realPlugin && realPlugin.api) {
        return Reflect.set(realPlugin.api, prop, value, receiver);
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });

  const lazyWrapper = {
    name,
    version: lazyOptions.version || (typeof pluginFactory === 'object' && pluginFactory?.version) || '1.0.0',
    dependencies: lazyOptions.dependencies || (typeof pluginFactory === 'object' && pluginFactory?.dependencies) || {},
    csp: lazyOptions.csp || (typeof pluginFactory === 'object' && pluginFactory?.csp) || null,
    isLazy: true,
    get isHydrated() { return isHydrated; },
    hydrate,
    api: apiProxy,

    register(ctx) {
      regCtx = ctx;

      // Register proxy services in app service registry
      if (ctx.app && ctx.app.serviceRegistry && lazyServices.length > 0) {
        for (const svcName of lazyServices) {
          if (!ctx.app.serviceRegistry.has(svcName)) {
            const proxyHandler = async (input, serviceCtx) => {
              hydrate();
              const realDef = ctx.app.serviceRegistry.get(svcName);
              if (realDef && typeof realDef.handler === 'function' && realDef.handler !== proxyHandler) {
                return typeof realDef.rawHandler === 'function'
                  ? realDef.rawHandler(input, serviceCtx)
                  : realDef.handler(input, serviceCtx);
              }
              return null;
            };

            ctx.app.serviceRegistry.register(
              svcName,
              { handler: proxyHandler },
              { overwrite: true }
            );
          }
        }
      }

      // Register proxy helpers in template engine
      if (typeof ctx.addHelper === 'function' && lazyHelpers.length > 0) {
        for (const helperName of lazyHelpers) {
          ctx.addHelper(helperName, (...args) => {
            hydrate();
            const helpers = regCtx?.pluginManager?.getHelpers ? regCtx.pluginManager.getHelpers() : {};
            if (typeof helpers[helperName] === 'function') {
              return helpers[helperName](...args);
            }
          });
        }
      }

      // Wire event triggers if eventDispatcher is available
      if (ctx.app?.events && lazyEvents.length > 0) {
        for (const eventName of lazyEvents) {
          ctx.app.events.on(eventName, () => {
            hydrate();
          });
        }
      }
    },

    onRoutesReady(ctx) {
      routesCtx = ctx;

      if (!ctx.app) return;

      // Mount lazy trigger router for each prefix
      for (const prefix of prefixes) {
        ctx.app.use(prefix, (req, res, next) => {
          if (!isHydrated) {
            hydrate();
          }
          router(req, res, next);
        });
      }
    },
  };

  return lazyWrapper;
}

module.exports = {
  lazyPlugin,
  defineLazyPlugin: lazyPlugin,
};
