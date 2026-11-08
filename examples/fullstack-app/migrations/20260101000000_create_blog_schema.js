'use strict';

/**
 * Initial blog schema: users, categories, posts (soft-deletable), comments.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.string('name', 120).notNullable();
    t.string('password').notNullable();
    t.string('role').notNullable().defaultTo('author');
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
  });

  await knex.schema.createTable('categories', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable();
    t.string('slug', 80).notNullable().unique();
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
  });

  await knex.schema.createTable('posts', (t) => {
    t.increments('id').primary();
    t.string('title', 200).notNullable();
    t.string('slug', 220).notNullable().unique();
    t.string('excerpt', 500).notNullable();
    t.text('body').notNullable();
    t.string('status').notNullable().defaultTo('draft');
    t.integer('views').notNullable().defaultTo(0);
    t.integer('author_id').notNullable().references('id').inTable('users');
    t.integer('category_id').notNullable().references('id').inTable('categories');
    t.timestamp('published_at').nullable();
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
    t.timestamp('deleted_at').nullable();
    t.index(['status', 'published_at']);
    t.index(['category_id']);
  });

  await knex.schema.createTable('comments', (t) => {
    t.increments('id').primary();
    t.integer('post_id').notNullable().references('id').inTable('posts');
    t.string('author_name', 80).notNullable();
    t.text('body').notNullable();
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
    t.index(['post_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('users');
};

