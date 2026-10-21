import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import knex from 'knex';
import {
  defineModel,
  clearRegistry,
  zdb,
  createDatabase,
  defineFactory,
  diffSchema,
  makeMigrations,
} from '../../index.js';

describe('ORM Enhancements: Schema Diff (Django-inspired) & Model Factory (Adonis-inspired)', () => {
  describe('Django-inspired: Schema Diff & MakeMigrations', () => {
    let db;
    let rawKnex;
    let tempDir;

    beforeEach(() => {
      clearRegistry();
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-diff-test-'));
      rawKnex = knex({
        client: 'better-sqlite3',
        connection: {
          filename: ':memory:',
        },
        useNullAsDefault: true,
      });
    });

    afterEach(async () => {
      if (db) {
        await db.destroy().catch(() => {});
        db = null;
      }
      if (rawKnex) {
        await rawKnex.destroy().catch(() => {});
        rawKnex = null;
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      clearRegistry();
    });
    it('detects missing table and proposes create_table migration', async () => {
      const PostModel = defineModel({
        name: 'Post',
        table: 'posts',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string({ maxLength: 200 }),
          content: zdb.text(),
        }),
      });

      const diff = await diffSchema({
        knex: rawKnex,
        models: [PostModel],
      });

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].type).toBe('create_table');
      expect(diff.changes[0].table).toBe('posts');
      expect(diff.changes[0].content).toContain("knex.schema.createTable('posts'");
      expect(diff.changes[0].content).toContain("table.string('title', 200)");
    });

    it('detects newly added columns in existing table and produces alterTable migration', async () => {
      // 1. Initially create the table in DB with id and title
      await rawKnex.schema.createTable('users', (table) => {
        table.bigIncrements('id').primary();
        table.string('name', 255).notNullable();
      });

      // 2. Now define the updated model having 'bio' and 'role'
      const UserModel = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string({ maxLength: 255 }),
          bio: zdb.text({ nullable: true }),
          role: zdb.string({ maxLength: 50, default: 'member' }),
        }),
      });

      const diff = await diffSchema({
        knex: rawKnex,
        models: [UserModel],
      });

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      const change = diff.changes[0];
      expect(change.type).toBe('alter_table');
      expect(change.table).toBe('users');
      expect(change.addedColumns).toEqual(['bio', 'role']);
      expect(change.content).toContain("knex.schema.alterTable('users'");
      expect(change.content).toContain("table.text('bio').nullable();");
      expect(change.content).toContain("table.string('role', 50).notNullable().defaultTo('member');");
      expect(change.content).toContain("table.dropColumn('bio');");
      expect(change.content).toContain("table.dropColumn('role');");

      // Verify the generated migration actually runs cleanly on Knex
      const migrationModule = {};
      const runUp = new Function('exports', 'knex', `${change.content}; return exports.up(knex);`);
      await runUp(migrationModule, rawKnex);

      // Verify columns now exist in DB
      const colInfo = await rawKnex('users').columnInfo();
      expect(colInfo).toHaveProperty('bio');
      expect(colInfo).toHaveProperty('role');

      // Subsequent diff should report NO changes
      const subsequentDiff = await diffSchema({
        knex: rawKnex,
        models: [UserModel],
      });
      expect(subsequentDiff.hasChanges).toBe(false);
      expect(subsequentDiff.changes).toHaveLength(0);
    });

    it('makeMigrations writes migration files to directory or previews in dryRun', async () => {
      const TagModel = defineModel({
        name: 'Tag',
        table: 'tags',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string({ maxLength: 100 }),
        }),
      });

      // Dry run first
      const dryResult = await makeMigrations({
        knex: rawKnex,
        migrationDir: tempDir,
        dryRun: true,
      });

      expect(dryResult.hasChanges).toBe(true);
      expect(dryResult.created).toHaveLength(1);
      expect(fs.readdirSync(tempDir)).toHaveLength(0); // No files written

      // Real run
      const realResult = await makeMigrations({
        knex: rawKnex,
        migrationDir: tempDir,
        dryRun: false,
      });

      expect(realResult.hasChanges).toBe(true);
      expect(realResult.created).toHaveLength(1);
      const files = fs.readdirSync(tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('create_tags_table.js');
    });

    it('exposes diff and makeMigrations on migrationManager instance', async () => {
      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
        migrations: {
          directory: tempDir,
        },
      });

      defineModel({
        name: 'Article',
        table: 'articles',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string({ maxLength: 255 }),
        }),
      });

      const diff = await db.migrate.diff();
      expect(diff.hasChanges).toBe(true);
      expect(diff.changes[0].table).toBe('articles');

      const result = await db.migrate.makeMigrations();
      expect(result.hasChanges).toBe(true);
      expect(result.created).toHaveLength(1);
    });
  });

  describe('AdonisJS-inspired: Model Factory', () => {
    let UserModel;
    let db;

    beforeAll(async () => {
      clearRegistry();
      UserModel = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          name: zdb.string({ maxLength: 255 }),
          email: zdb.string({ maxLength: 255 }),
          role: zdb.string({ maxLength: 50, default: 'user' }),
          isActive: zdb.boolean({ default: true }),
        }),
      });

      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
        cache: false,
      });

      await db.knex.schema.createTable('users', (table) => {
        table.bigIncrements('id').primary();
        table.string('name', 255).notNullable();
        table.string('email', 255).notNullable();
        table.string('role', 50).defaultTo('user');
        table.boolean('isActive').defaultTo(true);
      });
    });

    beforeEach(async () => {
      if (db) {
        await db.knex('users').delete();
      }
    });

    afterAll(async () => {
      if (db) {
        await db.destroy().catch(() => {});
      }
      clearRegistry();
    });

    it('generates in-memory data objects with .make()', () => {
      const UserFactory = defineFactory('User', ({ faker, index }) => ({
        name: `Test User ${index}`,
        email: `test${index}@example.com`,
        role: 'user',
        isActive: true,
      }));

      // Single make
      const user = UserFactory.make();
      expect(user).toHaveProperty('name', 'Test User 0');
      expect(user).toHaveProperty('email', 'test0@example.com');
      expect(user.role).toBe('user');

      // Make with overrides
      const customUser = UserFactory.make({ name: 'Custom Name' });
      expect(customUser.name).toBe('Custom Name');

      // Multi-make
      const users = UserFactory.count(3).make();
      expect(users).toHaveLength(3);
      expect(users[0].name).toBe('Test User 0');
      expect(users[1].name).toBe('Test User 1');
      expect(users[2].name).toBe('Test User 2');
    });

    it('supports registered states with .state() and .apply()', () => {
      const UserFactory = defineFactory('User', ({ faker }) => ({
        name: 'Regular',
        email: 'regular@example.com',
        role: 'user',
        isActive: true,
      }))
        .state('admin', () => ({ role: 'admin' }))
        .state('suspended', () => ({ isActive: false }));

      const admin = UserFactory.apply('admin').make();
      expect(admin.role).toBe('admin');
      expect(admin.isActive).toBe(true);

      const suspendedAdmin = UserFactory.apply('admin', 'suspended').make();
      expect(suspendedAdmin.role).toBe('admin');
      expect(suspendedAdmin.isActive).toBe(false);
    });

    it('creates persistent database records with .create({ db })', async () => {
      const UserFactory = defineFactory('User', ({ index }) => ({
        name: `DB User ${index}`,
        email: `db_${index}@example.com`,
        role: 'member',
        isActive: true,
      })).state('vip', { role: 'vip' });

      // Create 1 record
      const createdUser = await UserFactory.create({ db });
      expect(createdUser).toHaveProperty('id');
      expect(createdUser.name).toBe('DB User 0');

      // Verify in DB via repository
      const repo = db.getRepository('User');
      const found = await repo.findById(createdUser.id);
      expect(found).not.toBeNull();
      expect(found.email).toBe('db_0@example.com');

      // Create multiple with state and merge
      const vips = await UserFactory.count(2)
        .apply('vip')
        .create({ db, merge: { isActive: false } });

      expect(vips).toHaveLength(2);
      expect(vips[0].role).toBe('vip');
      expect(vips[0].isActive).toBe(0); // sqlite stores boolean as 0/1
      expect(vips[1].role).toBe('vip');

      const all = await repo.find();
      expect(all.length).toBe(3);
    });

    it('throws helpful error when create() is called without db instance', async () => {
      const SimpleFactory = defineFactory('User', () => ({ name: 'Test' }));
      await expect(SimpleFactory.create()).rejects.toThrow(
        'Factory.create() requires a database instance'
      );
    });
  });
});
