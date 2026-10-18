'use strict';

/**
 * Webspresso Dashboard Plugin
 * Development dashboard for monitoring routes, ORM models, services, plugins, and configuration
 * Uses Mithril.js for the SPA interface
 * @module plugins/dashboard
 */

const styles = require('./styles');
const appScript = require('./app');
const { getAllModels } = require('../../core/orm/model');
const { getServiceRegistry, hasServiceRegistry, hasDb, getDb } = require('../../src/app-context');

/**
 * Filter sensitive environment variables
 * @param {Object} env
 * @returns {Object}
 */
function filterSensitiveEnv(env) {
  const sensitiveKeys = ['SECRET', 'PASSWORD', 'KEY', 'TOKEN', 'CREDENTIAL', 'PRIVATE'];
  const filtered = {};

  for (const [key, value] of Object.entries(env)) {
    const isSensitive = sensitiveKeys.some((s) => key.toUpperCase().includes(s));
    filtered[key] = isSensitive ? '••••••••' : value;
  }

  return filtered;
}

/**
 * Safely collects all registered ORM models
 * @returns {Array<Object>}
 */
function collectModels() {
  try {
    const models = getAllModels();
    const result = [];
    for (const [name, model] of models.entries()) {
      result.push({
        name,
        table: model.table || name.toLowerCase(),
        primaryKey: model.primaryKey || 'id',
        columns: model.schema && model.schema.shape ? Object.keys(model.schema.shape) : [],
        columnCount: model.schema && model.schema.shape ? Object.keys(model.schema.shape).length : 0,
        relations: Object.keys(model.relations || {}),
        scopes: Object.keys(model.scopes || {}),
        softDelete: Boolean(model.scopes?.softDelete || model.scopes?.notDeleted || model.softDelete || model.paranoid),
        cache: model.cache || false,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Safely collects all registered business services
 * @returns {Array<Object>}
 */
function collectServices() {
  try {
    if (!hasServiceRegistry()) return [];
    const registry = getServiceRegistry();
    const result = [];
    if (registry && registry.services) {
      for (const [name, def] of registry.services.entries()) {
        result.push({
          name,
          transaction: Boolean(def.transaction),
          auth: def.auth !== undefined ? def.auth : false,
          timeout: def.timeout || null,
          hasSchema: Boolean(def.schema),
          cache: def.cache ? true : false,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Generate the dashboard HTML
 * @param {Object} data
 * @returns {string}
 */
function generateDashboardHtml(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webspresso Dashboard</title>
  <script src="https://unpkg.com/mithril/mithril.js"></script>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.__DASHBOARD_DATA__ = ${JSON.stringify(data)};
  </script>
  <script>${appScript}</script>
</body>
</html>`;
}

/**
 * Create the dashboard plugin
 * @param {Object} options - Plugin options
 * @param {string} [options.path='/_webspresso'] - Dashboard path
 * @param {boolean} [options.enabled] - Force enable/disable (default: auto based on NODE_ENV)
 */
function dashboardPlugin(options = {}) {
  const {
    path: dashboardPath = '/_webspresso',
    enabled,
  } = options;

  // Determine if enabled (default: only in development)
  const isEnabled = enabled !== undefined
    ? enabled
    : process.env.NODE_ENV !== 'production';

  return {
    name: 'dashboard',
    version: '1.0.0',
    description: 'Development dashboard for monitoring routes, models, services, and configuration',

    /**
     * Called after routes are mounted
     */
    onRoutesReady(ctx) {
      // Skip if disabled
      if (!isEnabled) {
        return;
      }

      const { app, routes = [], options: appOptions = {} } = ctx;

      // Collect plugin info
      const pluginManager = ctx.pluginManager || appOptions.pluginManager;
      const plugins = [];

      // Get plugins from plugin manager if available
      if (pluginManager && pluginManager.plugins) {
        for (const [name, plugin] of pluginManager.plugins) {
          plugins.push({
            name: plugin.name || name,
            version: plugin.version || '0.0.0',
            description: plugin.description || '',
          });
        }
      }

      // Collect models and services
      const models = collectModels();
      const services = collectServices();

      // Build config data
      const config = {
        env: filterSensitiveEnv({
          NODE_ENV: process.env.NODE_ENV || 'development',
          PORT: process.env.PORT || '7331',
          BASE_URL: process.env.BASE_URL || 'http://localhost:7331',
        }),
        i18n: {
          defaultLocale: process.env.DEFAULT_LOCALE || 'en',
          supportedLocales: (process.env.SUPPORTED_LOCALES || 'en').split(','),
        },
        server: {
          port: process.env.PORT || '7331',
          baseUrl: process.env.BASE_URL || 'http://localhost:7331',
        },
        database: {
          connected: hasDb(),
          dialect: hasDb() ? (getDb().client || getDb().knex?.client?.config?.client || 'knex') : 'none',
        },
      };

      const overview = {
        routesCount: routes.length,
        modelsCount: models.length,
        servicesCount: services.length,
        pluginsCount: plugins.length,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      };

      // 1. Dashboard HTML endpoint
      ctx.addRoute('get', dashboardPath, (req, res) => {
        const data = { routes, plugins, config, models, services, overview };
        res.type('text/html');
        res.send(generateDashboardHtml(data));
      });

      // 2. JSON API endpoints
      ctx.addRoute('get', `${dashboardPath}/api/routes`, (req, res) => {
        res.json(routes);
      });

      ctx.addRoute('get', `${dashboardPath}/api/plugins`, (req, res) => {
        res.json(plugins);
      });

      ctx.addRoute('get', `${dashboardPath}/api/config`, (req, res) => {
        res.json(config);
      });

      ctx.addRoute('get', `${dashboardPath}/api/models`, (req, res) => {
        res.json(collectModels());
      });

      ctx.addRoute('get', `${dashboardPath}/api/services`, (req, res) => {
        res.json(collectServices());
      });

      ctx.addRoute('get', `${dashboardPath}/api/overview`, (req, res) => {
        res.json({
          routesCount: (ctx.routes || []).length,
          modelsCount: collectModels().length,
          servicesCount: collectServices().length,
          pluginsCount: plugins.length,
          nodeVersion: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        });
      });

      // Log dashboard URL
      console.log(`\n📊 Dashboard available at: http://localhost:${process.env.PORT || 7331}${dashboardPath}\n`);
    },
  };
}

module.exports = dashboardPlugin;
module.exports.dashboardPlugin = dashboardPlugin;
module.exports.devToolbarPlugin = dashboardPlugin;
module.exports.devtoolsPlugin = dashboardPlugin;
module.exports.generateDashboardHtml = generateDashboardHtml;
module.exports.collectModels = collectModels;
module.exports.collectServices = collectServices;
