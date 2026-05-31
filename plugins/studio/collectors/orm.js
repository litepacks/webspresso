const { getAllModels } = require('../../../core/orm/model');

/**
 * @param {object} ctx
 */
async function collectOrm(ctx) {
  const db = ctx.db || ctx.options?.db;
  const models = [];

  try {
    const registry = getAllModels();
    for (const [, model] of registry) {
      const schema = model.schema?._def?.shape ? Object.keys(model.schema._def.shape()) : [];
      models.push({
        name: model.name,
        table: model.table,
        columns: schema,
        adminEnabled: !!model.admin?.enabled,
      });
    }
  } catch {
    /* registry empty */
  }

  const tables = [];
  if (db?.knex) {
    try {
      const client = db.knex.client.config.client;
      if (client === 'better-sqlite3') {
        const rows = await db.knex.raw(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'"
        );
        const names = rows.map((r) => r.name);
        for (const name of names) {
          let rowCount = null;
          try {
            const c = await db.knex(name).count('* as c').first();
            rowCount = Number(c?.c ?? c?.count ?? 0);
          } catch {
            rowCount = null;
          }
          tables.push({ name, rowCount });
        }
      }
    } catch (e) {
      tables.push({ error: e.message });
    }
  }

  let migrationStatus = { pending: 0, completed: 0 };
  if (db?.knex) {
    try {
      const migrationConfig = db.knex.client.config.migrations || { directory: './migrations' };
      const [completed, pending] = await db.knex.migrate.list(migrationConfig);
      migrationStatus = {
        pending: pending.length,
        completed: completed.length,
      };
    } catch {
      /* ignore */
    }
  }

  return {
    models,
    tables,
    migrationStatus,
    destructiveSqlEnabled: false,
  };
}

module.exports = { collectOrm };
