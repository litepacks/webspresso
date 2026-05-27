'use strict';

/**
 * Factory: extends knex-cloudflare-d1 Client so D1 run() meta.changes maps to Knex sqlite context.
 * Without this, DELETE/UPDATE report 0 affected rows while SQL still runs on D1.
 *
 * @param {typeof import('knex-cloudflare-d1')} Client_D1
 * @returns {typeof Client_D1}
 */
function createD1KnexClient(Client_D1) {
  class D1KnexClient extends Client_D1 {
    async _query(connection, obj) {
      if (!obj.sql) throw new Error('The query is empty');

      if (
        obj.sql.startsWith('BEGIN') ||
        obj.sql.startsWith('COMMIT') ||
        obj.sql.startsWith('ROLLBACK')
      ) {
        this.logger.warn(
          "[WARN] D1 doesn't support transactions, see https://blog.cloudflare.com/whats-new-with-d1/"
        );
        return;
      }

      const { method } = obj;
      let callMethod;
      switch (method) {
        case 'insert':
        case 'update':
          callMethod = obj.returning ? 'all' : 'run';
          break;
        case 'counter':
        case 'del':
          callMethod = 'run';
          break;
        default:
          callMethod = 'all';
      }

      if (!connection) {
        throw new Error(`Error calling ${callMethod} on connection.`);
      }

      let stmt = connection.prepare(obj.sql);
      if (obj.bindings && obj.bindings.length > 0) {
        stmt = stmt.bind(...obj.bindings);
      }

      const result = await stmt?.[callMethod]();

      obj.response = result?.results;
      obj.context = {
        changes: result?.meta?.changes ?? 0,
        lastID: result?.meta?.last_row_id ?? 0,
      };
      return obj;
    }
  }

  return D1KnexClient;
}

module.exports = createD1KnexClient;
