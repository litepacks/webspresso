'use strict';

/**
 * Webspresso XLSX Plugin
 * Excel spreadsheet generation, parsing, ORM export, streaming, and res.xlsx() integration
 * @module plugins/xlsx
 */

const engine = require('./engine');
const { createXlsxMiddleware, XLSX_MIME_TYPE } = require('./middleware');
const { createXlsxServices } = require('./services');

/**
 * Standalone XLSX Toolkit Singleton
 */
const xlsx = {
  ...engine,
  MIME_TYPE: XLSX_MIME_TYPE,
  createMiddleware: createXlsxMiddleware,
  createServices: createXlsxServices,
};

/**
 * XLSX Plugin for Webspresso
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {boolean} [options.sanitizeFormulas=true] - Prevent Formula Injection attacks
 * @param {Object} [options.headerStyle] - Default header styling (fill, font, border)
 * @param {Object} [options.db] - Optional database instance for model export services
 * @returns {import('../../index').Plugin}
 */
function xlsxPlugin(options = {}) {
  const {
    enabled = true,
    sanitizeFormulas = true,
    headerStyle = { fill: '4F46E5', color: 'FFFFFF', bold: true },
    db: dbOption,
  } = options;

  return {
    name: 'xlsx',
    version: '1.0.0',
    description: 'Excel XLSX spreadsheet engine, res.xlsx() response decorator, and ORM export tools',
    enabled,

    register(ctx) {
      if (!enabled) return;

      // 1. Expose on PluginContext & global app
      ctx.xlsx = xlsx;
      if (ctx.app) {
        ctx.app.xlsx = xlsx;
      }

      // 2. Register built-in services (xlsx.generate, xlsx.parse, xlsx.exportModel)
      if (ctx.app && ctx.app.serviceRegistry) {
        const db = dbOption ?? ctx.db ?? ctx.app?.get?.('db') ?? null;
        const services = createXlsxServices({ db, ...options });
        for (const [name, def] of Object.entries(services)) {
          if (!ctx.app.serviceRegistry.has(name)) {
            ctx.app.serviceRegistry.register(name, def);
          }
        }
      }

      // 3. Register named middleware & global decorator
      const middleware = createXlsxMiddleware({
        sanitizeFormulas,
        headerStyle,
        ...options,
      });

      if (ctx.middlewares) {
        ctx.middlewares.xlsx = middleware;
      }

      if (ctx.app && typeof ctx.app.use === 'function') {
        ctx.app.use(middleware);
      }
    },
  };
}

module.exports = {
  xlsxPlugin,
  xlsx,
  createXlsxMiddleware,
  createXlsxServices,
  XLSX_MIME_TYPE,
  ...engine,
};
