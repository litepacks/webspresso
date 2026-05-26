/**
 * Resolve D1 database from Cloudflare Worker bindings
 * @module core/build/runtime/resolve-worker-db
 */

/**
 * @param {object|null|undefined} bindings
 * @param {object|null|undefined} db
 * @param {{ modulePaths?: string[], dbRuntime?: { knex?: Function, d1Client?: Function } }} [opts]
 */
function resolveWorkerDb(bindings, db, opts = {}) {
  if (db != null) {
    return db;
  }
  if (!bindings?.DB) {
    return null;
  }

  const { createDatabase } = require('../../orm');
  return createDatabase(
    { client: 'd1', useNullAsDefault: true },
    {
      d1: bindings.DB,
      skipModelScan: true,
      modulePaths: opts.modulePaths,
      knex: opts.dbRuntime?.knex,
      d1Client: opts.dbRuntime?.d1Client,
    }
  );
}

module.exports = { resolveWorkerDb };
