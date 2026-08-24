const contentPlugin = require('../../plugins/content');
const { generateContentMigrations } = require('../../plugins/content/migration-template');
const { isAdminSession, createRequestContentHelpers } = require('../../plugins/content/helpers');
const { createDatabase } = require('../../core/orm');
const { clearRegistry } = require('../../core/orm/model');

describe('Content Plugin & Template Helpers (plugins/content)', () => {
  let db;

  beforeAll(() => {
    clearRegistry();
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterAll(async () => {
    clearRegistry();
    await db.knex.destroy();
  });

  it('should throw if db option is missing', () => {
    expect(() => contentPlugin({})).toThrow('requires a database instance');
  });

  it('should generate content migrations string', () => {
    const migration = generateContentMigrations();
    expect(typeof migration).toBe('string');
    expect(migration).toContain('content_types');
    expect(migration).toContain('content_entries');
  });

  it('isAdminSession and createRequestContentHelpers should detect admin session and format tags', () => {
    expect(isAdminSession({})).toBe(false);
    expect(isAdminSession({ session: { adminUser: { id: 1 } } })).toBe(true);

    const helpersFactory = createRequestContentHelpers({ adminPath: '/custom_admin' });
    const userHelpers = helpersFactory({ session: {} });
    expect(userHelpers.isAdmin()).toBe(false);
    expect(userHelpers.adminPath()).toBe('/custom_admin');
    expect(userHelpers.raw({ data: { title: 'Hello' } })).toEqual({ title: 'Hello' });
    expect(userHelpers.raw(null)).toEqual({});

    // editable for regular user should return plain text
    const text = userHelpers.editable('Hello World', { entryId: 1, typeSlug: 'post' });
    expect(text).toBe('Hello World');

    // editable for admin should wrap in data-ws-content-entry attributes
    const adminHelpers = helpersFactory({ session: { adminUser: { id: 1 } } });
    expect(adminHelpers.isAdmin()).toBe(true);
    const adminText = adminHelpers.editable('Hello World', { entryId: 1, typeSlug: 'post', field: 'title' });
    expect(adminText).toContain('ws-content-editable');
    expect(adminText).toContain('data-ws-content-entry="1"');
  });

  it('maybeInjectInlineEdit should inject bundle only for admin sessions', () => {
    const plugin = contentPlugin({ db });

    const regularHtml = plugin.api.maybeInjectInlineEdit({}, '<html><body><p>Hi</p></body></html>');
    expect(regularHtml).toBe('<html><body><p>Hi</p></body></html>');

    const adminHtml = plugin.api.maybeInjectInlineEdit(
      { session: { adminUser: { id: 1 } } },
      '<html><body><p>Hi</p></body></html>'
    );
    expect(adminHtml).toContain('window.__WS_CONTENT__');
    expect(adminHtml).toContain('ws-content-inline-edit');
  });

  it('should register models and routes when admin-panel is present', () => {
    const plugin = contentPlugin({ db });
    plugin.register({});

    let registeredMod = null;
    const addedRoutes = [];
    const mockCtx = {
      db,
      usePlugin: (name) => (name === 'admin-panel' ? { registerModule: (m) => { registeredMod = m; } } : null),
      addRoute: (method, path) => addedRoutes.push({ method, path }),
    };

    plugin.onRoutesReady(mockCtx);

    expect(registeredMod).not.toBeNull();
    expect(registeredMod.id).toBe('content');
    expect(registeredMod.pages.length).toBeGreaterThan(0);
    expect(addedRoutes.some(r => r.path === '/api/content/:typeSlug/:entrySlug')).toBe(true);
  });
});
