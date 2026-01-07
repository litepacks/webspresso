/**
 * Webspresso ORM - Migration Scaffolding
 * Generate migration code from model schema
 * @module core/orm/migrations/scaffold
 */

const { getColumnMeta } = require('../schema-helpers');

/**
 * Generate migration code from a model definition
 * @param {import('../types').ModelDefinition} model - Model definition
 * @returns {string} Migration file content
 */
function scaffoldMigration(model) {
  const { table, columns, scopes } = model;
  
  const columnLines = [];
  const indexLines = [];
  const foreignKeyLines = [];

  // Process each column
  for (const [columnName, meta] of columns.entries()) {
    const { line, indexLine, fkLine } = generateColumnLine(columnName, meta);
    columnLines.push(line);
    if (indexLine) indexLines.push(indexLine);
    if (fkLine) foreignKeyLines.push(fkLine);
  }

  // Generate the migration content
  const lines = [
    '/**',
    ` * Migration: Create ${table} table`,
    ' * Auto-generated from model schema',
    ' */',
    '',
    'exports.up = function(knex) {',
    `  return knex.schema.createTable('${table}', (table) => {`,
  ];

  // Add column definitions
  for (const line of columnLines) {
    lines.push(`    ${line}`);
  }

  // Add indexes
  if (indexLines.length > 0) {
    lines.push('');
    lines.push('    // Indexes');
    for (const line of indexLines) {
      lines.push(`    ${line}`);
    }
  }

  // Add foreign keys
  if (foreignKeyLines.length > 0) {
    lines.push('');
    lines.push('    // Foreign keys');
    for (const line of foreignKeyLines) {
      lines.push(`    ${line}`);
    }
  }

  lines.push('  });');
  lines.push('};');
  lines.push('');
  lines.push('exports.down = function(knex) {');
  lines.push(`  return knex.schema.dropTableIfExists('${table}');`);
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a single column line for migration
 * @param {string} columnName - Column name
 * @param {import('../types').ColumnMeta} meta - Column metadata
 * @returns {{ line: string, indexLine: string|null, fkLine: string|null }}
 */
function generateColumnLine(columnName, meta) {
  const parts = [];
  let indexLine = null;
  let fkLine = null;

  // Determine column type and method
  switch (meta.type) {
    case 'bigint':
      if (meta.primary && meta.autoIncrement) {
        parts.push(`table.bigIncrements('${columnName}')`);
      } else if (meta.references) {
        parts.push(`table.bigInteger('${columnName}').unsigned()`);
        fkLine = `table.foreign('${columnName}').references('${meta.referenceColumn || 'id'}').inTable('${meta.references}');`;
      } else {
        parts.push(`table.bigInteger('${columnName}')`);
      }
      break;

    case 'integer':
      if (meta.primary && meta.autoIncrement) {
        parts.push(`table.increments('${columnName}')`);
      } else {
        parts.push(`table.integer('${columnName}')`);
      }
      break;

    case 'string':
      const maxLength = meta.maxLength || 255;
      parts.push(`table.string('${columnName}', ${maxLength})`);
      break;

    case 'text':
      parts.push(`table.text('${columnName}')`);
      break;

    case 'float':
      parts.push(`table.float('${columnName}')`);
      break;

    case 'decimal':
      const precision = meta.precision || 10;
      const scale = meta.scale || 2;
      parts.push(`table.decimal('${columnName}', ${precision}, ${scale})`);
      break;

    case 'boolean':
      parts.push(`table.boolean('${columnName}')`);
      break;

    case 'date':
      parts.push(`table.date('${columnName}')`);
      break;

    case 'datetime':
      parts.push(`table.datetime('${columnName}')`);
      break;

    case 'timestamp':
      parts.push(`table.timestamp('${columnName}')`);
      break;

    case 'json':
      parts.push(`table.json('${columnName}')`);
      break;

    case 'enum':
      const enumValues = meta.enumValues || [];
      const valuesStr = enumValues.map(v => `'${v}'`).join(', ');
      parts.push(`table.enum('${columnName}', [${valuesStr}])`);
      break;

    case 'uuid':
      if (meta.primary) {
        parts.push(`table.uuid('${columnName}')`);
      } else if (meta.references) {
        parts.push(`table.uuid('${columnName}')`);
        fkLine = `table.foreign('${columnName}').references('${meta.referenceColumn || 'id'}').inTable('${meta.references}');`;
      } else {
        parts.push(`table.uuid('${columnName}')`);
      }
      break;

    default:
      parts.push(`table.string('${columnName}')`);
  }

  // Add constraints
  if (meta.primary && !meta.autoIncrement) {
    parts.push('.primary()');
  }

  if (meta.unique) {
    parts.push('.unique()');
  }

  if (meta.nullable) {
    parts.push('.nullable()');
  } else if (!meta.primary) {
    parts.push('.notNullable()');
  }

  if (meta.default !== undefined) {
    if (typeof meta.default === 'string') {
      parts.push(`.defaultTo('${meta.default}')`);
    } else if (meta.default === null) {
      parts.push('.defaultTo(null)');
    } else {
      parts.push(`.defaultTo(${meta.default})`);
    }
  }

  // Auto timestamps get default to knex.fn.now()
  if (meta.auto === 'create' || meta.auto === 'update') {
    parts.push('.defaultTo(knex.fn.now())');
  }

  // Generate index line if needed
  if (meta.index && !meta.unique && !meta.primary) {
    indexLine = `table.index(['${columnName}']);`;
  }

  return {
    line: parts.join('') + ';',
    indexLine,
    fkLine,
  };
}

/**
 * Generate migration code for adding columns to existing table
 * @param {string} tableName - Table name
 * @param {Map<string, import('../types').ColumnMeta>} columns - Columns to add
 * @returns {string} Migration file content
 */
function scaffoldAlterMigration(tableName, columns) {
  const columnLines = [];
  const indexLines = [];
  const foreignKeyLines = [];
  const dropLines = [];

  for (const [columnName, meta] of columns.entries()) {
    const { line, indexLine, fkLine } = generateColumnLine(columnName, meta);
    columnLines.push(line);
    if (indexLine) indexLines.push(indexLine);
    if (fkLine) foreignKeyLines.push(fkLine);
    dropLines.push(`table.dropColumn('${columnName}');`);
  }

  const lines = [
    '/**',
    ` * Migration: Alter ${tableName} table`,
    ' * Auto-generated',
    ' */',
    '',
    'exports.up = function(knex) {',
    `  return knex.schema.alterTable('${tableName}', (table) => {`,
  ];

  for (const line of columnLines) {
    lines.push(`    ${line}`);
  }

  if (indexLines.length > 0) {
    lines.push('');
    for (const line of indexLines) {
      lines.push(`    ${line}`);
    }
  }

  if (foreignKeyLines.length > 0) {
    lines.push('');
    for (const line of foreignKeyLines) {
      lines.push(`    ${line}`);
    }
  }

  lines.push('  });');
  lines.push('};');
  lines.push('');
  lines.push('exports.down = function(knex) {');
  lines.push(`  return knex.schema.alterTable('${tableName}', (table) => {`);

  for (const line of dropLines) {
    lines.push(`    ${line}`);
  }

  lines.push('  });');
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate migration code for a drop table
 * @param {string} tableName - Table name
 * @returns {string} Migration file content
 */
function scaffoldDropMigration(tableName) {
  return `/**
 * Migration: Drop ${tableName} table
 */

exports.up = function(knex) {
  return knex.schema.dropTableIfExists('${tableName}');
};

exports.down = function(knex) {
  // Note: This down migration is empty because we don't know the original schema.
  // If you need to restore the table, please add the schema manually.
  return Promise.resolve();
};
`;
}

/**
 * Generate migration name from model
 * @param {import('../types').ModelDefinition} model - Model definition
 * @param {string} [action='create'] - Action (create, alter, drop)
 * @returns {string}
 */
function generateMigrationName(model, action = 'create') {
  return `${action}_${model.table}_table`;
}

module.exports = {
  scaffoldMigration,
  scaffoldAlterMigration,
  scaffoldDropMigration,
  generateColumnLine,
  generateMigrationName,
};

