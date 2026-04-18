/**
 * Wire ModelEvents to ORM cache invalidation
 * Supports multiple DB/cache layers (e.g. tests); each layer receives mutation events.
 * @module core/orm/cache/listeners
 */

const { ModelEvents, Hooks } = require('../events');
const { getModel } = require('../model');

/** @type {Set<import('./layer').OrmCacheLayer>} */
const layers = new Set();
let hooked = false;

/**
 * @param {import('./layer').OrmCacheLayer} cacheLayer
 */
function registerOrmCacheListeners(cacheLayer) {
  layers.add(cacheLayer);
  if (hooked) return;
  hooked = true;

  /**
   * @param {*} record
   * @param {import('../events').EventContext} ctx
   * @param {'create'|'update'|'delete'|'restore'} op
   */
  function handleMutation(record, ctx, op) {
    const modelName = ctx.model;
    const model = getModel(modelName);
    if (!model) return;

    for (const layer of layers) {
      if (!layer.strategyFor(model)) continue;
      const strat = layer.strategyFor(model);
      const tags = layer.tagsForMutation(model, strat, op, record);
      layer.scheduleInvalidate(ctx.trx, tags);
    }
  }

  ModelEvents.on(`*.${Hooks.AFTER_CREATE}`, (record, ctx) => {
    handleMutation(record, ctx, 'create');
  });

  ModelEvents.on(`*.${Hooks.AFTER_UPDATE}`, (record, ctx) => {
    handleMutation(record, ctx, 'update');
  });

  ModelEvents.on(`*.${Hooks.AFTER_DELETE}`, (record, ctx) => {
    handleMutation(record, ctx, 'delete');
  });

  ModelEvents.on(`*.${Hooks.AFTER_RESTORE}`, (record, ctx) => {
    handleMutation(record, ctx, 'restore');
  });
}

/**
 * @param {import('./layer').OrmCacheLayer} cacheLayer
 */
function unregisterOrmCacheListeners(cacheLayer) {
  layers.delete(cacheLayer);
}

module.exports = {
  registerOrmCacheListeners,
  unregisterOrmCacheListeners,
};
