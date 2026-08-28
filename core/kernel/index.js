/**
 * Standalone Experimental Application Kernel
 * In-process event bus, simulated repository hooks, plugin shell, and minimal view resolver.
 * 
 * NOTE: This is an isolated, experimental standalone subsystem. It does NOT integrate with
 * or replace Webspresso's Express-based SSR createApp(), Knex ORM, or PluginManager.
 * @module core/kernel
 */

module.exports = {
  createApp: require('./app').createApp,
  definePlugin: require('./plugin').definePlugin,
  defineFlow: require('./flow').defineFlow,
  BaseRepository: require('./base-repository').BaseRepository,
  createEventBus: require('./events').createEventBus,
  buildContext: require('./events').buildContext,
  randomUUID: require('./events').randomUUID,
  createViewEngine: require('./view').createViewEngine,
  renderTemplate: require('./view').renderTemplate,
  parseQualified: require('./view').parseQualified,
};
