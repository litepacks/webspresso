'use strict';

const knex = require('knex');
const { createDatabase, zdb, defineModel, clearRegistry } = require('../../../core/orm');
const { ModelEvents, Hooks, HookCancellationError } = require('../../../core/orm/events');
const { runWithAmbientTransaction } = require('../../../core/orm/transaction');

describe('ORM Repository Edge Cases & Scenarios (core/orm/repository)', () => {
  let db;
  let rawKnex;
  let AuthorModel, ArticleModel, TagModel, NonSoftModel;

  beforeAll(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create schema
    await db.knex.schema.createTable('authors', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable();
      table.json('settings').nullable();
      table.timestamp('created_at').defaultTo(db.knex.fn.now());
      table.timestamp('updated_at').defaultTo(db.knex.fn.now());
      table.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('articles', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.integer('author_id').notNullable();
      table.timestamp('created_at').defaultTo(db.knex.fn.now());
      table.timestamp('updated_at').defaultTo(db.knex.fn.now());
      table.timestamp('deleted_at').nullable();
    });

    await db.knex.schema.createTable('non_soft_records', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });

    // Define Models
    AuthorModel = defineModel({
      name: 'Author',
      table: 'authors',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string(),
        settings: zdb.json({ nullable: true }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      relations: {
        articles: {
          type: 'hasMany',
          model: () => ArticleModel,
          foreignKey: 'author_id',
          cascade: true, // Cascades soft deletes and restores
        },
      },
      scopes: {
        softDelete: true,
        timestamps: true,
      },
    });

    ArticleModel = defineModel({
      name: 'Article',
      table: 'articles',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        author_id: zdb.foreignKey('authors'),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
        deleted_at: zdb.timestamp({ nullable: true }),
      }),
      scopes: {
        softDelete: true,
        timestamps: true,
      },
    });

    NonSoftModel = defineModel({
      name: 'NonSoftRecord',
      table: 'non_soft_records',
      schema: zdb.schema({
        id: zdb.id(),
        name: zdb.string(),
      }),
      scopes: {
        softDelete: false,
      },
    });

    db.registerModel(AuthorModel);
    db.registerModel(ArticleModel);
    db.registerModel(NonSoftModel);
  });

  afterAll(async () => {
    ModelEvents.removeAllListeners();
    await db.destroy();
  });

  beforeEach(async () => {
    ModelEvents.removeAllListeners();
    await db.knex('articles').del();
    await db.knex('authors').del();
    await db.knex('non_soft_records').del();
  });

  describe('Lifecycle Hook Cancellations', () => {
    it('throws HookCancellationError when beforeCreate cancels', async () => {
      const repo = db.getRepository('Author');
      ModelEvents.on(`Author.${Hooks.BEFORE_CREATE}`, (data, ctx) => {
        ctx.cancel('Registration is blocked');
      });

      await expect(
        repo.create({ name: 'Alice', email: 'alice@example.com' })
      ).rejects.toThrow(HookCancellationError);
    });

    it('throws HookCancellationError when beforeUpdate cancels', async () => {
      const repo = db.getRepository('Author');
      const author = await repo.create({ name: 'Bob', email: 'bob@example.com' });

      ModelEvents.on(`Author.${Hooks.BEFORE_UPDATE}`, (data, ctx) => {
        ctx.cancel('Updates not allowed');
      });

      await expect(
        repo.update(author.id, { name: 'Bobby' })
      ).rejects.toThrow(HookCancellationError);
    });

    it('throws HookCancellationError when beforeDelete cancels', async () => {
      const repo = db.getRepository('Author');
      const author = await repo.create({ name: 'Charlie', email: 'charlie@example.com' });

      ModelEvents.on(`Author.${Hooks.BEFORE_DELETE}`, (data, ctx) => {
        ctx.cancel('Cannot delete Charlie');
      });

      await expect(repo.delete(author.id)).rejects.toThrow(HookCancellationError);
    });

    it('throws HookCancellationError when beforeFind cancels', async () => {
      const repo = db.getRepository('Author');
      const author = await repo.create({ name: 'Dave', email: 'dave@example.com' });

      ModelEvents.on(`Author.${Hooks.BEFORE_FIND}`, (data, ctx) => {
        ctx.cancel('Find blocked');
      });

      await expect(repo.findById(author.id)).rejects.toThrow(HookCancellationError);
      await expect(repo.findOne({ email: 'dave@example.com' })).rejects.toThrow(HookCancellationError);
      await expect(repo.findAll()).rejects.toThrow(HookCancellationError);
    });

    it('throws HookCancellationError when beforeRestore cancels', async () => {
      const repo = db.getRepository('Author');
      const author = await repo.create({ name: 'Eve', email: 'eve@example.com' });
      await repo.delete(author.id);

      ModelEvents.on(`Author.${Hooks.BEFORE_RESTORE}`, (data, ctx) => {
        ctx.cancel('Restores blocked');
      });

      await expect(repo.restore(author.id)).rejects.toThrow(HookCancellationError);
    });
  });

  describe('Restore & Soft Delete Edge Cases', () => {
    it('throws when restore is called on a model without softDelete', async () => {
      const nonSoftRepo = db.getRepository('NonSoftRecord');
      const item = await nonSoftRepo.create({ name: 'Static' });

      await expect(nonSoftRepo.restore(item.id)).rejects.toThrow(/does not have soft delete enabled/i);
    });

    it('returns null when restoring non-existent or untrashed record', async () => {
      const repo = db.getRepository('Author');
      const notFound = await repo.restore(9999);
      expect(notFound).toBeNull();

      const activeAuthor = await repo.create({ name: 'Active', email: 'active@example.com' });
      const notTrashed = await repo.restore(activeAuthor.id);
      expect(notTrashed).toBeNull();
    });

    it('cascades soft delete and cascade restore to child relations', async () => {
      const authorRepo = db.getRepository('Author');
      const articleRepo = db.getRepository('Article');

      const author = await authorRepo.create({ name: 'Cascading Author', email: 'casc@example.com' });
      const article1 = await articleRepo.create({ title: 'Post 1', author_id: author.id });
      const article2 = await articleRepo.create({ title: 'Post 2', author_id: author.id });

      // Soft delete author
      const deleteResult = await authorRepo.delete(author.id);
      expect(deleteResult).toBe(true);

      // Child articles should also be soft deleted
      expect(await articleRepo.findById(article1.id)).toBeNull();
      expect(await articleRepo.findById(article2.id)).toBeNull();

      // Restore author
      const restored = await authorRepo.restore(author.id);
      expect(restored).not.toBeNull();
      expect(restored.id).toBe(author.id);

      // Child articles should also be restored
      const restoredArticle1 = await articleRepo.findById(article1.id);
      const restoredArticle2 = await articleRepo.findById(article2.id);
      expect(restoredArticle1).not.toBeNull();
      expect(restoredArticle2).not.toBeNull();
    });

    it('forceDelete bypasses soft delete and permanently deletes', async () => {
      const authorRepo = db.getRepository('Author');
      const author = await authorRepo.create({ name: 'Force Me', email: 'force@example.com' });

      const res = await authorRepo.forceDelete(author.id);
      expect(res).toBe(true);

      const raw = await db.knex('authors').where('id', author.id).first();
      expect(raw).toBeUndefined();

      // Force delete non-existent returns false
      const ghost = await authorRepo.forceDelete(9999);
      expect(ghost).toBe(false);
    });
  });

  describe('JSON Fields Serialization & Deserialization', () => {
    it('serializes JSON object on create and deserializes on find', async () => {
      const repo = db.getRepository('Author');
      const settingsObj = { theme: 'dark', notifications: { email: true, push: false } };

      const author = await repo.create({
        name: 'JSON User',
        email: 'json@example.com',
        settings: settingsObj,
      });

      expect(author.settings).toEqual(settingsObj);

      // Check raw database value is a string in SQLite
      const raw = await db.knex('authors').where('id', author.id).first();
      expect(typeof raw.settings).toBe('string');
      expect(JSON.parse(raw.settings)).toEqual(settingsObj);

      // Fetch via repository
      const fetched = await repo.findById(author.id);
      expect(fetched.settings).toEqual(settingsObj);

      // Update JSON field
      const updatedSettings = { theme: 'light', notifications: { email: false, push: true } };
      const updated = await repo.update(author.id, { settings: updatedSettings });
      expect(updated.settings).toEqual(updatedSettings);

      const refetched = await repo.findOne({ email: 'json@example.com' });
      expect(refetched.settings).toEqual(updatedSettings);
    });
  });

  describe('Ambient Transaction Propagation', () => {
    it('binds repository queries to ambient transaction context', async () => {
      const repo = db.getRepository('Author');

      await db.knex.transaction(async (trx) => {
        await runWithAmbientTransaction(trx, async () => {
          const author = await repo.create({ name: 'Trx User', email: 'trx@example.com' });
          expect(author.id).toBeDefined();

          // Visible within transaction
          const foundInside = await repo.findById(author.id);
          expect(foundInside).not.toBeNull();
        });
      });

      // Rolled back or committed
      const foundOutside = await repo.findOne({ email: 'trx@example.com' });
      expect(foundOutside).not.toBeNull();
    });
  });

  describe('Repository Query Helpers', () => {
    it('verifies count() and exists() with multiple conditions', async () => {
      const repo = db.getRepository('Author');
      await repo.create({ name: 'Count 1', email: 'c1@example.com' });
      await repo.create({ name: 'Count 2', email: 'c2@example.com' });

      expect(await repo.count()).toBe(2);
      expect(await repo.count({ name: 'Count 1' })).toBe(1);
      expect(await repo.count({ name: 'Ghost' })).toBe(0);

      expect(await repo.exists({ email: 'c1@example.com' })).toBe(true);
      expect(await repo.exists({ email: 'c3@example.com' })).toBe(false);
    });

    it('find() handles conditions, select, limit, and offset', async () => {
      const repo = db.getRepository('Author');
      await repo.create({ name: 'User A', email: 'a@example.com' });
      await repo.create({ name: 'User B', email: 'b@example.com' });
      await repo.create({ name: 'User C', email: 'c@example.com' });

      const all = await repo.find({});
      expect(all).toHaveLength(3);

      const paged = await repo.find({ name: 'User A' }, { limit: 1 });
      expect(paged).toHaveLength(1);

      const queryPaged = await repo.query().limit(2).offset(1).list();
      expect(queryPaged).toHaveLength(2);

      const selected = await repo.find({ name: 'User A' }, { select: ['id', 'email'] });
      expect(selected[0].email).toBe('a@example.com');
      expect(selected[0].name).toBeUndefined();
    });
  });
});
