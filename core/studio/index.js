'use strict';

/**
 * Webspresso DB Studio Subsystem
 * Interactive visual database browser and SQL query runner
 * @module core/studio
 */

const {
  listTables,
  getTableSchema,
  getTableRows,
  insertRow,
  updateRow,
  deleteRow,
  executeRawQuery,
  getDialect,
} = require('./inspector');

const {
  createStudioApp,
  startStudio,
  openBrowser,
  getTelemetrySnapshot,
} = require('./server');

const { renderStudioHtml } = require('./ui');

module.exports = {
  listTables,
  getTableSchema,
  getTableRows,
  insertRow,
  updateRow,
  deleteRow,
  executeRawQuery,
  getDialect,
  createStudioApp,
  startStudio,
  openBrowser,
  getTelemetrySnapshot,
  renderStudioHtml,
};
