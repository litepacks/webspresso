/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, clearRegistry } from '../../../index.js';
import { createContentService } from '../../../core/content/index.js';
import { createContentTypeModel } from '../../../plugins/content/models/content-type.js';
import { createContentEntryModel } from '../../../plugins/content/models/content-entry.js';

async function createContentTables(knex) {
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

describe('content service', () => {
  let db;
  let service;

  beforeEach(async () => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    db.registerModel(createContentTypeModel());
    db.registerModel(createContentEntryModel());
    await createContentTables(db.knex);
    service = createContentService(db);
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  it('creates types and entries', async () => {
    await service.createType({
      slug: 'hero',
      name: 'Hero',
      schema: {
        fields: [{ name: 'headline', type: 'text', required: true }],
      },
    });

    await service.createEntry('hero', {
      slug: 'home',
      title: 'Homepage Hero',
      data: { headline: 'Welcome' },
    });

    const entry = await service.getEntry('hero', 'home');
    expect(entry).not.toBeNull();
    expect(entry.data.headline).toBe('Welcome');
    expect(entry.meta.typeSlug).toBe('hero');
  });

  it('hides draft entries from public getEntry', async () => {
    await service.createType({
      slug: 'banner',
      name: 'Banner',
      schema: { fields: [{ name: 'text', type: 'text' }] },
    });

    await service.createEntry('banner', {
      slug: 'promo',
      status: 'draft',
      data: { text: 'secret' },
    });

    const pub = await service.getEntry('banner', 'promo');
    expect(pub).toBeNull();

    const admin = await service.getEntry('banner', 'promo', { includeDraft: true });
    expect(admin).not.toBeNull();
  });

  it('updates entry revision on save', async () => {
    await service.createType({
      slug: 'cta',
      name: 'CTA',
      schema: { fields: [{ name: 'label', type: 'text' }] },
    });

    const created = await service.createEntry('cta', {
      slug: 'main',
      data: { label: 'Go' },
    });

    const updated = await service.updateEntry(created.id, {
      data: { label: 'Start' },
    });

    expect(updated.revision).toBe(2);
    expect(updated.data.label).toBe('Start');
  });

  it('rejects duplicate type slug', async () => {
    await service.createType({
      slug: 'hero',
      name: 'Hero',
      schema: { fields: [{ name: 't', type: 'text' }] },
    });
    await expect(
      service.createType({
        slug: 'hero',
        name: 'Hero 2',
        schema: { fields: [{ name: 't', type: 'text' }] },
      })
    ).rejects.toThrow(/already exists/);
  });

  it('invalidates cache after mutation', async () => {
    await service.createType({
      slug: 'cache-test',
      name: 'Cache',
      schema: { fields: [{ name: 'v', type: 'text' }] },
    });
    await service.createEntry('cache-test', {
      slug: 'one',
      data: { v: 'first' },
    });

    const first = await service.getEntry('cache-test', 'one');
    expect(first.data.v).toBe('first');

    const entry = await service.getEntry('cache-test', 'one', { includeDraft: true });
    await service.updateEntry(entry.meta.id, { data: { v: 'second' } });

    const second = await service.getEntry('cache-test', 'one');
    expect(second.data.v).toBe('second');
  });

  it('caches repeated reads in memory', async () => {
    await service.createType({
      slug: 'memo',
      name: 'Memo',
      schema: { fields: [{ name: 't', type: 'text' }] },
    });
    const created = await service.createEntry('memo', {
      slug: 'a',
      data: { t: 'cached' },
    });

    const typeA = await service.getTypeBySlug('memo');
    const typeB = await service.getTypeBySlug('memo');
    expect(typeA).toBe(typeB);

    const entryA = await service.getEntry('memo', 'a');
    const entryB = await service.getEntry('memo', 'a');
    expect(entryA).toBe(entryB);

    const byIdA = await service.getEntryById(created.id);
    const byIdB = await service.getEntryById(created.id);
    expect(byIdA).toBe(byIdB);

    const listA = await service.listEntries('memo');
    const listB = await service.listEntries('memo');
    expect(listA).toBe(listB);
  });

  it('keeps published and draft getEntry cache keys separate', async () => {
    await service.createType({
      slug: 'drafty',
      name: 'Drafty',
      schema: { fields: [{ name: 't', type: 'text' }] },
    });
    await service.createEntry('drafty', {
      slug: 'x',
      status: 'draft',
      data: { t: 'hidden' },
    });

    const pub = await service.getEntry('drafty', 'x');
    const draft = await service.getEntry('drafty', 'x', { includeDraft: true });
    expect(pub).toBeNull();
    expect(draft).not.toBeNull();
    expect(draft.data.t).toBe('hidden');
  });

  it('lists entries filtered by status', async () => {
    await service.createType({
      slug: 'list',
      name: 'List',
      schema: { fields: [{ name: 't', type: 'text' }] },
    });
    await service.createEntry('list', { slug: 'pub', data: { t: 'a' } });
    await service.createEntry('list', { slug: 'draft', status: 'draft', data: { t: 'b' } });

    const published = await service.listEntries('list', { status: 'published' });
    expect(published).toHaveLength(1);
    expect(published[0].slug).toBe('pub');
  });
});
