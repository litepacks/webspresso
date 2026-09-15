'use strict';

/**
 * Webspresso CSV Plugin
 * RFC 4180 compliant CSV generation, parsing, ORM export, streaming, and res.csv() integration
 * @module plugins/csv
 */

const engine = require('./engine');
const { createCsvMiddleware, CSV_MIME_TYPE } = require('./middleware');
const { createCsvServices } = require('./services');

/**
 * Standalone CSV Toolkit Singleton
 */
const csv = {
  ...engine,
  MIME_TYPE: CSV_MIME_TYPE,
  createMiddleware: createCsvMiddleware,
  createServices: createCsvServices,
};

/**
 * CSV Plugin for Webspresso
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {string} [options.delimiter=','] - Default CSV delimiter
 * @param {boolean} [options.bom=true] - Prepend UTF-8 BOM for Excel compatibility
 * @param {boolean} [options.sanitizeFormulas=true] - Escape Formula Injection attacks
 * @param {Object} [options.db] - Optional database instance for model export services
 * @returns {import('../../index').Plugin}
 */
function csvPlugin(options = {}) {
  const {
    enabled = true,
    delimiter = ',',
    bom = true,
    sanitizeFormulas = true,
    db: dbOption,
  } = options;

  return {
    name: 'csv',
    version: '1.0.0',
    description: 'RFC 4180 CSV spreadsheet engine, res.csv() response decorator, and ORM export tools',
    enabled,

    register(ctx) {
      if (!enabled) return;

      // 1. Expose on PluginContext & global app
      ctx.csv = csv;
      if (ctx.app) {
        ctx.app.csv = csv;
      }

      // 2. Register built-in services (csv.generate, csv.parse, csv.exportModel)
      if (ctx.app && ctx.app.serviceRegistry) {
        const db = dbOption ?? ctx.db ?? ctx.app?.get?.('db') ?? null;
        const services = createCsvServices({ db, ...options });
        for (const [name, def] of Object.entries(services)) {
          if (!ctx.app.serviceRegistry.has(name)) {
            ctx.app.serviceRegistry.register(name, def);
          }
        }
      }

      // 3. Register named middleware & global decorator
      const middleware = createCsvMiddleware({
        delimiter,
        bom,
        sanitizeFormulas,
        ...options,
      });

      if (ctx.middlewares) {
        ctx.middlewares.csv = middleware;
      }

      if (ctx.app && typeof ctx.app.use === 'function') {
        ctx.app.use(middleware);
      }
    },
  };
}

module.exports = {
  csvPlugin,
  csv,
  createCsvMiddleware,
  createCsvServices,
  CSV_MIME_TYPE,
  ...engine,
};
