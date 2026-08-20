/**
 * Microbenchmarks: Webspresso ORM infrastructure
 * Model definition, Schema helpers, In-memory Repository CRUD, Eager loading, and Cache layer
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createDatabase,
  defineModel,
  getModel,
  zdb,
  extractColumnsFromSchema,
} = require('../core/orm/index.js');
const { loadRelations } = require('../core/orm/eager-loader.js');

// 1. Schema & Model Setup
const sampleZodSchema = zdb.schema({
  id: zdb.id(),
  title: zdb.string({ maxLength: 150 }),
  status: zdb.enum(['draft', 'published', 'archived']),
  settings: zdb.json({ nullable: true }),
});

const userModel = defineModel({
  name: 'BenchUser',
  table: 'bench_users',
  primaryKey: 'id',
  schema: zdb.schema({
    id: zdb.id(),
    name: zdb.string({ maxLength: 100 }),
    email: zdb.string().email(),
  }),
  scopes: { timestamps: true, softDelete: false },
  relations: {
    posts: {
      type: 'hasMany',
      model: () => getModel('BenchPost'),
      foreignKey: 'user_id',
    },
  },
});

const postModel = defineModel({
  name: 'BenchPost',
  table: 'bench_posts',
  primaryKey: 'id',
  schema: zdb.schema({
    id: zdb.id(),
    user_id: zdb.integer(),
    title: zdb.string({ maxLength: 200 }),
    body: zdb.text({ nullable: true }),
    metadata: zdb.json({ nullable: true }),
    is_published: zdb.boolean({ default: true }),
  }),
  scopes: { timestamps: true, softDelete: true },
  relations: {
    user: {
      type: 'belongsTo',
      model: () => getModel('BenchUser'),
      foreignKey: 'user_id',
    },
  },
});

const cachedModel = defineModel({
  name: 'BenchCachedArticle',
  table: 'bench_cached_articles',
  primaryKey: 'id',
  cache: 'auto',
  schema: zdb.schema({
    id: zdb.id(),
    title: zdb.string(),
    slug: zdb.string(),
  }),
  scopes: { timestamps: true },
});

// Top-level await initialization for in-memory SQLite DB
const db = createDatabase({
  client: 'better-sqlite3',
  connection: ':memory:',
  useNullAsDefault: true,
  cache: {
    enabled: true,
    maxEntries: 10000,
  },
});

await db.knex.schema.createTable('bench_users', (t) => {
  t.increments('id').primary();
  t.string('name', 100);
  t.string('email').unique();
  t.timestamp('created_at').defaultTo(db.knex.fn.now());
  t.timestamp('updated_at').defaultTo(db.knex.fn.now());
});

await db.knex.schema.createTable('bench_posts', (t) => {
  t.increments('id').primary();
  t.integer('user_id').references('bench_users.id');
  t.string('title', 200);
  t.text('body');
  t.text('metadata');
  t.boolean('is_published').defaultTo(true);
  t.timestamp('created_at').defaultTo(db.knex.fn.now());
  t.timestamp('updated_at').defaultTo(db.knex.fn.now());
  t.timestamp('deleted_at');
});

await db.knex.schema.createTable('bench_cached_articles', (t) => {
  t.increments('id').primary();
  t.string('title');
  t.string('slug');
  t.timestamp('created_at').defaultTo(db.knex.fn.now());
  t.timestamp('updated_at').defaultTo(db.knex.fn.now());
});

const userRepo = db.getRepository('BenchUser');
const postRepo = db.getRepository('BenchPost');
const cachedRepo = db.getRepository('BenchCachedArticle');

for (let u = 1; u <= 5; u++) {
  await userRepo.create({ name: `User ${u}`, email: `user${u}@example.com` });
}

const p1 = await postRepo.create({
  user_id: 1,
  title: 'First Post',
  body: 'Content',
  metadata: { views: 42, score: 9.8 },
  is_published: true,
});
const createdPostId = p1.id;

for (let i = 2; i <= 20; i++) {
  await postRepo.create({
    user_id: (i % 5) + 1,
    title: `Post ${i}`,
    body: `Body ${i}`,
    metadata: { views: i * 10 },
    is_published: i % 2 === 0,
  });
}

await cachedRepo.create({ title: 'Cached 1', slug: 'cached-1' });

const allPosts = await postRepo.findAll();
const allUsers = await userRepo.findAll();

// Warm up cache
await cachedRepo.findById(1);
await cachedRepo.findAll();

describe('ORM: Model Definition & Schema Reflection', () => {
  bench('zdb: schema creation (8 columns + metadata)', () => {
    zdb.schema({
      id: zdb.id(),
      title: zdb.string({ maxLength: 150 }).min(3).config({ label: 'Title', sortable: true }),
      slug: zdb.string({ maxLength: 150 }),
      content: zdb.text({ nullable: true }),
      view_count: zdb.integer({ default: 0 }),
      is_published: zdb.boolean({ default: false }),
      tags: zdb.array(null, { nullable: true }),
      metadata: zdb.json({ nullable: true }),
    });
  });

  bench('extractColumnsFromSchema (Zod reflection)', () => {
    extractColumnsFromSchema(sampleZodSchema);
  });

  bench('getModel (registry lookup)', () => {
    getModel('BenchPost');
  });
});

describe('ORM: In-Memory Repository CRUD & Queries', () => {
  bench('findById (deserialization)', async () => {
    await postRepo.findById(createdPostId);
  });

  bench('findOne (where clause)', async () => {
    await postRepo.findOne({ title: 'First Post' });
  });

  bench('findAll (20 rows with JSON parse)', async () => {
    await postRepo.findAll();
  });

  bench('QueryBuilder: paginate(1, 10)', async () => {
    await postRepo.query().where('is_published', true).orderBy('created_at', 'desc').paginate(1, 10);
  });

  bench('QueryBuilder: count()', async () => {
    await postRepo.query().where('is_published', true).count();
  });

  bench('create (validate + timestamps + insert)', async () => {
    await postRepo.create({
      user_id: 1,
      title: 'Benchmark Post',
      body: 'Bench text',
      metadata: { generated: true },
      is_published: true,
    });
  });

  bench('update (validate + SQL update)', async () => {
    await postRepo.update(createdPostId, {
      title: 'Updated Title',
      metadata: { views: 999 },
    });
  });
});

describe('ORM: Relations Eager Loading', () => {
  bench('loadRelations: belongsTo (20 posts -> users)', async () => {
    await loadRelations(allPosts, ['user'], postModel, db.knex, postRepo.scopeContext);
  });

  bench('loadRelations: hasMany (5 users -> posts)', async () => {
    await loadRelations(allUsers, ['posts'], userModel, db.knex, userRepo.scopeContext);
  });
});

describe('ORM: Cache Layer', () => {
  bench('findById (warm cache hit)', async () => {
    await cachedRepo.findById(1);
  });

  bench('findAll (warm collection cache hit)', async () => {
    await cachedRepo.findAll();
  });
});
