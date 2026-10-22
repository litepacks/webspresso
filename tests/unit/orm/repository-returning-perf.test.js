const z = require('zod');
const { defineModel, createDatabase } = require('../../../core/orm');

describe('Repository Direct Returning Optimization (create & update)', () => {
  let db;
  let ProductRepo;
  let queriesExecuted = [];

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });

    // Intercept knex queries to count roundtrips
    db.knex.on('query', (queryData) => {
      queriesExecuted.push(queryData.sql);
    });

    await db.knex.raw(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        metadata TEXT,
        created_at DATETIME,
        updated_at DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      );
    `);

    defineModel({
      name: 'PerfProduct',
      table: 'products',
      schema: z.object({
        id: z.number().int().optional(),
        name: z.string(),
        price: z.number(),
        metadata: z.record(z.any()).optional(),
      }),
      timestamps: true,
    });

    ProductRepo = db.getRepository('PerfProduct');
  });

  afterAll(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  beforeEach(() => {
    queriesExecuted = [];
  });

  describe('create() with direct returning', () => {
    it('creates a record with a SINGLE SQL query (no secondary SELECT)', async () => {
      const created = await ProductRepo.create({
        name: 'Keyboard',
        price: 99.99,
        metadata: { switches: 'brown' },
      });

      expect(created).toBeDefined();
      expect(created.id).toBe(1);
      expect(created.name).toBe('Keyboard');
      expect(created.price).toBe(99.99);
      expect(created.metadata).toEqual({ switches: 'brown' });

      // In SQLite 3.35+, insert with returning(*) runs exactly ONE query
      // Previously, it executed 2 queries: INSERT followed by SELECT ... WHERE id = ?
      const insertQueries = queriesExecuted.filter((sql) => sql.toLowerCase().includes('insert into'));
      const selectQueries = queriesExecuted.filter((sql) => sql.toLowerCase().includes('select'));

      expect(insertQueries).toHaveLength(1);
      expect(selectQueries).toHaveLength(0); // Zero redundant SELECT queries!
    });
  });

  describe('update() with direct returning', () => {
    it('updates a record with a SINGLE SQL query (no secondary SELECT)', async () => {
      queriesExecuted = [];
      const updated = await ProductRepo.update(1, {
        price: 79.99,
        metadata: { switches: 'blue' },
      });

      expect(updated).toBeDefined();
      expect(updated.id).toBe(1);
      expect(updated.name).toBe('Keyboard');
      expect(updated.price).toBe(79.99);
      expect(updated.metadata).toEqual({ switches: 'blue' });

      // Verify only UPDATE with RETURNING was executed, no SELECT
      const updateQueries = queriesExecuted.filter((sql) => sql.toLowerCase().includes('update'));
      const selectQueries = queriesExecuted.filter((sql) => sql.toLowerCase().includes('select'));

      expect(updateQueries).toHaveLength(1);
      expect(selectQueries).toHaveLength(0); // Zero redundant SELECT queries!
    });

    it('returns null when updating non-existent record', async () => {
      queriesExecuted = [];
      const result = await ProductRepo.update(9999, { price: 10 });
      expect(result).toBeNull();
    });
  });
});
