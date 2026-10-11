import { describe, it, expect, vi } from 'vitest';
const knex = require('knex');
const {
  extractTableFromSql,
  detectNPlusOne,
  formatRequestLog,
  attachProfilerToKnex,
  createDevProfilerMiddleware,
  profilerStorage,
} = require('../../../src/dev/profiler');

describe('src/dev/profiler', () => {
  describe('extractTableFromSql', () => {
    it('extracts table names from various SELECT statements', () => {
      expect(extractTableFromSql('select * from "users"')).toBe('users');
      expect(extractTableFromSql('SELECT id, name FROM users WHERE id = 1')).toBe('users');
      expect(extractTableFromSql('SELECT * FROM "public"."posts"')).toBe('posts');
      expect(extractTableFromSql('SELECT * FROM `items`')).toBe('items');
      expect(extractTableFromSql('SELECT * FROM users AS u JOIN notes n ON u.id = n.user_id')).toBe('users');
    });

    it('extracts table names from INSERT, UPDATE, and DELETE statements', () => {
      expect(extractTableFromSql('insert into "comments" ("body") values (?)')).toBe('comments');
      expect(extractTableFromSql('INSERT INTO notes(title) VALUES(?)')).toBe('notes');
      expect(extractTableFromSql('update "posts" set "published" = ? where "id" = ?')).toBe('posts');
      expect(extractTableFromSql('delete from "sessions" where "id" = ?')).toBe('sessions');
      expect(extractTableFromSql('DELETE FROM tokens WHERE id = 1')).toBe('tokens');
    });

    it('returns null for empty, non-string, or unparseable queries', () => {
      expect(extractTableFromSql('')).toBeNull();
      expect(extractTableFromSql(null)).toBeNull();
      expect(extractTableFromSql(undefined)).toBeNull();
      expect(extractTableFromSql('PRAGMA foreign_keys = ON')).toBeNull();
    });
  });

  describe('detectNPlusOne', () => {
    it('returns empty array when query count is below threshold', () => {
      const queries = [
        { table: 'users', durationMs: 1 },
        { table: 'users', durationMs: 2 },
      ];
      expect(detectNPlusOne(queries, { threshold: 4 })).toEqual([]);
    });

    it('returns empty array when queries are spread across distinct tables', () => {
      const queries = [
        { table: 'users', durationMs: 1 },
        { table: 'posts', durationMs: 1 },
        { table: 'comments', durationMs: 1 },
        { table: 'tags', durationMs: 1 },
      ];
      expect(detectNPlusOne(queries, { threshold: 4 })).toEqual([]);
    });

    it('detects repeated queries on the same table and flags warning', () => {
      const queries = [
        { table: 'users', sql: 'SELECT * FROM users WHERE id = ?', durationMs: 2.1 },
        { table: 'users', sql: 'SELECT * FROM users WHERE id = ?', durationMs: 1.5 },
        { table: 'users', sql: 'SELECT * FROM users WHERE id = ?', durationMs: 1.8 },
        { table: 'users', sql: 'SELECT * FROM users WHERE id = ?', durationMs: 2.0 },
      ];

      const warnings = detectNPlusOne(queries, { threshold: 4 });
      expect(warnings).toHaveLength(1);
      expect(warnings[0].table).toBe('users');
      expect(warnings[0].count).toBe(4);
      expect(warnings[0].totalMs).toBe(7.4);
      expect(warnings[0].recommendation).toContain("Potential N+1 query pattern detected on table 'users'");
      expect(warnings[0].recommendation).toContain("repo.query().include('users')");
    });

    it('ignores internal system and migration tables', () => {
      const queries = [
        { table: 'sqlite_master', durationMs: 1 },
        { table: 'sqlite_master', durationMs: 1 },
        { table: 'sqlite_master', durationMs: 1 },
        { table: 'sqlite_master', durationMs: 1 },
        { table: 'knex_migrations', durationMs: 1 },
        { table: 'knex_migrations', durationMs: 1 },
        { table: 'knex_migrations', durationMs: 1 },
        { table: 'knex_migrations', durationMs: 1 },
      ];
      expect(detectNPlusOne(queries, { threshold: 4 })).toEqual([]);
    });
  });

  describe('formatRequestLog', () => {
    it('formats clean request log without DB queries', () => {
      const result = formatRequestLog({
        method: 'GET',
        url: '/about',
        status: 200,
        durationMs: 4.5,
        queries: [],
      });

      expect(result.plainLine).toBe('[GET 200] /about — 4.5ms');
      expect(result.queryLines).toHaveLength(0);
    });

    it('formats request log with DB query counts and total duration', () => {
      const result = formatRequestLog({
        method: 'POST',
        url: '/api/notes',
        status: 201,
        durationMs: 18.2,
        queries: [
          { table: 'notes', durationMs: 3.2, sql: 'INSERT INTO notes' },
          { table: 'users', durationMs: 1.4, sql: 'SELECT * FROM users' },
        ],
      });

      expect(result.plainLine).toContain('[POST 201] /api/notes — 18.2ms');
      expect(result.plainLine).toContain('2 DB queries (4.6ms)');
    });

    it('identifies and highlights slow queries', () => {
      const result = formatRequestLog({
        method: 'GET',
        url: '/reports',
        status: 200,
        durationMs: 120.0,
        slowQueryMs: 50,
        queries: [
          { table: 'logs', durationMs: 65.5, sql: 'SELECT * FROM logs' },
        ],
      });

      expect(result.plainLine).toContain('1 DB query (65.5ms ⚠️ 1 slow >50ms)');
    });

    it('emits indented query lines when verbose is true', () => {
      const result = formatRequestLog({
        method: 'GET',
        url: '/api/notes',
        status: 200,
        durationMs: 12.0,
        verbose: true,
        queries: [
          { table: 'notes', durationMs: 2.5, sql: 'SELECT * FROM notes WHERE id = ?' },
          { table: 'users', durationMs: 1.2, sql: 'SELECT * FROM users WHERE id = ?' },
        ],
      });

      expect(result.queryLines).toHaveLength(2);
      expect(result.queryLines[0]).toContain('SELECT * FROM notes WHERE id = ?');
      expect(result.queryLines[1]).toContain('SELECT * FROM users WHERE id = ?');
    });
  });

  describe('createDevProfilerMiddleware & attachProfilerToKnex', () => {
    it('captures database queries and logs request summary during HTTP cycle', async () => {
      const dbKnex = knex({
        client: 'better-sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
      });

      await dbKnex.schema.createTable('demo_notes', (t) => {
        t.increments('id');
        t.string('title');
      });

      const logs = [];
      const warns = [];
      const mockLogger = {
        log: (msg) => logs.push(msg),
        warn: (msg) => warns.push(msg),
      };

      const middleware = createDevProfilerMiddleware({
        db: { knex: dbKnex },
        logger: mockLogger,
        thresholdNPlusOne: 3,
        slowQueryMs: 50,
      });

      const finishCallbacks = [];
      const req = {
        method: 'GET',
        originalUrl: '/api/test-notes',
        headers: {},
      };
      const res = {
        statusCode: 200,
        on: (evt, cb) => {
          if (evt === 'finish') finishCallbacks.push(cb);
        },
      };

      await new Promise((resolve) => {
        middleware(req, res, async () => {
          // Execute queries inside the request profiler storage context
          await dbKnex('demo_notes').insert({ title: 'First note' });
          await dbKnex('demo_notes').select('*');
          await dbKnex('demo_notes').select('*').where({ id: 1 });
          await dbKnex('demo_notes').select('*').where({ id: 2 }); // 4th query on demo_notes!

          // Simulate res.on('finish')
          for (const cb of finishCallbacks) cb();
          resolve();
        });
      });

      await dbKnex.destroy();

      // Check request summary log
      expect(logs.length).toBeGreaterThanOrEqual(1);
      const mainLog = logs[0];
      expect(mainLog).toContain('/api/test-notes');
      expect(mainLog).toContain('4 DB queries');

      // Check N+1 warning log (4 queries on demo_notes >= threshold 3)
      expect(warns.length).toBeGreaterThanOrEqual(1);
      expect(warns[0]).toContain("Potential N+1 query pattern detected on table 'demo_notes'");
    });
  });
});
