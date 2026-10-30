/**
 * Admin-only CSV/Excel import and Excel export.
 *
 * Usage: add after adminPanelPlugin in createApp({ plugins: [...] }) so session
 * middleware and admin-panel registry exist. Same adminPath as admin panel.
 *
 * @module plugins/data-exchange
 */

'use strict';

const { createExportHandler, buildXlsxBuffer, buildCsvBuffer, getModelExportColumns } = require('./export');
const { createImportHandler, allowedImportColumns, parseCsvToRows, parseXlsxToRows } = require('./import');
const { createTemplateHandler, generateCsvTemplate, generateXlsxTemplate, resolveTemplateColumns } = require('./template');
const { createPreviewHandler, analyzeSpreadsheetPreview } = require('./preview');

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
    version: '1.1.0',
    description: 'Admin spreadsheet import (CSV/XLSX), Excel/CSV export, and interactive column mapping wizard',
    enabled,

    register(ctx) {
      if (!enabled) return;
      const db = dbOption ?? ctx.db ?? ctx.app?.get?.('db') ?? null;
      if (ctx.app && ctx.app.serviceRegistry) {
        const { createExchangeServices } = require('../../core/services/builtins/exchange');
        const exchangeServices = createExchangeServices({ db });
        for (const [name, def] of Object.entries(exchangeServices)) {
          if (!ctx.app.serviceRegistry.has(name)) {
            ctx.app.serviceRegistry.register(name, def);
          }
        }
      }
    },

    onRoutesReady(ctx) {
      if (!enabled) return;
      if (ctx.app && ctx.app._dataExchangeRoutesRegistered) return;

      const db = dbOption ?? ctx.db;
      if (!db) {
        console.warn('[data-exchange] Skipping routes: no database (pass options.db or createApp({ db }))');
        return;
      }

      const { requireAuth } = require('../admin-panel/auth');
      const exportHandler = createExportHandler({ db, maxRows });
      const importHandler = createImportHandler({ db, maxRows, maxFileBytes });
      const templateHandler = createTemplateHandler({ db });
      const previewHandler = createPreviewHandler({ db, maxFileBytes });

      const base = `${adminPath}/api/data-exchange`;
      ctx.addRoute('get', `${base}/template/:model`, requireAuth, templateHandler);
      ctx.addRoute('post', `${base}/preview/:model`, requireAuth, previewHandler);
      ctx.addRoute('get', `${base}/export/:model`, requireAuth, exportHandler);
      ctx.addRoute('post', `${base}/export/:model`, requireAuth, exportHandler);
      ctx.addRoute('post', `${base}/import/:model`, requireAuth, importHandler);

      const adminApi = typeof ctx.usePlugin === 'function' ? ctx.usePlugin('admin-panel') : null;
      if (adminApi && typeof adminApi.getRegistry === 'function') {
        const registry = adminApi.getRegistry();
        if (!registry.bulkActions.has('export-xlsx')) {
          registry.registerBulkAction('export-xlsx', {
            label: 'Export as Excel',
            icon: 'download',
            color: 'blue',
            models: '*',
            confirm: false,
            handler: async (records, modelName, { db: d }) => {
              const targetModel = typeof modelName === 'object' && modelName !== null
                ? (modelName.name || modelName.modelName || modelName.model || String(modelName))
                : String(modelName);
              const { getModel } = require('../../core/orm/model');
              const model = d.getModel ? d.getModel(targetModel) : getModel(targetModel);
              const pk = model?.primaryKey || 'id';
              const ids = records.map((r) => r[pk]).join(',');
              return {
                download: true,
                url: `${adminPath}/api/data-exchange/export/${targetModel}?ids=${encodeURIComponent(ids)}`,
                filename: `${targetModel}_export.xlsx`,
              };
            },
          });
        }
      }

      if (ctx.app) {
        ctx.app._dataExchangeRoutesRegistered = true;
      }
    },
  };
}

dataExchangePlugin.dataExchangePlugin = dataExchangePlugin;
dataExchangePlugin.createExportHandler = createExportHandler;
dataExchangePlugin.createImportHandler = createImportHandler;
dataExchangePlugin.createTemplateHandler = createTemplateHandler;
dataExchangePlugin.createPreviewHandler = createPreviewHandler;
dataExchangePlugin.buildXlsxBuffer = buildXlsxBuffer;
dataExchangePlugin.buildCsvBuffer = buildCsvBuffer;
dataExchangePlugin.generateCsvTemplate = generateCsvTemplate;
dataExchangePlugin.generateXlsxTemplate = generateXlsxTemplate;
dataExchangePlugin.resolveTemplateColumns = resolveTemplateColumns;
dataExchangePlugin.analyzeSpreadsheetPreview = analyzeSpreadsheetPreview;
dataExchangePlugin.allowedImportColumns = allowedImportColumns;
dataExchangePlugin.parseCsvToRows = parseCsvToRows;
dataExchangePlugin.parseXlsxToRows = parseXlsxToRows;
dataExchangePlugin.getModelExportColumns = getModelExportColumns;

module.exports = {
  dataExchangePlugin,
  createExportHandler,
  createImportHandler,
  createTemplateHandler,
  createPreviewHandler,
  buildXlsxBuffer,
  buildCsvBuffer,
  generateCsvTemplate,
  generateXlsxTemplate,
  resolveTemplateColumns,
  analyzeSpreadsheetPreview,
  allowedImportColumns,
  parseCsvToRows,
  parseXlsxToRows,
  getModelExportColumns,
};
