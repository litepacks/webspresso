/**
 * Application kernel: event bus, simulated repository hooks, plugins, views, flows.
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
