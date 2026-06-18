/**
 * Generate Knex migrations from ORM model definitions
 * @module bin/utils/model-migrations
 */

const fs = require('fs');
const path = require('path');
const { clearRegistry, getAllModels } = require('../../core/orm/model');
const {
  scaffoldMigration,
  generateMigrationName,
} = require('../../core/orm/migrations/scaffold');

/**
 * @param {Date} [date]
 * @returns {string}
 */
function migrationTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '_',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
}

/**
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @returns {Set<string>}
 */
function getReferencedTables(model) {
  const deps = new Set();
  for (const meta of model.columns.values()) {
    if (meta.references) {
      deps.add(meta.references);
    }
  }
  return deps;
}

/**
 * Topological sort so parent tables migrate before dependents.
 * @param {import('../../core/orm/types').ModelDefinition[]} models
 * @returns {import('../../core/orm/types').ModelDefinition[]}
 */
function sortModelsByDependencies(models) {
  const byTable = new Map(models.map((m) => [m.table, m]));
  const sorted = [];
  const visiting = new Set();
  const done = new Set();

  function visit(model) {
    if (done.has(model.table)) return;
    if (visiting.has(model.table)) {
      throw new Error(`Circular table dependency involving "${model.table}"`);
    }
    visiting.add(model.table);
    for (const depTable of getReferencedTables(model)) {
      const dep = byTable.get(depTable);
      if (dep && dep.table !== model.table) {
        visit(dep);
      }
    }
    visiting.delete(model.table);
    done.add(model.table);
    sorted.push(model);
  }

  for (const model of models) {
    visit(model);
  }
  return sorted;
}

/**
 * @param {string} migrationDir
 * @param {string} table
 * @returns {string|null} existing filename
 */
function findExistingCreateMigration(migrationDir, table) {
  if (!fs.existsSync(migrationDir)) {
    return null;
  }
  const needle = `createTable('${table}'`;
  for (const file of fs.readdirSync(migrationDir)) {
    if (!file.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    if (content.includes(needle)) {
      return file;
    }
  }
  return null;
}

/**
 * @param {string} modelsDir
 * @returns {import('../../core/orm/types').ModelDefinition[]}
 */
function loadModelsFromDirectory(modelsDir) {
  const absoluteModelsDir = path.resolve(process.cwd(), modelsDir);
  if (!fs.existsSync(absoluteModelsDir)) {
    throw new Error(`Models directory not found: ${absoluteModelsDir}`);
  }

  clearRegistry();

  const files = fs
    .readdirSync(absoluteModelsDir)
    .filter((file) => file.endsWith('.js') && !file.startsWith('_'))
    .sort();

  const errors = [];
  for (const file of files) {
    try {
      const modelPath = path.join(absoluteModelsDir, file);
      delete require.cache[require.resolve(modelPath)];
      require(modelPath);
    } catch (err) {
      errors.push({ file, message: err.message });
    }
  }

  const models = [...getAllModels().values()];

  if (errors.length > 0) {
    throw new Error(
      `Failed to load models from ${absoluteModelsDir}:\n` +
        errors.map((e) => `  - ${e.file}: ${e.message}`).join('\n')
    );
  }

  return sortModelsByDependencies(models);
}

/**
 * @param {object} options
 * @param {string} options.modelsDir
 * @param {string} options.migrationDir
 * @param {boolean} [options.force]
 * @param {boolean} [options.dryRun]
 * @param {string[]} [options.only] model names
 * @returns {{ created: object[], skipped: object[], errors: object[] }}
 */
function scaffoldMigrationsFromModels(options) {
  const { modelsDir, migrationDir, force = false, dryRun = false, only = null } = options;
  let models = loadModelsFromDirectory(modelsDir);

  if (only && only.length > 0) {
    const allow = new Set(only);
    models = models.filter((m) => allow.has(m.name));
    const missing = only.filter((name) => !models.some((m) => m.name === name));
    if (missing.length > 0) {
      throw new Error(`Model(s) not found: ${missing.join(', ')}`);
    }
  }

  if (models.length === 0) {
    throw new Error(`No models found in ${path.resolve(process.cwd(), modelsDir)}`);
  }

  const created = [];
  const skipped = [];
  const errors = [];

  if (!dryRun && !fs.existsSync(migrationDir)) {
    fs.mkdirSync(migrationDir, { recursive: true });
  }

  models.forEach((model, index) => {
    const existing = findExistingCreateMigration(migrationDir, model.table);
    if (existing && !force) {
      skipped.push({ model: model.name, table: model.table, file: existing });
      return;
    }

    try {
      const migrationName = generateMigrationName(model, 'create');
      const stamp = migrationTimestamp(new Date(Date.now() + index * 1000));
      const filename = `${stamp}_${migrationName}.js`;
      const filepath = path.join(migrationDir, filename);
      const content = scaffoldMigration(model);

      if (!dryRun) {
        fs.writeFileSync(filepath, content);
      }

      created.push({
        model: model.name,
        table: model.table,
        file: filename,
        path: filepath,
      });
    } catch (err) {
      errors.push({ model: model.name, table: model.table, message: err.message });
    }
  });

  return { created, skipped, errors };
}

module.exports = {
  migrationTimestamp,
  getReferencedTables,
  sortModelsByDependencies,
  findExistingCreateMigration,
  loadModelsFromDirectory,
  scaffoldMigrationsFromModels,
};
