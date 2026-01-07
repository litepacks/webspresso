/**
 * Webspresso ORM - Migration Manager
 * Wraps Knex migrations API
 * @module core/orm/migrations
 */

const { generateMigrationTimestamp } = require('../utils');

/**
 * Create a migration manager
 * @param {import('knex').Knex} knex - Knex instance
 * @param {import('../types').MigrationConfig} config - Migration configuration
 * @returns {import('../types').MigrationManager}
 */
function createMigrationManager(knex, config = {}) {
  const {
    directory = './migrations',
    tableName = 'knex_migrations',
  } = config;

  const migrationConfig = {
    directory,
    tableName,
  };

  return {
    /**
     * Run all pending migrations
     * @returns {Promise<import('../types').MigrationResult>}
     */
    async latest() {
      const [batch, migrations] = await knex.migrate.latest(migrationConfig);
      return {
        batch,
        migrations,
      };
    },

    /**
     * Rollback migrations
     * @param {Object} [options={}]
     * @param {boolean} [options.all=false] - Rollback all migrations
     * @returns {Promise<import('../types').MigrationResult>}
     */
    async rollback(options = {}) {
      const rollbackConfig = {
        ...migrationConfig,
        ...(options.all ? { all: true } : {}),
      };
      const [batch, migrations] = await knex.migrate.rollback(rollbackConfig);
      return {
        batch,
        migrations,
      };
    },

    /**
     * Get current migration version
     * @returns {Promise<string>}
     */
    async currentVersion() {
      return knex.migrate.currentVersion(migrationConfig);
    },

    /**
     * Get migration status
     * @returns {Promise<import('../types').MigrationStatus[]>}
     */
    async status() {
      // Get completed migrations from database
      const completedResult = await knex.migrate.list(migrationConfig);
      const [completed, pending] = completedResult;

      const statuses = [];

      // Add completed migrations
      for (const migration of completed) {
        statuses.push({
          name: migration.name || migration,
          completed: true,
          ran_at: migration.migration_time || null,
          batch: migration.batch || null,
        });
      }

      // Add pending migrations
      for (const migration of pending) {
        statuses.push({
          name: migration.name || migration,
          completed: false,
          ran_at: null,
          batch: null,
        });
      }

      // Sort by name
      statuses.sort((a, b) => a.name.localeCompare(b.name));

      return statuses;
    },

    /**
     * Create a new migration file
     * @param {string} name - Migration name
     * @param {Object} [options={}]
     * @param {string} [options.content] - Custom migration content
     * @returns {Promise<string>} Created file path
     */
    async make(name, options = {}) {
      const { content } = options;
      
      if (content) {
        // Use custom stub with content
        const timestamp = generateMigrationTimestamp();
        const filename = `${timestamp}_${name}.js`;
        
        // Knex's make doesn't support custom content directly,
        // so we return the filename and content for the CLI to write
        return {
          filename,
          filepath: `${directory}/${filename}`,
          content,
        };
      }

      // Use default Knex make
      const result = await knex.migrate.make(name, migrationConfig);
      return {
        filename: result.split('/').pop(),
        filepath: result,
        content: null,
      };
    },

    /**
     * Run specific migration up
     * @param {string} name - Migration name
     * @returns {Promise<void>}
     */
    async up(name) {
      await knex.migrate.up({ ...migrationConfig, name });
    },

    /**
     * Run specific migration down
     * @param {string} name - Migration name
     * @returns {Promise<void>}
     */
    async down(name) {
      await knex.migrate.down({ ...migrationConfig, name });
    },

    /**
     * Get the migration configuration
     * @returns {Object}
     */
    getConfig() {
      return { ...migrationConfig };
    },

    /**
     * Check if migrations table exists
     * @returns {Promise<boolean>}
     */
    async hasTable() {
      return knex.schema.hasTable(tableName);
    },

    /**
     * Unlock stuck migrations
     * @returns {Promise<void>}
     */
    async unlock() {
      await knex.migrate.forceFreeMigrationsLock(migrationConfig);
    },
  };
}

/**
 * Default migration template
 * @returns {string}
 */
function getDefaultMigrationTemplate() {
  return `/**
 * Migration: 
 */

exports.up = function(knex) {
  return knex.schema.createTable('table_name', (table) => {
    table.bigIncrements('id').primary();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('table_name');
};
`;
}

module.exports = {
  createMigrationManager,
  getDefaultMigrationTemplate,
};

