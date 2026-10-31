const { defineModel, createDatabase, zdb } = require('../../../core/orm');

describe('QueryBuilder Extended SQL Methods', () => {
  let db;
  let ProductRepo;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.knex.raw(`
      CREATE TABLE test_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER,
        tags TEXT,
        created_at DATETIME,
        updated_at DATETIME,
        createdAt DATETIME,
        updatedAt DATETIME
      );
    `);

    defineModel({
      name: 'TestProduct',
      table: 'test_products',
      schema: ({ zdb }) => ({
        id: zdb.id().optional(),
        name: zdb.string(),
        category: zdb.string(),
        price: zdb.float(),
        stock: zdb.integer().nullable().optional(),
        tags: zdb.string().nullable().optional(),
      }),
      timestamps: true,
    });

    ProductRepo = db.getRepository('TestProduct');

    // Seed test products
    await ProductRepo.create({ name: 'Laptop', category: 'electronics', price: 1200, stock: 10, tags: 'tech' });
    await ProductRepo.create({ name: 'Phone', category: 'electronics', price: 800, stock: 25, tags: 'tech' });
    await ProductRepo.create({ name: 'Tablet', category: 'electronics', price: 500, stock: 15, tags: null });
    await ProductRepo.create({ name: 'Shirt', category: 'apparel', price: 40, stock: 50, tags: 'clothing' });
    await ProductRepo.create({ name: 'Jeans', category: 'apparel', price: 60, stock: null, tags: 'clothing' });
    await ProductRepo.create({ name: 'Novel', category: 'books', price: 15, stock: 100, tags: null });
    await ProductRepo.create({ name: 'Cookbook', category: 'books', price: 30, stock: 0, tags: 'cooking' });
  });

  afterAll(async () => {
    if (db && db.destroy) {
      await db.destroy();
    }
  });

  describe('whereBetween and whereNotBetween', () => {
    it('filters rows with whereBetween', async () => {
      const results = await ProductRepo.query()
        .whereBetween('price', [40, 500])
        .orderBy('price', 'asc')
        .find();

      expect(results.map(r => r.name)).toEqual(['Shirt', 'Jeans', 'Tablet']);
    });

    it('filters rows with whereNotBetween', async () => {
      const results = await ProductRepo.query()
        .whereNotBetween('price', [35, 1000])
        .orderBy('price', 'asc')
        .find();

      expect(results.map(r => r.name)).toEqual(['Novel', 'Cookbook', 'Laptop']);
    });

    it('supports orWhereBetween', async () => {
      const results = await ProductRepo.query()
        .where('category', 'books')
        .orWhereBetween('price', [1000, 2000])
        .orderBy('price', 'asc')
        .find();

      expect(results.map(r => r.name)).toEqual(['Novel', 'Cookbook', 'Laptop']);
    });

    it('supports orWhereNotBetween', async () => {
      const results = await ProductRepo.query()
        .where('category', 'books')
        .orWhereNotBetween('price', [20, 1500])
        .orderBy('price', 'asc')
        .find();

      expect(results.map(r => r.name)).toEqual(['Novel', 'Cookbook']);
    });
  });

  describe('whereNot and orWhereNot', () => {
    it('filters rows with whereNot with key and value', async () => {
      const results = await ProductRepo.query()
        .whereNot('category', 'electronics')
        .find();

      expect(results.every(r => r.category !== 'electronics')).toBe(true);
      expect(results.length).toBe(4);
    });

    it('filters rows with whereNot using object of conditions', async () => {
      const results = await ProductRepo.query()
        .whereNot({ category: 'electronics', tags: 'cooking' })
        .find();

      expect(results.every(r => r.category !== 'electronics' && r.tags !== 'cooking')).toBe(true);
    });

    it('supports orWhereNot', async () => {
      const results = await ProductRepo.query()
        .where('price', '>', 1000)
        .orWhereNot('category', 'electronics')
        .find();

      // Laptop (price > 1000) + all apparel/books
      expect(results.length).toBe(5);
    });
  });

  describe('whereIn, whereNotIn, orWhereIn, orWhereNotIn', () => {
    it('supports orWhereIn', async () => {
      const results = await ProductRepo.query()
        .where('name', 'Laptop')
        .orWhereIn('category', ['books'])
        .orderBy('price', 'asc')
        .find();

      expect(results.map(r => r.name)).toEqual(['Novel', 'Cookbook', 'Laptop']);
    });

    it('supports orWhereNotIn', async () => {
      const results = await ProductRepo.query()
        .where('category', 'electronics')
        .orWhereNotIn('category', ['electronics', 'apparel'])
        .find();

      // All electronics (3) + books (2)
      expect(results.length).toBe(5);
    });
  });

  describe('whereNull, whereNotNull, orWhereNull, orWhereNotNull', () => {
    it('filters null values with whereNull', async () => {
      const results = await ProductRepo.query()
        .whereNull('stock')
        .find();

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Jeans');
    });

    it('filters non-null values with whereNotNull', async () => {
      const results = await ProductRepo.query()
        .whereNotNull('stock')
        .find();

      expect(results.length).toBe(6);
      expect(results.every(r => r.stock !== null)).toBe(true);
    });

    it('supports orWhereNull', async () => {
      const results = await ProductRepo.query()
        .where('category', 'books')
        .orWhereNull('stock')
        .find();

      // 2 books + Jeans (stock is null)
      expect(results.length).toBe(3);
    });

    it('supports orWhereNotNull', async () => {
      const results = await ProductRepo.query()
        .where('category', 'electronics')
        .orWhereNotNull('tags')
        .find();

      // electronics (Laptop, Phone, Tablet) OR tagged (Laptop, Phone, Shirt, Jeans, Cookbook)
      expect(results.map((r) => r.name).sort()).toEqual(['Cookbook', 'Jeans', 'Laptop', 'Phone', 'Shirt', 'Tablet']);
    });
  });

  describe('distinct', () => {
    it('applies DISTINCT to query', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .distinct()
        .orderBy('category', 'asc')
        .find();

      expect(results).toEqual([
        { category: 'apparel' },
        { category: 'books' },
        { category: 'electronics' },
      ]);
    });

    it('applies distinct with specific column arguments', async () => {
      const results = await ProductRepo.query()
        .distinct('category')
        .orderBy('category', 'asc')
        .find();

      expect(results.map(r => r.category)).toEqual([
        'apparel',
        'books',
        'electronics',
      ]);
    });
  });

  describe('groupBy and having', () => {
    it('groups records and calculates aggregate sums', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .select(db.knex.raw('COUNT(*) as item_count'))
        .select(db.knex.raw('AVG(price) as avg_price'))
        .groupBy('category')
        .orderBy('category', 'asc')
        .find();

      expect(results.length).toBe(3);
      expect(results[0].category).toBe('apparel');
      expect(Number(results[0].item_count)).toBe(2);
      expect(results[1].category).toBe('books');
      expect(Number(results[1].item_count)).toBe(2);
      expect(results[2].category).toBe('electronics');
      expect(Number(results[2].item_count)).toBe(3);
    });

    it('filters grouped records with having', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .select(db.knex.raw('COUNT(*) as item_count'))
        .groupBy('category')
        .having('item_count', '>', 2)
        .find();

      expect(results.length).toBe(1);
      expect(results[0].category).toBe('electronics');
    });

    it('filters grouped records with havingRaw', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .groupBy('category')
        .havingRaw('COUNT(*) = ?', [2])
        .orderBy('category', 'asc')
        .find();

      expect(results.map(r => r.category)).toEqual(['apparel', 'books']);
    });

    it('supports orHaving and orHavingRaw', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .select(db.knex.raw('COUNT(*) as item_count'))
        .groupBy('category')
        .having('item_count', '>', 2)
        .orHaving('item_count', '=', 2)
        .orderBy('category', 'asc')
        .find();

      expect(results.length).toBe(3);
    });

    it('supports groupByRaw', async () => {
      const results = await ProductRepo.query()
        .select('category')
        .groupByRaw('category')
        .orderBy('category', 'asc')
        .find();

      expect(results.length).toBe(3);
    });

    it('accurately counts total groups when groupBy is used in count()', async () => {
      const totalGroups = await ProductRepo.query()
        .groupBy('category')
        .count();

      expect(totalGroups).toBe(3);
    });

    it('accepts object form paginate({ page, limit }) and paginate({ page, perPage })', async () => {
      const byLimit = await ProductRepo.query().orderBy('id', 'asc').paginate({ page: 2, limit: 2 });
      expect(byLimit.page).toBe(2);
      expect(byLimit.perPage).toBe(2);
      expect(byLimit.data.length).toBeLessThanOrEqual(2);

      const byPerPage = await ProductRepo.query().orderBy('id', 'asc').paginate({ page: 1, perPage: 3 });
      expect(byPerPage.page).toBe(1);
      expect(byPerPage.perPage).toBe(3);

      const positional = await ProductRepo.query().orderBy('id', 'asc').paginate(2, 2);
      expect(byLimit.data).toEqual(positional.data);
    });

    it('accurately paginates grouped queries', async () => {
      const paginated = await ProductRepo.query()
        .select('category')
        .select(db.knex.raw('COUNT(*) as count'))
        .groupBy('category')
        .orderBy('category', 'asc')
        .paginate(1, 2);

      expect(paginated.total).toBe(3);
      expect(paginated.totalPages).toBe(2);
      expect(paginated.page).toBe(1);
      expect(paginated.perPage).toBe(2);
      expect(paginated.data.length).toBe(2);
      expect(paginated.data[0].category).toBe('apparel');
      expect(paginated.data[1].category).toBe('books');
    });
  });

  describe('clone()', () => {
    it('correctly clones query builder with all new states preserved', () => {
      const qb1 = ProductRepo.query()
        .distinct('category')
        .whereBetween('price', [10, 100])
        .whereNull('tags')
        .groupBy('category')
        .having('price', '>', 20);

      const qb2 = qb1.clone();

      // Mutate qb2
      qb2.where('name', 'Laptop').groupBy('stock').having('stock', '>', 5);

      // Verify qb1 was not mutated
      expect(qb1.state.wheres.length).toBe(2);
      expect(qb1.state.groupBys.length).toBe(1);
      expect(qb1.state.havings.length).toBe(1);
      expect(qb1.state.distinct).toBe(true);

      // Verify qb2 received the clones and additions
      expect(qb2.state.wheres.length).toBe(3);
      expect(qb2.state.groupBys.length).toBe(2);
      expect(qb2.state.havings.length).toBe(2);
      expect(qb2.state.distinct).toBe(true);
    });
  });
});
