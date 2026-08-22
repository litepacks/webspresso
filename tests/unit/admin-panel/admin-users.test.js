/**
 * Admin Users API & Management Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAdminUsersApiHandlers,
  registerAdminUsersManagement,
  generateAdminUsersComponent,
  sanitizeAdminUser,
} from '../../../plugins/admin-panel/modules/admin-users.js';

describe('Admin User Management Module', () => {
  let mockDb;
  let mockAdminUserRepo;
  let mockHashPassword;
  let apiHandlers;

  beforeEach(() => {
    const mockQueryChain = {
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      first: vi.fn(),
      count: vi.fn().mockResolvedValue([{ count: 2 }]),
    };

    // Query resolves to array by default if awaited
    mockQueryChain.then = function (resolve) {
      return Promise.resolve([]).then(resolve);
    };

    mockAdminUserRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn().mockReturnValue(mockQueryChain),
    };

    mockDb = {
      getRepository: vi.fn().mockReturnValue(mockAdminUserRepo),
      knex: {
        client: { config: { client: 'sqlite3' } },
      },
    };

    mockHashPassword = vi.fn().mockImplementation(async (pw) => `hashed_${pw}`);

    apiHandlers = createAdminUsersApiHandlers({
      db: mockDb,
      AdminUser: { name: 'AdminUser' },
      hashPassword: mockHashPassword,
    });
  });

  describe('sanitizeAdminUser', () => {
    it('strips password and normalizes active boolean', () => {
      const raw = {
        id: 1,
        email: 'admin@example.com',
        password: 'supersecret_hash',
        name: 'Admin User',
        role: 'admin',
        active: 1,
      };

      const sanitized = sanitizeAdminUser(raw);
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.email).toBe('admin@example.com');
      expect(sanitized.active).toBe(true);
    });

    it('handles null safely', () => {
      expect(sanitizeAdminUser(null)).toBeNull();
    });
  });

  describe('listAdmins', () => {
    it('returns sanitized list of admin users', async () => {
      const userList = [
        { id: 1, email: 'admin1@example.com', password: 'hash1', name: 'Admin 1', role: 'admin', active: 1 },
        { id: 2, email: 'admin2@example.com', password: 'hash2', name: 'Admin 2', role: 'superadmin', active: 0 },
      ];

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(userList),
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = { query: {} };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.listAdmins(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          total: 2,
          data: [
            expect.objectContaining({ id: 1, email: 'admin1@example.com', active: true }),
            expect.objectContaining({ id: 2, email: 'admin2@example.com', active: false }),
          ],
        })
      );
      expect(res.json.mock.calls[0][0].data[0].password).toBeUndefined();
      expect(res.json.mock.calls[0][0].data[1].password).toBeUndefined();
    });
  });

  describe('getAdmin', () => {
    it('returns 404 when admin does not exist', async () => {
      mockAdminUserRepo.findById.mockResolvedValue(null);

      const req = { params: { id: 99 } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.getAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin user not found' });
    });

    it('returns sanitized admin when found', async () => {
      mockAdminUserRepo.findById.mockResolvedValue({
        id: 1,
        email: 'admin@example.com',
        password: 'hash',
        name: 'Admin',
        role: 'admin',
        active: 1,
      });

      const req = { params: { id: 1 } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.getAdmin(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 1,
          email: 'admin@example.com',
          name: 'Admin',
          active: true,
        }),
      });
      expect(res.json.mock.calls[0][0].data.password).toBeUndefined();
    });
  });

  describe('createAdmin', () => {
    it('validates required fields', async () => {
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      // Missing email
      await apiHandlers.createAdmin({ body: { name: 'A', password: 'password123' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Email is required' });

      // Invalid email
      await apiHandlers.createAdmin({ body: { email: 'not-an-email', name: 'A', password: 'password123' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid email address format' });

      // Password too short (< 8 chars)
      await apiHandlers.createAdmin({ body: { email: 'test@example.com', name: 'A', password: '123' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });

      // Missing name
      await apiHandlers.createAdmin({ body: { email: 'test@example.com', password: 'password123' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Name is required' });
    });

    it('rejects duplicate email', async () => {
      const queryChain = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1, email: 'existing@example.com' }),
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = {
        body: {
          email: 'existing@example.com',
          password: 'password123',
          name: 'Existing Admin',
        },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.createAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'An admin user with this email already exists' });
    });

    it('hashes password and creates admin user', async () => {
      const queryChain = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      mockAdminUserRepo.create.mockResolvedValue({
        id: 3,
        email: 'newadmin@example.com',
        password: 'hashed_password123',
        name: 'New Admin',
        role: 'superadmin',
        active: 1,
      });

      const req = {
        body: {
          email: 'NewAdmin@example.com',
          password: 'password123',
          name: 'New Admin',
          role: 'superadmin',
          active: true,
        },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.createAdmin(req, res);

      expect(mockHashPassword).toHaveBeenCalledWith('password123', 10);
      expect(mockAdminUserRepo.create).toHaveBeenCalledWith({
        email: 'newadmin@example.com',
        password: 'hashed_password123',
        name: 'New Admin',
        role: 'superadmin',
        active: 1,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: 3,
            email: 'newadmin@example.com',
            name: 'New Admin',
            role: 'superadmin',
            active: true,
          }),
        })
      );
    });
  });

  describe('updateAdmin', () => {
    it('prevents self-deactivation', async () => {
      mockAdminUserRepo.findById.mockResolvedValue({
        id: 1,
        email: 'me@example.com',
        name: 'Me',
        active: 1,
      });

      const req = {
        session: { adminUser: { id: 1, email: 'me@example.com' } },
        params: { id: 1 },
        body: { active: false },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'You cannot deactivate your own admin account' });
    });

    it('prevents deactivation of the last active admin', async () => {
      mockAdminUserRepo.findById.mockResolvedValue({
        id: 2,
        email: 'other@example.com',
        name: 'Other',
        active: 1,
      });

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue([{ count: 0 }]), // 0 other active admins
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = {
        session: { adminUser: { id: 1, email: 'me@example.com' } },
        params: { id: 2 },
        body: { active: false },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Cannot deactivate the last active administrator account' });
    });

    it('updates admin user and syncs current session if editing self', async () => {
      const existingUser = {
        id: 1,
        email: 'old@example.com',
        name: 'Old Name',
        role: 'admin',
        active: 1,
      };

      const updatedUser = {
        id: 1,
        email: 'updated@example.com',
        name: 'Updated Name',
        role: 'admin',
        active: 1,
      };

      mockAdminUserRepo.findById
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = {
        session: { adminUser: { id: 1, email: 'old@example.com' } },
        params: { id: 1 },
        body: {
          name: 'Updated Name',
          email: 'updated@example.com',
          password: 'newpassword123',
        },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateAdmin(req, res);

      expect(mockHashPassword).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockAdminUserRepo.update).toHaveBeenCalledWith(1, {
        name: 'Updated Name',
        email: 'updated@example.com',
        password: 'hashed_newpassword123',
      });
      expect(req.session.adminUser.name).toBe('Updated Name');
      expect(req.session.adminUser.email).toBe('updated@example.com');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: 1,
            email: 'updated@example.com',
            name: 'Updated Name',
          }),
        })
      );
    });
  });

  describe('deleteAdmin', () => {
    it('prevents self-deletion', async () => {
      const req = {
        session: { adminUser: { id: 1, email: 'admin@example.com' } },
        params: { id: 1 },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.deleteAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'You cannot delete your own admin account' });
    });

    it('prevents deletion of the last active admin', async () => {
      mockAdminUserRepo.findById.mockResolvedValue({
        id: 2,
        email: 'other@example.com',
        active: 1,
      });

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue([{ count: 0 }]), // 0 other active admins
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = {
        session: { adminUser: { id: 1, email: 'me@example.com' } },
        params: { id: 2 },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.deleteAdmin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Cannot delete the last active administrator account' });
    });

    it('deletes admin user successfully when other active admins exist', async () => {
      mockAdminUserRepo.findById.mockResolvedValue({
        id: 2,
        email: 'other@example.com',
        active: 1,
      });

      const queryChain = {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue([{ count: 1 }]), // 1 other active admin exists
      };
      mockAdminUserRepo.query.mockReturnValue(queryChain);

      const req = {
        session: { adminUser: { id: 1, email: 'me@example.com' } },
        params: { id: 2 },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.deleteAdmin(req, res);

      expect(mockAdminUserRepo.delete).toHaveBeenCalledWith(2);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Admin user deleted successfully',
      });
    });
  });

  describe('registerAdminUsersManagement & generateAdminUsersComponent', () => {
    it('registers menu item under system group', () => {
      const mockRegistry = {
        registerMenuItem: vi.fn(),
      };

      registerAdminUsersManagement({ registry: mockRegistry, config: {} });

      expect(mockRegistry.registerMenuItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'admin-users-list',
          label: 'Admin Users',
          path: '/admins',
          group: 'system',
        })
      );
    });

    it('does not register if enabled: false', () => {
      const mockRegistry = {
        registerMenuItem: vi.fn(),
      };

      registerAdminUsersManagement({ registry: mockRegistry, config: { enabled: false } });

      expect(mockRegistry.registerMenuItem).not.toHaveBeenCalled();
    });

    it('generates AdminUsersPage component', () => {
      const code = generateAdminUsersComponent();
      expect(code).toContain('const AdminUsersPage =');
      expect(code).toContain('/admins');
    });
  });
});
