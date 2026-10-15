/**
 * Coverage Test for Admin Panel User Modules:
 * - plugins/admin-panel/modules/admin-users.js
 * - plugins/admin-panel/modules/user-management.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAdminUsersApiHandlers,
  registerAdminUsersManagement,
} from '../../../plugins/admin-panel/modules/admin-users.js';
import {
  registerUserManagement,
} from '../../../plugins/admin-panel/modules/user-management.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    _json: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
  };
  return res;
}

describe('Admin Users Management Module Branches', () => {
  let mockRepo;
  let mockDb;
  let handlers;

  beforeEach(() => {
    mockRepo = {
      query: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    mockDb = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
      knex: {
        client: { config: { client: 'sqlite3' } },
      },
    };

    handlers = createAdminUsersApiHandlers({
      db: mockDb,
      AdminUser: { name: 'AdminUser' },
      hashPassword: vi.fn().mockResolvedValue('hashed_pw'),
    });
  });

  it('handles missing repository across all handlers', async () => {
    const brokenHandlers = createAdminUsersApiHandlers({ db: null, AdminUser: null });
    const res = mockRes();

    await brokenHandlers.listAdmins({}, res);
    expect(res.statusCode).toBe(500);

    await brokenHandlers.getAdmin({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(500);

    await brokenHandlers.createAdmin({ body: {} }, res);
    expect(res.statusCode).toBe(500);

    await brokenHandlers.updateAdmin({ params: { id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(500);

    await brokenHandlers.deleteAdmin({ params: { id: 1 } }, res);
    expect(res.statusCode).toBe(500);
  });

  it('listAdmins: covers query filters (search, role, active variations)', async () => {
    const mockQueryBuilder = {
      where: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      then(resolve) {
        return Promise.resolve([
          { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin', active: 1, password: 'hash' },
        ]).then(resolve);
      },
    };

    mockRepo.query.mockReturnValue(mockQueryBuilder);

    // 1. With search, role, active=true (SQLite)
    const req1 = { query: { search: 'ali', role: 'superadmin', active: 'true' } };
    const res1 = mockRes();
    await handlers.listAdmins(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1._json.total).toBe(1);
    expect(res1._json.data[0].password).toBeUndefined();

    // 2. Postgres client with active=false
    mockDb.knex.client.config.client = 'pg';
    const req2 = { query: { active: '0' } };
    const res2 = mockRes();
    await handlers.listAdmins(req2, res2);
    expect(res2.statusCode).toBe(200);
  });

  it('getAdmin: handles 404 and success branches', async () => {
    mockRepo.findById.mockResolvedValueOnce(null);
    const res1 = mockRes();
    await handlers.getAdmin({ params: { id: 999 } }, res1);
    expect(res1.statusCode).toBe(404);

    mockRepo.findById.mockResolvedValueOnce({ id: 1, name: 'Bob', email: 'bob@example.com', active: true });
    const res2 = mockRes();
    await handlers.getAdmin({ params: { id: 1 } }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2._json.data.name).toBe('Bob');
  });

  it('createAdmin: validation, duplicate check, and success branches', async () => {
    // Missing email
    const res1 = mockRes();
    await handlers.createAdmin({ body: {} }, res1);
    expect(res1.statusCode).toBe(400);

    // Invalid email format
    const res2 = mockRes();
    await handlers.createAdmin({ body: { email: 'not-an-email' } }, res2);
    expect(res2.statusCode).toBe(400);

    // Password too short
    const res3 = mockRes();
    await handlers.createAdmin({ body: { email: 'admin@webspresso.io', password: 'short' } }, res3);
    expect(res3.statusCode).toBe(400);

    // Missing name
    const res4 = mockRes();
    await handlers.createAdmin({ body: { email: 'admin@webspresso.io', password: 'validpassword' } }, res4);
    expect(res4.statusCode).toBe(400);

    // Duplicate email
    mockRepo.query.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 99 }),
    });
    const res5 = mockRes();
    await handlers.createAdmin({ body: { email: 'admin@webspresso.io', password: 'validpassword', name: 'Admin' } }, res5);
    expect(res5.statusCode).toBe(400);
    expect(res5._json.error).toContain('already exists');

    // Success
    mockRepo.query.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    });
    mockRepo.create.mockResolvedValueOnce({
      id: 2,
      email: 'admin@webspresso.io',
      name: 'Admin',
      role: 'admin',
      active: 1,
    });
    const res6 = mockRes();
    await handlers.createAdmin({ body: { email: 'admin@webspresso.io', password: 'validpassword', name: 'Admin' } }, res6);
    expect(res6.statusCode).toBe(201);
  });

  it('updateAdmin: validation, rules, and session sync', async () => {
    mockRepo.findById.mockResolvedValue(null);
    const res1 = mockRes();
    await handlers.updateAdmin({ params: { id: 999 }, body: {} }, res1);
    expect(res1.statusCode).toBe(404);

    const existingAdmin = { id: 1, name: 'Alice', email: 'alice@example.com', active: 1, role: 'admin' };
    mockRepo.findById.mockResolvedValue(existingAdmin);

    // Empty name
    const res2 = mockRes();
    await handlers.updateAdmin({ params: { id: 1 }, body: { name: '   ' } }, res2);
    expect(res2.statusCode).toBe(400);

    // Invalid email
    const res3 = mockRes();
    await handlers.updateAdmin({ params: { id: 1 }, body: { email: 'invalid' } }, res3);
    expect(res3.statusCode).toBe(400);

    // Duplicate email
    mockRepo.query.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 2 }),
    });
    const res4 = mockRes();
    await handlers.updateAdmin({ params: { id: 1 }, body: { email: 'other@example.com' } }, res4);
    expect(res4.statusCode).toBe(400);

    // Self-deactivation protection
    const res5 = mockRes();
    await handlers.updateAdmin({
      params: { id: 1 },
      session: { adminUser: { id: 1 } },
      body: { active: false },
    }, res5);
    expect(res5.statusCode).toBe(400);
    expect(res5._json.error).toContain('cannot deactivate your own');

    // Last active admin protection
    mockRepo.query.mockReturnValue({
      whereNot: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue([{ count: 0 }]),
    });
    const res6 = mockRes();
    await handlers.updateAdmin({
      params: { id: 2 },
      session: { adminUser: { id: 1 } },
      body: { active: false },
    }, res6);
    expect(res6.statusCode).toBe(400);
    expect(res6._json.error).toContain('last active administrator');

    // Short password
    const res7 = mockRes();
    await handlers.updateAdmin({ params: { id: 2 }, body: { password: 'short' } }, res7);
    expect(res7.statusCode).toBe(400);

    // Successful update
    const updatedUser = { id: 1, name: 'Alice Updated', email: 'alice@example.com', active: 1, role: 'admin' };
    mockRepo.findById.mockResolvedValue(updatedUser);
    const req8 = {
      params: { id: 1 },
      session: { adminUser: { id: 1, name: 'Alice' } },
      body: { name: 'Alice Updated', password: 'newsecretpassword' },
    };
    const res8 = mockRes();
    await handlers.updateAdmin(req8, res8);
    expect(res8.statusCode).toBe(200);
    expect(req8.session.adminUser.name).toBe('Alice Updated');
  });

  it('deleteAdmin: self-deletion and last admin protection rules', async () => {
    // 1. Self deletion
    const res1 = mockRes();
    await handlers.deleteAdmin({ params: { id: 1 }, session: { adminUser: { id: 1 } } }, res1);
    expect(res1.statusCode).toBe(400);

    // 2. Not found
    mockRepo.findById.mockResolvedValueOnce(null);
    const res2 = mockRes();
    await handlers.deleteAdmin({ params: { id: 2 }, session: { adminUser: { id: 1 } } }, res2);
    expect(res2.statusCode).toBe(404);

    // 3. Last admin protection
    mockRepo.findById.mockResolvedValueOnce({ id: 2, active: 1 });
    mockRepo.query.mockReturnValueOnce({
      whereNot: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue([{ 'count(*)': 0 }]),
    });
    const res3 = mockRes();
    await handlers.deleteAdmin({ params: { id: 2 }, session: { adminUser: { id: 1 } } }, res3);
    expect(res3.statusCode).toBe(400);
    expect(res3._json.error).toContain('last active administrator');

    // 4. Successful deletion
    mockRepo.findById.mockResolvedValueOnce({ id: 2, active: 1 });
    mockRepo.query.mockReturnValueOnce({
      whereNot: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue([{ count: 2 }]),
    });
    const res4 = mockRes();
    await handlers.deleteAdmin({ params: { id: 2 }, session: { adminUser: { id: 1 } } }, res4);
    expect(res4.statusCode).toBe(200);
  });

  it('registerAdminUsersManagement: config.enabled toggle', () => {
    const reg = { registerMenuItem: vi.fn() };
    registerAdminUsersManagement({ registry: reg, config: { enabled: false } });
    expect(reg.registerMenuItem).not.toHaveBeenCalled();

    registerAdminUsersManagement({ registry: reg, config: { enabled: true } });
    expect(reg.registerMenuItem).toHaveBeenCalled();
  });
});

describe('User Management Module Branches', () => {
  it('registerUserManagement: widgets, actions, bulk actions, and data loader', async () => {
    const widgets = new Map();
    const actions = new Map();
    const bulkActions = new Map();

    const mockRegistry = {
      enableUserManagement: vi.fn(),
      registerMenuGroup: vi.fn(),
      registerMenuItem: vi.fn(),
      registerWidget: vi.fn((id, cfg) => widgets.set(id, cfg)),
      registerAction: vi.fn((id, cfg) => actions.set(id, cfg)),
      registerBulkAction: vi.fn((id, cfg) => bulkActions.set(id, cfg)),
      registerHook: vi.fn(),
    };

    const mockUserRepo = {
      model: {
        table: 'users',
        columns: new Map([
          ['id', { type: 'id' }],
          ['active', { type: 'boolean' }],
          ['role', { type: 'string' }],
          ['created_at', { type: 'datetime' }],
        ]),
      },
      count: vi.fn().mockResolvedValue(100),
      query: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue(80),
      }),
      update: vi.fn().mockResolvedValue(true),
    };

    const mockDb = {
      getRepository: vi.fn().mockReturnValue(mockUserRepo),
      knex: {
        client: { config: { client: 'sqlite3' } },
        schema: {
          hasColumn: vi.fn().mockResolvedValue(true),
        },
      },
    };

    registerUserManagement({
      registry: mockRegistry,
      db: mockDb,
      auth: { enabled: true },
      config: { model: 'User' },
    });

    expect(mockRegistry.enableUserManagement).toHaveBeenCalled();
    expect(mockRegistry.registerMenuItem).toHaveBeenCalled();

    // 1. Test widget dataLoader
    const widget = widgets.get('user-stats');
    expect(widget).toBeDefined();
    const stats = await widget.dataLoader({ db: mockDb });
    expect(stats.total).toBe(100);
    expect(stats.active).toBe(80);

    // Widget dataLoader error branch
    mockUserRepo.count.mockRejectedValueOnce(new Error('DB Boom'));
    const errStats = await widget.dataLoader({ db: mockDb });
    expect(errStats.error).toBe('DB Boom');

    // 2. Action handlers (activate, deactivate, reset-password)
    const activateAction = actions.get('user-activate');
    expect(activateAction.visible({ active: false })).toBe(true);
    expect(activateAction.visible({ active: true })).toBe(false);
    const actRes = await activateAction.handler({ id: 5 }, 'User', { db: mockDb });
    expect(actRes.message).toBe('User activated');

    const deactivateAction = actions.get('user-deactivate');
    expect(deactivateAction.visible({ active: true })).toBe(true);
    const deactRes = await deactivateAction.handler({ id: 5 }, 'User', { db: mockDb });
    expect(deactRes.message).toBe('User deactivated');

    const resetAction = actions.get('user-reset-password');
    const resetRes = await resetAction.handler({ id: 5 }, 'User', { db: mockDb });
    expect(resetRes.newPassword).toBeDefined();

    // 3. Bulk actions (activate, deactivate, export)
    const bulkActivate = bulkActions.get('users-activate');
    await bulkActivate.handler([{ id: 1 }, { id: 2 }], 'User', { db: mockDb });

    const bulkDeactivate = bulkActions.get('users-deactivate');
    await bulkDeactivate.handler([{ id: 1 }, { id: 2 }], 'User', { db: mockDb });
  });

  it('createUserManagementApiHandlers: handles listUsers, getUser, and error paths', async () => {
    const { createUserManagementApiHandlers } = await import('../../../plugins/admin-panel/modules/user-management.js');

    const mockPaginate = vi.fn().mockResolvedValue({
      data: [{ id: 1, name: 'Alice', email: 'alice@example.com', password: 'hash' }],
      pagination: { page: 1, perPage: 10, total: 1 },
    });

    const mockRepo = {
      model: {
        table: 'users',
        columns: new Map([
          ['id', { type: 'id' }],
          ['email', { type: 'string' }],
          ['name', { type: 'string' }],
          ['role', { type: 'string' }],
          ['active', { type: 'boolean' }],
        ]),
      },
      query: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        paginate: mockPaginate,
      }),
      findById: vi.fn(),
    };

    const mockDb = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
      knex: {
        schema: {
          hasColumn: vi.fn().mockResolvedValue(true),
        },
      },
    };

    const userApi = createUserManagementApiHandlers({
      db: mockDb,
      config: { model: 'User' },
    });

    // 1. listUsers with search, role, active
    const listRes = mockRes();
    await userApi.listUsers({ query: { search: 'ali', role: 'admin', active: 'true', page: '1' } }, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes._json.data[0].password).toBeUndefined();

    // 2. getUser 404
    mockRepo.findById.mockResolvedValueOnce(null);
    const getRes1 = mockRes();
    await userApi.getUser({ params: { id: 99 } }, getRes1);
    expect(getRes1.statusCode).toBe(404);

    // 3. getUser 200
    mockRepo.findById.mockResolvedValueOnce({ id: 1, name: 'Alice', password: 'hash' });
    const getRes2 = mockRes();
    await userApi.getUser({ params: { id: 1 } }, getRes2);
    expect(getRes2.statusCode).toBe(200);
    expect(getRes2._json.data.password).toBeUndefined();
  });
});
