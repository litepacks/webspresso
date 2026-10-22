const z = require('zod');
const { defineModel, createDatabase, createQueryBuilder, QueryBuilder } = require('../../../core/orm');

describe('db.query() Direct QueryBuilder Instantiation & Allocations', () => {
  let db;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });

    await db.knex.raw(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tenant_id INTEGER,
        role TEXT DEFAULT 'member',
        deleted_at DATETIME
      );
    `);

    defineModel({
      name: 'QueryUser',
      table: 'users',
      schema: z.object({
        id: z.number().int().optional(),
        name: z.string(),
        tenant_id: z.number().optional(),
        role: z.string().optional(),
      }),
      scopes: {
        tenant: 'tenant_id',
        softDelete: true,
      },
    });

    const repo = db.getRepository('QueryUser');
    await repo.create({ name: 'Alice', tenant_id: 10, role: 'admin' });
    await repo.create({ name: 'Bob', tenant_id: 20, role: 'member' });
    await repo.create({ name: 'Charlie', tenant_id: 10, role: 'member' });
  });

  afterAll(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  it('exports createQueryBuilder and QueryBuilder from core/orm', () => {
    expect(typeof createQueryBuilder).toBe('function');
    expect(QueryBuilder).toBeDefined();
  });

  it('db.query(modelName) returns a QueryBuilder instance without intermediate repository overhead', () => {
    const qb = db.query('QueryUser');
    expect(qb).toBeInstanceOf(QueryBuilder);
    expect(qb.model.name).toBe('QueryUser');
  });

  it('db.query(modelName) executes queries and returns matching rows', async () => {
    const users = await db.query('QueryUser').orderBy('name', 'asc').get();
    expect(users).toHaveLength(3);
    expect(users.map((u) => u.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('db.query with tenant scope limits results to specified tenant', async () => {
    const users = await db.query('QueryUser', { tenantId: 10 }).get();
    expect(users).toHaveLength(2);
    expect(users.every((u) => u.tenant_id === 10)).toBe(true);
  });

  it('db.forTenant(tenantId).query(modelName) applies tenant scope directly', async () => {
    const users = await db.forTenant(20).query('QueryUser').get();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Bob');
  });

  it('trxContext.query works inside db.transaction', async () => {
    await db.transaction(async (trxCtx) => {
      expect(typeof trxCtx.query).toBe('function');
      const qb = trxCtx.query('QueryUser');
      expect(qb).toBeInstanceOf(QueryBuilder);

      const users = await qb.where('role', 'admin').get();
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
    });
  });
});
