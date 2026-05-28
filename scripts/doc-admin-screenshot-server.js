'use strict';

const path = require('path');
const { createApp, createDatabase } = require('..');
const {
  adminPanelPlugin,
  dataExchangePlugin,
  auditLogPlugin,
  siteAnalyticsPlugin,
  ormCacheAdminPlugin,
} = require('../plugins');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'doc-screenshots');
const MODELS_DIR = path.join(FIXTURE_ROOT, 'models');

async function createDocScreenshotDatabase() {
  const db = createDatabase({
    client: 'better-sqlite3',
    connection: ':memory:',
    useNullAsDefault: true,
    models: MODELS_DIR,
    cache: true,
  });

  await db.knex.schema.createTableIfNotExists('admin_users', (table) => {
    table.bigIncrements('id');
    table.string('email').unique();
    table.string('password');
    table.string('name');
    table.string('role').defaultTo('admin');
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });

  await db.knex.schema.createTableIfNotExists('test_posts', (table) => {
    table.bigIncrements('id');
    table.string('title');
    table.text('content');
    table.text('body');
    table.string('status').defaultTo('draft');
    table.boolean('published').defaultTo(false);
    table.date('publish_date').nullable();
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });

  await db.knex.schema.createTableIfNotExists('users', (table) => {
    table.bigIncrements('id').primary();
    table.string('email', 255).unique();
    table.string('password', 255);
    table.string('name', 255).nullable();
    table.string('role', 50).defaultTo('user');
    table.boolean('active').defaultTo(true);
    table.timestamp('email_verified_at').nullable();
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });

  await db.knex.schema.createTableIfNotExists('audit_logs', (table) => {
    table.bigIncrements('id');
    table.timestamp('created_at').defaultTo(db.knex.fn.now()).index();
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
  });

  const now = db.knex.fn.now();
  await db.knex('users').insert({
    email: 'visitor@docs.webspresso',
    password: 'not-used',
    name: 'Docs Visitor',
    role: 'user',
    active: 1,
    created_at: now,
    updated_at: now,
  });

  await db.knex('test_posts').insert([
    {
      title: 'Getting started with Webspresso',
      content: 'A short guide to file-based routing and the admin panel.',
      body: '<p>Welcome to the <strong>admin docs</strong> fixture.</p>',
      status: 'published',
      published: 1,
      created_at: now,
      updated_at: now,
    },
    {
      title: 'Plugin overview draft',
      content: 'Draft post used for filters and bulk actions in screenshots.',
      status: 'draft',
      published: 0,
      created_at: now,
      updated_at: now,
    },
    {
      title: 'ORM cache and analytics',
      content: 'Companion notes for admin plugin screenshots.',
      status: 'pending',
      published: 0,
      created_at: now,
      updated_at: now,
    },
  ]);

  await db.knex('audit_logs').insert([
    {
      actor_email: 'admin@docs.webspresso',
      action: 'create',
      resource_model: 'TestPost',
      resource_id: '1',
      http_method: 'POST',
      path: '/_admin/api/models/TestPost/records',
      created_at: now,
    },
    {
      actor_email: 'admin@docs.webspresso',
      action: 'update',
      resource_model: 'TestPost',
      resource_id: '2',
      http_method: 'PUT',
      path: '/_admin/api/models/TestPost/records/2',
      created_at: now,
    },
  ]);

  return db;
}

async function startDocScreenshotServer(port = 3099) {
  const db = await createDocScreenshotDatabase();
  const pagesDir = path.join(FIXTURE_ROOT, 'pages');
  const viewsDir = path.join(FIXTURE_ROOT, 'views');
  const publicDir = path.join(FIXTURE_ROOT, 'public');

  const { app } = createApp({
    pagesDir,
    viewsDir,
    publicDir,
    cookieSecret: 'doc-screenshot-secret-32-chars-min!!',
    plugins: [
      adminPanelPlugin({
        path: '/_admin',
        db,
        userManagement: { enabled: true, model: 'User' },
      }),
      dataExchangePlugin({ adminPath: '/_admin', db }),
      auditLogPlugin({ db, adminPath: '/_admin' }),
      siteAnalyticsPlugin({ db }),
      ormCacheAdminPlugin({ db }),
    ],
  });

  await new Promise((resolve) => {
    app.listen(port, resolve);
  });

  return { app, db, port, baseUrl: `http://127.0.0.1:${port}` };
}

module.exports = { startDocScreenshotServer, FIXTURE_ROOT };
