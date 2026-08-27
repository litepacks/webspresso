/**
 * Unit tests for rich query filtering and multi-column sorting in rest-resources plugin
 */

const { createDatabase, defineModel, zdb, clearRegistry } = require('../../core/orm');
const {
  parseSortParams,
  applyColumnFilters,
} = require('../../plugins/rest-resources');

describe('REST Resources - Rich Query Filtering & Multi-Column Sorting', () => {
  let db;
  let Product;

  beforeEach(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.knex.schema.createTable('products', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.string('sku').nullable();
      table.integer('price').notNullable();
      table.boolean('active').defaultTo(true);
      table.string('category').nullable();
      table.timestamp('created_at').defaultTo(db.knex.fn.now());
    });

    Product = defineModel({
      name: 'Product',
      table: 'products',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string({ maxLength: 255 }),
        sku: zdb.string({ maxLength: 50, nullable: true }),
        price: zdb.integer(),
        active: zdb.boolean({ default: true }),
        category: zdb.string({ maxLength: 50, nullable: true }),
      }),
      rest: { enabled: true },
    });

    db.registerModel(Product);

    const repo = db.getRepository('Product');
    await repo.create({ title: 'Apple iPhone', sku: 'APL-100', price: 999, active: true, category: 'electronics' });
    await repo.create({ title: 'Apple iPad', sku: 'APL-200', price: 599, active: true, category: 'electronics' });
    await repo.create({ title: 'Samsung Galaxy', sku: 'SAM-100', price: 899, active: false, category: 'electronics' });
    await repo.create({ title: 'Desk Lamp', sku: 'LMP-50', price: 49, active: true, category: 'home' });
    await repo.create({ title: 'Old Book', sku: null, price: 15, active: false, category: null });
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  describe('parseSortParams', () => {
    it('should parse single column sort with order', () => {
      const result = parseSortParams(Product, 'price', 'desc');
      expect(result).toEqual([{ column: 'price', direction: 'desc' }]);
    });

    it('should parse comma-separated sort strings with - and + prefixes', () => {
      const result = parseSortParams(Product, '-price,+title');
      expect(result).toEqual([
        { column: 'price', direction: 'desc' },
        { column: 'title', direction: 'asc' },
      ]);
    });

    it('should parse colon syntax (col:asc, col:desc)', () => {
      const result = parseSortParams(Product, 'price:desc,title:asc');
      expect(result).toEqual([
        { column: 'price', direction: 'desc' },
        { column: 'title', direction: 'asc' },
      ]);
    });

    it('should parse array sort parameters', () => {
      const result = parseSortParams(Product, ['-price', 'category:asc']);
      expect(result).toEqual([
        { column: 'price', direction: 'desc' },
        { column: 'category', direction: 'asc' },
      ]);
    });

    it('should filter out invalid column names and prevent duplicates', () => {
      const result = parseSortParams(Product, 'unknown_col,-price,price:asc');
      expect(result).toEqual([{ column: 'price', direction: 'desc' }]);
    });

    it('should fallback to primary key desc when sort is empty', () => {
      const result = parseSortParams(Product, '', 'asc');
      expect(result).toEqual([{ column: 'id', direction: 'asc' }]);
    });
  });

  describe('applyColumnFilters', () => {
    it('should filter with range operators: gt, gte, lt, lte', async () => {
      const repo = db.getRepository(Product);
      let { query } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          price: { gte: 500, lte: 900 },
        },
      });

      const records = await query.list();
      expect(records.length).toBe(2);
      expect(records.map(r => r.title)).toEqual(expect.arrayContaining(['Apple iPad', 'Samsung Galaxy']));
    });

    it('should filter with in and nin operators', async () => {
      const repo = db.getRepository(Product);
      let { query } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          category: { in: 'electronics,home' },
        },
      });

      const records = await query.list();
      expect(records.length).toBe(4);

      let { query: ninQuery } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          category: { nin: ['electronics'] },
        },
      });
      const ninRecords = await ninQuery.list();
      expect(ninRecords.length).toBe(1);
      expect(ninRecords[0].title).toBe('Desk Lamp');
    });

    it('should filter with pattern matching: contains, startsWith, endsWith', async () => {
      const repo = db.getRepository(Product);
      
      // contains
      let { query: containsQuery } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          title: { contains: 'Apple' },
        },
      });
      const containsRecords = await containsQuery.list();
      expect(containsRecords.length).toBe(2);

      // startsWith
      let { query: startsQuery } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          sku: { startsWith: 'SAM' },
        },
      });
      const startsRecords = await startsQuery.list();
      expect(startsRecords.length).toBe(1);
      expect(startsRecords[0].title).toBe('Samsung Galaxy');
    });

    it('should filter with nullability operators: isNull and isNotNull', async () => {
      const repo = db.getRepository(Product);
      
      // isNull
      let { query: nullQuery } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          sku: { isNull: 'true' },
        },
      });
      const nullRecords = await nullQuery.list();
      expect(nullRecords.length).toBe(1);
      expect(nullRecords[0].title).toBe('Old Book');

      // isNotNull
      let { query: notNullQuery } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          sku: { isNotNull: true },
        },
      });
      const notNullRecords = await notNullQuery.list();
      expect(notNullRecords.length).toBe(4);
    });

    it('should filter with between operator', async () => {
      const repo = db.getRepository(Product);
      let { query } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          price: { between: '40,600' },
        },
      });

      const records = await query.list();
      expect(records.length).toBe(2);
      expect(records.map(r => r.title)).toEqual(expect.arrayContaining(['Apple iPad', 'Desk Lamp']));
    });

    it('should support nested filter object format (?filter[col][op]=...) and (?filter[col]=...) and admin-style { op, value }', async () => {
      const repo = db.getRepository(Product);
      
      // Admin style { op, value }
      let { query: adminQ } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          filter: {
            title: { op: 'contains', value: 'Phone' },
          },
        },
      });
      const adminRecords = await adminQ.list();
      expect(adminRecords.length).toBe(1);
      expect(adminRecords[0].title).toBe('Apple iPhone');

      // Direct filter object
      let { query: directQ } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          filter: {
            active: 'false',
          },
        },
      });
      const directRecords = await directQ.list();
      expect(directRecords.length).toBe(2);
    });

    it('should ignore non-existent model columns safely', async () => {
      const repo = db.getRepository(Product);
      let { query } = applyColumnFilters(repo.query(), repo.query(), Product, {
        query: {
          hacked_col: { gte: 100 },
          page: 2,
          perPage: 10,
        },
      });

      const records = await query.list();
      expect(records.length).toBe(5);
    });
  });
});
