/**
 * Migration: Create content_entries table
 */

exports.up = function (knex) {
  return knex.schema.createTable('content_entries', (table) => {
    table.increments('id').primary();
    table.integer('content_type_id').unsigned().notNullable()
      .references('id').inTable('content_types').onDelete('CASCADE');
    table.string('slug', 128).notNullable();
    table.string('title', 255).nullable();
    table.json('data').notNullable();
    table.string('status', 32).notNullable().defaultTo('published');
    table.string('locale', 16).nullable();
    table.integer('revision').notNullable().defaultTo(1);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['content_type_id', 'slug', 'locale']);
    table.index(['content_type_id', 'status']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('content_entries');
};
