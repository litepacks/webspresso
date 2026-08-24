const knexLib = require('knex');
const auditLogPlugin = require('../../plugins/audit-log');
const { generateAuditLogsMigration } = require('../../plugins/audit-log/migration-template');
const { generateAuditLogComponent } = require('../../plugins/audit-log/admin-component');
const { createAuditLogHandlers } = require('../../plugins/audit-log/api-handlers');

describe('Audit Log Plugin & API Handlers (plugins/audit-log)', () => {
  let knex;

  beforeAll(async () => {
    knex = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await knex.schema.createTable('audit_logs', (table) => {
      table.increments('id').primary();
      table.string('resource_model');
      table.string('action');
      table.string('user_id');
      table.text('metadata');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex('audit_logs').insert([
      { resource_model: 'User', action: 'create', user_id: '1', created_at: '2026-01-01 10:00:00' },
      { resource_model: 'Post', action: 'update', user_id: '1', created_at: '2026-01-02 11:00:00' },
      { resource_model: 'User', action: 'delete', user_id: '2', created_at: '2026-01-03 12:00:00' },
    ]);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('should throw if db is missing in auditLogPlugin', () => {
    expect(() => auditLogPlugin({})).toThrow('requires a database instance');
  });

  it('should generate migration template string and admin component string', () => {
    const migration = generateAuditLogsMigration('custom_audit_logs');
    expect(migration).toContain('custom_audit_logs');
    expect(migration).toContain('exports.up');

    const component = generateAuditLogComponent({ apiPrefix: '/admin-api/audit-logs' });
    expect(component).toContain('/admin-api/audit-logs');
  });

  it('should list audit logs via listHandler with pagination and filters', async () => {
    const handlers = createAuditLogHandlers({ knex });

    const req = {
      query: { model: 'User', action: 'create', page: '1', perPage: '10' },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };

    await handlers.listHandler(req, res);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].resource_model).toBe('User');
    expect(res.body.data[0].action).toBe('create');
  });

  it('should query logs programmatically with filters', async () => {
    const handlers = createAuditLogHandlers({ knex });

    const logs = await handlers.queryLogs({ model: 'User', limit: 10 });
    expect(logs.length).toBe(2);

    const fromLogs = await handlers.queryLogs({ from: '2026-01-02 00:00:00' });
    expect(fromLogs.length).toBe(2);
  });

  it('should register plugin middleware and hooks correctly', () => {
    const plugin = auditLogPlugin({ db: knex });
    expect(plugin.name).toBe('audit-log');

    const mockApp = {
      use(fn) {
        this.middleware = fn;
      },
    };
    plugin.register({ app: mockApp });
    expect(typeof mockApp.middleware).toBe('function');

    let registeredModule = null;
    const mockAdminApi = {
      registerModule(mod) {
        registeredModule = mod;
      },
    };

    plugin.onRoutesReady({
      usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
    });

    expect(registeredModule).not.toBeNull();
    expect(registeredModule.id).toBe('audit-log');
    expect(registeredModule.pages.length).toBe(1);
    expect(registeredModule.api.routes.length).toBe(1);
  });
});
