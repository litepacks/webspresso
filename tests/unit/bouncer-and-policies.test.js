import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import {
  definePolicy,
  defineGate,
  createBouncer,
  createBouncerMiddleware,
  createHelpers,
  ForbiddenError,
  UnauthorizedError,
} from '../../index.js';
import { defaultPolicyManager } from '../../core/auth/policy.js';

describe('Authorization & Policies (AdonisJS Bouncer & Django Permissions-inspired)', () => {
  beforeEach(() => {
    defaultPolicyManager.clear();
  });

  describe('definePolicy and Bouncer allows/denies/authorize', () => {
    beforeEach(() => {
      definePolicy('Note', {
        view: (user, note) => note.isPublic || user?.id === note.userId,
        update: (user, note) => user?.id === note.userId || user?.role === 'admin',
        delete: (user, note) => user?.role === 'admin',
      });

      defineGate('admin-only', (user) => user?.role === 'admin');
    });

    it('evaluates resource-based policies with dot-notation and separate arguments', () => {
      const owner = { id: 10, role: 'member' };
      const otherUser = { id: 20, role: 'member' };
      const admin = { id: 99, role: 'admin' };
      const note = { id: 101, userId: 10, isPublic: false, title: 'Secret Note' };

      const ownerBouncer = createBouncer(owner);
      const otherBouncer = createBouncer(otherUser);
      const adminBouncer = createBouncer(admin);
      const guestBouncer = createBouncer(null);

      // Dot-notation: 'Note.view'
      expect(ownerBouncer.allows('Note.view', note)).toBe(true);
      expect(otherBouncer.denies('Note.view', note)).toBe(true);
      expect(guestBouncer.denies('Note.view', note)).toBe(true);

      // Dot-notation: 'Note.update'
      expect(ownerBouncer.allows('Note.update', note)).toBe(true);
      expect(otherBouncer.denies('Note.update', note)).toBe(true);
      expect(adminBouncer.allows('Note.update', note)).toBe(true);

      // Two-string notation: ('Note', 'delete', note)
      expect(ownerBouncer.denies('Note', 'delete', note)).toBe(true);
      expect(adminBouncer.allows('Note', 'delete', note)).toBe(true);

      // Gates: 'admin-only'
      expect(ownerBouncer.denies('admin-only')).toBe(true);
      expect(adminBouncer.allows('admin-only')).toBe(true);
    });

    it('throws ForbiddenError when authorize() fails for authenticated user', () => {
      const regularUser = { id: 10, role: 'member' };
      const bouncer = createBouncer(regularUser);
      const note = { id: 101, userId: 999 };

      expect(() => bouncer.authorize('Note.update', note)).toThrow(ForbiddenError);
      expect(() => bouncer.authorize('Note.update', note)).toThrow(
        'You are not authorized to perform "Note.update"'
      );
    });

    it('throws UnauthorizedError when authorize() fails for guest user', () => {
      const guestBouncer = createBouncer(null);
      const note = { id: 101, userId: 10, isPublic: false };

      expect(() => guestBouncer.authorize('Note.view', note)).toThrow(UnauthorizedError);
    });

    it('allows passing inline closure/function directly to allows/authorize', () => {
      const user = { id: 1, karma: 50 };
      const bouncer = createBouncer(user);

      const highKarmaRule = (u) => u && u.karma >= 100;
      expect(bouncer.denies(highKarmaRule)).toBe(true);

      const basicUserRule = (u) => u && u.karma >= 10;
      expect(bouncer.allows(basicUserRule)).toBe(true);
    });
  });

  describe('Django-style Permissions Array & Superuser Bypass', () => {
    it('checks user.permissions string array or wildcard permissions', () => {
      const userWithPerms = {
        id: 5,
        permissions: ['order.view', 'order.create', 'report.*'],
      };

      const bouncer = createBouncer(userWithPerms);

      // Direct exact match
      expect(bouncer.allows('order.view')).toBe(true);
      expect(bouncer.allows('order.create')).toBe(true);
      // Denied if not in list
      expect(bouncer.denies('order.delete')).toBe(true);
      // Wildcard match 'report.*'
      expect(bouncer.allows('report.export')).toBe(true);
      expect(bouncer.allows('report.download')).toBe(true);
    });

    it('superuser bypasses all permission checks (Django is_superuser)', () => {
      const superuser = { id: 1, isSuperuser: true };
      const bouncer = createBouncer(superuser);

      expect(bouncer.allows('any.arbitrary.permission')).toBe(true);
      expect(bouncer.allows('some-gate-that-does-not-exist')).toBe(true);
    });

    it('supports custom user.hasPermission method', () => {
      const customUser = {
        id: 1,
        hasPermission(perm) {
          return perm.startsWith('billing.');
        },
      };

      const bouncer = createBouncer(customUser);
      expect(bouncer.allows('billing.invoices')).toBe(true);
      expect(bouncer.denies('users.delete')).toBe(true);
    });
  });

  describe('Nunjucks / fsy Template Helpers Integration', () => {
    it('exposes fsy.can and fsy.cannot in templates using bound user', () => {
      definePolicy('Article', {
        publish: (user, article) => user?.id === article.authorId,
      });

      const user = { id: 42, role: 'author' };
      const ownArticle = { id: 1, authorId: 42 };
      const otherArticle = { id: 2, authorId: 99 };

      const mockReq = { user };
      const fsy = createHelpers({ req: mockReq });

      expect(fsy.can('Article.publish', ownArticle)).toBe(true);
      expect(fsy.cannot('Article.publish', ownArticle)).toBe(false);

      expect(fsy.can('Article.publish', otherArticle)).toBe(false);
      expect(fsy.cannot('Article.publish', otherArticle)).toBe(true);
    });
  });

  describe('Express Middleware (createBouncerMiddleware)', () => {
    it('automatically injects req.bouncer on incoming requests', async () => {
      defineGate('view-secret', (user) => user?.secretAccess === true);

      const app = express();
      app.use((req, res, next) => {
        if (req.headers['x-user-secret'] === 'yes') {
          req.user = { id: 1, secretAccess: true };
        }
        next();
      });
      app.use(createBouncerMiddleware());

      app.get('/secret', (req, res) => {
        try {
          req.bouncer.authorize('view-secret');
          res.json({ secret: 42 });
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      const client = supertest(app);

      // Denied for guest
      await client.get('/secret').expect(401);

      // Allowed with header
      const res = await client
        .get('/secret')
        .set('x-user-secret', 'yes')
        .expect(200);

      expect(res.body.secret).toBe(42);
    });
  });
});
