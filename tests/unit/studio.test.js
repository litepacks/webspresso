'use strict';

/**
 * Unit Tests for Webspresso DB Studio Subsystem (core/studio)
 * Tests:
 * 1. Inspector: schema metadata, table listing, paginated query, CRUD, and raw SQL execution
 * 2. Studio Express HTTP Server & REST API endpoints
 * 3. startStudio lifecycle (listen & close)
 * 4. CLI command registration (db:studio)
 */

const { program } = require('commander');
const {
  createDatabase,
  startStudio,
  createStudioApp,
} = require('../../index');
const {
  listTables,
  getTableSchema,
  getTableRows,
  insertRow,
  updateRow,
  deleteRow,
  executeRawQuery,
  getTelemetrySnapshot,
} = require('../../core/studio');
const { registerCommand: registerStudioCommand } = require('../../bin/commands/db-studio');

describe('Webspresso DB Studio (core/studio)', () => {
  let db;
  let knex;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: false,
    });
    knex = db.knex;

    // Create test schema
    await knex.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('email').notNullable().unique();
      t.string('name').nullable();
      t.integer('age').defaultTo(18);
    });

    await knex.schema.createTable('posts', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.string('title').notNullable();
    });
  });

  beforeEach(async () => {
    await knex('posts').delete();
    await knex('users').delete();

    // Seed test records with explicit IDs
    await knex('users').insert([
      { id: 1, email: 'alice@example.com', name: 'Alice Smith', age: 25 },
      { id: 2, email: 'bob@example.com', name: 'Bob Jones', age: 30 },
      { id: 3, email: 'carol@example.com', name: 'Carol White', age: 35 },
    ]);

    await knex('posts').insert([
      { id: 1, user_id: 1, title: 'First Post' },
      { id: 2, user_id: 1, title: 'Second Post' },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('Inspector Utilities', () => {
    it('lists tables with correct row counts', async () => {
      const tables = await listTables(knex);
      const userTable = tables.find((t) => t.name === 'users');
      const postTable = tables.find((t) => t.name === 'posts');

      expect(userTable).toBeDefined();
      expect(userTable.count).toBe(3);
      expect(postTable).toBeDefined();
      expect(postTable.count).toBe(2);
    });

    it('extracts table schema columns with types and primary keys', async () => {
      const schema = await getTableSchema(knex, 'users');
      const idCol = schema.find((c) => c.name === 'id');
      const emailCol = schema.find((c) => c.name === 'email');
      const ageCol = schema.find((c) => c.name === 'age');

      expect(idCol.isPrimaryKey).toBe(true);
      expect(emailCol.nullable).toBe(false);
      expect(ageCol.type).toContain('int');
    });

    it('fetches paginated rows with sorting and text search', async () => {
      // 1. Pagination
      const page1 = await getTableRows(knex, 'users', { page: 1, limit: 2, sort: 'id', order: 'asc' });
      expect(page1.rows.length).toBe(2);
      expect(page1.total).toBe(3);
      expect(page1.totalPages).toBe(2);
      expect(page1.rows[0].email).toBe('alice@example.com');

      // 2. Search
      const searchRes = await getTableRows(knex, 'users', { search: 'Smith' });
      expect(searchRes.rows.length).toBe(1);
      expect(searchRes.rows[0].name).toBe('Alice Smith');
    });

    it('performs insert, update, and delete row operations', async () => {
      // Insert
      const insRes = await insertRow(knex, 'users', { email: 'dave@example.com', name: 'Dave' });
      expect(insRes.success).toBe(true);

      const countAfterIns = await knex('users').count({ c: '*' });
      expect(Number(countAfterIns[0].c)).toBe(4);

      // Update
      const upRes = await updateRow(knex, 'users', 1, { name: 'Alice Updated' }, 'id');
      expect(upRes.success).toBe(true);
      const updatedUser = await knex('users').where('id', 1).first();
      expect(updatedUser.name).toBe('Alice Updated');

      // Delete
      const delRes = await deleteRow(knex, 'users', 1, 'id');
      expect(delRes.success).toBe(true);
      const remainingUser = await knex('users').where('id', 1).first();
      expect(remainingUser).toBeUndefined();
    });

    it('executes arbitrary raw SQL query and reports execution time', async () => {
      const result = await executeRawQuery(knex, 'SELECT email, age FROM users WHERE age > ?', [26]);
      expect(result.rows.length).toBe(2);
      expect(typeof result.durationMs).toBe('number');
      expect(result.rows[0].email).toBe('bob@example.com');
    });
  });

  describe('Studio HTTP Server & REST APIs', () => {
    it('serves HTML UI and handles RESTful table mutations', async () => {
      const studio = await startStudio({
        knex,
        port: 0,
        host: '127.0.0.1',
        silent: true,
      });

      const { url } = studio;

      try {
        // 1. GET /_studio UI HTML
        const uiRes = await fetch(`${url}/_studio`);
        expect(uiRes.status).toBe(200);
        expect(uiRes.headers.get('content-type')).toContain('text/html');
        const html = await uiRes.text();
        expect(html).toContain('Webspresso DB Studio');

        // 2. GET /_studio/api/tables
        const tablesRes = await fetch(`${url}/_studio/api/tables`);
        expect(tablesRes.status).toBe(200);
        const tables = await tablesRes.json();
        expect(tables.some((t) => t.name === 'users')).toBe(true);

        // 3. GET /_studio/api/tables/users/schema
        const schemaRes = await fetch(`${url}/_studio/api/tables/users/schema`);
        const schema = await schemaRes.json();
        expect(schema.some((c) => c.name === 'email')).toBe(true);

        // 4. POST /_studio/api/tables/users/rows (Insert)
        const postRes = await fetch(`${url}/_studio/api/tables/users/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'eve@example.com', name: 'Eve', age: 29 }),
        });
        expect(postRes.status).toBe(201);

        // 5. PUT /_studio/api/tables/users/rows/2 (Update)
        const putRes = await fetch(`${url}/_studio/api/tables/users/rows/2`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Robert Jones' }),
        });
        expect(putRes.status).toBe(200);
        const bob = await knex('users').where('id', 2).first();
        expect(bob.name).toBe('Robert Jones');

        // 6. DELETE /_studio/api/tables/users/rows/3 (Delete)
        const delRes = await fetch(`${url}/_studio/api/tables/users/rows/3`, {
          method: 'DELETE',
        });
        expect(delRes.status).toBe(200);
        const carol = await knex('users').where('id', 3).first();
        expect(carol).toBeUndefined();

        // 7. POST /_studio/api/query (SQL Runner)
        const queryRes = await fetch(`${url}/_studio/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: 'SELECT COUNT(*) as total FROM users' }),
        });
        expect(queryRes.status).toBe(200);
        const queryData = await queryRes.json();
        expect(queryData.rows[0].total).toBe(3); // 3 original + 1 added - 1 deleted
      } finally {
        await studio.close();
      }
    });
  });

  describe('Live Telemetry & Metrics Subsystem', () => {
    it('collects memory, database pool, and circuit breaker metrics', async () => {
      const { circuitBreakerRegistry } = require('../../core/resilience');
      const breaker = circuitBreakerRegistry.getBreaker('test-payment-service');
      breaker.recordSuccess();

      const snapshot = await getTelemetrySnapshot(knex);
      expect(snapshot).toBeDefined();
      expect(snapshot.memory).toBeDefined();
      expect(typeof snapshot.memory.heapUsedMb).toBe('number');
      expect(snapshot.pool).toBeDefined();
      expect(snapshot.breakers.some((b) => b.name === 'test-payment-service')).toBe(true);
    });

    it('exposes /_studio/api/telemetry and /_studio/api/live SSE stream', async () => {
      const studio = await startStudio({
        knex,
        port: 0,
        host: '127.0.0.1',
        silent: true,
      });

      try {
        const { url } = studio;

        // 1. GET /_studio/api/telemetry
        const telRes = await fetch(`${url}/_studio/api/telemetry`);
        expect(telRes.status).toBe(200);
        const data = await telRes.json();
        expect(data.memory).toBeDefined();
        expect(data.pool).toBeDefined();

        // 2. GET /_studio/api/live (SSE stream)
        const controller = new AbortController();
        const liveRes = await fetch(`${url}/_studio/api/live`, {
          signal: controller.signal,
        });
        expect(liveRes.status).toBe(200);
        expect(liveRes.headers.get('content-type')).toContain('text/event-stream');
        controller.abort();

        // 3. Reset circuit breaker via POST /_studio/api/breakers/:name/reset
        const { circuitBreakerRegistry } = require('../../core/resilience');
        circuitBreakerRegistry.getBreaker('test-breaker');
        const resetRes = await fetch(`${url}/_studio/api/breakers/test-breaker/reset`, {
          method: 'POST',
        });
        expect(resetRes.status).toBe(200);
        const resetJson = await resetRes.json();
        expect(resetJson.success).toBe(true);
        expect(resetJson.state).toBe('CLOSED');

        // 4. Reset non-existent breaker returns 404
        const notFoundRes = await fetch(`${url}/_studio/api/breakers/non-existent-breaker/reset`, {
          method: 'POST',
        });
        expect(notFoundRes.status).toBe(404);
        const notFoundJson = await notFoundRes.json();
        expect(notFoundJson.error).toContain('not found');

        // 5. Queue action without queue returns 400
        const noQueueRes = await fetch(`${url}/_studio/api/queue/pause`, {
          method: 'POST',
        });
        expect(noQueueRes.status).toBe(400);
        const noQueueJson = await noQueueRes.json();
        expect(noQueueJson.error).toContain('not configured');
      } finally {
        await studio.close();
      }
    });

    it('interactively trips a circuit breaker and verifies recovery via Studio', async () => {
      const { circuitBreakerRegistry } = require('../../core/resilience');
      const breaker = circuitBreakerRegistry.getBreaker('studio-trip-test', {
        failureThreshold: 2,
        resetTimeout: 60000,
      });

      // Cause 2 consecutive failures to trip breaker to OPEN
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');

      const studio = await startStudio({
        knex,
        port: 0,
        host: '127.0.0.1',
        silent: true,
      });

      try {
        const { url } = studio;

        // 1. Verify telemetry reports breaker as OPEN
        const telRes = await fetch(`${url}/_studio/api/telemetry`);
        const telData = await telRes.json();
        const found = telData.breakers.find((b) => b.name === 'studio-trip-test');
        expect(found).toBeDefined();
        expect(found.state).toBe('OPEN');
        expect(found.failures).toBe(2);

        // 2. Reset breaker via Studio API
        const resetRes = await fetch(`${url}/_studio/api/breakers/studio-trip-test/reset`, {
          method: 'POST',
        });
        expect(resetRes.status).toBe(200);
        const resetData = await resetRes.json();
        expect(resetData.state).toBe('CLOSED');
        expect(breaker.getState()).toBe('CLOSED');

        // 3. Verify telemetry now reflects CLOSED state
        const telResAfter = await fetch(`${url}/_studio/api/telemetry`);
        const telDataAfter = await telResAfter.json();
        const foundAfter = telDataAfter.breakers.find((b) => b.name === 'studio-trip-test');
        expect(foundAfter.state).toBe('CLOSED');
      } finally {
        await studio.close();
      }
    });

    it('controls background job queue through Studio API (pause and resume)', async () => {
      const { QueueManager } = require('../../core/queue');
      const queue = new QueueManager({ autoStart: false, concurrency: 3 });

      const studio = await startStudio({
        knex,
        queue,
        port: 0,
        host: '127.0.0.1',
        silent: true,
      });

      try {
        const { url } = studio;

        // 1. Verify initial queue telemetry
        const telRes = await fetch(`${url}/_studio/api/telemetry`);
        const telData = await telRes.json();
        expect(telData.queue.enabled).toBe(true);
        expect(telData.queue.concurrency).toBe(3);
        expect(telData.queue.isPaused).toBe(false);

        // 2. Pause queue
        const pauseRes = await fetch(`${url}/_studio/api/queue/pause`, { method: 'POST' });
        expect(pauseRes.status).toBe(200);
        const pauseData = await pauseRes.json();
        expect(pauseData.isPaused).toBe(true);
        expect(queue.isPaused).toBe(true);

        // 3. Resume queue
        const resumeRes = await fetch(`${url}/_studio/api/queue/resume`, { method: 'POST' });
        expect(resumeRes.status).toBe(200);
        const resumeData = await resumeRes.json();
        expect(resumeData.isPaused).toBe(false);
        expect(queue.isPaused).toBe(false);

        // 4. Invalid action returns 400
        const invalidRes = await fetch(`${url}/_studio/api/queue/invalid_action`, { method: 'POST' });
        expect(invalidRes.status).toBe(400);
      } finally {
        await studio.close();
      }
    });
  });

  describe('CLI db:studio command registration', () => {
    it('registers db:studio and studio alias on commander', () => {
      const testProg = new program.Command();
      registerStudioCommand(testProg);

      const studioCmd = testProg.commands.find((c) => c.name() === 'db:studio');
      expect(studioCmd).toBeDefined();
      expect(studioCmd.alias()).toBe('studio');
      expect(studioCmd.description()).toContain('database browser');

      const optionFlags = studioCmd.options.map((o) => o.flags);
      expect(optionFlags.some((f) => f.includes('--port'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--host'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--env'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--config'))).toBe(true);
      expect(optionFlags.some((f) => f.includes('--open'))).toBe(true);
    });
  });
});
