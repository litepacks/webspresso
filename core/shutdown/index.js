/**
 * Webspresso Shutdown & Lifecycle Management
 * @module core/shutdown
 */

const { ShutdownManager } = require('./shutdown-manager');
const { NodeHttpAdapter } = require('./http-adapter');

module.exports = {
  ShutdownManager,
  NodeHttpAdapter,
};
