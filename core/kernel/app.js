/**
 * Minimal extensible application kernel (event bus, views, flows, plugins).
 * @module core/kernel/app
 */

const { createEventBus } = require('./events');
const { createViewEngine } = require('./view');
const { definePlugin } = require('./plugin');
const { defineFlow } = require('./flow');
const { BaseRepository } = require('./base-repository');

/**
 * @typedef {{
 *   events: ReturnType<typeof createEventBus>,
 *   view: ReturnType<typeof createViewEngine>,
 *   flows: Array<{ id?: string, trigger: string }>,
 *   registerPlugin: (plugin: Parameters<typeof definePlugin>[0]) => void,
 *   registerFlow: (flow: ReturnType<typeof defineFlow>) => () => void,
 *   paths: Record<string, string | undefined>,
 * }} KernelApp
 */

/**
 * @param {{
 *   paths?: { appViews?: string, themeViews?: string },
 * }} [options]
 */
function createApp(options = {}) {
  const paths = options.paths || {};
  const events = createEventBus();
  const view = createViewEngine({
    appViews: paths.appViews,
    themeViews: paths.themeViews,
  });

  /** @type {Array<{ id?: string, trigger: string, unregister: () => void }>} */
  const flowHandles = [];

  /**
   * @param {ReturnType<typeof defineFlow>} flowDef
   */
  function registerFlow(flowDef) {
    const id = flowDef.id || flowDef.trigger;
    /** @param {import('./events').KernelEventContext} ctx */
    const handler = async (ctx) => {
      if (flowDef.when && !flowDef.when(ctx)) return;
      const actions = flowDef.actions || [];
      for (const action of actions) {
        await action(ctx, app);
      }
    };
    events.on(flowDef.trigger, handler);
    const unregister = () => events.off(flowDef.trigger, handler);
    flowHandles.push({
      id,
      trigger: flowDef.trigger,
      unregister,
    });
    return unregister;
  }

  /**
   * @param {Parameters<typeof definePlugin>[0]} plugin
   */
  function registerPlugin(plugin) {
    if (typeof plugin.views === 'function') {
      const bundle = plugin.views();
      view.registerPluginViews(plugin.name, bundle);
    }
    if (typeof plugin.events === 'function') {
      plugin.events(app);
    }
  }

  /** @type {KernelApp} */
  const app = {
    events,
    view,
    options,
    paths,
    get flows() {
      return flowHandles.map(({ id, trigger }) => ({ id, trigger }));
    },
    registerPlugin,
    registerFlow,
  };

  return app;
}

module.exports = {
  createApp,
  definePlugin,
  defineFlow,
  BaseRepository,
};
