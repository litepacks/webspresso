/**
 * Profile API Handler Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApiHandlers } from '../../../plugins/admin-panel/api.js';

describe('Admin Panel Profile API', () => {
  let mockDb;
  let mockAdminUserRepo;
  let mockHashPassword;
  let mockComparePassword;
  let apiHandlers;

  beforeEach(() => {
    const mockQueryChain = {
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn(),
    };

    mockAdminUserRepo = {
      findById: vi.fn(),
      update: vi.fn(),
      query: vi.fn().mockReturnValue(mockQueryChain),
    };

    mockDb = {
      getRepository: vi.fn().mockReturnValue(mockAdminUserRepo),
      getAllModels: vi.fn().mockReturnValue([]),
    };

    mockHashPassword = vi.fn().mockResolvedValue('hashed_new_password');
    mockComparePassword = vi.fn().mockResolvedValue(true);

    apiHandlers = createApiHandlers({
      db: mockDb,
      AdminUser: { name: 'AdminUser' },
      hashPassword: mockHashPassword,
      comparePassword: mockComparePassword,
    });
  });

  describe('updateProfileHandler', () => {
    it('should return 401 if user is not authenticated', async () => {
      const req = { session: {} };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    });

    it('should update user name and email successfully', async () => {
      const currentUser = { id: 1, name: 'Old Name', email: 'old@example.com', password: 'hashed_password' };
      const updatedUser = { id: 1, name: 'New Name', email: 'new@example.com', password: 'hashed_password' };

      mockAdminUserRepo.findById.mockResolvedValueOnce(currentUser).mockResolvedValueOnce(updatedUser);

      const req = {
        session: {
          adminUser: { id: 1, name: 'Old Name', email: 'old@example.com' },
        },
        body: {
          name: 'New Name',
          email: 'new@example.com',
        },
      };

      const res = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(mockAdminUserRepo.update).toHaveBeenCalledWith(1, {
        name: 'New Name',
        email: 'new@example.com',
      });
      expect(req.session.adminUser).toEqual({
        id: 1,
        name: 'New Name',
        email: 'new@example.com',
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        user: expect.objectContaining({
          id: 1,
          name: 'New Name',
          email: 'new@example.com',
        }),
      });
    });

    it('should reject email update if duplicate email exists', async () => {
      const currentUser = { id: 1, name: 'User One', email: 'one@example.com' };

      mockAdminUserRepo.findById.mockResolvedValue(currentUser);
      mockAdminUserRepo.query().first.mockResolvedValue({ id: 2, email: 'taken@example.com' });

      const req = {
        session: { adminUser: { id: 1, name: 'User One', email: 'one@example.com' } },
        body: { email: 'taken@example.com' },
      };

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Email is already in use by another user' });
      expect(mockAdminUserRepo.update).not.toHaveBeenCalled();
    });

    it('should reject password update if currentPassword is missing', async () => {
      const currentUser = { id: 1, name: 'User One', email: 'one@example.com', password: 'hashed_pass' };
      mockAdminUserRepo.findById.mockResolvedValue(currentUser);

      const req = {
        session: { adminUser: { id: 1 } },
        body: { newPassword: 'newsecretpass' },
      };

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Current password is required to set a new password' });
    });

    it('should reject password update if currentPassword is incorrect', async () => {
      const currentUser = { id: 1, name: 'User One', email: 'one@example.com', password: 'hashed_pass' };
      mockAdminUserRepo.findById.mockResolvedValue(currentUser);
      mockComparePassword.mockResolvedValue(false);

      const req = {
        session: { adminUser: { id: 1 } },
        body: { currentPassword: 'wrongpassword', newPassword: 'newsecretpass' },
      };

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(mockComparePassword).toHaveBeenCalledWith('wrongpassword', 'hashed_pass');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Current password is incorrect' });
    });

    it('should update password successfully when currentPassword is correct', async () => {
      const currentUser = { id: 1, name: 'User One', email: 'one@example.com', password: 'old_hashed_pass' };
      const updatedUser = { id: 1, name: 'User One', email: 'one@example.com', password: 'hashed_new_password' };

      mockAdminUserRepo.findById.mockResolvedValueOnce(currentUser).mockResolvedValueOnce(updatedUser);
      mockComparePassword.mockResolvedValue(true);

      const req = {
        session: { adminUser: { id: 1, name: 'User One', email: 'one@example.com' } },
        body: { currentPassword: 'correctoldpass', newPassword: 'newsecretpassword' },
      };

      const res = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      await apiHandlers.updateProfileHandler(req, res);

      expect(mockHashPassword).toHaveBeenCalledWith('newsecretpassword', 10);
      expect(mockAdminUserRepo.update).toHaveBeenCalledWith(1, { password: 'hashed_new_password' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        user: expect.objectContaining({ id: 1 }),
      });
    });
  });
});
