/**
 * ORM / framework cache inspector.
 */

/**
 * @param {object} ctx
 */
function collectCache(ctx) {
  const db = ctx.db || ctx.options?.db;
  const cache = db?.cache;

  if (!cache) {
    return {
      enabled: false,
      stores: [],
      message: 'ORM cache not enabled. Use createDatabase({ cache: true }).',
      hitMissInstrumented: false,
    };
  }

  let stats = { entries: 0, tags: 0 };
  try {
    if (typeof cache.getSizeStats === 'function') {
      stats = cache.getSizeStats();
    }
  } catch {
    /* ignore */
  }

  return {
    enabled: true,
    stores: [
      {
        id: 'orm-memory',
        keysCount: stats.entries ?? 0,
        tagsCount: stats.tags ?? 0,
        ttl: 'per-entry',
        hitMissInstrumented: false,
      },
    ],
    hitMissInstrumented: false,
    config: {
      strategy: db?.cacheConfig?.defaultStrategy || 'auto',
    },
  };
}

module.exports = { collectCache };
