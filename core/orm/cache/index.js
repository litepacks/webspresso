/**
 * ORM query cache (memory provider + tag invalidation)
 * @module core/orm/cache
 */

const { createMemoryCacheProvider } = require('./memory-provider');
const { OrmCacheLayer } = require('./layer');
const { registerOrmCacheListeners, unregisterOrmCacheListeners } = require('./listeners');

/**
 * @param {boolean|object} cacheConfig - true | { enabled, defaultStrategy, provider, memory }
 * @returns {{ layer: OrmCacheLayer|null, publicApi: object|null }}
 */
function createOrmCacheFromConfig(cacheConfig) {
  const normalized = normalizeCacheConfig(cacheConfig);
  if (!normalized) {
    return { layer: null, publicApi: null };
  }

  const provider =
    normalized.provider || createMemoryCacheProvider(normalized.memory || {});

  const layer = new OrmCacheLayer(provider, {
    defaultStrategy: normalized.defaultStrategy,
    providerKind: normalized.provider ? 'custom' : 'memory',
  });

  registerOrmCacheListeners(layer);

  const publicApi = {
    purge: () => layer.purge(),
    invalidateTags: (tags) => layer.invalidateTags(tags),
    invalidateModel: (modelName) => {
      const { getModel } = require('../model');
      const model = getModel(modelName);
      if (model) layer.invalidateModelAll(model);
    },
    getMetrics: () => ({
      ...layer.getMetrics(),
      providerKind: layer.providerKind || 'memory',
    }),
    resetMetrics: () => layer.resetMetrics(),
  };

  return { layer, publicApi };
}

/**
 * @param {boolean|object|undefined} cacheConfig
 */
function normalizeCacheConfig(cacheConfig) {
  if (cacheConfig === true) {
    return { enabled: true, defaultStrategy: 'auto', provider: null, memory: {} };
  }
  if (!cacheConfig || cacheConfig.enabled === false) {
    return null;
  }
  return {
    enabled: true,
    defaultStrategy: cacheConfig.defaultStrategy === 'smart' ? 'smart' : 'auto',
    provider: cacheConfig.provider || null,
    memory: cacheConfig.memory || {},
  };
}

module.exports = {
  createOrmCacheFromConfig,
  normalizeCacheConfig,
  createMemoryCacheProvider,
  OrmCacheLayer,
  registerOrmCacheListeners,
  unregisterOrmCacheListeners,
};
