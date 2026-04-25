/**
 * Admin-only CSV/Excel import and Excel export.
 *
 * Usage: add after adminPanelPlugin in createApp({ plugins: [...] }) so session
 * middleware and admin-panel registry exist. Same adminPath as admin panel.
 *
 * @module plugins/data-exchange
 */

const { createExportXlsxHandler } = require('./export-xlsx');
const { createImportHandler } = require('./import');

/**
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {import('../../core/orm/database').Database} [options.db] - defaults to ctx.db
 * @param {string} [options.adminPath='/_admin'] - must match admin panel path
 * @param {number} [options.maxRows=10000] - export/import row cap
 * @param {number} [options.maxFileBytes=10485760] - multipart size (10 MiB)
 */
function dataExchangePlugin(options = {}) {
  const {
    enabled = true,
    db: dbOption,
    adminPath = '/_admin',
    maxRows = 10_000,
    maxFileBytes = 10 * 1024 * 1024,
  } = options;

  return {
    name: 'data-exchange',
    version: '1.0.0',
    description: 'Admin spreadsheet import (CSV/XLSX) and Excel export',
    enabled,

    onRoutesReady(ctx) {
      if (!enabled) return;

      const db = dbOption ?? ctx.db;
      if (!db) {
        console.warn('[data-exchange] Skipping routes: no database (pass options.db or createApp({ db }))');
        return;
      }

      const { requireAuth } = require('../admin-panel/auth');
      const exportHandler = createExportXlsxHandler({ db, maxRows });
      const importHandler = createImportHandler({ db, maxRows, maxFileBytes });

      const base = `${adminPath}/api/data-exchange`;
      ctx.addRoute('get', `${base}/export/:model`, requireAuth, exportHandler);
      ctx.addRoute('post', `${base}/export/:model`, requireAuth, exportHandler);
      ctx.addRoute('post', `${base}/import/:model`, requireAuth, importHandler);

      const adminApi = typeof ctx.usePlugin === 'function' ? ctx.usePlugin('admin-panel') : null;
      if (adminApi && typeof adminApi.getRegistry === 'function') {
        const registry = adminApi.getRegistry();
        registry.registerBulkAction('export-xlsx', {
          label: 'Export as Excel',
          icon: 'download',
          color: 'blue',
          models: '*',
          confirm: false,
          handler: async (records, modelName, { db: d }) => {
            const { getModel } = require('../../core/orm/model');
            const model = d.getModel ? d.getModel(modelName) : getModel(modelName);
            const pk = model?.primaryKey || 'id';
            const ids = records.map((r) => r[pk]).join(',');
            return {
              download: true,
              url: `${adminPath}/api/data-exchange/export/${modelName}?ids=${encodeURIComponent(ids)}`,
              filename: `${modelName}_export.xlsx`,
            };
          },
        });
      }
    },
  };
}

module.exports = { dataExchangePlugin };
