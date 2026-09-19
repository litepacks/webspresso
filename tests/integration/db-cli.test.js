/**
 * Database CLI Command Tests
 */

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { registerCommand: registerDbMigrate } = require('../../bin/commands/db-migrate');
const { registerCommand: registerDbRollback } = require('../../bin/commands/db-rollback');
const { registerCommand: registerDbStatus } = require('../../bin/commands/db-status');
const { registerCommand: registerDbMake } = require('../../bin/commands/db-make');
const { registerCommand: registerDbScaffold } = require('../../bin/commands/db-scaffold');

describe('Database CLI Commands', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-project-'));
  const migrationsDir = path.join(testDir, 'migrations');
  const modelsDir = path.join(testDir, 'models');
  const configFile = path.join(testDir, 'webspresso.db.js');
  const ormRequirePath = path.resolve(__dirname, '../../core/orm').replace(/\\/g, '/');

  async function runCliInProcess(args) {
    const program = new Command();
    program.exitOverride();
    registerDbMigrate(program);
    registerDbRollback(program);
    registerDbStatus(program);
    registerDbMake(program);
    registerDbScaffold(program);

    const logs = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...a) => logs.push(a.join(' '));
    console.error = (...a) => logs.push(a.join(' '));
    console.warn = (...a) => logs.push(a.join(' '));

    try {
      await program.parseAsync(['node', 'webspresso', ...args]);
      return logs.join('\n');
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }
  }

  beforeAll(() => {
    // Create test directory structure
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(modelsDir, 'User.js'),
      `const { defineModel, zdb } = require('${ormRequirePath}');
module.exports = defineModel({
  name: 'User',
  table: 'users',
  schema: zdb.schema({
    id: zdb.id(),
    email: zdb.string({ maxLength: 255, unique: true }),
  }),
});
`
    );

    // Create test database config
    const config = `
module.exports = {
  client: 'better-sqlite3',
  connection: {
    filename: '${path.join(testDir, 'test.db')}',
  },
  useNullAsDefault: true,
  migrations: {
    directory: '${migrationsDir}',
    tableName: 'knex_migrations',
  },
  models: '${modelsDir}',
};
`;
    fs.writeFileSync(configFile, config);

    // Create a test migration
    const migration = `
exports.up = function(knex) {
  return knex.schema.createTable('cli_test', (table) => {
    table.increments('id');
    table.string('name');
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('cli_test');
};
`;
    fs.writeFileSync(
      path.join(migrationsDir, '20240101_000001_create_cli_test_table.js'),
      migration
    );
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('db:status', () => {
    it('should show migration status', async () => {
      const result = await runCliInProcess(['db:status', '--config', configFile]);
      expect(result).toContain('Migration Status');
    });
  });

  describe('db:make', () => {
    it('should create a new migration file', async () => {
      const migrationName = 'add_users_table';
      const result = await runCliInProcess(['db:make', migrationName, '--config', configFile]);

      expect(result).toContain('Created:');

      const files = fs.readdirSync(migrationsDir);
      const newMigration = files.find(f => f.includes(migrationName));
      expect(newMigration).toBeDefined();

      const content = fs.readFileSync(
        path.join(migrationsDir, newMigration),
        'utf-8'
      );
      expect(content).toContain('exports.up');
      expect(content).toContain('exports.down');

      fs.unlinkSync(path.join(migrationsDir, newMigration));
    });

    it('should parse table name from migration name', async () => {
      const migrationName = 'create_posts_table';
      await runCliInProcess(['db:make', migrationName, '--config', configFile]);

      const files = fs.readdirSync(migrationsDir);
      const newMigration = files.find(f => f.includes(migrationName));
      expect(newMigration).toBeDefined();

      const content = fs.readFileSync(
        path.join(migrationsDir, newMigration),
        'utf-8'
      );
      expect(content).toContain("'posts'");

      fs.unlinkSync(path.join(migrationsDir, newMigration));
    });
  });

  describe('db:scaffold', () => {
    it('should generate migrations from models directory', async () => {
      const result = await runCliInProcess(['db:scaffold', '--config', configFile]);

      expect(result).toContain('Created');
      expect(result).toContain('users');

      const files = fs.readdirSync(migrationsDir);
      const usersMigration = files.find((f) => f.includes('create_users_table'));
      expect(usersMigration).toBeDefined();

      const content = fs.readFileSync(path.join(migrationsDir, usersMigration), 'utf-8');
      expect(content).toContain("createTable('users'");

      if (usersMigration) {
        fs.unlinkSync(path.join(migrationsDir, usersMigration));
      }
    });
  });

  describe('db:migrate', () => {
    it('should run pending migrations', async () => {
      const result = await runCliInProcess(['db:migrate', '--config', configFile]);

      expect(
        result.includes('migration') || 
        result.includes('up to date') ||
        result.includes('Done')
      ).toBe(true);
    });
  });

  describe('db:rollback', () => {
    it('should rollback migrations', async () => {
      await runCliInProcess(['db:migrate', '--config', configFile]);
      const result = await runCliInProcess(['db:rollback', '--config', configFile]);

      expect(
        result.includes('rollback') || 
        result.includes('Nothing') ||
        result.includes('Done') ||
        result.includes('Rolling back')
      ).toBe(true);
    });
  });
});
