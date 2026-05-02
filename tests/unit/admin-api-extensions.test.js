/**
 * Admin panel extension API — query builder and HTTP handlers (mocked db)
 */
const {
  createExtensionApiHandlers,
  buildFilteredQuery,
  getAllMatchingIds,
  coerceBulkTemporalValue,
} = require('../../plugins/admin-panel/core/api-extensions');
const { AdminRegistry } = require('../../plugins/admin-panel/core/registry');

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(o) {
      this.payload = o;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

function createQueryChain(listResult) {
  const calls = [];
  const chain = {
    _calls: calls,
    onlyTrashed() {
      calls.push('onlyTrashed');
      return chain;
    },
    where(col, op, val) {
      calls.push(['where', col, op, val]);
      return chain;
    },
    whereNull(col) {
      calls.push(['whereNull', col]);
      return chain;
    },
    whereNotNull(col) {
      calls.push(['whereNotNull', col]);
      return chain;
    },
    whereIn(col, vals) {
      calls.push(['whereIn', col, vals]);
      return chain;
    },
    select(...cols) {
      calls.push(['select', cols]);
      return chain;
    },
    list: async () => listResult,
  };
  return chain;
}

describe('admin api-extensions', () => {
  describe('buildFilteredQuery', () => {
    it('returns base query when filters empty', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      const out = buildFilteredQuery(repo, {});
      expect(out).toBe(q);
    });

    it('applies onlyTrashed when option set', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, {}, { onlyTrashed: true });
      expect(q._calls).toContain('onlyTrashed');
    });

    it('covers string operators', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      const filters = {
        a: { op: 'contains', value: 'x' },
        b: { op: 'equals', value: 'y' },
        c: { op: 'starts_with', value: 'z' },
        d: { op: 'ends_with', value: 'w' },
      };
      buildFilteredQuery(repo, filters);
      expect(q._calls.some((c) => c[0] === 'where' && c[2] === 'like' && c[3] === '%x%')).toBe(true);
      expect(q._calls.some((c) => c[0] === 'where' && c[1] === 'b' && c[2] === '=')).toBe(true);
      expect(q._calls.some((c) => c[3] === 'z%')).toBe(true);
      expect(q._calls.some((c) => c[3] === '%w')).toBe(true);
    });

    it('uses filter.operator when op missing', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, { n: { operator: 'equals', value: 1 } });
      expect(q._calls.some((c) => c[0] === 'where' && c[1] === 'n' && c[3] === 1)).toBe(true);
    });

    it('covers numeric comparison ops', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, {
        x: { op: 'gt', value: 1 },
        y: { op: 'gte', value: 2 },
        z: { op: 'lt', value: 3 },
        w: { op: 'lte', value: 4 },
      });
      expect(q._calls.filter((c) => c[0] === 'where').length).toBeGreaterThanOrEqual(4);
    });

    it('applies between and in', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, {
        d: { op: 'between', from: 'a', to: 'b' },
        e: { op: 'in', value: [1, 2] },
      });
      expect(q._calls.some((c) => c[0] === 'whereIn')).toBe(true);
    });

    it('skips empty in array', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, { e: { op: 'in', value: [] } });
      expect(q._calls.some((c) => c[0] === 'whereIn')).toBe(false);
    });

    it('applies whereNull / whereNotNull for is_null and is_not_null', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, {
        a: { op: 'is_null' },
        b: { op: 'is_not_null' },
      });
      expect(q._calls.some((c) => c[0] === 'whereNull' && c[1] === 'a')).toBe(true);
      expect(q._calls.some((c) => c[0] === 'whereNotNull' && c[1] === 'b')).toBe(true);
    });

    it('skips inactive filter rows', () => {
      const q = createQueryChain([]);
      const repo = { query: () => q };
      buildFilteredQuery(repo, {
        empty: { op: 'equals', value: '' },
        nil: null,
      });
      expect(q._calls.length).toBe(0);
    });
  });

  describe('getAllMatchingIds', () => {
    it('maps primary key from list()', async () => {
      const q = createQueryChain([{ pk: 10 }, { pk: 20 }]);
      const repo = { query: () => q };
      const ids = await getAllMatchingIds(repo, {}, 'pk');
      expect(ids).toEqual([10, 20]);
    });
  });

  describe('createExtensionApiHandlers', () => {
    let registry;
    let db;

    beforeEach(() => {
      registry = new AdminRegistry();
      db = {
        knex: {
          schema: {
            hasTable: async () => false,
          },
        },
      };
    });

    it('configHandler returns toClientConfig', () => {
      const handlers = createExtensionApiHandlers({ registry, db });
      const res = createMockRes();
      handlers.configHandler({}, res);
      expect(res.payload.settings).toBeDefined();
      expect(res.payload.pages).toEqual([]);
    });

    it('settingsGetHandler and settingsUpdateHandler', () => {
      registry.settings.title = 'T1';
      const handlers = createExtensionApiHandlers({ registry, db });
      const res1 = createMockRes();
      handlers.settingsGetHandler({}, res1);
      expect(res1.payload.settings.title).toBe('T1');

      const res2 = createMockRes();
      handlers.settingsUpdateHandler({ body: { title: 'T2', autoRefreshMs: 0 } }, res2);
      expect(res2.payload.success).toBe(true);
      expect(registry.settings.title).toBe('T2');
      expect(registry.settings.autoRefreshMs).toBe(0);
    });

    it('widgetDataHandler 404, no loader, and success', async () => {
      const handlers = createExtensionApiHandlers({ registry, db });

      const r404 = createMockRes();
      await handlers.widgetDataHandler({ params: { widgetId: 'missing' } }, r404);
      expect(r404.statusCode).toBe(404);

      registry.registerWidget('plain', { title: 'P' });
      const rNull = createMockRes();
      await handlers.widgetDataHandler({ params: { widgetId: 'plain' } }, rNull);
      expect(rNull.payload.data).toBeNull();

      registry.registerWidget('data', {
        title: 'D',
        dataLoader: async ({ db: d }) => ({ n: d === db ? 1 : 0 }),
      });
      const rOk = createMockRes();
      await handlers.widgetDataHandler({ params: { widgetId: 'data' }, session: {} }, rOk);
      expect(rOk.payload.data).toEqual({ n: 1 });
    });

    it('activityLogHandler returns empty when table missing', async () => {
      const handlers = createExtensionApiHandlers({ registry, db });
      const res = createMockRes();
      await handlers.activityLogHandler({ query: {} }, res);
      expect(res.payload.data).toEqual([]);
      expect(res.payload.pagination.total).toBe(0);
    });

    it('actionHandler 404 action, 404 record, success', async () => {
      registry.registerAction('act', {
        label: 'A',
        models: 'M',
        handler: async (rec) => ({ echoed: rec.id }),
      });
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getRepository: () => ({
            findById: async (id) => (String(id) === '7' ? { id: 7, name: 'x' } : null),
          }),
        },
      });

      const r1 = createMockRes();
      await handlers.actionHandler(
        { params: { actionId: 'nope', model: 'M', id: '7' }, session: {}, body: {} },
        r1,
      );
      expect(r1.statusCode).toBe(404);

      const r2 = createMockRes();
      await handlers.actionHandler(
        { params: { actionId: 'act', model: 'Other', id: '7' }, session: {}, body: {} },
        r2,
      );
      expect(r2.statusCode).toBe(403);

      const r3 = createMockRes();
      await handlers.actionHandler(
        { params: { actionId: 'act', model: 'M', id: '99' }, session: {}, body: {} },
        r3,
      );
      expect(r3.statusCode).toBe(404);

      const r4 = createMockRes();
      await handlers.actionHandler(
        { params: { actionId: 'act', model: 'M', id: '7' }, session: {}, body: {} },
        r4,
      );
      expect(r4.payload.success).toBe(true);
      expect(r4.payload.result).toEqual({ echoed: 7 });
    });

    it('bulkActionHandler 404 and 400 paths', async () => {
      registry.registerBulkAction('b', { label: 'B', handler: async () => ({}) });
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getModel: () => ({ primaryKey: 'id', scopes: {} }),
          getRepository: () => ({}),
        },
      });

      const r1 = createMockRes();
      await handlers.bulkActionHandler(
        { params: { actionId: 'x', model: 'M' }, body: { ids: [1] } },
        r1,
      );
      expect(r1.statusCode).toBe(404);

      const r2 = createMockRes();
      await handlers.bulkActionHandler(
        { params: { actionId: 'b', model: 'M' }, body: { ids: [] } },
        r2,
      );
      expect(r2.statusCode).toBe(400);
    });

    it('bulkFieldsHandler returns enum and boolean fields', () => {
      const model = {
        name: 'X',
        admin: { enabled: true },
        hidden: [],
        columns: new Map([
          ['status', { type: 'string', enumValues: ['draft', 'live'], label: 'Status' }],
          ['active', { type: 'boolean', label: 'Active' }],
          ['name', { type: 'string', label: 'Name' }],
        ]),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getModel: () => model,
        },
      });
      const res = createMockRes();
      handlers.bulkFieldsHandler({ params: { model: 'X' } }, res);
      expect(res.payload.fields.length).toBe(2);
      expect(res.payload.fields.find((f) => f.name === 'status').type).toBe('enum');
      expect(res.payload.fields.find((f) => f.name === 'active').type).toBe('boolean');
    });

    it('bulkFieldsHandler includes date fields and excludes auto timestamps', () => {
      const model = {
        name: 'D',
        admin: { enabled: true },
        hidden: ['secret'],
        columns: new Map([
          ['secret', { type: 'date', nullable: true }],
          ['on_day', { type: 'date', nullable: false, label: 'On day' }],
          ['starts_at', { type: 'datetime', nullable: true }],
          ['created_at', { type: 'timestamp', nullable: false, auto: 'create' }],
        ]),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: { ...db, getModel: () => model },
      });
      const res = createMockRes();
      handlers.bulkFieldsHandler({ params: { model: 'D' } }, res);
      const names = res.payload.fields.map((f) => f.name).sort();
      expect(names).toEqual(['on_day', 'starts_at']);
      expect(res.payload.fields.find((f) => f.name === 'on_day').nullable).toBe(false);
      expect(res.payload.fields.find((f) => f.name === 'starts_at').type).toBe('datetime');
    });

    it('bulkFieldsHandler 404 when model missing', () => {
      const handlers = createExtensionApiHandlers({
        registry,
        db: { ...db, getModel: () => null },
      });
      const res = createMockRes();
      handlers.bulkFieldsHandler({ params: { model: 'Z' } }, res);
      expect(res.statusCode).toBe(404);
    });

    it('dashboardStatsHandler aggregates enabled models', async () => {
      const model = {
        name: 'StatModel',
        table: 'stat_models',
        admin: { enabled: true, label: 'S' },
        columns: new Map(),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getAllModels: () => [model],
          getRepository: () => ({
            count: async () => 5,
            query: () => ({
              orderBy: () => ({ first: async () => null }),
            }),
          }),
        },
      });
      const res = createMockRes();
      await handlers.dashboardStatsHandler({}, res);
      expect(res.payload.stats.StatModel.count).toBe(5);
      expect(res.payload.stats.StatModel.label).toBe('S');
    });

    it('exportHandler requires model and exports json', async () => {
      const model = {
        name: 'E',
        admin: { enabled: true },
        hidden: [],
        columns: new Map([['id', {}], ['name', {}]]),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getModel: () => model,
          getRepository: () => ({
            findAll: async () => [{ id: 1, name: 'a,b' }],
            findById: async () => null,
          }),
        },
      });

      const r0 = createMockRes();
      await handlers.exportHandler({ params: {}, query: {} }, r0);
      expect(r0.statusCode).toBe(400);

      const r1 = createMockRes();
      await handlers.exportHandler({ params: { model: 'E' }, query: { format: 'json' } }, r1);
      expect(r1.payload.data).toHaveLength(1);
      expect(r1.payload.model).toBe('E');

      const r2 = createMockRes();
      await handlers.exportHandler(
        {
          params: { model: 'E' },
          query: { format: 'csv' },
        },
        r2,
      );
      expect(r2.headers['Content-Type']).toBe('text/csv');
      expect(String(r2.payload.data)).toContain('name');
      expect(String(r2.payload.data)).toContain('"a,b"');
    });

    it('bulkUpdateFieldHandler validates field and enum', async () => {
      const model = {
        name: 'Bu',
        admin: { enabled: true },
        primaryKey: 'id',
        columns: new Map([
          ['status', { type: 'string', enumValues: ['on', 'off'] }],
          ['active', { type: 'boolean' }],
        ]),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getModel: () => model,
          getRepository: () => ({
            update: async () => {},
          }),
        },
      });

      const r1 = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Bu' }, body: { ids: [1], field: 'status', value: 'bad' } },
        r1,
      );
      expect(r1.statusCode).toBe(400);

      const r2 = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Bu' }, body: { ids: [1], field: 'active', value: 'true' } },
        r2,
      );
      expect(r2.payload.success).toBe(true);
    });

    it('bulkUpdateFieldHandler accepts date and rejects invalid format', async () => {
      let lastUpdate;
      const model = {
        name: 'Bu',
        admin: { enabled: true },
        primaryKey: 'id',
        columns: new Map([
          ['on_day', { type: 'date', nullable: false }],
          ['optional_at', { type: 'datetime', nullable: true }],
        ]),
      };
      const handlers = createExtensionApiHandlers({
        registry,
        db: {
          ...db,
          getModel: () => model,
          getRepository: () => ({
            update: async (_id, data) => {
              lastUpdate = data;
            },
          }),
        },
      });

      const bad = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Bu' }, body: { ids: [1], field: 'on_day', value: '02-03-2025' } },
        bad,
      );
      expect(bad.statusCode).toBe(400);

      const ok = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Bu' }, body: { ids: [1], field: 'on_day', value: '2025-06-15' } },
        ok,
      );
      expect(ok.payload.success).toBe(true);
      expect(lastUpdate.on_day).toBeInstanceOf(Date);

      const nullOk = createMockRes();
      await handlers.bulkUpdateFieldHandler(
        { params: { model: 'Bu' }, body: { ids: [1], field: 'optional_at', value: null } },
        nullOk,
      );
      expect(nullOk.payload.success).toBe(true);
      expect(lastUpdate.optional_at).toBeNull();
    });

    it('coerceBulkTemporalValue covers edge cases', () => {
      expect(coerceBulkTemporalValue({ type: 'date', nullable: true }, '', 'd').value).toBeNull();
      expect(coerceBulkTemporalValue({ type: 'date', nullable: false }, '', 'd').error).toBeTruthy();
      expect(coerceBulkTemporalValue({ type: 'datetime', nullable: true }, '2025-01-02T08:30', 't').value).toBeInstanceOf(Date);
    });
  });
});
