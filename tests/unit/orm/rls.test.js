'use strict';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const knexLib = require('knex');
const { z } = require('zod');
const { defineModel, clearRegistry } = require('../../../core/orm/model');
const { createRepository } = require('../../../core/orm/repository');
const { createDatabase } = require('../../../core/orm/index');
const { rlsPlugin, createRlsMiddleware } = require('../../../plugins/rls/index');
const { ForbiddenError, UnauthorizedError } = require('../../../core/errors');

describe('Dynamic Model Row-Level Security (RLS)', () => {
  let knex;
  let db;

  beforeEach(async () => {
    clearRegistry();
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // Create tables
    await knex.schema.createTable('notes', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.string('title').notNullable();
      t.text('content');
      t.string('status').defaultTo('draft');
      t.boolean('is_public').defaultTo(false);
      t.timestamps(true, true);
    });

    await knex.schema.createTable('tenant_docs', (t) => {
      t.increments('id').primary();
      t.string('tenant_id').notNullable();
      t.string('title').notNullable();
      t.timestamps(true, true);
    });

    await knex.schema.createTable('articles', (t) => {
      t.increments('id').primary();
      t.integer('author_id').notNullable();
      t.string('title').notNullable();
      t.boolean('is_published').defaultTo(false);
      t.string('state').defaultTo('draft');
    });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // Replace internal knex with initialized table knex
    db.knex = knex;
  });

  afterEach(async () => {
    clearRegistry();
    if (knex) {
      await knex.destroy();
    }
  });

  describe('Shorthand userColumn Scoping', () => {
    let NoteModel;
    let NoteRepo;

    beforeEach(async () => {
      NoteModel = defineModel({
        name: 'Note',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
          content: z.string().optional(),
          status: z.string().optional(),
          is_public: z.boolean().optional(),
          created_at: z.any().optional(),
          updated_at: z.any().optional(),
        }),
        rls: {
          userColumn: 'user_id',
        },
      });

      NoteRepo = createRepository(NoteModel, knex);

      // Seed records directly into DB
      await knex('notes').insert([
        { id: 1, user_id: 100, title: 'User 100 Note 1', content: 'Secret 1' },
        { id: 2, user_id: 100, title: 'User 100 Note 2', content: 'Secret 2' },
        { id: 3, user_id: 200, title: 'User 200 Note 1', content: 'Secret 3' },
      ]);
    });

    it('filters findAll and find for specific user', async () => {
      const user100Repo = NoteRepo.forUser({ id: 100 });
      const user200Repo = NoteRepo.forUser({ id: 200 });

      const notes100 = await user100Repo.findAll();
      expect(notes100).toHaveLength(2);
      expect(notes100.map((n) => n.id)).toEqual([1, 2]);

      const notes200 = await user200Repo.findAll();
      expect(notes200).toHaveLength(1);
      expect(notes200[0].id).toBe(3);
    });

    it('filters findById to only allow owner', async () => {
      const user100Repo = NoteRepo.forUser({ id: 100 });

      const ownNote = await user100Repo.findById(1);
      expect(ownNote).not.toBeNull();
      expect(ownNote.id).toBe(1);

      const otherNote = await user100Repo.findById(3);
      expect(otherNote).toBeNull();
    });

    it('filters findOne to only match owner records', async () => {
      const user100Repo = NoteRepo.forUser({ id: 100 });

      const note = await user100Repo.findOne({ id: 3 });
      expect(note).toBeNull();

      const own = await user100Repo.findOne({ id: 2 });
      expect(own).not.toBeNull();
      expect(own.id).toBe(2);
    });

    it('returns empty set and count 0 for unauthenticated guest', async () => {
      const guestRepo = NoteRepo.forUser(null);
      const all = await guestRepo.findAll();
      expect(all).toHaveLength(0);

      const count = await guestRepo.count();
      expect(count).toBe(0);

      const exists = await guestRepo.exists({ id: 1 });
      expect(exists).toBe(false);
    });

    it('allows withoutRls() to see all records across users', async () => {
      const adminRepo = NoteRepo.withoutRls();
      const all = await adminRepo.findAll();
      expect(all).toHaveLength(3);
      expect(await adminRepo.count()).toBe(3);
    });

    it('supports QueryBuilder chaining with forUser and withoutRls', async () => {
      const qb100 = NoteRepo.query().forUser({ id: 100 });
      const list = await qb100.where('title', 'like', '%Note 1%').list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(1);

      const count = await NoteRepo.query().forUser({ id: 100 }).count();
      expect(count).toBe(2);

      const paginated = await NoteRepo.query().forUser({ id: 100 }).paginate(1, 10);
      expect(paginated.total).toBe(2);
      expect(paginated.data).toHaveLength(2);

      const unconstrained = await NoteRepo.query().withoutRls().count();
      expect(unconstrained).toBe(3);
    });

    it('supports userId and _id and sub user property resolution', async () => {
      expect((await NoteRepo.forUser({ userId: 100 }).findAll())).toHaveLength(2);
      expect((await NoteRepo.forUser({ _id: 200 }).findAll())).toHaveLength(1);
      expect((await NoteRepo.forUser({ sub: 100 }).findAll())).toHaveLength(2);
    });
  });

  describe('Mutations with userColumn RLS', () => {
    let NoteModel;
    let NoteRepo;

    beforeEach(async () => {
      NoteModel = defineModel({
        name: 'Note',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
          content: z.string().optional(),
          status: z.string().optional(),
          is_public: z.boolean().optional(),
          created_at: z.any().optional(),
          updated_at: z.any().optional(),
        }),
        rls: {
          userColumn: 'user_id',
        },
      });

      NoteRepo = createRepository(NoteModel, knex);
    });

    it('auto-populates user_id on create when missing', async () => {
      const userRepo = NoteRepo.forUser({ id: 42 });
      const note = await userRepo.create({ title: 'Auto User Note' });

      expect(note.user_id).toBe(42);
      expect(note.title).toBe('Auto User Note');

      const raw = await knex('notes').where('id', note.id).first();
      expect(raw.user_id).toBe(42);
    });

    it('allows create when explicit user_id matches authenticated user', async () => {
      const userRepo = NoteRepo.forUser({ id: 42 });
      const note = await userRepo.create({ user_id: 42, title: 'Matching User Note' });

      expect(note.user_id).toBe(42);
    });

    it('throws ForbiddenError when user tries to create on behalf of another user', async () => {
      const userRepo = NoteRepo.forUser({ id: 42 });

      await expect(
        userRepo.create({ user_id: 999, title: 'Impersonated Note' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws UnauthorizedError when guest tries to create user-scoped record', async () => {
      const guestRepo = NoteRepo.forUser(null);

      await expect(
        guestRepo.create({ title: 'Guest Note' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('auto-populates and validates user_id in createBatch', async () => {
      const userRepo = NoteRepo.forUser({ id: 55 });
      const created = await userRepo.createBatch([
        { title: 'Batch 1' },
        { title: 'Batch 2' },
      ]);

      expect(created).toHaveLength(2);
      expect(created[0].user_id).toBe(55);
      expect(created[1].user_id).toBe(55);

      await expect(
        userRepo.createBatch([
          { title: 'Valid', user_id: 55 },
          { title: 'Invalid', user_id: 88 },
        ])
      ).rejects.toThrow(ForbiddenError);
    });

    it('auto-populates user_id in upsert', async () => {
      const userRepo = NoteRepo.forUser({ id: 77 });
      const result = await userRepo.upsert({ id: 99, title: 'Upserted Note' });

      expect(result.user_id).toBe(77);
      expect(result.title).toBe('Upserted Note');
    });

    it('only allows user to update their own record', async () => {
      await knex('notes').insert([
        { id: 10, user_id: 100, title: 'Original 100' },
        { id: 20, user_id: 200, title: 'Original 200' },
      ]);

      const user100Repo = NoteRepo.forUser({ id: 100 });

      // Updating own record
      const updated = await user100Repo.update(10, { title: 'Updated 100' });
      expect(updated).not.toBeNull();
      expect(updated.title).toBe('Updated 100');

      // Attempting to update another user's record returns null (0 rows affected)
      const failed = await user100Repo.update(20, { title: 'Hacked 200' });
      expect(failed).toBeNull();

      const record20 = await knex('notes').where('id', 20).first();
      expect(record20.title).toBe('Original 200');
    });

    it('throws ForbiddenError if user attempts to reassign user_id on update', async () => {
      await knex('notes').insert({ id: 15, user_id: 100, title: 'Note 15' });
      const user100Repo = NoteRepo.forUser({ id: 100 });

      await expect(
        user100Repo.update(15, { user_id: 200, title: 'Transferred' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('restricts updateWhere to current user records', async () => {
      await knex('notes').insert([
        { id: 31, user_id: 100, status: 'draft', title: 'Note 31' },
        { id: 32, user_id: 100, status: 'draft', title: 'Note 32' },
        { id: 33, user_id: 200, status: 'draft', title: 'Note 33' },
      ]);

      const user100Repo = NoteRepo.forUser({ id: 100 });
      const count = await user100Repo.updateWhere({ status: 'draft' }, { status: 'archived' });

      expect(count).toBe(2);

      const record33 = await knex('notes').where('id', 33).first();
      expect(record33.status).toBe('draft'); // Unchanged
    });

    it('only allows user to delete their own record', async () => {
      await knex('notes').insert([
        { id: 41, user_id: 100, title: 'Delete Me 100' },
        { id: 42, user_id: 200, title: 'Delete Me 200' },
      ]);

      const user100Repo = NoteRepo.forUser({ id: 100 });

      // Deleting own record
      const deletedOwn = await user100Repo.delete(41);
      expect(deletedOwn).toBe(true);
      expect(await knex('notes').where('id', 41).first()).toBeUndefined();

      // Deleting another user's record fails
      const deletedOther = await user100Repo.delete(42);
      expect(deletedOther).toBe(false);
      expect(await knex('notes').where('id', 42).first()).toBeDefined();
    });

    it('respects RLS delete policy on QueryBuilder.delete()', async () => {
      await knex('notes').insert([
        { id: 51, user_id: 100, status: 'trash', title: 'Trash 1' },
        { id: 52, user_id: 200, status: 'trash', title: 'Trash 2' },
      ]);

      const deletedCount = await NoteRepo.query()
        .forUser({ id: 100 })
        .where('status', 'trash')
        .delete();

      expect(deletedCount).toBe(1);
      expect(await knex('notes').where('id', 51).first()).toBeUndefined();
      expect(await knex('notes').where('id', 52).first()).toBeDefined();
    });
  });

  describe('Role Bypass and Custom Bypass', () => {
    it('bypasses RLS automatically for admin and superadmin roles by default', async () => {
      const Model = defineModel({
        name: 'AdminTest',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 10, title: 'A' },
        { id: 2, user_id: 20, title: 'B' },
      ]);

      const repo = createRepository(Model, knex);

      const adminRepo = repo.forUser({ id: 999, role: 'admin' });
      expect((await adminRepo.findAll())).toHaveLength(2);

      const superadminRepo = repo.forUser({ id: 999, role: 'superadmin' });
      expect((await superadminRepo.findAll())).toHaveLength(2);

      const flagAdminRepo = repo.forUser({ id: 999, isAdmin: true });
      expect((await flagAdminRepo.findAll())).toHaveLength(2);

      // Admin can create on behalf of other users
      const created = await adminRepo.create({ user_id: 20, title: 'Admin created for user 20' });
      expect(created.user_id).toBe(20);
    });

    it('supports custom bypassRoles array and function', async () => {
      const Model = defineModel({
        name: 'CustomBypass',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
          bypassRoles: ['auditor', 'compliance'],
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 10, title: 'A' },
        { id: 2, user_id: 20, title: 'B' },
      ]);

      const repo = createRepository(Model, knex);

      const auditorRepo = repo.forUser({ id: 1, role: 'auditor' });
      expect((await auditorRepo.findAll())).toHaveLength(2);

      const memberRepo = repo.forUser({ id: 10, role: 'member' });
      expect((await memberRepo.findAll())).toHaveLength(1);
    });

    it('enforces RLS even for admins when bypassRoles is set to false', async () => {
      const StrictModel = defineModel({
        name: 'StrictNote',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
          bypassRoles: false,
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 10, title: 'A' },
        { id: 2, user_id: 20, title: 'B' },
      ]);

      const repo = createRepository(StrictModel, knex);
      const adminRepo = repo.forUser({ id: 10, role: 'admin' });

      // Even though user is admin, bypassRoles is false, so user is scoped to user_id = 10
      const notes = await adminRepo.findAll();
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(1);
    });

    it('supports custom bypass predicate function', async () => {
      const BypassModel = defineModel({
        name: 'BypassPredicate',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
          bypass: (user, action) => user?.canBypass === true || action === 'read',
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 10, title: 'A' },
        { id: 2, user_id: 20, title: 'B' },
      ]);

      const repo = createRepository(BypassModel, knex);
      const userRepo = repo.forUser({ id: 10 });

      // Can read all because action === 'read' bypasses
      expect((await userRepo.findAll())).toHaveLength(2);

      // But update cannot bypass unless canBypass is true
      const updated = await userRepo.update(2, { title: 'Cannot update other' });
      expect(updated).toBeNull();
    });
  });

  describe('Multi-Tenant Scoping (tenantColumn)', () => {
    let DocModel;
    let DocRepo;

    beforeEach(async () => {
      DocModel = defineModel({
        name: 'TenantDoc',
        table: 'tenant_docs',
        schema: z.object({
          id: z.number().int().optional(),
          tenant_id: z.string().min(1).optional(),
          title: z.string().min(1),
        }),
        rls: {
          tenantColumn: 'tenant_id',
        },
      });

      DocRepo = createRepository(DocModel, knex);

      await knex('tenant_docs').insert([
        { id: 1, tenant_id: 'org_acme', title: 'Acme Doc 1' },
        { id: 2, tenant_id: 'org_acme', title: 'Acme Doc 2' },
        { id: 3, tenant_id: 'org_beta', title: 'Beta Doc 1' },
      ]);
    });

    it('scopes reads to user tenant_id', async () => {
      const acmeRepo = DocRepo.forUser({ id: 1, tenant_id: 'org_acme' });
      const docs = await acmeRepo.findAll();
      expect(docs).toHaveLength(2);
      expect(docs.map((d) => d.id)).toEqual([1, 2]);

      const betaRepo = DocRepo.forUser({ id: 2, tenant_id: 'org_beta' });
      const betaDocs = await betaRepo.findAll();
      expect(betaDocs).toHaveLength(1);
      expect(betaDocs[0].id).toBe(3);
    });

    it('auto-populates tenant_id on create', async () => {
      const acmeRepo = DocRepo.forUser({ id: 1, tenant_id: 'org_acme' });
      const created = await acmeRepo.create({ title: 'New Acme Doc' });

      expect(created.tenant_id).toBe('org_acme');
      expect(created.title).toBe('New Acme Doc');
    });

    it('rejects creating records for a different tenant', async () => {
      const acmeRepo = DocRepo.forUser({ id: 1, tenant_id: 'org_acme' });

      await expect(
        acmeRepo.create({ tenant_id: 'org_beta', title: 'Sneaky Doc' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects reassigning tenant on update', async () => {
      const acmeRepo = DocRepo.forUser({ id: 1, tenant_id: 'org_acme' });

      await expect(
        acmeRepo.update(1, { tenant_id: 'org_beta' })
      ).rejects.toThrow(ForbiddenError);
    });

    it('works with repo.forTenant()', async () => {
      const scopedRepo = DocRepo.forTenant('org_beta');
      const docs = await scopedRepo.findAll();
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe(3);
    });
  });

  describe('Custom Granular Action Rules', () => {
    let ArticleModel;
    let ArticleRepo;

    beforeEach(async () => {
      ArticleModel = defineModel({
        name: 'Article',
        table: 'articles',
        schema: z.object({
          id: z.number().int().optional(),
          author_id: z.number().int().optional(),
          title: z.string().min(1),
          is_published: z.boolean().optional(),
          state: z.string().optional(),
        }),
        rls: {
          userColumn: 'author_id',
          // Custom read: Anyone can read published articles, but authors can also read their own drafts
          read: (user, qb) => {
            if (!user) {
              return { is_published: 1 };
            }
            return (q) => {
              q.where('author_id', user.id).orWhere('is_published', 1);
            };
          },
          // Custom update: Can only update if state is draft
          update: (user, qb) => {
            if (!user) return false;
            return (q) => {
              q.where('author_id', user.id).where('state', 'draft');
            };
          },
          // Custom delete: Completely disabled via boolean
          delete: false,
          // Custom create hook: enriches data with default state
          create: (user, data) => {
            if (!user) return false;
            return { state: 'draft' };
          },
        },
      });

      ArticleRepo = createRepository(ArticleModel, knex);

      await knex('articles').insert([
        { id: 1, author_id: 10, title: 'Author 10 Published', is_published: 1, state: 'published' },
        { id: 2, author_id: 10, title: 'Author 10 Draft', is_published: 0, state: 'draft' },
        { id: 3, author_id: 20, title: 'Author 20 Draft', is_published: 0, state: 'draft' },
        { id: 4, author_id: 20, title: 'Author 20 Published', is_published: 1, state: 'published' },
      ]);
    });

    it('allows guest to read all published articles but no drafts', async () => {
      const guestRepo = ArticleRepo.forUser(null);
      const articles = await guestRepo.findAll();

      expect(articles).toHaveLength(2);
      expect(articles.every((a) => a.is_published)).toBe(true);
    });

    it('allows logged in author to read their own drafts plus any published articles', async () => {
      const author10Repo = ArticleRepo.forUser({ id: 10 });
      const articles = await author10Repo.findAll();

      // Should see id 1 (own published), id 2 (own draft), id 4 (other published). Not id 3 (other draft)
      expect(articles).toHaveLength(3);
      expect(articles.map((a) => a.id).sort()).toEqual([1, 2, 4]);
    });

    it('enforces custom update rule (draft only)', async () => {
      const author10Repo = ArticleRepo.forUser({ id: 10 });

      // Updating draft article 2 succeeds
      const updated = await author10Repo.update(2, { title: 'Draft Revised' });
      expect(updated).not.toBeNull();
      expect(updated.title).toBe('Draft Revised');

      // Updating published article 1 fails because state != 'draft'
      const failed = await author10Repo.update(1, { title: 'Cannot edit published' });
      expect(failed).toBeNull();
    });

    it('blocks delete when rule is false', async () => {
      const author10Repo = ArticleRepo.forUser({ id: 10 });
      const deleted = await author10Repo.delete(2);
      expect(deleted).toBe(false);

      // Still in DB
      expect(await knex('articles').where('id', 2).first()).toBeDefined();
    });

    it('enforces custom create hook enrichment and validation', async () => {
      const author10Repo = ArticleRepo.forUser({ id: 10 });
      const created = await author10Repo.create({ title: 'New Article' });

      expect(created.author_id).toBe(10);
      expect(created.state).toBe('draft');

      const guestRepo = ArticleRepo.forUser(null);
      await expect(guestRepo.create({ title: 'Guest Article' })).rejects.toThrow();
    });
  });

  describe('Database Scoped Accessors', () => {
    let NoteModel;

    beforeEach(async () => {
      NoteModel = defineModel({
        name: 'DbNote',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 100, title: 'N1' },
        { id: 2, user_id: 200, title: 'N2' },
      ]);
    });

    it('provides db.forUser() scoped repository and query access', async () => {
      const user100Db = db.forUser({ id: 100 });
      const repo = user100Db.getRepository('DbNote');
      const notes = await repo.findAll();

      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(1);

      const qbNotes = await user100Db.query('DbNote').list();
      expect(qbNotes).toHaveLength(1);
      expect(qbNotes[0].id).toBe(1);
    });

    it('provides db.withoutRls() access', async () => {
      const unconstrainedDb = db.withoutRls();
      const notes = await unconstrainedDb.getRepository('DbNote').findAll();
      expect(notes).toHaveLength(2);
    });

    it('supports trx.forUser() inside transactions', async () => {
      await db.transaction(async (trx) => {
        const repo = trx.forUser({ id: 100 }).getRepository('DbNote');
        const notes = await repo.findAll();
        expect(notes).toHaveLength(1);
      });
    });
  });

  describe('Express Middleware & Plugin (createRlsMiddleware, rlsPlugin)', () => {
    let NoteModel;

    beforeEach(async () => {
      NoteModel = defineModel({
        name: 'MwNote',
        table: 'notes',
        schema: z.object({
          id: z.number().int().optional(),
          user_id: z.number().int().optional(),
          title: z.string().min(1),
        }),
        rls: {
          userColumn: 'user_id',
        },
      });

      await knex('notes').insert([
        { id: 1, user_id: 100, title: 'N1' },
        { id: 2, user_id: 200, title: 'N2' },
      ]);
    });

    it('automatically wraps req.db.getRepository with req.user', async () => {
      const mw = createRlsMiddleware();

      const req = {
        user: { id: 100, role: 'member' },
        db,
      };
      const res = {};
      let nextCalled = false;

      mw(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);

      // In route handler:
      const notes = await req.db.getRepository('MwNote').findAll();
      expect(notes).toHaveLength(1);
      expect(notes[0].user_id).toBe(100);

      // Explicit bypass from repo
      const all = await req.db.getRepository('MwNote').withoutRls().findAll();
      expect(all).toHaveLength(2);
    });

    it('automatically bypasses when req.user is admin', async () => {
      const mw = createRlsMiddleware();

      const req = {
        user: { id: 999, role: 'admin' },
        db,
      };

      mw(req, {}, () => {});

      const notes = await req.db.getRepository('MwNote').findAll();
      expect(notes).toHaveLength(2);
    });

    it('rlsPlugin exposes valid plugin structure and registers named middleware', () => {
      const plugin = rlsPlugin({ bypassRoles: ['superadmin'] });

      expect(plugin.name).toBe('rls');
      expect(plugin.version).toBe('1.0.0');

      const ctx = {
        middlewares: {},
        app: {
          use: () => {},
        },
      };

      plugin.register(ctx);
      expect(typeof ctx.middlewares.rls).toBe('function');
      const routeMw = ctx.middlewares.rls();
      expect(typeof routeMw).toBe('function');
    });
  });
});
