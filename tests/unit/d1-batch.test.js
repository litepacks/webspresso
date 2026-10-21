'use strict';

/**
 * Cloudflare D1 Atomic Batch API & Webspresso Dual-Runtime Batch Tests
 */

const {
  createDatabase,
  defineModel,
  zdb,
  clearRegistry,
  executeD1Batch,
  normalizeD1Bindings,
  createD1Knex,
} = require('../../index');

class MockD1Statement {
  constructor(sql, d1Db) {
    this.sql = sql;
    this.d1Db = d1Db;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    return this.d1Db._executeStatement(this.sql, this.params, 'all');
  }

  async run() {
    return this.d1Db._executeStatement(this.sql, this.params, 'run');
  }

  async first() {
    const res = await this.all();
    return res.results?.[0] || null;
  }
}

class MockD1Database {
  constructor() {
    this.tables = {
      notes: [],
    };
    this.nextId = 1;
    this.batchCalls = [];
    this.executedSql = [];
  }

  prepare(sql) {
    return new MockD1Statement(sql, this);
  }

  _executeStatement(sql, params, mode) {
    this.executedSql.push({ sql, params, mode });

    if (/insert/i.test(sql)) {
      const id = this.nextId++;
      const record = { id, title: params[0] || 'mock', active: params[1] !== undefined ? params[1] : 1 };
      this.tables.notes.push(record);
      return {
        results: [record],
        success: true,
        meta: { changes: 1, last_row_id: id },
      };
    }

    if (/update/i.test(sql)) {
      return {
        results: [],
        success: true,
        meta: { changes: this.tables.notes.length },
      };
    }

    if (/select/i.test(sql)) {
      return {
        results: [...this.tables.notes],
        success: true,
        meta: { changes: 0 },
      };
    }

    if (/delete/i.test(sql)) {
      const count = this.tables.notes.length;
      this.tables.notes = [];
      return {
        results: [],
        success: true,
        meta: { changes: count },
      };
    }

    return { results: [], success: true, meta: { changes: 0 } };
  }

  async batch(statements) {
    this.batchCalls.push(statements);
    const results = [];
    for (const stmt of statements) {
      if (stmt && typeof stmt.all === 'function') {
        const res = await stmt.all();
        results.push(res);
      } else {
        results.push({ results: [], success: true, meta: { changes: 0 } });
      }
    }
    return results;
  }
}

