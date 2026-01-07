/**
 * Database CLI Command Tests
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Database CLI Commands', () => {
  const testDir = path.join(__dirname, '../fixtures/cli-test-project');
  const migrationsDir = path.join(testDir, 'migrations');
  const configFile = path.join(testDir, 'webspresso.db.js');

  beforeAll(() => {
    // Create test directory structure
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

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
    // Cleanup
    const dbFile = path.join(testDir, 'test.db');
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
    }
    // Remove migration files (but keep directory for other tests)
    const files = fs.readdirSync(migrationsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(migrationsDir, file));
    }
  });

  describe('db:status', () => {
    it('should show migration status', () => {
      const cliPath = path.join(__dirname, '../../bin/webspresso.js');
      
      try {
        const result = execSync(
          `node "${cliPath}" db:status --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        expect(result).toContain('Migration Status');
      } catch (error) {
        // If knex or better-sqlite3 not installed, skip
        if (error.message.includes('Cannot find module')) {
          console.log('Skipping CLI test - dependencies not installed');
          return;
        }
        throw error;
      }
    });
  });

  describe('db:make', () => {
    it('should create a new migration file', () => {
      const cliPath = path.join(__dirname, '../../bin/webspresso.js');
      const migrationName = 'add_users_table';

      try {
        const result = execSync(
          `node "${cliPath}" db:make ${migrationName} --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        expect(result).toContain('Created:');

        // Check file was created
        const files = fs.readdirSync(migrationsDir);
        const newMigration = files.find(f => f.includes(migrationName));
        expect(newMigration).toBeDefined();

        // Check content
        const content = fs.readFileSync(
          path.join(migrationsDir, newMigration),
          'utf-8'
        );
        expect(content).toContain('exports.up');
        expect(content).toContain('exports.down');

        // Cleanup
        fs.unlinkSync(path.join(migrationsDir, newMigration));
      } catch (error) {
        if (error.message.includes('Cannot find module')) {
          console.log('Skipping CLI test - dependencies not installed');
          return;
        }
        throw error;
      }
    });

    it('should parse table name from migration name', () => {
      const cliPath = path.join(__dirname, '../../bin/webspresso.js');
      const migrationName = 'create_posts_table';

      try {
        execSync(
          `node "${cliPath}" db:make ${migrationName} --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        const files = fs.readdirSync(migrationsDir);
        const newMigration = files.find(f => f.includes(migrationName));
        
        const content = fs.readFileSync(
          path.join(migrationsDir, newMigration),
          'utf-8'
        );

        // Should have parsed 'posts' from 'create_posts_table'
        expect(content).toContain("'posts'");

        // Cleanup
        fs.unlinkSync(path.join(migrationsDir, newMigration));
      } catch (error) {
        if (error.message.includes('Cannot find module')) {
          console.log('Skipping CLI test - dependencies not installed');
          return;
        }
        throw error;
      }
    });
  });

  describe('db:migrate', () => {
    it('should run pending migrations', () => {
      const cliPath = path.join(__dirname, '../../bin/webspresso.js');

      try {
        const result = execSync(
          `node "${cliPath}" db:migrate --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        // Should either run migrations or say up to date
        expect(
          result.includes('migration') || 
          result.includes('up to date') ||
          result.includes('Done')
        ).toBe(true);
      } catch (error) {
        if (error.message.includes('Cannot find module')) {
          console.log('Skipping CLI test - dependencies not installed');
          return;
        }
        throw error;
      }
    });
  });

  describe('db:rollback', () => {
    it('should rollback migrations', () => {
      const cliPath = path.join(__dirname, '../../bin/webspresso.js');

      try {
        // First run migrations
        execSync(
          `node "${cliPath}" db:migrate --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        // Then rollback
        const result = execSync(
          `node "${cliPath}" db:rollback --config "${configFile}"`,
          { encoding: 'utf-8', cwd: testDir }
        );

        expect(
          result.includes('rollback') || 
          result.includes('Nothing') ||
          result.includes('Done') ||
          result.includes('Rolling back')
        ).toBe(true);
      } catch (error) {
        if (error.message.includes('Cannot find module')) {
          console.log('Skipping CLI test - dependencies not installed');
          return;
        }
        throw error;
      }
    });
  });
});

