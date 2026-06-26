/**
 * Migration: Create content_types table
 */

exports.up = function (knex) {
  return knex.schema.createTable('content_types', (table) => {
    table.increments('id').primary();
    table.string('slug', 128).notNullable().unique();
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.json('schema').notNullable();
    table.json('settings').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('content_types');
};
