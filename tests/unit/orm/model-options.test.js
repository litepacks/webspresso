'use strict';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../../core/orm');

describe('ORM Model Options & Automatic Timestamps / SoftDelete', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  it('supports plain object schema in defineModel', () => {
    const model = defineModel({
      name: 'PlainNote',
      table: 'plain_notes',
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
      },
    });

    expect(model.columns.has('id')).toBe(true);
    expect(model.columns.has('title')).toBe(true);
    expect(typeof model.schema.parse).toBe('function');
    const parsed = model.schema.parse({ id: 1, title: 'Hello' });
    expect(parsed.title).toBe('Hello');
  });

  it('auto-injects createdAt, updatedAt, and deletedAt with top-level flags', () => {
    const model = defineModel({
      name: 'FlagNote',
      table: 'flag_notes',
      timestamps: true,
      softDelete: true,
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
      },
    });

    expect(model.scopes.timestamps).toBe(true);
    expect(model.scopes.softDelete).toBe(true);
    expect(model.options.timestamps).toBe(true);
    expect(model.options.softDelete).toBe(true);

    expect(model.columns.has('createdAt')).toBe(true);
    expect(model.columns.has('updatedAt')).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);

    // Schema should validate without requiring timestamps in input
    const parsed = model.schema.parse({ id: 1, title: 'Clean Schema' });
    expect(parsed.title).toBe('Clean Schema');
    expect(parsed.createdAt).toBeUndefined();
    expect(parsed.deletedAt).toBeUndefined();
  });

  it('supports options: { timestamps: true, softDelete: true } block', () => {
    const model = defineModel({
      name: 'NestedOptionsNote',
      table: 'nested_options_notes',
      options: {
        timestamps: true,
        softDelete: true,
      },
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
      },
    });

    expect(model.scopes.timestamps).toBe(true);
    expect(model.scopes.softDelete).toBe(true);
    expect(model.columns.has('createdAt')).toBe(true);
    expect(model.columns.has('updatedAt')).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);
  });

  it('supports softDeletes alias for softDelete', () => {
    const model = defineModel({
      name: 'AliasNote',
      table: 'alias_notes',
      softDeletes: true,
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
      },
    });

    expect(model.scopes.softDelete).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);
  });

  it('supports snake_case and custom column names in options', () => {
    const model = defineModel({
      name: 'SnakeNote',
      table: 'snake_notes',
      timestamps: { snakeCase: true },
      softDelete: { deletedAt: 'archived_at' },
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
      },
    });

    expect(model.columns.has('created_at')).toBe(true);
    expect(model.columns.has('updated_at')).toBe(true);
    expect(model.columns.has('archived_at')).toBe(true);
    expect(model.columns.has('createdAt')).toBe(false);
    expect(model.columns.has('deletedAt')).toBe(false);
  });

  it('does not duplicate fields if already explicitly defined in schema', () => {
    const model = defineModel({
      name: 'ExplicitNote',
      table: 'explicit_notes',
      timestamps: true,
      softDelete: true,
      schema: {
        id: zdb.id(),
        title: zdb.string(100),
        createdAt: zdb.datetime(), // explicitly defined
      },
    });

    const cols = Array.from(model.columns.keys());
    const createdAtCount = cols.filter(c => c === 'createdAt').length;
    expect(createdAtCount).toBe(1);
    expect(model.columns.has('updatedAt')).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);
  });

  it('supports zdb.timestamps() and zdb.softDeletes() spread helpers', () => {
    const model = defineModel({
      name: 'SpreadNote',
      table: 'spread_notes',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(100),
        ...zdb.timestamps(),
        ...zdb.softDeletes(),
      }),
    });

    expect(model.columns.has('createdAt')).toBe(true);
    expect(model.columns.has('updatedAt')).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);

    // snake_case spread
    const snakeModel = defineModel({
      name: 'SnakeSpreadNote',
      table: 'snake_spread_notes',
      schema: zdb.schema({
        id: zdb.id(),
        ...zdb.timestamps({ snakeCase: true }),
        ...zdb.softDeletes({ snakeCase: true }),
      }),
    });

    expect(snakeModel.columns.has('created_at')).toBe(true);
    expect(snakeModel.columns.has('updated_at')).toBe(true);
    expect(snakeModel.columns.has('deleted_at')).toBe(true);
  });

  it('supports zdb.timestamps().createdAt and zdb.softDelete() individual helpers', () => {
    const ts = zdb.timestamps();
    expect(ts.createdAt).toBeDefined();
    expect(ts.updatedAt).toBeDefined();

    const sd = zdb.softDelete();
    expect(sd).toBeDefined();

    const model = defineModel({
      name: 'IndividualNote',
      table: 'individual_notes',
      schema: {
        id: zdb.id(),
        createdAt: zdb.timestamps().createdAt,
        updatedAt: zdb.timestamps().updatedAt,
        deletedAt: zdb.softDelete().optional(),
      },
    });

    expect(model.columns.has('createdAt')).toBe(true);
    expect(model.columns.has('updatedAt')).toBe(true);
    expect(model.columns.has('deletedAt')).toBe(true);
  });

  it('performs repository CRUD, soft delete, and restore with automatically injected timestamps and softDelete', async () => {
    const db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    defineModel({
      name: 'TaskItem',
      table: 'task_items',
      timestamps: true,
      softDelete: true,
      schema: {
        id: zdb.id(),
        title: zdb.string(200),
        done: zdb.boolean({ default: false }),
      },
    });

    await db.knex.schema.createTable('task_items', (table) => {
      table.increments('id').primary();
      table.string('title', 200).notNullable();
      table.boolean('done').defaultTo(false);
      table.timestamp('createdAt').defaultTo(db.knex.fn.now());
      table.timestamp('updatedAt').defaultTo(db.knex.fn.now());
      table.timestamp('deletedAt').nullable();
    });

    const repo = db.getRepository('TaskItem');

    // 1. Create
    const task = await repo.create({ title: 'Buy Groceries' });
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Buy Groceries');
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();
    expect(task.deletedAt).toBeNull();

    // 2. Update
    const updated = await repo.update(task.id, { title: 'Buy Organic Groceries', done: true });
    expect(updated.title).toBe('Buy Organic Groceries');
    expect(Boolean(updated.done)).toBe(true);
    expect(updated.updatedAt).toBeDefined();

    // 3. Find
    const found = await repo.findById(task.id);
    expect(found).not.toBeNull();
    expect(found.title).toBe('Buy Organic Groceries');

    // 4. Soft Delete
    const deleted = await repo.delete(task.id);
    expect(deleted).toBe(true);

    // Active query should not find deleted record
    const afterDelete = await repo.findById(task.id);
    expect(afterDelete).toBeNull();

    // onlyTrashed query should find it
    const trashed = await repo.query().onlyTrashed().first();
    expect(trashed).not.toBeNull();
    expect(trashed.id).toBe(task.id);
    expect(trashed.deletedAt).not.toBeNull();

    // 5. Restore
    const restored = await repo.restore(task.id);
    expect(restored).not.toBeNull();
    expect(restored.deletedAt).toBeNull();

    // Active query should now find it again
    const activeAgain = await repo.findById(task.id);
    expect(activeAgain).not.toBeNull();
    expect(activeAgain.id).toBe(task.id);

    await db.destroy();
  });
});
