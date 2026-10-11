'use strict';

/**
 * Webspresso CLI - make:model Command
 * Scaffolds an ORM model in models/<Name>.js with zdb schema and optional migration
 * @module bin/commands/make-model
 */

const fs = require('fs');
const path = require('path');

function pluralize(word) {
  if (!word) return '';
  const lower = word.toLowerCase();
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
    return lower.slice(0, -1) + 'ies';
  }
  if (lower.endsWith('s') || lower.endsWith('sh') || lower.endsWith('ch') || lower.endsWith('x') || lower.endsWith('z')) {
    return lower + 'es';
  }
  return lower + 's';
}

function parseFields(fieldsArg) {
  if (!fieldsArg || typeof fieldsArg !== 'string') return [];
  const parts = fieldsArg.split(',').map((p) => p.trim()).filter(Boolean);
  const fields = [];

  for (const part of parts) {
    const [name, type = 'string', modifier = ''] = part.split(':').map((s) => s.trim());
    if (!name) continue;
    fields.push({
      name,
      type: type.toLowerCase(),
      isNullable: modifier.toLowerCase() === 'nullable' || modifier.toLowerCase() === 'optional' || name.endsWith('?'),
    });
  }

  return fields;
}

function generateSchemaLines(fields, softDeletes = false) {
  const lines = ['    id: zdb.id(),'];

  for (const f of fields) {
    if (f.name === 'id') continue;
    let expr = 'zdb.string().min(1)';

    switch (f.type) {
      case 'text':
        expr = 'zdb.text().optional()';
        break;
      case 'integer':
      case 'int':
        expr = f.isNullable ? 'zdb.integer().nullable().optional()' : 'zdb.integer().defaultTo(0)';
        break;
      case 'number':
      case 'float':
      case 'decimal':
        expr = f.isNullable ? 'zdb.number().nullable().optional()' : 'zdb.number().defaultTo(0)';
        break;
      case 'boolean':
      case 'bool':
        expr = 'zdb.boolean().defaultTo(false)';
        break;
      case 'json':
        expr = 'zdb.json().optional()';
        break;
      case 'date':
      case 'datetime':
        expr = 'zdb.date().optional()';
        break;
      case 'email':
        expr = 'zdb.email().optional()';
        break;
      case 'file':
        expr = 'zdb.file().optional()';
        break;
      case 'id':
        expr = 'zdb.id()';
        break;
      case 'string':
      default:
        expr = f.isNullable ? 'zdb.string().nullable().optional()' : 'zdb.string().min(1)';
        break;
    }

    lines.push(`    ${f.name}: ${expr},`);
  }

  if (softDeletes) {
    lines.push('    deletedAt: zdb.softDelete().optional(),');
  }

  lines.push('    createdAt: zdb.timestamps().createdAt,');
  lines.push('    updatedAt: zdb.timestamps().updatedAt,');

  return lines.join('\n');
}

function generateModelContent(modelName, tableName, fields, softDeletes = false) {
  const schemaCode = generateSchemaLines(fields, softDeletes);
  const softScope = softDeletes ? `,\n  scopes: {\n    default: (q) => q.whereNull('deletedAt'),\n  }` : '';

  return `'use strict';

const { defineModel, zdb } = require('webspresso');

module.exports = defineModel({
  name: '${modelName}',
  table: '${tableName}',
  schema: {
${schemaCode}
  }${softScope},
});
`;
}

function generateMigrationContent(tableName, fields, softDeletes = false) {
  const colLines = ['    table.increments(\'id\').primary();'];

  for (const f of fields) {
    if (f.name === 'id') continue;
    switch (f.type) {
      case 'text':
        colLines.push(`    table.text('${f.name}')${f.isNullable ? '.nullable()' : ''};`);
        break;
      case 'integer':
      case 'int':
        colLines.push(`    table.integer('${f.name}')${f.isNullable ? '.nullable()' : '.defaultTo(0)'};`);
        break;
      case 'number':
      case 'float':
      case 'decimal':
        colLines.push(`    table.float('${f.name}')${f.isNullable ? '.nullable()' : '.defaultTo(0)'};`);
        break;
      case 'boolean':
      case 'bool':
        colLines.push(`    table.boolean('${f.name}').defaultTo(false);`);
        break;
      case 'json':
        colLines.push(`    table.json('${f.name}').nullable();`);
        break;
      case 'date':
      case 'datetime':
        colLines.push(`    table.datetime('${f.name}').nullable();`);
        break;
      default:
        colLines.push(`    table.string('${f.name}')${f.isNullable ? '.nullable()' : '.notNullable()'};`);
        break;
    }
  }

  if (softDeletes) {
    colLines.push('    table.datetime(\'deletedAt\').nullable();');
  }

  colLines.push('    table.timestamps(true, true);');

  return `'use strict';

/**
 * Migration: Create ${tableName} table
 */
exports.up = function(knex) {
  return knex.schema.createTable('${tableName}', (table) => {
${colLines.join('\n')}
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('${tableName}');
};
`;
}

function registerCommand(program) {
  program
    .command('make:model <name>')
    .alias('model:make')
    .description('Scaffold an ORM model in models/<Name>.js with zdb schema')
    .option('-f, --fields <fields>', 'Comma-separated fields (e.g. title:string,content:text,published:boolean)')
    .option('-t, --table <table>', 'Custom table name (defaults to pluralized lowercase)')
    .option('-m, --migration', 'Generate corresponding Knex migration file in migrations/')
    .option('--soft-deletes', 'Include deletedAt column and default scope for soft delete')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const modelsDir = path.join(rootDir, 'models');
      const migrationsDir = path.join(rootDir, 'migrations');

      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }

      // Format Model Name (PascalCase, e.g. post -> Post, blog_post -> BlogPost)
      const cleanName = String(nameArg || '').trim();
      const modelName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      const tableName = options.table ? String(options.table).trim() : pluralize(cleanName.toLowerCase());

      const modelFilePath = path.join(modelsDir, `${modelName}.js`);
      if (fs.existsSync(modelFilePath)) {
        console.error(`❌ Model file already exists: models/${modelName}.js`);
        process.exitCode = 1;
        return;
      }

      const fields = parseFields(options.fields);
      const modelContent = generateModelContent(modelName, tableName, fields, Boolean(options.softDeletes));

      fs.writeFileSync(modelFilePath, modelContent, 'utf-8');
      console.log(`\n✅ Created model: models/${modelName}.js (table: "${tableName}")`);

      // Optional migration generation
      if (options.migration) {
        if (!fs.existsSync(migrationsDir)) {
          fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const now = new Date();
        const timestamp = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
          '_',
          String(now.getHours()).padStart(2, '0'),
          String(now.getMinutes()).padStart(2, '0'),
          String(now.getSeconds()).padStart(2, '0'),
        ].join('');

        const migrationFileName = `${timestamp}_create_${tableName}_table.js`;
        const migrationFilePath = path.join(migrationsDir, migrationFileName);
        const migrationContent = generateMigrationContent(tableName, fields, Boolean(options.softDeletes));

        fs.writeFileSync(migrationFilePath, migrationContent, 'utf-8');
        console.log(`✅ Created migration: migrations/${migrationFileName}`);
      }

      console.log('');
    });
}

module.exports = {
  registerCommand,
  pluralize,
  parseFields,
  generateSchemaLines,
  generateModelContent,
  generateMigrationContent,
};
