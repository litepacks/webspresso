/**
 * Migration Integration Tests
 */

const { createDatabase } = require('../../../core/orm');
const { createMigrationManager } = require('../../../core/orm/migrations');

describe('Migration Integration', () => {
  let db;
  let migrate;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      migrations: {
        directory: './tests/fixtures/migrations',
        tableName: 'test_migrations',
      },
    });

    migrate = db.migrate;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('createMigrationManager', () => {
    it('should create migration manager with config', () => {
      const manager = createMigrationManager(db.knex, {
        directory: './migrations',
        tableName: 'custom_migrations',
      });

      const config = manager.getConfig();
      expect(config.directory).toBe('./migrations');
      expect(config.tableName).toBe('custom_migrations');
    });

    it('should use defaults when no config provided', () => {
      const manager = createMigrationManager(db.knex);

      const config = manager.getConfig();
      expect(config.directory).toBe('./migrations');
      expect(config.tableName).toBe('knex_migrations');
    });
  });

  describe('status', () => {
    it('should return migration status array', async () => {
      const status = await migrate.status();

      expect(Array.isArray(status)).toBe(true);
    });
  });

  describe('hasTable', () => {
    it('should check if migrations table exists', async () => {
      // Initially might not exist
      const hasBefore = await migrate.hasTable();
      expect(typeof hasBefore).toBe('boolean');
    });
  });

  describe('make', () => {
    it('should generate migration file info', async () => {
      const result = await migrate.make('test_migration', {
        content: `
exports.up = function(knex) {
  return knex.schema.createTable('test', t => t.increments('id'));
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('test');
};
`,
      });

      expect(result.filename).toContain('test_migration');
      expect(result.filepath).toContain('test_migration');
      expect(result.content).toContain('exports.up');
    });
  });

  describe('currentVersion', () => {
    it('should return current version string', async () => {
      const version = await migrate.currentVersion();

      // Will be 'none' or a migration name
      expect(typeof version).toBe('string');
    });
  });
});

