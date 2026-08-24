const {
  ServiceRegistry,
  UnauthorizedError,
  ForbiddenError,
} = require('../../index');

describe('Services Authorization & RBAC (Section 5 Hardened)', () => {
  describe('auth: true (Authentication Required)', () => {
    it('should reject unauthenticated caller with 401 UnauthorizedError', async () => {
      const registry = new ServiceRegistry();

      registry.register('profile.get', {
        auth: true,
        async handler(input, ctx) {
          return { id: ctx.user.id };
        },
      });

      // No user in ctx
      await expect(registry.call('profile.get', {}, {})).rejects.toThrow(UnauthorizedError);

      try {
        await registry.call('profile.get', {}, {});
      } catch (err) {
        expect(err.status).toBe(401);
        expect(err.message).toContain("Authentication required to execute service 'profile.get'");
      }
    });

    it('should allow authenticated caller with ctx.user', async () => {
      const registry = new ServiceRegistry();

      registry.register('profile.get', {
        auth: true,
        async handler(input, ctx) {
          return { userId: ctx.user.id, name: ctx.user.name };
        },
      });

      const res = await registry.call('profile.get', {}, { user: { id: 10, name: 'Alice' } });
      expect(res.userId).toBe(10);
    });
  });

  describe('auth: "admin" (Single Role Requirement)', () => {
    it('should reject non-admin user with 403 ForbiddenError', async () => {
      const registry = new ServiceRegistry();

      registry.register('admin.dashboard', {
        auth: 'admin',
        async handler() {
          return { secretStats: 42 };
        },
      });

      // Regular user
      await expect(
        registry.call('admin.dashboard', {}, { user: { id: 2, role: 'member' } })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow user with matching role or roles array', async () => {
      const registry = new ServiceRegistry();

      registry.register('admin.dashboard', {
        auth: 'admin',
        async handler() {
          return { secretStats: 42 };
        },
      });

      // User with role: 'admin'
      const res1 = await registry.call('admin.dashboard', {}, { user: { id: 1, role: 'admin' } });
      expect(res1.secretStats).toBe(42);

      // User with roles: ['editor', 'admin']
      const res2 = await registry.call('admin.dashboard', {}, { user: { id: 1, roles: ['editor', 'admin'] } });
      expect(res2.secretStats).toBe(42);
    });
  });

  describe('auth: ["admin", "manager"] (Multiple Allowed Roles)', () => {
    it('should allow any user matching one of the allowed roles', async () => {
      const registry = new ServiceRegistry();

      registry.register('billing.view', {
        auth: ['admin', 'manager'],
        async handler() {
          return { billingAccess: true };
        },
      });

      const managerRes = await registry.call('billing.view', {}, { user: { id: 3, role: 'manager' } });
      expect(managerRes.billingAccess).toBe(true);

      const adminRes = await registry.call('billing.view', {}, { user: { id: 1, role: 'admin' } });
      expect(adminRes.billingAccess).toBe(true);

      await expect(
        registry.call('billing.view', {}, { user: { id: 4, role: 'guest' } })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('auth: (user, ctx) => boolean (Custom Predicate)', () => {
    it('should evaluate custom predicate function for dynamic authorization', async () => {
      const registry = new ServiceRegistry();

      registry.register('post.edit', {
        auth: (user, ctx) => user && (user.role === 'admin' || user.id === ctx.postAuthorId),
        async handler({ title }) {
          return { title, saved: true };
        },
      });

      // Author matches ctx.postAuthorId -> allowed
      const authorRes = await registry.call('post.edit', { title: 'Hello' }, {
        user: { id: 5 },
        postAuthorId: 5,
      });
      expect(authorRes.saved).toBe(true);

      // Other user -> rejected with ForbiddenError
      await expect(
        registry.call('post.edit', { title: 'Hello' }, {
          user: { id: 6 },
          postAuthorId: 5,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('skipAuth Option for Trusted Internal Calls', () => {
    it('should allow internal/cron calls to bypass auth check when skipAuth: true', async () => {
      const registry = new ServiceRegistry();

      registry.register('system.maintenance', {
        auth: 'superadmin',
        async handler() {
          return { cleaned: true };
        },
      });

      // Calling without user but with skipAuth: true
      const res = await registry.call('system.maintenance', {}, {}, { skipAuth: true });
      expect(res.cleaned).toBe(true);
    });
  });
});
