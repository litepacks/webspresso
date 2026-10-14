/**
 * Webspresso ORM - Schema Diff & Auto-Migration Generator (Django-inspired makemigrations)
 * Compares ORM models with live database schema and generates migrations
 * @module core/orm/migrations/diff
 */

const fs = require('fs');
const path = require('path');
const { getAllModels } = require('../model');
const {
  scaffoldMigration,
  scaffoldAlterMigration,
  generateMigrationName,
} = require('./scaffold');
const {
  migrationTimestamp,
  sortModelsByDependencies,
  loadModelsFromDirectory,
} = require('../../../bin/utils/model-migrations');

/**
 * Compare models with existing database schema to find diffs
 * @param {Object} options
 * @param {import('knex').Knex} options.knex - Active Knex instance
 * @param {import('../types').ModelDefinition[]} [options.models] - List of models to diff
 * @param {boolean} [options.includeDrops=false] - Whether to generate dropColumn for removed fields
 * @returns {Promise<{ hasChanges: boolean, changes: Array<Object> }>}
 */
async function diffSchema(options = {}) {
  const {
    knex,
    models = [...getAllModels().values()],
    includeDrops = false,
  } = options;

  if (!knex) {
    throw new Error('diffSchema requires an active knex instance');
  }

  const sortedModels = sortModelsByDependencies(models);
  const changes = [];

  for (const model of sortedModels) {
    const tableExists = await knex.schema.hasTable(model.table);

    if (!tableExists) {
      // Table doesn't exist at all -> generate createTable
      const migrationName = generateMigrationName(model, 'create');
      const content = scaffoldMigration(model);
      changes.push({
        model: model.name,
        table: model.table,
        type: 'create_table',
        addedColumns: Array.from(model.columns.keys()),
        removedColumns: [],
        migrationName,
        content,
      });
      continue;
    }

    // Table exists -> inspect columns
    const columnInfo = await knex(model.table).columnInfo();
    const existingColNames = new Set(Object.keys(columnInfo));

    const addedColumns = new Map();
    for (const [colName, colMeta] of model.columns.entries()) {
      if (!existingColNames.has(colName)) {
        addedColumns.set(colName, colMeta);
      }
    }

    const removedColumnNames = [];
    if (includeDrops) {
      for (const existingCol of existingColNames) {
        // Skip knex internal migrations or common internal columns if needed
        if (!model.columns.has(existingCol)) {
          removedColumnNames.push(existingCol);
        }
      }
    }

    if (addedColumns.size > 0) {
      const addedKeys = Array.from(addedColumns.keys());
      const prefix = addedKeys.slice(0, 3).join('_');
      const migrationName = `add_${prefix}${addedKeys.length > 3 ? '_etc' : ''}_to_${model.table}_table`;
      const content = scaffoldAlterMigration(model.table, addedColumns);

      changes.push({
        model: model.name,
        table: model.table,
        type: 'alter_table',
        addedColumns: addedKeys,
        removedColumns: removedColumnNames,
        migrationName,
        content,
      });
    }
  }

  return {
    hasChanges: changes.length > 0,
    changes,
  };
}

/**
 * High-level makemigrations execution: diffs schema and writes migration files
 * @param {Object} options
 * @param {import('knex').Knex} options.knex - Knex instance
 * @param {string} [options.modelsDir='./models'] - Models directory
 * @param {string} [options.migrationDir='./migrations'] - Target migrations directory
 * @param {boolean} [options.dryRun=false] - Preview without writing files
 * @param {boolean} [options.includeDrops=false] - Include dropColumn operations
 * @param {string} [options.name] - Custom migration name override
 * @returns {Promise<{ hasChanges: boolean, created: Array<Object>, skipped: Array<Object> }>}
 */
async function makeMigrations(options = {}) {
  const {
    knex,
    modelsDir = './models',
    migrationDir = './migrations',
    dryRun = false,
    includeDrops = false,
    name = null,
  } = options;

  let models;
  if (fs.existsSync(path.resolve(process.cwd(), modelsDir))) {
    models = loadModelsFromDirectory(modelsDir);
  } else {
    models = [...getAllModels().values()];
  }

  const { hasChanges, changes } = await diffSchema({
    knex,
    models,
    includeDrops,
  });

  const created = [];
  const skipped = [];

  if (!hasChanges) {
    return { hasChanges: false, created, skipped };
  }

  const absoluteMigrationDir = path.resolve(process.cwd(), migrationDir);
  if (!dryRun && !fs.existsSync(absoluteMigrationDir)) {
    fs.mkdirSync(absoluteMigrationDir, { recursive: true });
  }

  changes.forEach((change, index) => {
    const customName = name && changes.length === 1 ? name : change.migrationName;
    const stamp = migrationTimestamp(new Date(Date.now() + index * 1000));
    const filename = `${stamp}_${customName}.js`;
    const filepath = path.join(absoluteMigrationDir, filename);

    if (!dryRun) {
      fs.writeFileSync(filepath, change.content, 'utf8');
    }

    created.push({
      model: change.model,
      table: change.table,
      type: change.type,
      addedColumns: change.addedColumns,
      removedColumns: change.removedColumns,
      file: filename,
      path: filepath,
      content: change.content,
    });
  });

  return {
    hasChanges: true,
    created,
    skipped,
  };
}

module.exports = {
  diffSchema,
  makeMigrations,
};