describe('Cloudflare D1 Atomic Batch API', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('normalizeD1Bindings', () => {
    it('normalizes Dates, booleans, and undefined values', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      const input = ['hello', true, false, undefined, date, 42, null];
      const output = normalizeD1Bindings(input);

      expect(output).toEqual([
        'hello',
        1,
        0,
        null,
        '2026-01-01T00:00:00.000Z',
        42,
        null,
      ]);
    });

    it('returns empty array when invalid input passed', () => {
      expect(normalizeD1Bindings(null)).toEqual([]);
      expect(normalizeD1Bindings()).toEqual([]);
    });
  });

  describe('executeD1Batch', () => {
    it('throws when d1Database is missing or has no .batch method', async () => {
      await expect(executeD1Batch(null, [])).rejects.toThrow('Cloudflare D1 Database instance with .batch() method is required');
      await expect(executeD1Batch({}, [])).rejects.toThrow('Cloudflare D1 Database instance with .batch() method is required');
    });

    it('returns empty array when queries list is empty', async () => {
      const mockD1 = new MockD1Database();
      const res = await executeD1Batch(mockD1, []);
      expect(res).toEqual([]);
      expect(mockD1.batchCalls.length).toBe(0);
    });

    it('executes array of raw SQL strings and objects in single batch call', async () => {
      const mockD1 = new MockD1Database();
      const results = await executeD1Batch(mockD1, [
        { sql: 'INSERT INTO notes (title, active) VALUES (?, ?)', bindings: ['First', true] },
        { sql: 'INSERT INTO notes (title, active) VALUES (?, ?)', bindings: ['Second', false] },
        'SELECT * FROM notes',
      ]);

      expect(mockD1.batchCalls.length).toBe(1);
      expect(mockD1.batchCalls[0].length).toBe(3);

      // Statements were properly prepared and bound
      expect(mockD1.batchCalls[0][0].params).toEqual(['First', 1]);
      expect(mockD1.batchCalls[0][1].params).toEqual(['Second', 0]);

      // Returns parsed result descriptors
      expect(results[0]).toEqual({ success: true, changes: 1, lastID: 1 });
      expect(results[1]).toEqual({ success: true, changes: 1, lastID: 2 });
      expect(Array.isArray(results[2])).toBe(true);
      expect(results[2].length).toBe(2);
    });

    it('executes builder callback style with add() and raw()', async () => {
      const mockD1 = new MockD1Database();
      const results = await executeD1Batch(mockD1, async (b) => {
        b.raw('INSERT INTO notes (title) VALUES (?)', ['Note A']);
        b.raw('INSERT INTO notes (title) VALUES (?)', ['Note B']);
        b.add('SELECT * FROM notes');
      });

      expect(mockD1.batchCalls.length).toBe(1);
      expect(mockD1.batchCalls[0].length).toBe(3);
      expect(results.length).toBe(3);
      expect(results[2].length).toBe(2);
    });

    it('accepts prepared D1 statements directly', async () => {
      const mockD1 = new MockD1Database();
      const stmt1 = mockD1.prepare('INSERT INTO notes (title) VALUES (?)').bind('Direct Stmt');
      const stmt2 = mockD1.prepare('SELECT * FROM notes');

      const results = await executeD1Batch(mockD1, [stmt1, stmt2]);
      expect(mockD1.batchCalls.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[1].results.length).toBe(1);
    });
  });

  describe('D1 Database & Knex .batch() integration', () => {
    it('executes Knex queries through db.batch() on D1 database', async () => {
      const mockD1 = new MockD1Database();
      const db = createDatabase({
        client: 'sqlite3',
        d1: mockD1,
      });

      defineModel({
        name: 'Note',
        table: 'notes',
        schema: {
          id: zdb.id(),
          title: zdb.string(),
        },
      });

      const noteRepo = db.getRepository('Note');

      const results = await db.batch([
        db.knex('notes').insert({ title: 'From Knex 1' }),
        db.knex('notes').insert({ title: 'From Knex 2' }),
        noteRepo.query().select('*'),
      ]);

      expect(mockD1.batchCalls.length).toBe(1);
      expect(mockD1.batchCalls[0].length).toBe(3);
      expect(results.length).toBe(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(Array.isArray(results[2])).toBe(true);
    });

    it('supports direct instance.batch() attached by createD1Knex', async () => {
      const mockD1 = new MockD1Database();
      const knex = createD1Knex(mockD1);

      expect(typeof knex.batch).toBe('function');

      const results = await knex.batch([
        knex('notes').insert({ title: 'Direct Knex Batch' }),
        knex('notes').select('*'),
      ]);

      expect(mockD1.batchCalls.length).toBe(1);
      expect(results.length).toBe(2);
    });
  });

  describe('Dual-Runtime: db.batch() on standard Node.js SQLite', () => {
    it('executes atomically inside db.transaction() on standard SQLite', async () => {
      const db = createDatabase({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      await db.knex.schema.createTable('tasks', (table) => {
        table.increments('id').primary();
        table.string('title').notNullable();
        table.integer('priority').defaultTo(1);
      });

      const results = await db.batch([
        db.knex('tasks').insert({ title: 'Task 1', priority: 10 }),
        db.knex('tasks').insert({ title: 'Task 2', priority: 20 }),
        db.knex('tasks').select('*').orderBy('id', 'asc'),
      ]);

      expect(results.length).toBe(3);
      const rows = results[2];
      expect(rows.length).toBe(2);
      expect(rows[0].title).toBe('Task 1');
      expect(rows[1].title).toBe('Task 2');

      await db.destroy();
    });

    it('rolls back all statements if one statement fails in batch on Node.js', async () => {
      const db = createDatabase({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      await db.knex.schema.createTable('tasks', (table) => {
        table.increments('id').primary();
        table.string('title').notNullable().unique();
      });

      await expect(
        db.batch([
          db.knex('tasks').insert({ title: 'Unique Task' }),
          // Second query will violate unique constraint
          db.knex('tasks').insert({ title: 'Unique Task' }),
        ])
      ).rejects.toThrow();

      // Verify rollback occurred: 0 tasks exist
      const existing = await db.knex('tasks').select('*');
      expect(existing.length).toBe(0);

      await db.destroy();
    });

    it('supports callback builder on standard Node.js database', async () => {
      const db = createDatabase({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      await db.knex.schema.createTable('items', (table) => {
        table.increments('id').primary();
        table.string('name').notNullable();
      });

      const results = await db.batch(async (b) => {
        b.add(db.knex('items').insert({ name: 'Item A' }));
        b.raw('INSERT INTO items (name) VALUES (?)', ['Item B']);
        b.add(db.knex('items').select('*'));
      });

      expect(results.length).toBe(3);
      const allItems = await db.knex('items').select('*');
      expect(allItems.length).toBe(2);

      await db.destroy();
    });
  });
});
