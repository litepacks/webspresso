/**
 * Migration Utilities
 * Functions for generating migration file content
 */

/**
 * Get default migration content
 * @param {string} name - Migration name
 * @returns {string}
 */
function getDefaultMigrationContent(name) {
  // Parse table name from migration name (e.g., create_users_table -> users)
  const match = name.match(/^create_(\w+)_table$/);
  const tableName = match ? match[1] : 'table_name';
  
  return `/**
 * Migration: ${name}
 */

exports.up = function(knex) {
  return knex.schema.createTable('${tableName}', (table) => {
    table.bigIncrements('id').primary();
    // Add your columns here
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('${tableName}');
};
`;
}

module.exports = {
  getDefaultMigrationContent
};
