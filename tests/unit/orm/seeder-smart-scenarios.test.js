/**
 * Smart Field Detection, Factory States & Deep Relations in ORM Seeder
 * (core/orm/seeder.js)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { zdb, defineModel, clearRegistry, createDatabase } from '../../../core/orm/index.js';
import { createSeeder } from '../../../core/orm/seeder.js';

describe.sequential('ORM Seeder Smart Fields & Factory Scenarios', () => {
  let db;
  let knex;
  let seeder;

  beforeAll(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });
    knex = db.knex;

    await knex.schema.createTable('authors', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable();
      table.string('avatar').nullable();
      table.string('bio').nullable();
      table.string('phone').nullable();
      table.string('city').nullable();
      table.string('country').nullable();
      table.string('company_name').nullable();
      table.string('website_url').nullable();
    });

    await knex.schema.createTable('articles', (table) => {
      table.increments('id').primary();
      table.integer('author_id').notNullable();
      table.string('title').notNullable();
      table.string('slug').notNullable();
      table.text('content').notNullable();
      table.string('status').defaultTo('draft');
      table.float('price').defaultTo(0);
      table.integer('view_count').defaultTo(0);
      table.json('tags').nullable();
      table.json('metadata').nullable();
      table.string('uuid_val').nullable();
      table.string('nanoid_val').nullable();
      table.string('published_date').nullable();
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    clearRegistry();
  });

  beforeEach(() => {
    faker.seed(98765);
    seeder = createSeeder(faker, knex);
  });

  it('generates values using smart field naming heuristics', () => {
    const AuthorModel = defineModel({
      name: 'Author',
      table: 'authors',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string(),
        avatar: zdb.string({ nullable: true }),
        bio: zdb.string({ nullable: true }),
        phone: zdb.string({ nullable: true }),
        city: zdb.string({ nullable: true }),
        country: zdb.string({ nullable: true }),
        company_name: zdb.string({ nullable: true }),
        website_url: zdb.string({ nullable: true }),
      }),
    });

    const builder = seeder.factory(AuthorModel);
    const mockRecord = builder.make();

    expect(typeof mockRecord.name).toBe('string');
    expect(mockRecord.email).toContain('@');
    if (mockRecord.avatar) expect(mockRecord.avatar).toMatch(/^https?:\/\//);
    if (mockRecord.website_url) expect(mockRecord.website_url).toMatch(/^https?:\/\//);
    if (mockRecord.phone) expect(typeof mockRecord.phone).toBe('string');
    if (mockRecord.city) expect(typeof mockRecord.city).toBe('string');
    if (mockRecord.company_name) expect(typeof mockRecord.company_name).toBe('string');
  });

  it('handles smart array generation by column name and mixed arrays', () => {
    const TagModel = defineModel({
      name: 'TagContainer',
      table: 'articles',
      schema: zdb.schema({
        id: zdb.id(),
        tags: zdb.array(zdb.string()),
        scores: zdb.array(zdb.integer()),
        email_list: zdb.array(zdb.string()),
        link_list: zdb.array(zdb.string()),
        misc_items: zdb.array(zdb.string()),
      }),
    });

    const builder = seeder.factory(TagModel);
    const record = builder.make();

    expect(Array.isArray(record.tags)).toBe(true);
    expect(record.tags.length).toBeGreaterThanOrEqual(1);

    expect(Array.isArray(record.scores)).toBe(true);
    expect(typeof record.scores[0]).toBe('number');

    expect(Array.isArray(record.email_list)).toBe(true);
    expect(record.email_list[0]).toContain('@');

    expect(Array.isArray(record.link_list)).toBe(true);
    expect(record.link_list[0]).toMatch(/^https?:\/\//);

    expect(Array.isArray(record.misc_items)).toBe(true);
  });

  it('handles uuid, nanoid, float, decimal, json and enum types properly', () => {
    const TypeModel = defineModel({
      name: 'TypeTest',
      table: 'articles',
      schema: zdb.schema({
        id: zdb.id(),
        uuid_val: zdb.uuid(),
        nanoid_val: zdb.nanoid(16),
        price: zdb.decimal(10, 2),
        view_count: zdb.bigint(),
        metadata: zdb.json(),
        stage: zdb.enum(['draft', 'review', 'published']),
      }),
    });

    const builder = seeder.factory(TypeModel);
    const record = builder.make();

    expect(record.uuid_val).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(record.nanoid_val.length).toBe(16); // zdb.nanoid(16)
    expect(typeof record.price).toBe('number');
    expect(typeof record.view_count).toBe('number');
    expect(typeof record.metadata).toBe('object');
    expect(['draft', 'review', 'published']).toContain(record.stage);
  });

  it('supports factory states (object and function) and field overrides', () => {
    const ArticleModel = defineModel({
      name: 'Article',
      table: 'articles',
      schema: zdb.schema({
        id: zdb.id(),
        author_id: zdb.integer(),
        title: zdb.string(),
        slug: zdb.string(),
        content: zdb.string(),
        status: zdb.string(),
        price: zdb.float(),
      }),
    });

    seeder.defineFactory(ArticleModel, {
      defaults: { status: 'draft', price: 10 },
      states: {
        published: { status: 'published' },
        featured: (f) => ({ price: 99.99, title: `Featured: ${f.lorem.word()}` }),
      },
    });

    // Test default
    const draft = seeder.factory('Article').make();
    expect(draft.status).toBe('draft');
    expect(draft.price).toBe(10);

    // Test object state
    const pub = seeder.factory('Article').state('published').make();
    expect(pub.status).toBe('published');

    // Test function state + override
    const feat = seeder.factory('Article')
      .state('featured')
      .override({ price: 150 })
      .make();
    expect(feat.title).toContain('Featured:');
    expect(feat.price).toBe(150);
  });

  it('creates parent record and children within a transaction (createInTransaction)', async () => {
    const Author = defineModel({
      name: 'AuthorTrans',
      table: 'authors',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string(),
      }),
    });
    db.registerModel(Author);

    const builder = seeder.factory(Author);
    const created = await builder.createInTransaction(2);

    expect(Array.isArray(created)).toBe(true);
    expect(created.length).toBe(2);
    expect(created[0].id).toBeDefined();

    const inDb = await knex('authors').where('id', created[0].id).first();
    expect(inDb).toBeDefined();
    expect(inDb.name).toBe(created[0].name);
  });

  it('runs multiple seeders and truncates tables using seeder.run and seeder.truncate', async () => {
    const Author = defineModel({
      name: 'AuthorBatch',
      table: 'authors',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string(),
      }),
    });
    db.registerModel(Author);

    const results = await seeder.run([
      { model: 'AuthorBatch', count: 3, overrides: { name: 'Batch Author' } },
    ]);

    expect(results.AuthorBatch).toBeDefined();
    expect(results.AuthorBatch.length).toBe(3);
    expect(results.AuthorBatch[0].name).toBe('Batch Author');

    const countBefore = await knex('authors').count('* as cnt').first();
    expect(Number(countBefore.cnt)).toBeGreaterThanOrEqual(3);

    // Truncate
    await seeder.truncate(['AuthorBatch']);
    const countAfter = await knex('authors').count('* as cnt').first();
    expect(Number(countAfter.cnt)).toBe(0);
  });
});
