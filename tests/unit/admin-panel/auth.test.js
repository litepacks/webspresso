/**
 * Admin Panel Auth Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkAdminExists,
  setupAdmin,
  login,
  logout,
  verifyPassword,
  requireAuth,
} from '../../../plugins/admin-panel/auth.js';

describe('Admin Panel Auth', () => {
  let mockRepo;
  let mockHashPassword;
  let mockComparePassword;

  beforeEach(() => {
    mockRepo = {
      count: vi.fn(),
      create: vi.fn(),
      query: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        first: vi.fn(),
      })),
    };
    mockHashPassword = vi.fn();
    mockComparePassword = vi.fn();
  });

  describe('checkAdminExists', () => {
    it('should return true when admin exists', async () => {
      mockRepo.count.mockResolvedValue(1);
      const exists = await checkAdminExists(mockRepo);
      expect(exists).toBe(true);
      expect(mockRepo.count).toHaveBeenCalled();
    });

    it('should return false when no admin exists', async () => {
      mockRepo.count.mockResolvedValue(0);
      const exists = await checkAdminExists(mockRepo);
      expect(exists).toBe(false);
    });

    it('should return false on error (table might not exist)', async () => {
      mockRepo.count.mockRejectedValue(new Error('Table does not exist'));
      const exists = await checkAdminExists(mockRepo);
      expect(exists).toBe(false);
    });
  });

  describe('setupAdmin', () => {
    it('should create first admin user', async () => {
      mockRepo.count.mockResolvedValue(0);
      mockHashPassword.mockResolvedValue('hashed_password');
      mockRepo.create.mockResolvedValue({
        id: 1,
        email: 'admin@example.com',
        password: 'hashed_password',
        name: 'Admin User',
        role: 'admin',
        active: true,
      });

      const admin = await setupAdmin(
        mockRepo,
        {
          email: 'admin@example.com',
          password: 'password123',
          name: 'Admin User',
        },
        mockHashPassword
      );

      expect(mockHashPassword).toHaveBeenCalledWith('password123', 10);
      expect(mockRepo.create).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'hashed_password',
        name: 'Admin User',
        role: 'admin',
        active: true,
      });
      expect(admin.password).toBeUndefined();
    });

    it('should throw error if admin already exists', async () => {
      mockRepo.count.mockResolvedValue(1);

      await expect(
        setupAdmin(
          mockRepo,
          {
            email: 'admin@example.com',
            password: 'password123',
            name: 'Admin User',
          },
          mockHashPassword
        )
      ).rejects.toThrow('Admin user already exists');
    });

    it('should throw error if required fields missing', async () => {
      await expect(
        setupAdmin(mockRepo, { email: 'admin@example.com' }, mockHashPassword)
      ).rejects.toThrow('Email, password, and name are required');
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      mockComparePassword.mockResolvedValue(true);
      const isValid = await verifyPassword('password123', 'hash', mockComparePassword);
      expect(isValid).toBe(true);
      expect(mockComparePassword).toHaveBeenCalledWith('password123', 'hash');
    });

    it('should reject incorrect password', async () => {
      mockComparePassword.mockResolvedValue(false);
      const isValid = await verifyPassword('wrong', 'hash', mockComparePassword);
      expect(isValid).toBe(false);
    });
  });

  describe('login', () => {
    it('should login with correct credentials', async () => {
      const mockUser = {
        id: 1,
        email: 'admin@example.com',
        password: 'hashed_password',
        name: 'Admin User',
        active: true,
      };

      mockRepo.query.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(mockUser),
      });
      mockComparePassword.mockResolvedValue(true);

      const user = await login(mockRepo, 'admin@example.com', 'password123', mockComparePassword);

      expect(user).toBeDefined();
      expect(user.password).toBeUndefined();
      expect(user.email).toBe('admin@example.com');
    });

    it('should return null for invalid credentials', async () => {
      mockRepo.query.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      });

      const user = await login(mockRepo, 'admin@example.com', 'wrong', mockComparePassword);
      expect(user).toBeNull();
    });

    it('should return null for inactive user', async () => {
      const mockUser = {
        id: 1,
        email: 'admin@example.com',
        password: 'hashed_password',
        active: false,
      };

      mockRepo.query.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(mockUser),
      });

      const user = await login(mockRepo, 'admin@example.com', 'password123', mockComparePassword);
      expect(user).toBeNull();
    });
  });

  describe('logout', () => {
    it('should destroy session', async () => {
      const mockReq = {
        session: {
          destroy: vi.fn((callback) => callback(null)),
        },
      };
      const mockRes = {};

      await logout(mockReq, mockRes);
      expect(mockReq.session.destroy).toHaveBeenCalled();
    });

    it('should handle session destroy error', async () => {
      const mockReq = {
        session: {
          destroy: vi.fn((callback) => callback(new Error('Destroy failed'))),
        },
      };
      const mockRes = {};

      await expect(logout(mockReq, mockRes)).rejects.toThrow('Destroy failed');
    });
  });

  describe('requireAuth', () => {
    it('should call next if authenticated', () => {
      const mockReq = {
        session: {
          adminUser: { id: 1, email: 'admin@example.com' },
        },
        path: '/api/test',
      };
      const mockRes = {};
      const mockNext = vi.fn();

      requireAuth(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 401 for API requests when not authenticated', () => {
      const mockReq = {
        session: {},
        path: '/api/test',
      };
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const mockNext = vi.fn();

      requireAuth(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
