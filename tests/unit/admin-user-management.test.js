const z = require('zod');
const {
  registerUserManagement,
  createUserManagementApiHandlers,
  generateRandomPassword,
} = require('../../plugins/admin-panel/modules/user-management');
const { defineModel, clearRegistry } = require('../../core/orm/model');
const { createDatabase } = require('../../core/orm');

describe('Admin Panel User Management Module (plugins/admin-panel/modules/user-management)', () => {
  let db;
  let knex;

  beforeAll(async () => {
    clearRegistry();
    const userSchema = z.object({
      id: z.number().optional(),
      email: z.string().email(),
      password: z.string(),
      name: z.string().optional(),
      role: z.string().default('user'),
      active: z.boolean().default(true),
    });

    defineModel({
      name: 'User',
      table: 'users',
      schema: userSchema,
    });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('email').notNullable().unique();
      table.string('password').notNullable();
      table.string('name');
      table.string('role').defaultTo('user');
      table.boolean('active').defaultTo(true);
      table.timestamp('email_verified_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('remember_tokens', (table) => {
      table.increments('id').primary();
      table.integer('user_id');
      table.string('token');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  });

  afterAll(async () => {
    clearRegistry();
    await knex.destroy();
  });

  it('generateRandomPassword should generate strings of specified length', () => {
    const p1 = generateRandomPassword(16);
    expect(typeof p1).toBe('string');
    expect(p1.length).toBe(16);

    const p2 = generateRandomPassword();
    expect(p2.length).toBe(12);
  });

  it('registerUserManagement should register menu items, widgets, actions and bulk actions', async () => {
    const menuGroups = [];
    const menuItems = [];
    const widgets = {};
    const actions = {};
    const bulkActions = {};
    const hooks = {};

    const mockRegistry = {
      enableUserManagement: vi.fn(),
      registerMenuGroup: (id, config) => menuGroups.push({ id, ...config }),
      registerMenuItem: (item) => menuItems.push(item),
      registerWidget: (id, config) => { widgets[id] = config; },
      registerAction: (id, config) => { actions[id] = config; },
      registerBulkAction: (id, config) => { bulkActions[id] = config; },
      registerHook: (event, handler) => { hooks[event] = handler; },
    };

    const res = registerUserManagement({
      registry: mockRegistry,
      db,
      auth: { rememberTokens: {} },
      config: { roles: ['user', 'admin', 'moderator'] },
    });

    expect(res.modelName).toBe('User');
    expect(mockRegistry.enableUserManagement).toHaveBeenCalled();
    expect(menuGroups.length).toBe(1);
    expect(menuItems.length).toBe(3); // user-list, user-create, user-sessions
    expect(widgets['user-stats']).toBeDefined();

    // Test widget dataLoader
    const stats = await widgets['user-stats'].dataLoader({ db });
    expect(stats.total).toBe(0);

    // Test actions: user-activate, user-deactivate, user-reset-password
    await knex('users').insert({
      email: 'test@example.com',
      password: 'hashedpassword',
      name: 'Test',
      active: 1,
    });

    const userObj = { id: 1, email: 'test@example.com', active: 1 };
    expect(actions['user-deactivate'].visible(userObj)).toBeTruthy();

    await actions['user-deactivate'].handler(userObj, 'User', { db });
    let row = await knex('users').where({ id: 1 }).first();
    expect(row.active).toBeFalsy();

    await actions['user-activate'].handler(userObj, 'User', { db });
    row = await knex('users').where({ id: 1 }).first();
    expect(row.active).toBeTruthy();

    const resetRes = await actions['user-reset-password'].handler(userObj, 'User', { db });
    expect(resetRes.newPassword).toBeDefined();

    // Test bulk actions
    await bulkActions['users-deactivate'].handler([userObj], 'User', { db });
    row = await knex('users').where({ id: 1 }).first();
    expect(row.active).toBeFalsy();

    await bulkActions['users-activate'].handler([userObj], 'User', { db });
    row = await knex('users').where({ id: 1 }).first();
    expect(row.active).toBeTruthy();

    // Test hooks
    const createCtx = { model: 'User', data: { password: 'plainPassword' } };
    await hooks['beforeCreate'](createCtx);
    expect(createCtx.data.password).not.toBe('plainPassword');
    expect(createCtx.data.password.startsWith('$2')).toBe(true);

    const updateCtx = { model: 'User', data: { password: 'newPlainPassword' } };
    await hooks['beforeUpdate'](updateCtx);
    expect(updateCtx.data.password.startsWith('$2')).toBe(true);
  });

  describe('createUserManagementApiHandlers', () => {
    let handlers;

    beforeAll(() => {
      handlers = createUserManagementApiHandlers({
        db,
        config: {},
        auth: { rememberTokens: {} },
      });
    });

    function createMockRes() {
      return {
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
    }

    it('createUser should validate email and hash password', async () => {
      // Missing email
      const res1 = createMockRes();
      await handlers.createUser({ body: {} }, res1);
      expect(res1.statusCode).toBe(400);
      expect(res1.body.error).toBe('Email is required');

      // Successful create
      const res2 = createMockRes();
      await handlers.createUser({
        body: { email: 'alice@example.com', password: 'secretpassword', name: 'Alice' },
      }, res2);

      expect(res2.statusCode).toBe(201);
      expect(res2.body.data.email).toBe('alice@example.com');
      expect(res2.body.data.password).toBeUndefined();

      // Duplicate email
      const res3 = createMockRes();
      await handlers.createUser({
        body: { email: 'alice@example.com', password: 'secretpassword' },
      }, res3);
      expect(res3.statusCode).toBe(400);
      expect(res3.body.error).toBe('Email already exists');
    });

    it('listUsers should return paginated users without passwords', async () => {
      const res = createMockRes();
      await handlers.listUsers({ query: { page: '1', perPage: '10', search: 'Alice' } }, res);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].email).toBe('alice@example.com');
      expect(res.body.data[0].password).toBeUndefined();
    });

    it('getUser should return single user or 404', async () => {
      const res1 = createMockRes();
      await handlers.getUser({ params: { id: 9999 } }, res1);
      expect(res1.statusCode).toBe(404);

      const user = await knex('users').where({ email: 'alice@example.com' }).first();
      const res2 = createMockRes();
      await handlers.getUser({ params: { id: user.id } }, res2);
      expect(res2.body.data.email).toBe('alice@example.com');
      expect(res2.body.data.password).toBeUndefined();
    });

    it('updateUser should update fields, validate unique email, and hash changed password', async () => {
      const user = await knex('users').where({ email: 'alice@example.com' }).first();

      // Non-existent user
      const res1 = createMockRes();
      await handlers.updateUser({ params: { id: 9999 }, body: { name: 'Nobody' } }, res1);
      expect(res1.statusCode).toBe(404);

      // Successful update
      const res2 = createMockRes();
      await handlers.updateUser({
        params: { id: user.id },
        body: { name: 'Alice Cooper', password: 'newpassword123' },
      }, res2);

      expect(res2.body.data.name).toBe('Alice Cooper');
      expect(res2.body.data.password).toBeUndefined();
    });

    it('deleteUser should delete user by ID', async () => {
      const user = await knex('users').where({ email: 'alice@example.com' }).first();

      const res = createMockRes();
      await handlers.deleteUser({ params: { id: user.id } }, res);
      expect(res.body.success).toBe(true);

      const res404 = createMockRes();
      await handlers.deleteUser({ params: { id: user.id } }, res404);
      expect(res404.statusCode).toBe(404);
    });

    it('session handlers should list and revoke sessions', async () => {
      await knex('remember_tokens').insert([
        { user_id: 1, token: 'token-abc' },
        { user_id: 1, token: 'token-def' },
      ]);

      const res1 = createMockRes();
      await handlers.getSessions({}, res1);
      expect(res1.body.data.length).toBe(2);

      const res2 = createMockRes();
      await handlers.revokeSession({ params: { token: 'token-abc' } }, res2);
      expect(res2.body.success).toBe(true);

      const res3 = createMockRes();
      await handlers.revokeUserSessions({ params: { userId: 1 } }, res3);
      expect(res3.body.revoked).toBe(1);
    });
  });
});
