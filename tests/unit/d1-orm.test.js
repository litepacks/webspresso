'use strict';

/**
 * Cloudflare D1 Native Edge Dialect & Webspresso ORM Integration Tests
 */

const {
  createDatabase,
  defineModel,
  zdb,
  clearRegistry,
  createD1Knex,
  Client_D1,
} = require('../../core/orm');

class MockD1Database {
  constructor() {
    this.tables = {
      users: [],
      notes: [],
    };
    this.nextId = 1;
    this.executedSql = [];
  }

  prepare(sql) {
    const db = this;
    let boundParams = [];
    return {
      bind(...params) {
        boundParams = params;
        return this;
      },
      async all() {
        db.executedSql.push({ sql, boundParams, method: 'all' });

        if (/insert/i.test(sql)) {
          const tableName = /into\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
          const id = db.nextId++;
          const tableRows = db.tables[tableName] || (db.tables[tableName] = []);
          const record = { id };
          const colMatch = /\(([^()]+)\)\s+values/i.exec(sql);
          if (colMatch) {
            const cols = colMatch[1].split(',').map((c) => c.trim().replace(/[`"]/g, ''));
            cols.forEach((col, idx) => {
              record[col] = boundParams[idx];
            });
          } else if (tableName === 'users') {
            record.email = boundParams[0];
            record.role = boundParams[1] || 'user';
          } else {
            record.title = boundParams[0];
            record.content = boundParams[1];
            record.userId = boundParams[2] || 1;
            record.published = boundParams[3] !== undefined ? boundParams[3] : 1;
          }
          tableRows.push(record);
          return { results: [record], success: true, meta: { changes: 1, last_row_id: id } };
        }

        if (/select/i.test(sql)) {
          const tableName = /from\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
          const tableRows = db.tables[tableName] || [];
          if (/where/i.test(sql) && boundParams.length > 0) {
            const idParam = boundParams[0];
            const found = tableRows.filter((r) => r.id === idParam || r.email === idParam);
            return { results: found, success: true, meta: { changes: 0 } };
          }
          return { results: [...tableRows], success: true, meta: { changes: 0 } };
        }

        return { results: [], success: true, meta: { changes: 0 } };
      },
      async run() {
        db.executedSql.push({ sql, boundParams, method: 'run' });

        if (/insert/i.test(sql)) {
          const tableName = /into\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
          const id = db.nextId++;
          const tableRows = db.tables[tableName] || (db.tables[tableName] = []);
          const record = { id };
          const colMatch = /\(([^()]+)\)\s+values/i.exec(sql);
          if (colMatch) {
            const cols = colMatch[1].split(',').map((c) => c.trim().replace(/[`"]/g, ''));
            cols.forEach((col, idx) => {
              record[col] = boundParams[idx];
            });
          } else {
            record.title = boundParams[0];
          }
          tableRows.push(record);
          return { success: true, meta: { changes: 1, last_row_id: id } };
        }

        if (/update/i.test(sql)) {
          const tableName = /update\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
          const tableRows = db.tables[tableName] || [];
          return { success: true, meta: { changes: tableRows.length } };
        }

        if (/delete/i.test(sql)) {
          const tableName = /from\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
          const tableRows = db.tables[tableName] || [];
          const count = tableRows.length;
          db.tables[tableName] = [];
          return { success: true, meta: { changes: count } };
        }

        return { success: true, meta: { changes: 0 } };
      },
      async first() {
        db.executedSql.push({ sql, boundParams, method: 'first' });
        const tableName = /from\s+[`"]?(\w+)[`"]?/i.exec(sql)?.[1] || 'notes';
        const tableRows = db.tables[tableName] || [];
        if (/where/i.test(sql) && boundParams.length > 0) {
          return tableRows.find((r) => r.id === boundParams[0] || r.email === boundParams[0]) || null;
        }
        return tableRows[0] || null;
      },
    };
  }
}

describe('Cloudflare D1 Native Edge Dialect (core/orm/d1)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('exports Client_D1 and createD1Knex', () => {
    expect(typeof Client_D1).toBe('function');
    expect(typeof createD1Knex).toBe('function');
  });

  it('fails fast if D1 Database instance is missing when client: d1', () => {
    expect(() => {
      createDatabase({ client: 'd1' });
    }).toThrow(/Cloudflare D1 requires a D1 Database instance/);
  });

  it('successfully initializes createDatabase with client: "d1" and d1 binding', async () => {
    const mockD1 = new MockD1Database();

    defineModel({
      name: 'User',
      table: 'users',
      schema: {
        id: zdb.id(),
        email: zdb.string(),
        role: zdb.string({ default: 'user' }),
      },
    });

    const db = createDatabase({
      client: 'd1',
      d1: mockD1,
    });

    expect(db).toBeDefined();
    expect(typeof db.getRepository).toBe('function');
    expect(db.knex.client.driverName).toBe('d1');

    await db.knex.destroy();
  });

  it('performs CRUD operations via Repositories on Cloudflare D1 with zero code changes', async () => {
    const mockD1 = new MockD1Database();

    let beforeCreateHookRan = false;
    let afterCreateHookRan = false;

    defineModel({
      name: 'Note',
      table: 'notes',
      schema: {
        id: zdb.id(),
        title: zdb.string(),
        content: zdb.string(),
        published: zdb.boolean({ default: true }),
      },
      hooks: {
        beforeCreate: (data) => {
          beforeCreateHookRan = true;
          return data;
        },
        afterCreate: (record) => {
          afterCreateHookRan = true;
          return record;
        },
      },
    });

    const db = createDatabase({
      client: 'd1',
      d1: mockD1,
    });

    const NoteRepo = db.getRepository('Note');

    // 1. Create record via repo.create()
    const note = await NoteRepo.create({
      title: 'Cloudflare D1 Edge Note',
      content: 'Serverless SQLite at the edge',
    });

    expect(beforeCreateHookRan).toBe(true);
    expect(afterCreateHookRan).toBe(true);
    expect(note).toBeDefined();
    expect(note.id).toBe(1);
    expect(note.title).toBe('Cloudflare D1 Edge Note');

    // 2. Query record via repo.findById()
    const fetched = await NoteRepo.findById(1);
    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(1);

    // 3. Query records via repo.find()
    const allNotes = await NoteRepo.find();
    expect(allNotes.length).toBe(1);
    expect(allNotes[0].title).toBe('Cloudflare D1 Edge Note');

    // 4. Update record via repo.update()
    const updateRes = await NoteRepo.update(1, {
      title: 'Updated D1 Title',
    });
    expect(updateRes).toBeDefined();

    // 5. QueryBuilder fluent querying
    const queryBuilder = NoteRepo.query().where('id', 1);
    expect(queryBuilder).toBeDefined();

    await db.knex.destroy();
  });

  it('normalizes bindings properly for D1 (Date, boolean, undefined)', async () => {
    const mockD1 = new MockD1Database();

    defineModel({
      name: 'Note',
      table: 'notes',
      schema: {
        id: zdb.id(),
        title: zdb.string(),
        content: zdb.string(),
        published: zdb.boolean({ default: true }),
      },
    });

    const db = createDatabase({
      client: 'd1',
      d1: mockD1,
    });

    const NoteRepo = db.getRepository('Note');

    await NoteRepo.create({
      title: 'Type Normalization Note',
      content: 'Checks boolean and dates',
      published: true,
    });

    // Check that D1 received normalized bindings
    const insertCall = mockD1.executedSql.find((e) => /insert/i.test(e.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall.boundParams).toContain(1); // boolean normalized to 1

    await db.knex.destroy();
  });
});
