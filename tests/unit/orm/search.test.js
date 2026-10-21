import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDatabase,
  defineModel,
  zdb,
  clearRegistry,
  buildSearchClause,
  tokenizeSearchTerm,
  detectDialect,
} from '../../../core/orm';

describe('ORM Universal Full-Text Search (core/orm/search.js)', () => {
  describe('tokenizeSearchTerm', () => {
    it('returns empty array for invalid, null or empty input', () => {
      expect(tokenizeSearchTerm(null)).toEqual([]);
      expect(tokenizeSearchTerm(undefined)).toEqual([]);
      expect(tokenizeSearchTerm('')).toEqual([]);
      expect(tokenizeSearchTerm('   ')).toEqual([]);
      expect(tokenizeSearchTerm(123)).toEqual([]);
    });

    it('tokenizes plain words separated by spaces', () => {
      expect(tokenizeSearchTerm('webspresso nodejs orm')).toEqual(['webspresso', 'nodejs', 'orm']);
      expect(tokenizeSearchTerm('  quick   brown   fox  ')).toEqual(['quick', 'brown', 'fox']);
    });

    it('preserves double-quoted phrases as single tokens without quotes', () => {
      expect(tokenizeSearchTerm('apple "macbook pro" laptop')).toEqual([
        'apple',
        'macbook pro',
        'laptop',
      ]);
      expect(tokenizeSearchTerm('"full text search" sqlite')).toEqual([
        'full text search',
        'sqlite',
      ]);
    });
  });

  describe('detectDialect', () => {
    it('detects sqlite from various client strings', () => {
      expect(detectDialect({ client: { config: { client: 'better-sqlite3' } } })).toBe('sqlite');
      expect(detectDialect({ client: { config: { client: 'sqlite3' } } })).toBe('sqlite');
    });

    it('detects postgres from pg client strings', () => {
      expect(detectDialect({ client: { config: { client: 'pg' } } })).toBe('postgres');
      expect(detectDialect({ client: { config: { client: 'postgresql' } } })).toBe('postgres');
    });

    it('detects mysql from mysql / mariadb client strings', () => {
      expect(detectDialect({ client: { config: { client: 'mysql2' } } })).toBe('mysql');
      expect(detectDialect({ client: { config: { client: 'mariadb' } } })).toBe('mysql');
    });

    it('falls back to generic for unknown clients', () => {
      expect(detectDialect({ client: { config: { client: 'oracle' } } })).toBe('generic');
      expect(detectDialect(null)).toBe('generic');
    });
  });

  describe('buildSearchClause (SQL clause generation)', () => {
    // Mock knex ref builder
    const mockPgKnex = {
      client: { config: { client: 'pg' } },
      ref: (col) => `"${col}"`,
    };

    const mockSqliteKnex = {
      client: { config: { client: 'better-sqlite3' } },
      ref: (col) => `\`${col}\``,
    };

    const mockMysqlKnex = {
      client: { config: { client: 'mysql2' } },
      ref: (col) => `\`${col}\``,
    };

    const testModel = {
      name: 'Post',
      table: 'posts',
      searchable: ['title', 'body'],
    };

    it('returns null if term is empty or whitespace', () => {
      expect(buildSearchClause({ knex: mockSqliteKnex, model: testModel, term: '' })).toBeNull();
      expect(buildSearchClause({ knex: mockSqliteKnex, model: testModel, term: '   ' })).toBeNull();
      expect(buildSearchClause({ knex: mockSqliteKnex, model: testModel, term: null })).toBeNull();
    });

    it('throws error if no searchable columns are available', () => {
      const emptyModel = { name: 'Empty', table: 'empty' };
      expect(() =>
        buildSearchClause({ knex: mockSqliteKnex, model: emptyModel, term: 'test' })
      ).toThrow(/No searchable columns specified/);
    });

    it('falls back to model.admin.searchFields if model.searchable is absent', () => {
      const adminModel = {
        name: 'AdminModel',
        table: 'admin_table',
        admin: { searchFields: ['headline'] },
      };
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: adminModel,
        term: 'news',
      });
      expect(clause).not.toBeNull();
      expect(clause.sql).toContain('`headline`');
    });

    it('generates PostgreSQL full-text search clause with tsvector and plainto_tsquery', () => {
      const clause = buildSearchClause({
        knex: mockPgKnex,
        model: testModel,
        term: 'webspresso framework',
        columns: ['title', 'body'],
        options: { language: 'english' },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe(
        "to_tsvector(?, COALESCE(\"title\"::text, '') || ' ' || COALESCE(\"body\"::text, '')) @@ plainto_tsquery(?, ?)"
      );
      expect(clause.bindings).toEqual(['english', 'english', 'webspresso framework']);
      expect(clause.rankClause).toBeNull();
    });

    it('uses websearch_to_tsquery and generates ts_rank when rank: true on Postgres', () => {
      const clause = buildSearchClause({
        knex: mockPgKnex,
        model: testModel,
        term: '"deep learning" ai',
        columns: ['title'],
        options: { language: 'english', rank: true },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toContain('websearch_to_tsquery');
      expect(clause.rankClause).not.toBeNull();
      expect(clause.rankClause.sql).toBe(
        'ts_rank(to_tsvector(?, COALESCE("title"::text, \'\')), websearch_to_tsquery(?, ?)) DESC'
      );
      expect(clause.rankClause.bindings).toEqual(['english', 'english', '"deep learning" ai']);
    });

    it('generates SQLite MATCH clause when mode is fts', () => {
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: testModel,
        term: 'fast database',
        options: { mode: 'fts' },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe('`posts` MATCH ?');
      expect(clause.bindings).toEqual(['fast database']);
    });

    it('generates SQLite virtual FTS table subquery when ftsTable option is provided', () => {
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: testModel,
        term: 'search term',
        options: { mode: 'fts', ftsTable: 'posts_fts' },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe('rowid IN (SELECT rowid FROM `posts_fts` WHERE `posts_fts` MATCH ?)');
      expect(clause.bindings).toEqual(['search term']);
    });

    it('generates MySQL MATCH ... AGAINST clause when mode is fts', () => {
      const clause = buildSearchClause({
        knex: mockMysqlKnex,
        model: testModel,
        term: '+fulltext +search',
        columns: ['title', 'body'],
        options: { mode: 'fts' },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe('MATCH(`title`, `body`) AGAINST(? IN BOOLEAN MODE)');
      expect(clause.bindings).toEqual(['+fulltext +search']);
    });

    it('generates tokenized LIKE query by default on SQLite / generic', () => {
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: testModel,
        term: 'hello world',
        columns: ['title', 'body'],
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe(
        '((LOWER(`title`) LIKE LOWER(?) OR LOWER(`body`) LIKE LOWER(?)) AND (LOWER(`title`) LIKE LOWER(?) OR LOWER(`body`) LIKE LOWER(?)))'
      );
      expect(clause.bindings).toEqual(['%hello%', '%hello%', '%world%', '%world%']);
    });

    it('supports matchAllWords: false to OR individual tokens', () => {
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: testModel,
        term: 'hello world',
        columns: ['title'],
        options: { matchAllWords: false },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe('((LOWER(`title`) LIKE LOWER(?)) OR (LOWER(`title`) LIKE LOWER(?)))');
      expect(clause.bindings).toEqual(['%hello%', '%world%']);
    });

    it('supports exact: true for literal substring matching', () => {
      const clause = buildSearchClause({
        knex: mockSqliteKnex,
        model: testModel,
        term: 'hello world',
        columns: ['title', 'body'],
        options: { exact: true },
      });

      expect(clause).not.toBeNull();
      expect(clause.sql).toBe('(LOWER(`title`) LIKE LOWER(?) OR LOWER(`body`) LIKE LOWER(?))');
      expect(clause.bindings).toEqual(['%hello world%', '%hello world%']);
    });
  });

  describe('Database Integration with SQLite in-memory', () => {
    let db;
    let Article;
    let repo;

    beforeAll(async () => {
      clearRegistry();

      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        models: './tests/fixtures/models-empty',
        cache: false,
      });

      Article = defineModel({
        name: 'Article',
        table: 'articles',
        schema: zdb.schema({
          id: zdb.id(),
          title: zdb.string(),
          content: zdb.string(),
          author: zdb.string(),
          status: zdb.string().default('published'),
        }),
        searchable: ['title', 'content'],
      });

      db.registerModel(Article);

      const knex = db.knex;
      await knex.schema.createTable('articles', (table) => {
        table.increments('id').primary();
        table.string('title').notNullable();
        table.text('content').notNullable();
        table.string('author').notNullable();
        table.string('status').notNullable().defaultTo('published');
      });

      repo = db.getRepository('Article');

      // Seed articles
      await repo.createMany([
        {
          title: 'Getting started with Webspresso',
          content: 'Webspresso is a lightweight Node.js SSR framework with zero dependency sprawl.',
          author: 'Alice',
          status: 'published',
        },
        {
          title: 'Deep dive into Node.js ORM',
          content: 'Learn how repositories and knex work together to build reliable backend services.',
          author: 'Bob',
          status: 'published',
        },
        {
          title: 'React vs Vue Frontend Comparison',
          content: 'Comparing client-side component libraries and reactive user interfaces.',
          author: 'Charlie',
          status: 'draft',
        },
        {
          title: 'High Performance Webspresso Applications',
          content: 'Optimizing queries, response compression, and query caching in Webspresso.',
          author: 'Alice',
          status: 'published',
        },
      ]);
    });

    afterAll(async () => {
      if (db) await db.destroy();
      clearRegistry();
    });

    it('searches across default searchable columns using query().search(term)', async () => {
      const results = await repo.query().search('Webspresso').get();
      expect(results).toHaveLength(2);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('Getting started with Webspresso');
      expect(titles).toContain('High Performance Webspresso Applications');
    });

    it('searches using repo.search(term) shortcut', async () => {
      const results = await repo.search('repositories').get();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Deep dive into Node.js ORM');
    });

    it('performs multi-token AND matching across columns', async () => {
      // "Webspresso" is in 1 and 4, but "lightweight" is only in 1
      const results = await repo.search('Webspresso lightweight').get();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Getting started with Webspresso');
    });

    it('supports matchAllWords: false for OR matching', async () => {
      // 1 has Webspresso, 3 has React
      const results = await repo
        .search('Webspresso React', null, { matchAllWords: false })
        .get();
      expect(results).toHaveLength(3); // Articles 1, 3, and 4
    });

    it('supports exact phrase matching with quotes', async () => {
      const results = await repo.search('"Deep dive"').get();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Deep dive into Node.js ORM');
    });

    it('supports exact: true option', async () => {
      const results = await repo
        .search('zero dependency sprawl', null, { exact: true })
        .get();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Getting started with Webspresso');
    });

    it('allows overriding search columns dynamically', async () => {
      // Search only in title: 'framework' is in content of 1 and title of 3
      const titleOnly = await repo.search('framework', ['title']).get();
      expect(titleOnly).toHaveLength(0); // 'framework' is in title of none (3 has 'Frontend')

      // Search author
      const aliceArticles = await repo.search('Alice', ['author']).get();
      expect(aliceArticles).toHaveLength(2);
      expect(aliceArticles.every((a) => a.author === 'Alice')).toBe(true);
    });

    it('acts as safe no-op when term is empty, null or undefined', async () => {
      const all1 = await repo.search('').get();
      expect(all1).toHaveLength(4);

      const all2 = await repo.search('   ').get();
      expect(all2).toHaveLength(4);

      const all3 = await repo.search(null).get();
      expect(all3).toHaveLength(4);
    });

    it('chains seamlessly with where, orderBy, and pagination', async () => {
      const page = await repo
        .search('Webspresso')
        .where('status', 'published')
        .orderBy('id', 'desc')
        .paginate(1, 1);

      expect(page.total).toBe(2);
      expect(page.page).toBe(1);
      expect(page.perPage).toBe(1);
      expect(page.totalPages).toBe(2);
      expect(page.data).toHaveLength(1);
      expect(page.data[0].id).toBe(4); // DESC order: id 4 before id 1
    });

    it('supports orSearch to disjoin search clauses', async () => {
      const results = await repo
        .query()
        .where('author', 'Bob')
        .orSearch('React', ['title'])
        .get();

      // Bob's article (id 2) + React article (id 3)
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.id).sort();
      expect(ids).toEqual([2, 3]);
    });

    it('supports SQLite FTS5 with external virtual content table', async () => {
      // Create FTS5 virtual table indexing title and content
      await db.knex.raw(`
        CREATE VIRTUAL TABLE articles_fts USING fts5(
          title,
          content,
          content='articles',
          content_rowid='id'
        )
      `);
      // Populate FTS table
      await db.knex.raw(`
        INSERT INTO articles_fts(rowid, title, content)
        SELECT id, title, content FROM articles
      `);

      const ftsResults = await repo
        .search('Webspresso', null, { mode: 'fts', ftsTable: 'articles_fts' })
        .get();

      expect(ftsResults).toHaveLength(2);
      const titles = ftsResults.map((r) => r.title);
      expect(titles).toContain('Getting started with Webspresso');
      expect(titles).toContain('High Performance Webspresso Applications');
    });
  });
});
