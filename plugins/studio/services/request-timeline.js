/**
 * In-memory request timeline ring buffer (development).
 */

/** @type {import('./request-timeline').RequestTimelineStore|null} */
let globalStore = null;

/**
 * @param {import('../config').StudioResolvedConfig} config
 */
function createRequestTimelineStore(config) {
  const maxEntries = config.requestTimeline?.maxEntries ?? 100;
  /** @type {object[]} */
  const buffer = [];
  let dbQueryCount = 0;

  return {
    push(entry) {
      buffer.unshift(entry);
      if (buffer.length > maxEntries) {
        buffer.length = maxEntries;
      }
    },
    getAll() {
      return [...buffer];
    },
    incrementDbQueries(n = 1) {
      dbQueryCount += n;
    },
    resetDbQueries() {
      dbQueryCount = 0;
    },
    getDbQueryCount() {
      return dbQueryCount;
    },
    attachKnex(knex) {
      if (!knex || knex.__studioQueryHook) return;
      knex.__studioQueryHook = true;
      knex.on('query', () => {
        dbQueryCount += 1;
      });
    },
  };
}

/**
 * @param {import('../config').StudioResolvedConfig} config
 */
function getRequestTimelineStore(config) {
  if (!globalStore) {
    globalStore = createRequestTimelineStore(config);
  }
  return globalStore;
}

function resetRequestTimelineStore() {
  globalStore = null;
}

/**
 * @param {import('../config').StudioResolvedConfig} config
 */
function createTimelineMiddleware(config) {
  const store = getRequestTimelineStore(config);

  return function studioTimelineMiddleware(req, res, next) {
    const start = Date.now();
    store.resetDbQueries();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      store.push({
        method: req.method,
        path: req.path || req.url,
        status: res.statusCode,
        durationMs,
        matchedRoute: req.route?.path || req.matchedRoute || null,
        middlewareMs: null,
        renderMs: null,
        dbQueryCount: store.getDbQueryCount(),
        cacheHit: 0,
        cacheMiss: 0,
        error: res.statusCode >= 500 ? 'HTTP error' : null,
        at: new Date().toISOString(),
      });
    });

    next();
  };
}

module.exports = {
  createRequestTimelineStore,
  getRequestTimelineStore,
  resetRequestTimelineStore,
  createTimelineMiddleware,
};
