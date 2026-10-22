const knexLib = require('knex');
const auditLogPlugin = require('../../../plugins/audit-log');
const { createAuditLogHandlers } = require('../../../plugins/audit-log/api-handlers');
const { generateAuditLogComponent } = require('../../../plugins/audit-log/admin-component');
const { createMockRes } = require('../../utils');

describe('Audit Log Timeline & Record History (plugins/audit-log)', () => {
  let knex;
  let handlers;

  beforeAll(async () => {
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable('audit_logs', (table) => {
      table.increments('id').primary();
      table.string('resource_model');
      table.string('resource_id');
      table.string('action');
      table.integer('actor_id').nullable();
      table.string('actor_email').nullable();
      table.string('http_method', 16);
      table.string('path', 2000);
      table.string('ip', 64).nullable();
      table.text('user_agent').nullable();
      table.text('metadata').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    handlers = createAuditLogHandlers({ knex });

    // Seed test audit records for a Post #42 and other records
    await knex('audit_logs').insert([
      {
        resource_model: 'Post',
        resource_id: '42',
        action: 'create',
        actor_id: 1,
        actor_email: 'alice@example.com',
        http_method: 'POST',
        path: '/_admin/api/models/Post/records',
        ip: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
        metadata: JSON.stringify({ changedFields: ['title', 'content', 'status'] }),
        created_at: '2026-10-10 10:00:00',
      },
      {
        resource_model: 'Post',
        resource_id: '42',
        action: 'update',
        actor_id: 2,
        actor_email: 'bob@example.com',
        http_method: 'PUT',
        path: '/_admin/api/models/Post/records/42',
        ip: '192.168.1.5',
        user_agent: 'Chrome/120',
        metadata: JSON.stringify({ changedFields: ['title', 'price'] }),
        created_at: '2026-10-11 14:30:00',
      },
      {
        resource_model: 'Post',
        resource_id: '42',
        action: 'delete',
        actor_id: 1,
        actor_email: 'alice@example.com',
        http_method: 'DELETE',
        path: '/_admin/api/models/Post/records/42',
        ip: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
        metadata: null,
        created_at: '2026-10-12 09:15:00',
      },
      {
        resource_model: 'User',
        resource_id: '99',
        action: 'create',
        actor_id: 1,
        actor_email: 'alice@example.com',
        http_method: 'POST',
        path: '/_admin/api/models/User/records',
        ip: '127.0.0.1',
        created_at: '2026-10-09 08:00:00',
      },
    ]);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  describe('timelineHandler', () => {
    it('returns 400 if model or recordId is missing', async () => {
      const req = { params: {}, query: {} };
      const res = createMockRes();
      await handlers.timelineHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('model and id are required');
    });

    it('returns ordered timeline and revision summary for a specific record', async () => {
      const req = {
        params: { model: 'Post', id: '42' },
      };
      const res = createMockRes();
      await handlers.timelineHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.model).toBe('Post');
      expect(res.body.recordId).toBe('42');

      const { summary, timeline } = res.body;
      expect(summary.totalChanges).toBe(3);
      expect(summary.createdBy).toBe('alice@example.com');
      expect(summary.createdAt).toBe('2026-10-10 10:00:00');
      expect(summary.lastModifiedBy).toBe('alice@example.com');
      expect(summary.lastModifiedAt).toBe('2026-10-12 09:15:00');

      expect(timeline).toHaveLength(3);
      expect(timeline[0].action).toBe('create');
      expect(timeline[0].actor.email).toBe('alice@example.com');
      expect(timeline[0].changedFields).toEqual(['title', 'content', 'status']);

      expect(timeline[1].action).toBe('update');
      expect(timeline[1].actor.email).toBe('bob@example.com');
      expect(timeline[1].changedFields).toEqual(['title', 'price']);

      expect(timeline[2].action).toBe('delete');
    });

    it('also accepts query parameters (?model=Post&recordId=42)', async () => {
      const req = {
        params: {},
        query: { model: 'Post', recordId: '42' },
      };
      const res = createMockRes();
      await handlers.timelineHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.timeline).toHaveLength(3);
    });
  });

  describe('queryTimeline programmatic helper', () => {
    it('returns chronological rows for model and recordId', async () => {
      const rows = await handlers.queryTimeline('Post', '42');
      expect(rows).toHaveLength(3);
      expect(rows[0].action).toBe('create');
      expect(rows[1].action).toBe('update');
      expect(rows[2].action).toBe('delete');
    });

    it('returns empty array if record does not exist or params invalid', async () => {
      const rows = await handlers.queryTimeline('Post', '999');
      expect(rows).toEqual([]);

      const invalid = await handlers.queryTimeline(null, null);
      expect(invalid).toEqual([]);
    });
  });

  describe('Enhanced listHandler filtering', () => {
    it('filters by recordId', async () => {
      const req = { query: { recordId: '42' } };
      const res = createMockRes();
      await handlers.listHandler(req, res);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.every((r) => r.resource_id === '42')).toBe(true);
    });

    it('filters by search keyword across email and path', async () => {
      const req = { query: { search: 'bob@example.com' } };
      const res = createMockRes();
      await handlers.listHandler(req, res);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].actor_email).toBe('bob@example.com');
    });

    it('filters by actorEmail', async () => {
      const req = { query: { actorEmail: 'alice' } };
      const res = createMockRes();
      await handlers.listHandler(req, res);

      expect(res.body.meta.total).toBe(3);
    });
  });

  describe('Admin Panel Record Action Registration', () => {
    it('registers audit-timeline action on models in onRoutesReady', async () => {
      let registeredAction = null;
      const mockAdminApi = {
        registerModule: () => {},
        registerAction: (id, config) => {
          if (id === 'audit-timeline') {
            registeredAction = config;
          }
        },
      };

      const plugin = auditLogPlugin({ db: knex });
      plugin.onRoutesReady({
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
      });

      expect(registeredAction).not.toBeNull();
      expect(registeredAction.id).toBe('audit-timeline');
      expect(registeredAction.label).toBe('Timeline');

      // Test handler redirect response
      const actionResult = await registeredAction.handler({ id: 42 }, { name: 'Post' });
      expect(actionResult.redirect).toBe('/audit-log?model=Post&recordId=42');
    });
  });

  describe('generateAuditLogComponent', () => {
    it('generates Mithril component with timeline and table views', () => {
      const code = generateAuditLogComponent({ apiPrefix: '/_admin/api/audit-logs' });
      expect(code).toContain('/_admin/api/audit-logs');
      expect(code).toContain('Timeline');
      expect(code).toContain('Table');
      expect(code).toContain('formatRelativeTime');
      expect(code).toContain('getActionTheme');
      expect(code).toContain('focusRecord');
    });
  });
});
