/**
 * Migration: Create audit_logs table (example — use getMigrationTemplate from audit-log plugin to customize)
 */

exports.up = function (knex) {
  return knex.schema.createTable('audit_logs', (table) => {
    table.bigIncrements('id').primary();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable().index();
    table.bigInteger('actor_id').nullable().index();
    table.string('actor_email', 255).nullable();
    table.string('action', 32).notNullable();
    table.string('resource_model', 255).notNullable();
    table.string('resource_id', 255).nullable();
    table.string('http_method', 16).notNullable();
    table.string('path', 2000).notNullable();
    table.string('ip', 64).nullable();
    table.text('user_agent').nullable();
    table.json('metadata').nullable();

    table.index(['resource_model', 'created_at']);
    table.index(['action', 'created_at']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('audit_logs');
};
