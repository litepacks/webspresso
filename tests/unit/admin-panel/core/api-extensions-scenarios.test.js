/**
 * Scenarios and Edge Cases for Admin Panel API Extensions
 * (plugins/admin-panel/core/api-extensions.js)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineModel, clearRegistry } from '../../../../core/orm/model.js';
import { createDatabase, zdb } from '../../../../core/orm/index.js';
import {
  buildFilteredQuery,
  getAllMatchingIds,
  coerceBulkTemporalValue,
  compareSemver,
  formatUptime,
  formatBytes,
  createExtensionApiHandlers,
} from '../../../../plugins/admin-panel/core/api-extensions.js';
import { createMockRes } from '../../../utils';

describe.sequential('Admin Panel API Extensions Scenarios', () => {
  let db;
  let knex;
  let repo;
  let model;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    await knex.schema.createTable('tasks', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.string('priority').defaultTo('medium');
      table.string('status').defaultTo('todo');
      table.boolean('is_active').defaultTo(true);
      table.integer('score').defaultTo(10);
      table.string('due_date').nullable();
      table.timestamp('deleted_at').nullable();
    });

    model = defineModel({
      name: 'Task',
      table: 'tasks',
      schema: zdb.schema({
        id: zdb.id(),
        title: zdb.string(),
        priority: zdb.string({ default: 'medium' }),
        status: zdb.enum(['todo', 'in_progress', 'done']),
        is_active: zdb.boolean({ default: true }),
        score: zdb.integer({ default: 10 }),
        due_date: zdb.string({ nullable: true }),
        deleted_at: zdb.date({ nullable: true }),
      }),
      scopes: {
        softDelete: true,
      },
      admin: {
        enabled: true,
        displayName: 'Tasks',
      },
    });
    db.registerModel(model);

    repo = db.getRepository('Task');

    await repo.create({ title: 'Alpha task', priority: 'high', status: 'todo', score: 95, due_date: '2026-10-01' });
    await repo.create({ title: 'Beta feature', priority: 'medium', status: 'in_progress', score: 50, due_date: '2026-10-15' });
    await repo.create({ title: 'Gamma fix', priority: 'low', status: 'done', score: 20, due_date: null });
    const toDelete = await repo.create({ title: 'Trashed task', priority: 'low', status: 'todo', score: 5 });
    await repo.delete(toDelete.id);
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  describe('Utility Functions: compareSemver, formatUptime, formatBytes', () => {
    it('compares semver strings correctly', () => {
      expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
      expect(compareSemver('2.3.4', '2.3.4')).toBe(0);
      expect(compareSemver('v1.5.0', '1.4.0')).toBe(1);
      expect(compareSemver(null, '1.0.0')).toBe(0);
    });

    it('formats uptime into readable duration parts', () => {
      expect(formatUptime(45)).toBe('45s');
      expect(formatUptime(125)).toBe('2m 5s');
      expect(formatUptime(3665)).toBe('1h 1m 5s');
      expect(formatUptime(90061)).toBe('1d 1h 1m 1s');
      expect(formatUptime(0)).toBe('0s');
    });

    it('formats bytes into megabytes with fallback', () => {
      expect(formatBytes(0)).toBe('0 MB');
      expect(formatBytes(null)).toBe('0 MB');
      expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
    });
  });

  describe('coerceBulkTemporalValue', () => {
    it('handles empty and nullable fields properly', () => {
      expect(coerceBulkTemporalValue({ nullable: true }, '', 'due_date')).toEqual({ value: null });
      expect(coerceBulkTemporalValue({ nullable: true }, null, 'due_date')).toEqual({ value: null });
      expect(coerceBulkTemporalValue({ nullable: false }, '', 'due_date')).toEqual({
        error: 'Field "due_date" requires a value',
      });
    });

    it('validates and coerces date type (YYYY-MM-DD)', () => {
      const res = coerceBulkTemporalValue({ type: 'date', nullable: false }, '2026-12-25', 'due_date');
      expect(res.value instanceof Date).toBe(true);
      expect(res.value.toISOString()).toContain('2026-12-25');

      const invalid = coerceBulkTemporalValue({ type: 'date' }, 'not-a-date', 'due_date');
      expect(invalid.error).toContain('Date must be YYYY-MM-DD');
    });

    it('validates and coerces datetime/timestamp types', () => {
      const res1 = coerceBulkTemporalValue({ type: 'datetime' }, '2026-06-15T10:30', 'event_at');
      expect(res1.value instanceof Date).toBe(true);

      const res2 = coerceBulkTemporalValue({ type: 'timestamp' }, '2026-06-15', 'event_at');
      expect(res2.value instanceof Date).toBe(true);

      const nonString = coerceBulkTemporalValue({ type: 'datetime' }, 123456, 'event_at');
      expect(nonString.error).toContain('Invalid datetime value');
    });
  });

  describe('buildFilteredQuery & getAllMatchingIds', () => {
    it('applies is_null and is_not_null operators', async () => {
      const queryNull = buildFilteredQuery(repo, {
        due_date: { op: 'is_null' },
      });
      const nullResults = await queryNull.find();
      expect(nullResults.length).toBe(1);
      expect(nullResults[0].title).toBe('Gamma fix');

      const queryNotNull = buildFilteredQuery(repo, {
        due_date: { op: 'is_not_null' },
      });
      const notNullResults = await queryNotNull.find();
      expect(notNullResults.length).toBe(2);
    });

    it('applies contains, starts_with, and ends_with operators', async () => {
      const containsQ = buildFilteredQuery(repo, {
        title: { op: 'contains', value: 'pha' },
      });
      const containsRes = await containsQ.find();
      expect(containsRes[0].title).toBe('Alpha task');

      const startsQ = buildFilteredQuery(repo, {
        title: { op: 'starts_with', value: 'Beta' },
      });
      const startsRes = await startsQ.find();
      expect(startsRes[0].title).toBe('Beta feature');

      const endsQ = buildFilteredQuery(repo, {
        title: { op: 'ends_with', value: 'fix' },
      });
      const endsRes = await endsQ.find();
      expect(endsRes[0].title).toBe('Gamma fix');
    });

    it('applies numeric comparisons: gt, gte, lt, lte, between, in', async () => {
      const gtQ = buildFilteredQuery(repo, { score: { op: 'gt', value: 80 } });
      const gtRes = await gtQ.find();
      expect(gtRes.length).toBe(1);
      expect(gtRes[0].score).toBe(95);

      const betweenQ = buildFilteredQuery(repo, { score: { op: 'between', from: 20, to: 60 } });
      const betweenRes = await betweenQ.find();
      expect(betweenRes.length).toBe(2);

      const inQ = buildFilteredQuery(repo, { priority: { op: 'in', value: ['high', 'low'] } });
      const inRes = await inQ.find();
      expect(inRes.length).toBe(2);
    });

    it('retrieves IDs matching filters including soft-deleted scope', async () => {
      const ids = await getAllMatchingIds(repo, { priority: { op: 'equals', value: 'low' } }, 'id', {
        onlyTrashed: true,
      });
      expect(ids.length).toBe(1);

      const trashed = await repo.query().onlyTrashed().where('id', ids[0]).first();
      expect(trashed.title).toBe('Trashed task');
    });
  });

  describe('createExtensionApiHandlers: bulkUpdateFieldHandler & systemInfoHandler', () => {
    let handlers;
    let registry;

    beforeAll(() => {
      registry = {
        widgets: new Map(),
        actions: new Map(),
        bulkActions: new Map(),
        settings: { theme: 'dark' },
        getWidget(id) { return this.widgets.get(id); },
        getAction(id) { return this.actions.get(id); },
        getBulkAction(id) { return this.bulkActions.get(id); },
      };

      handlers = createExtensionApiHandlers({
        db,
        registry,
      });
    });

    it('bulkUpdateFieldHandler updates enum or boolean field across selected IDs', async () => {
      const [id1] = await knex('tasks').insert({ title: 'Bulk Item 1', priority: 'medium', status: 'todo' });
      const [id2] = await knex('tasks').insert({ title: 'Bulk Item 2', priority: 'medium', status: 'todo' });

      const res = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        {
          params: { model: 'Task' },
          body: {
            field: 'status',
            value: 'done',
            ids: [id1, id2],
          },
        },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.affected).toBe(2);

      const check1 = await knex('tasks').where('id', id1).first();
      expect(check1.status).toBe('done');
    });

    it('returns 400 when field or ids are missing in bulkUpdateFieldHandler', async () => {
      const res1 = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        {
          params: { model: 'Task' },
          body: { field: '', ids: [] },
        },
        res1
      );
      expect(res1.statusCode).toBe(400);
      expect(res1.data.error).toBe('Field name is required');

      const res2 = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        {
          params: { model: 'Task' },
          body: { field: 'status', value: 'done', ids: [] },
        },
        res2
      );
      expect(res2.statusCode).toBe(400);
      expect(res2.data.error).toBe('No records selected');
    });

    it('returns 400 when attempting to bulk update non-bulk-updatable field', async () => {
      const res = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        {
          params: { model: 'Task' },
          body: { field: 'title', value: 'New title', ids: [1] },
        },
        res
      );
      expect(res.statusCode).toBe(400);
      expect(res.data.error).toContain('is not bulk-updatable');
    });

    it('systemInfoHandler returns OS memory, node version and uptime metrics', async () => {
      const res = createMockRes();
      await handlers.systemInfoHandler({}, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.nodeVersion).toBe(process.version);
      expect(res.data.platform).toBeDefined();
      expect(res.data.webspressoVersion).toBeDefined();
    });

    it('settingsGetHandler and settingsUpdateHandler manage registry settings', () => {
      const getRes = createMockRes();
      handlers.settingsGetHandler({}, getRes);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.data.settings.theme).toBe('dark');

      const updateRes = createMockRes();
      handlers.settingsUpdateHandler({ body: { theme: 'light', brandColor: '#ff5500' } }, updateRes);
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.data.success).toBe(true);
      expect(registry.settings.theme).toBe('light');
      expect(registry.settings.brandColor).toBe('#ff5500');
    });
  });
});
