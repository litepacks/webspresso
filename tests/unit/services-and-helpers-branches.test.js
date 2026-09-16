import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';

describe('Services & Helpers Branch Coverage', () => {
  describe('plugins/admin-panel/api.js comprehensive branch coverage', () => {
    const { createApiHandlers } = require('../../plugins/admin-panel/api.js');

    it('exercises admin auth endpoints (check, setup, login, logout, me, updateProfile)', async () => {
      const mockAdminRepo = {
        name: 'AdminUser',
        query: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      };

      const mockDb = {
        getRepository: vi.fn().mockReturnValue(mockAdminRepo),
        getModel: vi.fn().mockReturnValue({
          name: 'AdminUser',
          hidden: ['password'],
          columns: new Map([
            ['id', { type: 'integer', primary: true }],
            ['name', { type: 'string' }],
            ['email', { type: 'string' }],
            ['password', { type: 'string' }],
          ]),
          relations: {},
          admin: { enabled: true },
        }),
      };

      const hashPassword = vi.fn().mockResolvedValue('hashed_pw');
      const comparePassword = vi.fn().mockImplementation(async (plain, hashed) => (plain === 'valid_pw' || plain === 'current_secret') && (hashed === 'hashed_pw' || hashed === 'current_hashed'));

      const handlers = createApiHandlers({
        path: '/_admin',
        db: mockDb,
        AdminUser: { name: 'AdminUser' },
        hashPassword,
        comparePassword,
        richTextSanitize: true,
      });

      // 1. checkHandler
      const resCheck1 = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      mockAdminRepo.query.mockReturnValue({
        count: vi.fn().mockResolvedValue([{ count: 1 }]),
      });
      await handlers.checkHandler({}, resCheck1);
      expect(resCheck1.json).toHaveBeenCalled();

      // checkHandler with no repo
      const handlersNoRepo = createApiHandlers({ path: '/_admin', db: null });
      const resCheck2 = { json: vi.fn() };
      await handlersNoRepo.checkHandler({}, resCheck2);
      expect(resCheck2.json).toHaveBeenCalledWith({ exists: false });

      // 2. setupHandler
      const resSetupErr1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlersNoRepo.setupHandler({ body: {} }, resSetupErr1);
      expect(resSetupErr1.status).toHaveBeenCalledWith(500);

      const resSetupErr2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.setupHandler({ body: { email: '' } }, resSetupErr2);
      expect(resSetupErr2.status).toHaveBeenCalledWith(400);

      const resSetupOk = { json: vi.fn() };
      mockAdminRepo.query.mockReturnValue({
        count: vi.fn().mockResolvedValue([{ count: 0 }]),
      });
      mockAdminRepo.create.mockResolvedValue({ id: 1, email: 'admin@test.com', name: 'Admin' });
      const reqSetup = { body: { email: 'admin@test.com', password: 'password123', name: 'Admin' }, session: {} };
      await handlers.setupHandler(reqSetup, resSetupOk);
      expect(reqSetup.session.adminUser).toBeDefined();
      expect(resSetupOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 3. loginHandler
      const resLoginErr1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlersNoRepo.loginHandler({ body: {} }, resLoginErr1);
      expect(resLoginErr1.status).toHaveBeenCalledWith(500);

      const resLoginErr2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.loginHandler({ body: { email: 'admin@test.com' } }, resLoginErr2);
      expect(resLoginErr2.status).toHaveBeenCalledWith(400);

      // login invalid credentials
      mockAdminRepo.query.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1, password: 'hashed_pw', active: true }),
      });
      const resLogin401 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.loginHandler({ body: { email: 'admin@test.com', password: 'wrong' }, session: {} }, resLogin401);
      expect(resLogin401.status).toHaveBeenCalledWith(401);

      // login success
      const reqLoginOk = { body: { email: 'admin@test.com', password: 'valid_pw' }, session: {} };
      const resLoginOk = { json: vi.fn() };
      await handlers.loginHandler(reqLoginOk, resLoginOk);
      expect(reqLoginOk.session.adminUser).toBeDefined();

      // 4. logoutHandler
      const reqLogout = {
        session: {
          destroy: (cb) => cb(null),
        },
      };
      const resLogout = { json: vi.fn(), clearCookie: vi.fn() };
      await handlers.logoutHandler(reqLogout, resLogout);
      expect(resLogout.json).toHaveBeenCalledWith({ success: true });

      // 5. meHandler
      const resMe401 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.meHandler({ session: {} }, resMe401);
      expect(resMe401.status).toHaveBeenCalledWith(401);

      const resMeOk = { json: vi.fn() };
      handlers.meHandler({ session: { adminUser: { id: 1, name: 'Admin' } } }, resMeOk);
      expect(resMeOk.json).toHaveBeenCalledWith({ user: { id: 1, name: 'Admin' } });

      // 6. updateProfileHandler
      const resProf401 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler({ session: {} }, resProf401);
      expect(resProf401.status).toHaveBeenCalledWith(401);

      const resProf500 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlersNoRepo.updateProfileHandler({ session: { adminUser: { id: 1 } } }, resProf500);
      expect(resProf500.status).toHaveBeenCalledWith(500);

      // user not found
      mockAdminRepo.findById.mockResolvedValueOnce(null);
      const resProf404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler({ session: { adminUser: { id: 999 } }, body: {} }, resProf404);
      expect(resProf404.status).toHaveBeenCalledWith(404);

      // duplicate email
      mockAdminRepo.findById.mockResolvedValue({ id: 1, email: 'admin@test.com', password: 'current_hashed' });
      mockAdminRepo.query.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValueOnce({ id: 2 }),
      });
      const resProfDup = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler(
        { session: { adminUser: { id: 1 } }, body: { email: 'other@test.com' } },
        resProfDup
      );
      expect(resProfDup.status).toHaveBeenCalledWith(400);

      // password change missing current
      const resProfNoCurPw = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler(
        { session: { adminUser: { id: 1 } }, body: { newPassword: 'newpassword123' } },
        resProfNoCurPw
      );
      expect(resProfNoCurPw.status).toHaveBeenCalledWith(400);

      // password change incorrect current
      const resProfWrongPw = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler(
        { session: { adminUser: { id: 1 } }, body: { currentPassword: 'wrong', newPassword: 'newpassword123' } },
        resProfWrongPw
      );
      expect(resProfWrongPw.status).toHaveBeenCalledWith(400);

      // password change too short
      const resProfShortPw = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler(
        { session: { adminUser: { id: 1 } }, body: { currentPassword: 'current_secret', newPassword: '123' } },
        resProfShortPw
      );
      expect(resProfShortPw.status).toHaveBeenCalledWith(400);

      // profile update success
      mockAdminRepo.findById.mockResolvedValue({ id: 1, name: 'New Name', email: 'admin@test.com', password: 'current_hashed' });
      const reqProfSuccess = {
        session: { adminUser: { id: 1, name: 'Old' } },
        body: { name: 'New Name', currentPassword: 'current_secret', newPassword: 'newpassword123' },
      };
      const resProfSuccess = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateProfileHandler(reqProfSuccess, resProfSuccess);
      expect(resProfSuccess.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(reqProfSuccess.session.adminUser.name).toBe('New Name');
    });

    it('exercises model metadata, records list, filtering, search, pagination, and sorting', async () => {
      const mockPostModel = {
        name: 'Post',
        table: 'posts',
        primaryKey: 'id',
        hidden: ['internal_secret'],
        relations: { author: { type: 'belongsTo' } },
        scopes: { softDelete: true },
        columns: new Map([
          ['id', { type: 'integer', primary: true, sortable: true }],
          ['title', { type: 'string', sortable: true }],
          ['content', { type: 'text', sortable: false }],
          ['active', { type: 'boolean' }],
          ['views', { type: 'integer' }],
          ['created_at', { type: 'datetime', auto: 'create' }],
          ['internal_secret', { type: 'string' }],
        ]),
        admin: {
          enabled: true,
          label: 'Posts',
          icon: 'file-text',
          customFields: {
            content: { type: 'rich-text' },
          },
          queries: {
            published: vi.fn().mockImplementation(async (repo) => [{ id: 1, title: 'Published Post' }]),
          },
        },
      };

      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
        whereNull: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        whereBetween: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        onlyTrashed: vi.fn().mockReturnThis(),
        withTrashed: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue(42),
        list: vi.fn().mockResolvedValue([
          { id: 1, title: 'First Post', content: '<p>Hello</p>', active: 1, internal_secret: 'hide_me' },
        ]),
      };

      const mockRepo = {
        query: vi.fn().mockReturnValue(mockQueryBuilder),
        findById: vi.fn().mockResolvedValue({ id: 1, title: 'First Post' }),
        create: vi.fn().mockResolvedValue({ id: 2, title: 'Created Post' }),
        update: vi.fn().mockResolvedValue({ id: 1, title: 'Updated Post' }),
        delete: vi.fn().mockResolvedValue(true),
        restore: vi.fn().mockResolvedValue(true),
        forceDelete: vi.fn().mockResolvedValue(true),
      };

      const mockDb = {
        getModel: vi.fn((name) => (name === 'Post' ? mockPostModel : null)),
        getAllModels: vi.fn(() => [mockPostModel]),
        getRepository: vi.fn(() => mockRepo),
      };

      const handlers = createApiHandlers({
        path: '/_admin',
        db: mockDb,
        richTextSanitize: true,
      });

      // 1. modelsHandler
      const resModels = { json: vi.fn() };
      handlers.modelsHandler({}, resModels);
      expect(resModels.json).toHaveBeenCalledWith({
        models: expect.arrayContaining([expect.objectContaining({ name: 'Post' })]),
      });

      // 2. modelHandler (found vs not found vs disabled)
      const resModel404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      handlers.modelHandler({ params: { model: 'Unknown' } }, resModel404);
      expect(resModel404.status).toHaveBeenCalledWith(404);

      const resModelOk = { json: vi.fn() };
      handlers.modelHandler({ params: { model: 'Post' } }, resModelOk);
      expect(resModelOk.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Post', primaryKey: 'id' }));

      // 3. recordsListHandler with full filter suite, trashed='only', search, sort
      const reqList = {
        params: { model: 'Post' },
        query: {
          page: '2',
          perPage: '10',
          trashed: 'only',
          search: 'tech',
          sort: 'title',
          order: 'asc',
          filter: {
            id: { op: 'is_not_null' },
            views: { op: 'between', from: '10', to: '100' },
            active: { op: 'eq', value: 'true' },
            title: { op: 'starts_with', value: 'Doc' },
          },
        },
      };
      const resList = { json: vi.fn() };
      await handlers.recordsListHandler(reqList, resList);
      expect(mockQueryBuilder.onlyTrashed).toHaveBeenCalled();
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(resList.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: expect.objectContaining({ page: 2, total: 42 }),
      }));

      // Test recordsListHandler with trashed='include' & fallback sort
      const reqList2 = {
        params: { model: 'Post' },
        query: {
          trashed: 'include',
          sort: 'content', // content is sortable: false
          filter: {
            views: { op: 'gt', value: 50 },
            title: { op: 'ends_with', value: 'Guide' },
            active: { op: 'in', value: [1, 2] },
          },
        },
      };
      await handlers.recordsListHandler(reqList2, { json: vi.fn() });
      expect(mockQueryBuilder.withTrashed).toHaveBeenCalled();

      // 4. recordHandler (found vs 404)
      const resRecord404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      mockRepo.findById.mockResolvedValueOnce(null);
      await handlers.recordHandler({ params: { model: 'Post', id: '999' } }, resRecord404);
      expect(resRecord404.status).toHaveBeenCalledWith(404);

      const resRecordOk = { json: vi.fn() };
      mockRepo.findById.mockResolvedValueOnce({ id: 1, title: 'Post 1', internal_secret: 'hidden' });
      await handlers.recordHandler({ params: { model: 'Post', id: '1' } }, resRecordOk);
      expect(resRecordOk.json).toHaveBeenCalled();

      // 5. createRecordHandler with rich text sanitization & validation error extraction
      const resCreateOk = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createRecordHandler(
        { params: { model: 'Post' }, body: { title: 'New', content: '<script>alert(1)</script><p>Hi</p>' } },
        resCreateOk
      );
      expect(mockRepo.create).toHaveBeenCalled();
      expect(resCreateOk.status).toHaveBeenCalledWith(201);

      // Validation error with issues
      mockRepo.create.mockRejectedValueOnce({
        issues: [{ path: ['title'], message: 'Title is required' }],
      });
      const resCreateValErr = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createRecordHandler({ params: { model: 'Post' }, body: {} }, resCreateValErr);
      expect(resCreateValErr.status).toHaveBeenCalledWith(400);

      // 6. updateRecordHandler (not found, validation error with fields map, success)
      mockRepo.update.mockResolvedValueOnce(null);
      const resUp404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateRecordHandler({ params: { model: 'Post', id: '99' }, body: {} }, resUp404);
      expect(resUp404.status).toHaveBeenCalledWith(404);

      mockRepo.update.mockRejectedValueOnce({
        errors: [{ path: ['views'], message: 'Must be positive' }],
      });
      const resUpValErr = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateRecordHandler({ params: { model: 'Post', id: '1' }, body: { views: -5 } }, resUpValErr);
      expect(resUpValErr.status).toHaveBeenCalledWith(400);

      mockRepo.update.mockResolvedValue({ id: 1, title: 'Updated' });
      const resUpOk = { json: vi.fn() };
      await handlers.updateRecordHandler({ params: { model: 'Post', id: '1' }, body: { title: 'Updated' } }, resUpOk);
      expect(resUpOk.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));

      // 7. deleteRecordHandler
      mockRepo.delete.mockResolvedValueOnce(false);
      const resDel404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.deleteRecordHandler({ params: { model: 'Post', id: '99' } }, resDel404);
      expect(resDel404.status).toHaveBeenCalledWith(404);

      mockRepo.delete.mockResolvedValueOnce(true);
      const resDelOk = { json: vi.fn() };
      await handlers.deleteRecordHandler({ params: { model: 'Post', id: '1' } }, resDelOk);
      expect(resDelOk.json).toHaveBeenCalledWith({ success: true });

      // 8. restoreRecordHandler
      const resRestoreOk = { json: vi.fn() };
      await handlers.restoreRecordHandler({ params: { model: 'Post', id: '1' } }, resRestoreOk);
      expect(resRestoreOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 9. queryHandler (found vs not found)
      const resQuery404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.queryHandler({ params: { model: 'Post', query: 'nonexistent' } }, resQuery404);
      expect(resQuery404.status).toHaveBeenCalledWith(404);

      const resQueryOk = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.queryHandler({ params: { model: 'Post', query: 'published' } }, resQueryOk);
      expect(mockPostModel.admin.queries.published).toHaveBeenCalled();
      expect(resQueryOk.json).toHaveBeenCalled();
    });
  });

  describe('core/auth/manager.js comprehensive branch coverage', () => {
    const { AuthManager } = require('../../core/auth/manager.js');

    it('exercises registration, tokens, passwords, verification, and remember-me', async () => {
      const mockUsers = new Map();
      const mockTokens = new Map();

      const auth = new AuthManager({
        session: { secret: 'test-secret-key-12345' },
        jwt: { enabled: true, secret: 'jwt-secret-xyz' },
        findUserById: async (id) => mockUsers.get(Number(id)) || null,
        findUserByCredentials: async (email, pw) => {
          for (const u of mockUsers.values()) {
            if (u.email === email && pw === 'validpass') return u;
          }
          return null;
        },
        findUserByIdentifier: async (email) => {
          for (const u of mockUsers.values()) {
            if (u.email === email) return u;
          }
          return null;
        },
        updateUser: async (id, data) => {
          const u = mockUsers.get(Number(id));
          if (u) Object.assign(u, data);
          return u;
        },
        rememberTokens: {
          create: async (userId, token, exp) => {
            mockTokens.set(token, { user_id: userId, token, expires_at: exp });
          },
          find: async (token) => mockTokens.get(token) || null,
          delete: async (token) => { mockTokens.delete(token); },
          deleteAllForUser: async (userId) => {
            for (const [k, v] of mockTokens.entries()) {
              if (v.user_id === userId) mockTokens.delete(k);
            }
          },
        },
        authTokens: {
          create: async (userId, type, token, exp) => ({ user_id: userId, type, token, expires_at: exp }),
          find: async (token, type) => ({ user_id: 1, type, token, expires_at: new Date(Date.now() + 60000) }),
          delete: async (token) => true,
          deleteAllForUser: async (userId) => true,
          consume: async () => true,
        },
        notifications: {
          passwordReset: vi.fn(),
          emailVerification: vi.fn(),
          welcome: vi.fn(),
        },
      });

      // 1. Initial user setup
      mockUsers.set(1, { id: 1, email: 'user@test.com', password: 'hashed_password', email_verified_at: null });

      // 2. Request & complete password reset
      const resetRes = await auth.requestPasswordReset('user@test.com');
      expect(resetRes.sent).toBe(true);
      expect(auth.notifications.passwordReset).toHaveBeenCalled();

      // Non-existent user returns sent: false
      const noUserReset = await auth.requestPasswordReset('nobody@test.com');
      expect(noUserReset.sent).toBe(false);

      // Complete password reset
      const resetDone = await auth.completePasswordReset('valid_token', 'newsecretpass');
      expect(resetDone.ok).toBe(true);

      // 3. Email verification
      const verifySent = await auth.requestEmailVerification(1);
      expect(verifySent.sent).toBe(true);
      expect(auth.notifications.emailVerification).toHaveBeenCalled();

      const verifyDone = await auth.verifyEmail('valid_verify_token');
      expect(verifyDone.ok).toBe(true);

      // 4. Request context operations (login, check, guest, logout)
      const mockReq = { session: {}, user: null, cookies: {}, signedCookies: {} };
      const mockRes = { cookie: vi.fn(), clearCookie: vi.fn() };
      const authCtx = auth.createRequestAuth(mockReq, mockRes);

      expect(authCtx.guest()).toBe(true);
      expect(authCtx.check()).toBe(false);

      const user = await authCtx.attempt('user@test.com', 'validpass', { remember: true });
      expect(user).toBeDefined();
      expect(authCtx.check()).toBe(true);
      expect(authCtx.id()).toBe(1);

      await authCtx.logout();
      expect(authCtx.check()).toBe(false);
    });
  });

  describe('plugins/admin-panel/modules/admin-users.js comprehensive branch coverage', () => {
    const { createAdminUsersApiHandlers } = require('../../plugins/admin-panel/modules/admin-users.js');

    it('exercises full admin CRUD: list, get, create, update, delete with security constraints', async () => {
      const admins = new Map([
        [1, { id: 1, email: 'super@admin.com', name: 'Super Admin', role: 'admin', active: 1 }],
        [2, { id: 2, email: 'editor@admin.com', name: 'Editor', role: 'editor', active: 1 }],
      ]);

      const mockRepo = {
        query: vi.fn().mockImplementation(() => {
          let list = Array.from(admins.values());
          const builder = {
            where: vi.fn((arg1, arg2, arg3) => {
              if (typeof arg1 === 'function') {
                const sub = {
                  where: vi.fn().mockReturnThis(),
                  orWhere: vi.fn().mockReturnThis(),
                };
                arg1(sub);
              }
              return builder;
            }),
            whereNot: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            count: vi.fn().mockResolvedValue([{ count: 2 }]),
            first: vi.fn().mockImplementation(async () => null),
            then: (resolve) => resolve(list),
          };
          return builder;
        }),
        findById: vi.fn(async (id) => admins.get(Number(id)) || null),
        create: vi.fn(async (data) => {
          const newAdmin = { id: 3, ...data };
          admins.set(3, newAdmin);
          return newAdmin;
        }),
        update: vi.fn(async (id, data) => {
          const a = admins.get(Number(id));
          if (a) Object.assign(a, data);
          return a;
        }),
        delete: vi.fn(async (id) => {
          admins.delete(Number(id));
          return true;
        }),
      };

      const mockDb = {
        getRepository: vi.fn().mockReturnValue(mockRepo),
        knex: {
          client: { config: { client: 'sqlite3' } },
        },
      };

      const handlers = createAdminUsersApiHandlers({
        db: mockDb,
        AdminUser: { name: 'AdminUser' },
        hashPassword: async (pw) => `hashed_${pw}`,
      });

      // 1. listAdmins with search, role, active filter
      const resList = { json: vi.fn() };
      await handlers.listAdmins({ query: { search: 'admin', role: 'admin', active: 'true' } }, resList);
      expect(resList.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, total: 2 }));

      // 2. getAdmin (404 vs found)
      const resGet404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.getAdmin({ params: { id: '999' } }, resGet404);
      expect(resGet404.status).toHaveBeenCalledWith(404);

      const resGetOk = { json: vi.fn() };
      await handlers.getAdmin({ params: { id: '1' } }, resGetOk);
      expect(resGetOk.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ email: 'super@admin.com' }),
      }));

      // 3. createAdmin validations (missing email, bad email, short pw, missing name, duplicate)
      const resCrNoEmail = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin({ body: {} }, resCrNoEmail);
      expect(resCrNoEmail.status).toHaveBeenCalledWith(400);

      const resCrBadEmail = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin({ body: { email: 'invalid_email' } }, resCrBadEmail);
      expect(resCrBadEmail.status).toHaveBeenCalledWith(400);

      const resCrShortPw = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin({ body: { email: 'a@b.com', password: 'short' } }, resCrShortPw);
      expect(resCrShortPw.status).toHaveBeenCalledWith(400);

      const resCrNoName = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin({ body: { email: 'a@b.com', password: 'validpassword123' } }, resCrNoName);
      expect(resCrNoName.status).toHaveBeenCalledWith(400);

      // createAdmin success
      const resCrOk = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.createAdmin(
        { body: { email: 'new@admin.com', password: 'validpassword123', name: 'New Admin', role: 'admin', active: true } },
        resCrOk
      );
      expect(resCrOk.status).toHaveBeenCalledWith(201);

      // 4. updateAdmin (not found, empty name, self-deactivation protection, last active admin protection, success)
      const resUp404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateAdmin({ params: { id: '999' }, body: {} }, resUp404);
      expect(resUp404.status).toHaveBeenCalledWith(404);

      const resUpEmptyName = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateAdmin({ params: { id: '1' }, body: { name: '   ' } }, resUpEmptyName);
      expect(resUpEmptyName.status).toHaveBeenCalledWith(400);

      // Self-deactivation prevention
      const resUpSelfDeact = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.updateAdmin(
        { params: { id: '1' }, session: { adminUser: { id: 1 } }, body: { active: false } },
        resUpSelfDeact
      );
      expect(resUpSelfDeact.status).toHaveBeenCalledWith(400);

      // updateAdmin success
      const resUpOk = { json: vi.fn() };
      await handlers.updateAdmin(
        { params: { id: '2' }, session: { adminUser: { id: 1 } }, body: { name: 'Updated Editor', role: 'admin' } },
        resUpOk
      );
      expect(resUpOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 5. deleteAdmin (not found, self-delete prevention, last active admin, success)
      const resDel404 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.deleteAdmin({ params: { id: '999' } }, resDel404);
      expect(resDel404.status).toHaveBeenCalledWith(404);

      const resDelSelf = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await handlers.deleteAdmin({ params: { id: '1' }, session: { adminUser: { id: 1 } } }, resDelSelf);
      expect(resDelSelf.status).toHaveBeenCalledWith(400);

      const resDelOk = { json: vi.fn() };
      await handlers.deleteAdmin({ params: { id: '3' }, session: { adminUser: { id: 1 } } }, resDelOk);
      expect(resDelOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('plugins/file-manager/core.js comprehensive branch coverage', () => {
    const {
      resolveSafePath,
      getFileType,
      getMimeType,
      sanitizeName,
    } = require('../../plugins/file-manager/core.js');

    it('exercises resolveSafePath edge cases, categories, mimes, and sanitizers', () => {
      const base = '/tmp/uploads';

      expect(resolveSafePath(base, '')).toBe(path.resolve(base));
      expect(resolveSafePath(base, 'sub/file.png')).toBe(path.resolve(base, 'sub/file.png'));
      expect(() => resolveSafePath('')).toThrow('Invalid base directory');
      expect(() => resolveSafePath(base, 123)).toThrow('Path must be a string');
      expect(() => resolveSafePath(base, 'sub/\0file.png')).toThrow('Null byte detected');
      expect(() => resolveSafePath(base, '%00file.png')).toThrow('Null byte detected');
      expect(() => resolveSafePath(base, '../outside.txt')).toThrow('Directory traversal attempt detected');

      // Categories (getFileType)
      expect(getFileType('png')).toBe('image');
      expect(getFileType('.pdf')).toBe('document');
      expect(getFileType('txt')).toBe('text');
      expect(getFileType('mp3')).toBe('audio');
      expect(getFileType('mp4')).toBe('video');
      expect(getFileType('zip')).toBe('archive');
      expect(getFileType('xyz123')).toBe('other');

      // MIME types
      expect(getMimeType('.jpg')).toBe('image/jpeg');
      expect(getMimeType('.css')).toBe('text/css');
      expect(getMimeType('.unknown99')).toBe('application/octet-stream');

      // Sanitize name
      expect(sanitizeName('  good_file.png  ')).toBe('good_file.png');
      expect(() => sanitizeName('../bad.png')).toThrow();
      expect(() => sanitizeName('.hidden')).toThrow();
    });
  });

  describe('plugins/data-exchange/import.js branch coverage', () => {
    const {
      allowedImportColumns,
      buildPayloadForRow,
    } = require('../../plugins/data-exchange/import.js');

    it('exercises allowedImportColumns and buildPayloadForRow', () => {
      const model = {
        hidden: ['secret'],
        columns: new Map([
          ['id', { type: 'integer' }],
          ['score', { type: 'decimal' }],
          ['active', { type: 'boolean' }],
          ['created_at', { type: 'datetime' }],
          ['metadata', { type: 'json' }],
          ['secret', { type: 'string' }],
          ['raw_val', {}],
        ]),
      };

      const cols = allowedImportColumns(model);
      expect(cols).toContain('id');
      expect(cols).toContain('score');
      expect(cols).not.toContain('secret');

      // buildPayloadForRow
      const payload = buildPayloadForRow(model, { id: '10', active: 'yes', secret: 'ignore_me' }, 'create');
      expect(payload.id).toBe(10);
      expect(payload.active).toBe(true);
      expect(payload.secret).toBeUndefined();
    });
  });

  describe('core/orm/schema-helpers.js branch coverage', () => {
    const {
      createSchemaHelpers,
      encodeColumnMeta,
      decodeColumnMeta,
      hasColumnMeta,
      getColumnMeta,
      extractColumnsFromSchema,
    } = require('../../core/orm/schema-helpers.js');

    it('exercises zdb schema builders and helper methods', () => {
      const zdb = createSchemaHelpers(z);

      const idField = zdb.id();
      const stringField = zdb.string({ min: 2, max: 50, unique: true });
      const enumField = zdb.enum(['draft', 'published'], { default: 'draft' });
      const jsonField = zdb.json({ default: {} });
      const boolField = zdb.boolean({ default: false });
      const dateField = zdb.datetime({ auto: 'create' });
      const fileField = zdb.file({ accept: ['image/*'], maxSize: 5000 });

      expect(idField).toBeDefined();
      expect(stringField).toBeDefined();
      expect(enumField).toBeDefined();
      expect(jsonField).toBeDefined();
      expect(boolField).toBeDefined();
      expect(dateField).toBeDefined();
      expect(fileField).toBeDefined();

      const testSchema = z.object({
        id: idField,
        name: stringField,
        status: enumField,
        active: boolField,
      });

      const extracted = extractColumnsFromSchema(testSchema);
      expect(extracted.has('id')).toBe(true);
      expect(extracted.has('name')).toBe(true);
      expect(extracted.get('id').primary).toBe(true);

      const encoded = encodeColumnMeta({ type: 'string', unique: true });
      expect(typeof encoded).toBe('string');
      const decoded = decodeColumnMeta(encoded);
      expect(decoded.type).toBe('string');
      expect(decodeColumnMeta(null)).toBeNull();
    });
  });

  describe('core/queue/adapters/redis.js branch coverage', () => {
    const { RedisQueueAdapter } = require('../../core/queue/adapters/redis.js');

    it('exercises redis queue methods with simulated client', async () => {
      const mockStorage = new Map();
      const mockClient = {
        status: 'ready',
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn(async (k) => mockStorage.get(k) || null),
        zadd: vi.fn().mockResolvedValue(1),
        zcard: vi.fn().mockResolvedValue(2),
        scard: vi.fn().mockResolvedValue(1),
        srem: vi.fn().mockResolvedValue(1),
        del: vi.fn(async (k) => { mockStorage.delete(k); return 1; }),
      };

      const adapter = new RedisQueueAdapter({
        client: mockClient,
        prefix: 'test-queue:',
      });

      const jobData = { id: 'j1', name: 'send-email', data: { to: 'a@b.com' } };
      await adapter.enqueue(jobData);
      expect(mockClient.set).toHaveBeenCalled();

      const stats = await adapter.getStats();
      expect(stats.total).toBeGreaterThan(0);

      await adapter.clear();
      expect(mockClient.del).toHaveBeenCalled();
    });
  });

  describe('src/plugin-manager.js branch coverage', () => {
    const { PluginManager } = require('../../src/plugin-manager.js');

    it('exercises plugin registration, hooks, dependency ordering and errors', async () => {
      const pm = new PluginManager();

      const mockCtx = {
        app: {},
        config: {},
        events: { emit: vi.fn(), on: vi.fn() },
      };

      const p1 = {
        name: 'plugin-one',
        version: '1.0.0',
        register: vi.fn(),
        onRoutesReady: vi.fn(),
        disposer: vi.fn(),
        csp: { scriptSrc: ["'self'"] },
        api: { ping: () => 'pong' },
      };

      const p2 = {
        name: 'plugin-two',
        version: '1.0.0',
        dependencies: ['plugin-one'],
        register: vi.fn(),
        setup: vi.fn(),
      };

      await pm.register([p1, p2], mockCtx);

      expect(pm.plugins.has('plugin-one')).toBe(true);
      expect(pm.plugins.has('plugin-two')).toBe(true);
      expect(pm.plugins.has('unknown')).toBe(false);

      expect(p1.register).toHaveBeenCalled();
      expect(p2.register).toHaveBeenCalled();
      expect(p2.setup).toHaveBeenCalled();

      expect(pm.getCspDirectives()).toEqual(expect.objectContaining({
        scriptSrc: ["'self'"],
      }));

      await pm.onRoutesReady(mockCtx);
      expect(p1.onRoutesReady).toHaveBeenCalled();

      // Sync registration check
      const pmSync = new PluginManager();
      pmSync.registerSync([p1], mockCtx);
      expect(pmSync.plugins.has('plugin-one')).toBe(true);
    });
  });

  describe('src/services/memoize.js and src/services/registry.js comprehensive branch coverage', () => {
    const {
      memoize,
      parseTtlMs,
      stableCacheKey,
      safeClone,
    } = require('../../src/services/memoize.js');
    const { ServiceRegistry } = require('../../src/services/registry.js');

    it('exercises parseTtlMs durations and edge cases', () => {
      expect(parseTtlMs('5s')).toBe(5000);
      expect(parseTtlMs('2m')).toBe(120000);
      expect(parseTtlMs('1h')).toBe(3600000);
      expect(parseTtlMs('1d')).toBe(86400000);
      expect(parseTtlMs('100')).toBe(100000);
      expect(parseTtlMs(1500)).toBe(1500);
      expect(parseTtlMs(-500)).toBe(60000);
      expect(parseTtlMs(true)).toBe(60000);
      expect(parseTtlMs(null)).toBe(60000);
      expect(parseTtlMs('invalid')).toBe(60000);
    });

    it('exercises stableCacheKey with all types and circular references', () => {
      expect(stableCacheKey(undefined)).toBe('__undefined__');
      expect(stableCacheKey(null)).toBe('__null__');
      expect(stableCacheKey('hello')).toBe('"hello"');
      expect(stableCacheKey(42)).toBe('42');
      expect(stableCacheKey(true)).toBe('true');
      expect(stableCacheKey(100n)).toBe('100n');
      expect(stableCacheKey(Symbol('test'))).toBe('Symbol(test)');
      expect(stableCacheKey(/abc/i)).toBe('[RegExp:/abc/i]');
      expect(stableCacheKey(Buffer.from('hi'))).toContain('[Buffer:');
      expect(stableCacheKey(new Date('2026-09-16T12:00:00Z'))).toBe('[Date:2026-09-16T12:00:00.000Z]');

      const circular = { a: 1 };
      circular.self = circular;
      expect(stableCacheKey(circular)).toContain('[Circular]');
    });

    it('exercises memoize LRU eviction, thundering herd deduping, clear, delete, and size', async () => {
      let callCount = 0;
      const fn = vi.fn(async (x) => {
        callCount++;
        return { count: callCount, x };
      });

      const cached = memoize(fn, { ttl: 10000, maxSize: 2, clone: true });

      // First call
      const res1 = await cached(1);
      expect(res1.count).toBe(1);

      // Cache hit
      const res2 = await cached(1);
      expect(res2.count).toBe(1);
      expect(res1).not.toBe(res2); // clone = true

      expect(cached.has(1)).toBe(true);
      expect(cached.size).toBe(1);

      // Second key
      await cached(2);
      expect(cached.size).toBe(2);

      // Third key causes LRU eviction of key 1
      await cached(3);
      expect(cached.size).toBe(2);
      expect(cached.has(1)).toBe(false);

      // Invalidation / delete
      cached.delete(2);
      expect(cached.has(2)).toBe(false);

      // Clear
      cached.clear();
      expect(cached.size).toBe(0);

      // Error thrown is not cached
      const errFn = memoize(async () => {
        throw new Error('fail');
      });
      await expect(errFn()).rejects.toThrow('fail');
    });

    it('exercises ServiceRegistry programmatic registration, aliases, caches, and reload', async () => {
      const reg = new ServiceRegistry();

      // Register with object definition
      reg.register('math.add', {
        handler: async ({ a, b }) => a + b,
        cache: '10s',
        description: 'Adds two numbers',
      });

      // Register with function definition
      reg.register('math.sub', async ({ a, b }) => a - b);

      expect(reg.has('math.add')).toBe(true);
      expect(reg.has('math.sub')).toBe(true);
      expect(reg.has('math.mul')).toBe(false);
      expect(reg.list()).toEqual(['math.add', 'math.sub']);

      const sum = await reg.call('math.add', { a: 10, b: 5 });
      expect(sum).toBe(15);

      // Invalidation & Clear
      reg.invalidate('math.add', { a: 10, b: 5 });
      reg.clearCache('math.add');
      reg.clearAllCaches();

      // Error branches
      expect(() => reg.register('', () => {})).toThrow();
      expect(() => reg.register('math.add', () => {})).toThrow();
      expect(() => reg.register('invalid', null)).toThrow();
    });
  });

  describe('src/services/builtins/auth.js and file-manager.js branch coverage', () => {
    const { createAuthServices } = require('../../src/services/builtins/auth.js');
    const { createFileManagerServices } = require('../../src/services/builtins/file-manager.js');
    const { hash } = require('../../core/auth/hash');

    it('exercises auth builtin services (change-password, verify-email)', async () => {
      const hashedPw = await hash('correct_pw');
      const mockUsers = new Map([
        [1, { id: 1, password: hashedPw, email_verified_at: null }],
      ]);

      const mockDb = {
        getRepository: () => ({
          findById: async (id) => mockUsers.get(Number(id)) || null,
          update: async (id, data) => {
            const u = mockUsers.get(Number(id));
            if (u) Object.assign(u, data);
            return u;
          },
        }),
      };

      const authServices = createAuthServices({
        userModel: 'User',
      });

      const changePwDef = authServices['auth.change-password'];

      // 1. Missing user in context
      await expect(
        changePwDef.handler({ currentPassword: 'any', newPassword: 'newpassword123' }, { db: mockDb })
      ).rejects.toThrow('User authentication required');

      // 2. User not found in db
      await expect(
        changePwDef.handler(
          { currentPassword: 'any', newPassword: 'newpassword123' },
          { db: mockDb, user: { id: 999 } }
        )
      ).rejects.toThrow('User not found');

      // 3. Incorrect current password
      await expect(
        changePwDef.handler(
          { currentPassword: 'wrong_pw', newPassword: 'newpassword123' },
          { db: mockDb, user: { id: 1 } }
        )
      ).rejects.toThrow('Current password does not match');

      // 4. Success password change
      const changeRes = await changePwDef.handler(
        { currentPassword: 'correct_pw', newPassword: 'newpassword123' },
        { db: mockDb, user: { id: 1 } }
      );
      expect(changeRes.success).toBe(true);
    });

    it('exercises fileManager builtin services (mkdir, rename, delete, move, upload)', async () => {
      const tmpBase = path.join(__dirname, '../../tmp/test-file-manager-services');
      await fs.rm(tmpBase, { recursive: true, force: true });
      await fs.mkdir(tmpBase, { recursive: true });

      const fmServices = createFileManagerServices({
        defaultBaseDir: tmpBase,
        defaultPublicBase: '/uploads',
      });

      // 1. mkdir
      const mkdirRes = await fmServices['fileManager.mkdir'].handler({
        path: '',
        name: 'test-folder',
        baseDir: tmpBase,
      });
      expect(mkdirRes.name).toBe('test-folder');

      // 2. upload with base64 data URL
      const base64Data = 'data:text/plain;base64,' + Buffer.from('Hello File').toString('base64');
      const uploadRes = await fmServices['fileManager.upload'].handler({
        path: 'test-folder',
        base64: base64Data,
        originalName: 'greeting.txt',
        baseDir: tmpBase,
      });
      expect(uploadRes.name).toBe('greeting.txt');

      // 3. rename
      const renameRes = await fmServices['fileManager.rename'].handler({
        path: 'test-folder/greeting.txt',
        newName: 'hello.txt',
        baseDir: tmpBase,
      });
      expect(renameRes.newName).toBe('hello.txt');

      // 4. move
      const moveRes = await fmServices['fileManager.move'].handler({
        source: 'test-folder/hello.txt',
        destination: '',
        baseDir: tmpBase,
      });
      expect(moveRes.newPath).toBe('hello.txt');

      // 5. delete
      const deleteRes = await fmServices['fileManager.delete'].handler({
        path: 'hello.txt',
        baseDir: tmpBase,
      });
      expect(deleteRes.success).toBe(true);

      // 6. upload validation errors (invalid buffer, empty buffer)
      await expect(
        fmServices['fileManager.upload'].handler({
          buffer: 12345,
          baseDir: tmpBase,
        })
      ).rejects.toThrow('Invalid buffer provided');

      await expect(
        fmServices['fileManager.upload'].handler({
          baseDir: tmpBase,
        })
      ).rejects.toThrow('No file content provided');

      await fs.rm(tmpBase, { recursive: true, force: true });
    });
  });

  describe('src/server.js nunjucks filters, wrapAsync, and HTTP method wrapper branches', () => {
    const { createApp } = require('../../src/server.js');
    const request = require('supertest');

    it('exercises nunjucks json, t, and date filters with all parameters', () => {
      const { nunjucksEnv } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages-basic'),
        helmet: false,
      });

      // 1. json filter with script escaping and undefined
      expect(nunjucksEnv.renderString("{{ data | json | safe }}", { data: { html: '<script>alert(1)&</script>' } }))
        .toContain('\\u003cscript\\u003ealert(1)\\u0026\\u003c/script\\u003e');
      expect(nunjucksEnv.renderString("{{ data | json | safe }}", { data: undefined })).toBe('');

      // 2. date filter with format 'short', 'long', 'iso', and default
      const d = new Date('2026-09-16T12:00:00Z');
      expect(nunjucksEnv.renderString("{{ date | date('short') }}", { date: d })).toBe(d.toLocaleDateString());
      expect(nunjucksEnv.renderString("{{ date | date('long') }}", { date: d })).toBe(
        d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      );
      expect(nunjucksEnv.renderString("{{ date | date('iso') }}", { date: d })).toBe(d.toISOString());
      expect(nunjucksEnv.renderString("{{ date | date('custom') }}", { date: d })).toBe(d.toString());

      // 3. t filter with tFunc present, missing, and fallback
      const ctxWithT = {
        t: (k, p, d) => `translated:${k}:${d || ''}`,
      };
      expect(nunjucksEnv.renderString("{{ 'nav.home' | t(null, 'Home Default') }}", ctxWithT))
        .toBe('translated:nav.home:Home Default');

      expect(nunjucksEnv.renderString("{{ 'nav.missing' | t(null, 'Fallback Home') }}", {}))
        .toBe('Fallback Home');
      expect(nunjucksEnv.renderString("{{ 'nav.key' | t }}", {})).toBe('nav.key');
    });

    it('exercises wrapAsync with rejected promises, synchronous errors, and all HTTP methods', async () => {
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages-basic'),
        helmet: false,
        setupRoutes: (a) => {
          // Promise rejection
          a.get('/async-reject', async () => {
            throw new Error('Async Rejection in Route');
          });
          // Synchronous throw
          a.get('/sync-throw', () => {
            throw new Error('Sync Throw in Route');
          });
          // Array of handlers
          a.post('/multi-handler', [
            (req, res, next) => {
              req.firstRan = true;
              next();
            },
            (req, res) => {
              res.json({ firstRan: req.firstRan });
            },
          ]);
          // Other HTTP methods
          a.put('/test-put', (req, res) => res.send('PUT_OK'));
          a.patch('/test-patch', (req, res) => res.send('PATCH_OK'));
          a.delete('/test-delete', (req, res) => res.send('DELETE_OK'));
          a.options('/test-options', (req, res) => res.send('OPTIONS_OK'));
        },
      });

      const resReject = await request(app).get('/async-reject').set('Accept', 'application/json');
      expect(resReject.status).toBe(500);

      const resSync = await request(app).get('/sync-throw').set('Accept', 'application/json');
      expect(resSync.status).toBe(500);

      const resMulti = await request(app).post('/multi-handler');
      expect(resMulti.body.firstRan).toBe(true);

      const resPut = await request(app).put('/test-put');
      expect(resPut.text).toBe('PUT_OK');

      const resPatch = await request(app).patch('/test-patch');
      expect(resPatch.text).toBe('PATCH_OK');

      const resDelete = await request(app).delete('/test-delete');
      expect(resDelete.text).toBe('DELETE_OK');
    });
  });
});



