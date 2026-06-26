/**
 * Shared setup for content plugin integration / contract tests.
 * @module tests/fixtures/content-test-setup
 */

import { createApp } from '../../src/server.js';
import { createDatabase, clearRegistry } from '../../index.js';
import { adminPanelPlugin, contentPlugin } from '../../plugins/index.js';

export const SAMPLE_TYPE_SCHEMA = {
  fields: [
    { name: 'headline', type: 'text', label: 'Headline', required: true },
    { name: 'body', type: 'rich-text', label: 'Body' },
    { name: 'count', type: 'number' },
    { name: 'active', type: 'boolean' },
    { name: 'cta', type: 'url' },
    { name: 'badge', type: 'image' },
    { name: 'published_on', type: 'date' },
    { name: 'variant', type: 'select', options: ['a', 'b'] },
    {
      name: 'items',
      type: 'repeater',
      fields: [
        { name: 'q', type: 'text' },
        { name: 'a', type: 'textarea' },
      ],
    },
  ],
};

export async function createContentTables(knex) {
  await knex.schema.createTable('content_types', (table) => {
    table.increments('id').primary();
    table.string('slug', 128).notNullable().unique();
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.json('schema').notNullable();
    table.json('settings').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('content_entries', (table) => {
    table.increments('id').primary();
    table.integer('content_type_id').unsigned().notNullable();
    table.string('slug', 128).notNullable();
    table.string('title', 255).nullable();
    table.json('data').notNullable();
    table.string('status', 32).notNullable().defaultTo('published');
    table.string('locale', 16).nullable();
    table.integer('revision').notNullable().defaultTo(1);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['content_type_id', 'slug', 'locale']);
  });
}

export async function createAdminUsersTable(knex) {
  await knex.schema.createTable('admin_users', (table) => {
    table.bigIncrements('id');
    table.string('email').unique();
    table.string('password');
    table.string('name');
    table.string('role').defaultTo('admin');
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.inlineEdit=true]
 */
export async function createContentTestApp(options = {}) {
  clearRegistry();

  const db = createDatabase({
    client: 'better-sqlite3',
    connection: ':memory:',
    useNullAsDefault: true,
  });

  await createContentTables(db.knex);
  await createAdminUsersTable(db.knex);

  const { app } = createApp({
    pagesDir: './tests/fixtures/pages',
    viewsDir: './tests/fixtures/views',
    publicDir: './public',
    db,
    plugins: [
      adminPanelPlugin({ path: '/_admin', db }),
      contentPlugin({
        db,
        adminPath: '/_admin',
        inlineEdit: options.inlineEdit !== false,
      }),
    ],
  });

  return { app, db };
}

/**
 * @param {import('supertest').SuperTest<import('express').Application>} request
 * @param {import('express').Application} app
 */
export async function loginAdmin(request, app) {
  await request(app).post('/_admin/api/auth/setup').send({
    email: 'admin@example.com',
    password: 'password123',
    name: 'Admin',
  });
  const loginRes = await request(app).post('/_admin/api/auth/login').send({
    email: 'admin@example.com',
    password: 'password123',
  });
  return loginRes.headers['set-cookie'];
}

/**
 * Seed hero type + home entry for contract tests.
 */
export async function seedHeroContent(request, app, cookie) {
  const typeRes = await request(app)
    .post('/_admin/api/content/types')
    .set('Cookie', cookie)
    .send({
      slug: 'hero',
      name: 'Hero',
      description: 'Homepage hero block',
      schema: SAMPLE_TYPE_SCHEMA,
    })
    .expect(201);

  const entryRes = await request(app)
    .post('/_admin/api/content/types/hero/entries')
    .set('Cookie', cookie)
    .send({
      slug: 'home',
      title: 'Homepage',
      data: {
        headline: 'Hello CMS',
        body: '<p>Rich</p>',
        count: 2,
        active: true,
        cta: 'https://example.com',
        badge: '/uploads/badge.png',
        published_on: '2026-06-25',
        variant: 'a',
        items: [{ q: 'Q1', a: 'A1' }],
      },
    })
    .expect(201);

  return { type: typeRes.body.data, entry: entryRes.body.data };
}
