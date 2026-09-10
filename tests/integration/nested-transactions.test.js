import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { z } = require('zod');
const { createDatabase, defineModel, zdb } = require('../../core/orm');

describe('Nested Transactions & Savepoints (SQLite)', () => {
  let db;

  const Note = defineModel({
    name: 'Note',
    table: 'notes',
    schema: z.object({
      id: zdb.id(),
      title: zdb.string(),
    }),
  });

  beforeEach(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });

    await db.knex.schema.createTable('notes', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
    });

    db.registerModel(Note);
  });

  afterEach(async () => {
    if (db && db.knex) {
      await db.knex.destroy();
    }
  });

  it('should allow nested db.transaction calls without deadlock and commit both', async () => {
    const NoteRepo = db.getRepository('Note');

    await db.transaction(async (outerCtx) => {
      await outerCtx.getRepository('Note').create({ title: 'Outer Note' });

      // Nested transaction (creates Knex savepoint on existing ambient transaction)
      await db.transaction(async (innerCtx) => {
        await innerCtx.getRepository('Note').create({ title: 'Inner Note' });
      });
    });

    const allNotes = await NoteRepo.findAll();
    expect(allNotes).toHaveLength(2);
    expect(allNotes.map((n) => n.title)).toEqual(['Outer Note', 'Inner Note']);
  });

  it('should rollback inner savepoint when inner transaction fails without killing outer if caught', async () => {
    const NoteRepo = db.getRepository('Note');

    await db.transaction(async (outerCtx) => {
      await outerCtx.getRepository('Note').create({ title: 'Outer Preserved' });

      try {
        await db.transaction(async (innerCtx) => {
          await innerCtx.getRepository('Note').create({ title: 'Inner Failed' });
          throw new Error('Rollback inner savepoint');
        });
      } catch (err) {
        expect(err.message).toBe('Rollback inner savepoint');
      }

      await outerCtx.getRepository('Note').create({ title: 'Outer Preserved 2' });
    });

    const allNotes = await NoteRepo.findAll();
    expect(allNotes).toHaveLength(2);
    expect(allNotes.map((n) => n.title)).toEqual(['Outer Preserved', 'Outer Preserved 2']);
  });
});
