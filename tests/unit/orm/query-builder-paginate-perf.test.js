const z = require('zod');
const { defineModel, createDatabase } = require('../../../core/orm');

describe('QueryBuilder Paginate & Count Performance Optimization', () => {
  let db;
  let PostRepo;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.knex.raw(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        created_at DATETIME,
        updated_at DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      );
    `);

    defineModel({
      name: 'PerfPost',
      table: 'posts',
      schema: z.object({
        id: z.number().int().optional(),
        title: z.string(),
        content: z.string().optional(),
      }),
      timestamps: true,
    });

    PostRepo = db.getRepository('PerfPost');

    // Seed 5 posts
    for (let i = 1; i <= 5; i++) {
      await PostRepo.create({
        title: `Post ${i}`,
        content: `Content for post ${i}`,
      });
    }
  });

  afterAll(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  describe('SQL Projection and Order Stripping in toKnex', () => {
    it('should strip ORDER BY from count SQL when includeOrderBy is false', () => {
      const qb = PostRepo.query()
        .where('title', 'like', '%Post%')
        .orderBy('created_at', 'desc');

      const fullSql = qb.toSQL();
      expect(fullSql.sql.toLowerCase()).toContain('order by');

      const countSql = qb.toKnex({ includeLimitOffset: false, includeOrderBy: false, includeSelect: false }).toSQL();
      expect(countSql.sql.toLowerCase()).not.toContain('order by');
    });

    it('should strip SELECT columns when includeSelect is false', () => {
      const qb = PostRepo.query()
        .select('title', 'content')
        .where('id', '>', 0);

      const countSql = qb.toKnex({ includeSelect: false }).count('* as count').toSQL();
      expect(countSql.sql).not.toContain('"title"');
      expect(countSql.sql).not.toContain('"content"');
      expect(countSql.sql.toLowerCase()).toContain('count(*) as "count"');
    });
  });

  describe('Parallel Execution and Pagination Accuracy', () => {
    it('paginate() returns correct paginated result with stripped count query', async () => {
      const result = await PostRepo.query()
        .select('id', 'title')
        .orderBy('id', 'desc')
        .paginate(1, 2);

      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(result.data).toHaveLength(2);
      // Verify ordering is preserved in the data query
      expect(result.data[0].id).toBe(5);
      expect(result.data[1].id).toBe(4);
    });

    it('paginate() on page 2 returns the second slice', async () => {
      const result = await PostRepo.query()
        .orderBy('id', 'asc')
        .paginate(2, 2);

      expect(result.total).toBe(5);
      expect(result.page).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe(3);
      expect(result.data[1].id).toBe(4);
    });

    it('paginate() on empty matches returns empty array without error', async () => {
      const result = await PostRepo.query()
        .where('title', '=', 'NonExistent')
        .paginate(1, 10);

      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('count() strips ORDER BY even if ordered query builder is used', async () => {
      const count = await PostRepo.query()
        .orderBy('title', 'desc')
        .count();

      expect(count).toBe(5);
    });
  });
});
