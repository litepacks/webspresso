/**
 * Comprehensive Branch Coverage Boost Test Suite (Extended)
 *
 * Systematically exercises branches across:
 * 1. plugins/admin-panel/api.js (All CRUD, inlines, quickEdit, batchEdit, dateHierarchy, facets, filters, actions)
 * 2. core/auth/jwt.js (duration parser, signJwt claims/algorithms, verifyJwt signatures/expirations/iss/aud, decodeJwt)
 * 3. core/auth/middleware.js (authenticate, requireAuth, requireJwt, requireGuest, requireCan, requireVerified, require2Fa, parseMiddlewareString)
 * 4. plugins/file-manager/api-handlers.js (RBAC checks, list, mkdir, rename, delete, move, upload quota/validation)
 * 5. plugins/site-analytics/api-handlers.js (days parsing, referrer normalization, stats aggregations)
 * 6. plugins/audit-log/api-handlers.js (filter mapping, timeline analysis, purge, stats)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import session from 'express-session';
import { createApiHandlers, LoginRateLimiter } from '../../../plugins/admin-panel/api.js';
import { signJwt, verifyJwt, decodeJwt, parseDuration, base64UrlEncode, base64UrlDecode } from '../../../core/auth/jwt.js';
import { createAuthMiddleware } from '../../../core/auth/middleware.js';
import { createFileManagerApiHandlers } from '../../../plugins/file-manager/api-handlers.js';
import { createAnalyticsApiHandlers } from '../../../plugins/site-analytics/api-handlers.js';
import { createAuditLogHandlers } from '../../../plugins/audit-log/api-handlers.js';
import { createRepository } from '../../../core/orm/repository.js';
import { z } from 'zod';
import { ModelEvents } from '../../../core/orm/events.js';
import { WebhookDispatcher, generateDeliveryId } from '../../../plugins/webhooks/dispatcher.js';
import { createMockRes, createMockRepo } from '../../utils/index.js';

describe('Coverage Boost: JWT Helper Branches', () => {
  it('covers parseDuration with all branches', () => {
    expect(parseDuration(120)).toBe(120);
    expect(parseDuration(null)).toBe(3600);
    expect(parseDuration('invalid')).toBe(3600);
    expect(parseDuration('500')).toBe(500);
    expect(parseDuration('10s')).toBe(10);
    expect(parseDuration('5m')).toBe(300);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('3d')).toBe(259200);
    expect(parseDuration('4x')).toBe(4);
  });

  it('covers signJwt options and errors', () => {
    expect(() => signJwt({ foo: 'bar' }, null)).toThrow('Secret is required');
    expect(() => signJwt({ foo: 'bar' }, 'sec', { algorithm: 'RS256' })).toThrow('Unsupported algorithm');

    const token = signJwt({ userId: 1 }, 'sec', {
      expiresIn: false,
      issuer: 'test-issuer',
      subject: 'test-sub',
      audience: 'test-aud',
    });
    expect(token).toBeTypeOf('string');

    const decoded = decodeJwt(token);
    expect(decoded.payload.iss).toBe('test-issuer');
    expect(decoded.payload.sub).toBe('test-sub');
    expect(decoded.payload.aud).toBe('test-aud');
    expect(decoded.payload.exp).toBeUndefined();
  });

  it('covers verifyJwt validations and errors', () => {
    expect(() => verifyJwt('token', null)).toThrow('Secret is required');
    expect(() => verifyJwt('', 'sec')).toThrow('JWT token must be a non-empty string');
    expect(() => verifyJwt('not.three.parts.here', 'sec')).toThrow('Invalid JWT format');
    expect(() => verifyJwt('badjson.badpayload.sig', 'sec')).toThrow('Invalid JWT header JSON');

    const validHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    expect(() => verifyJwt(`${validHeader}.badjson.sig`, 'sec')).toThrow('Invalid JWT payload JSON');

    const invalidAlgHeader = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const validPayload = base64UrlEncode(JSON.stringify({ userId: 1 }));
    expect(() => verifyJwt(`${invalidAlgHeader}.${validPayload}.sig`, 'sec')).toThrow('Unsupported algorithm');

    // Invalid signature
    const validToken = signJwt({ userId: 1 }, 'correct-secret');
    expect(() => verifyJwt(validToken, 'wrong-secret')).toThrow('Invalid JWT signature');

    // Expired token
    const expiredPayload = { userId: 1, exp: Math.floor(Date.now() / 1000) - 100 };
    const expiredToken = signJwt(expiredPayload, 'sec', { expiresIn: false });
    expect(() => verifyJwt(expiredToken, 'sec')).toThrow('JWT token has expired');
    expect(verifyJwt(expiredToken, 'sec', { ignoreExpiration: true })).toMatchObject({ userId: 1 });

    // Issuer and audience mismatches
    const claimToken = signJwt({ userId: 1 }, 'sec', { issuer: 'real-iss', audience: 'real-aud' });
    expect(() => verifyJwt(claimToken, 'sec', { issuer: 'bad-iss' })).toThrow('Invalid JWT issuer');
    expect(() => verifyJwt(claimToken, 'sec', { issuer: 'real-iss', audience: 'bad-aud' })).toThrow('Invalid JWT audience');
    expect(verifyJwt(claimToken, 'sec', { issuer: 'real-iss', audience: 'real-aud' })).toMatchObject({ userId: 1 });
  });

  it('covers decodeJwt invalid branches', () => {
    expect(decodeJwt(null)).toBeNull();
    expect(decodeJwt('')).toBeNull();
    expect(decodeJwt('invalid.token')).toBeNull();
    expect(decodeJwt('inv.json.sig')).toBeNull();
  });
});

describe('Coverage Boost: Admin Panel API Endpoints Exhaustive', () => {
  let mockModels;
  let mockRepos;
  let mockDb;
  let mockRegistry;
  let handlers;

  beforeEach(() => {
    const articleModel = {
      name: 'Article',
      table: 'articles',
      primaryKey: 'id',
      columns: new Map([
        ['id', { type: 'id', primary: true }],
        ['title', { type: 'string' }],
        ['content', { type: 'text' }],
        ['status', { type: 'string' }],
        ['published', { type: 'boolean' }],
        ['views', { type: 'integer' }],
        ['created_at', { type: 'timestamp' }],
        ['file_col', { type: 'file' }],
        ['json_col', { type: 'json' }],
      ]),
      relations: {
        comments: {
          model: () => 'Comment',
          type: 'hasMany',
        },
      },
      scopes: {
        softDelete: { deletedAtColumn: 'deleted_at' },
      },
      admin: {
        enabled: true,
        label: 'Articles',
        icon: 'doc',
        dateHierarchy: 'created_at',
        listFilter: ['status', 'published'],
        listEditable: ['title', 'status'],
        customFields: {
          content: { type: 'rich-text' },
        },
        defaultSort: { column: 'created_at', order: 'asc' },
        inlines: [
          { model: 'Comment', foreignKey: 'article_id' },
        ],
        actions: [
          {
            id: 'archive-article',
            label: 'Archive',
            handler: vi.fn().mockResolvedValue({ archived: true }),
          },
        ],
        bulkActions: [
          {
            id: 'bulk-publish',
            label: 'Publish All',
            handler: vi.fn().mockResolvedValue({ count: 2 }),
          },
        ],
        queries: {
          trending: vi.fn().mockResolvedValue([{ id: 1, title: 'Trending 1' }]),
        },
      },
    };

    const commentModel = {
      name: 'Comment',
      table: 'comments',
      primaryKey: 'id',
      columns: new Map([
        ['id', { type: 'id' }],
        ['article_id', { type: 'integer' }],
        ['body', { type: 'text' }],
      ]),
      relations: {},
      admin: {
        enabled: true,
      },
    };

    const disabledModel = {
      name: 'Secret',
      table: 'secrets',
      columns: new Map([['id', { type: 'id' }]]),
      relations: {},
      admin: { enabled: false },
    };

    mockModels = new Map([
      ['Article', articleModel],
      ['Comment', commentModel],
      ['Secret', disabledModel],
    ]);

    mockRepos = {
      Article: createMockRepo([
        { id: 1, title: 'Post 1', content: '<p>Content 1</p>', status: 'draft', published: false, views: 10, created_at: '2026-05-10T12:00:00Z' },
        { id: 2, title: 'Post 2', content: '<p>Content 2</p>', status: 'active', published: true, views: 50, created_at: '2026-05-15T12:00:00Z' },
      ], { softDelete: true }),
      Comment: createMockRepo([
        { id: 101, article_id: 1, body: 'Nice post!' },
      ]),
      AdminUser: createMockRepo([
        { id: 1, email: 'admin@webspresso.com', password: 'hashedpassword', name: 'Admin', role: 'admin', active: true },
      ]),
    };

    mockDb = {
      getModel: vi.fn((name) => mockModels.get(name) || null),
      getAllModels: vi.fn(() => Array.from(mockModels.values())),
      getRepository: vi.fn((name) => mockRepos[name] || createMockRepo()),
      knex: {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true),
        },
      },
    };

    mockRegistry = {
      runHooks: vi.fn().mockResolvedValue(undefined),
      getActionsForModel: vi.fn().mockReturnValue([]),
      getBulkActionsForModel: vi.fn().mockReturnValue([]),
      getBulkAction: vi.fn().mockReturnValue(null),
    };

    handlers = createApiHandlers({
      path: '/_admin',
      db: mockDb,
      registry: mockRegistry,
      AdminUser: { name: 'AdminUser' },
      hashPassword: vi.fn(async (p) => `hashed_${p}`),
      comparePassword: vi.fn(async (plain, hashed) => plain === 'secret' && hashed === 'hashedpassword'),
      richTextSanitize: true,
      loginRateLimit: false,
    });
  });

  it('covers checkHandler and setupHandler error and success branches', async () => {
    // 1. checkHandler without AdminUserRepo
    const uninitHandlers = createApiHandlers({ path: '/_admin', db: null });
    const resCheckNoRepo = createMockRes();
    await uninitHandlers.checkHandler({}, resCheckNoRepo);
    expect(resCheckNoRepo._json.exists).toBe(false);

    // 2. setupHandler without AdminUserRepo
    const resSetupNoRepo = createMockRes();
    await uninitHandlers.setupHandler({ body: {} }, resSetupNoRepo);
    expect(resSetupNoRepo.statusCode).toBe(500);

    // 3. setupHandler missing fields
    const resSetupMissing = createMockRes();
    await handlers.setupHandler({ body: { email: 'a@b.com' } }, resSetupMissing);
    expect(resSetupMissing.statusCode).toBe(400);

    // 4. setupHandler success
    mockRepos.AdminUser.items.length = 0;
    const reqSetup = {
      body: { email: 'new@admin.com', password: 'secretpassword', name: 'New Admin' },
      session: {},
    };
    const resSetup = createMockRes();
    await handlers.setupHandler(reqSetup, resSetup);
    expect(resSetup._json.success).toBe(true);
    expect(reqSetup.session.adminUser).toBeDefined();
  });

  it('covers loginHandler rateLimiter, invalid creds, and errors', async () => {
    // Rate limiter blocked branch
    const rateLimitedHandlers = createApiHandlers({
      path: '/_admin',
      db: mockDb,
      AdminUser: { name: 'AdminUser' },
      comparePassword: vi.fn(),
      rateLimiter: {
        isBlocked: vi.fn().mockReturnValue({ blocked: true, message: 'Too many attempts', retryAfter: 60 }),
      },
    });
    const resRateLimit = createMockRes();
    await rateLimitedHandlers.loginHandler({ ip: '1.2.3.4' }, resRateLimit);
    expect(resRateLimit.statusCode).toBe(429);
    expect(resRateLimit.headers['Retry-After']).toBe('60');

    // Missing email or password
    const resMissing = createMockRes();
    await handlers.loginHandler({ body: {} }, resMissing);
    expect(resMissing.statusCode).toBe(400);

    // Invalid credentials
    const resInvalid = createMockRes();
    await handlers.loginHandler({ body: { email: 'admin@webspresso.com', password: 'wrong' }, session: {} }, resInvalid);
    expect(resInvalid.statusCode).toBe(401);

    // Success
    const reqSuccess = { body: { email: 'admin@webspresso.com', password: 'secret' }, session: {} };
    const resSuccess = createMockRes();
    await handlers.loginHandler(reqSuccess, resSuccess);
    expect(resSuccess._json.success).toBe(true);
    expect(reqSuccess.session.adminUser.email).toBe('admin@webspresso.com');

    // Logout
    const resLogout = createMockRes();
    await handlers.logoutHandler({ session: { destroy: vi.fn((cb) => cb()) } }, resLogout);
    expect(resLogout._json.success).toBe(true);
  });

  it('covers meHandler and updateProfileHandler branches', async () => {
    // meHandler unauthenticated
    const resMeUnauth = createMockRes();
    handlers.meHandler({}, resMeUnauth);
    expect(resMeUnauth.statusCode).toBe(401);

    // meHandler authenticated
    const resMeAuth = createMockRes();
    handlers.meHandler({ session: { adminUser: { id: 1, email: 'admin@test.com' } } }, resMeAuth);
    expect(resMeAuth._json.user.id).toBe(1);

    // updateProfileHandler unauthenticated
    const resProfUnauth = createMockRes();
    await handlers.updateProfileHandler({}, resProfUnauth);
    expect(resProfUnauth.statusCode).toBe(401);

    // User not found
    const resProfNotFound = createMockRes();
    await handlers.updateProfileHandler({ session: { adminUser: { id: 999 } } }, resProfNotFound);
    expect(resProfNotFound.statusCode).toBe(404);

    // Email conflict
    const adminRepo = mockRepos.AdminUser;
    adminRepo.query = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 2, email: 'taken@webspresso.com' }),
    });
    const resConflict = createMockRes();
    await handlers.updateProfileHandler({
      session: { adminUser: { id: 1 } },
      body: { email: 'taken@webspresso.com' },
    }, resConflict);
    expect(resConflict.statusCode).toBe(400);

    // Password validation errors
    const resMissingCurrentPass = createMockRes();
    await handlers.updateProfileHandler({
      session: { adminUser: { id: 1 } },
      body: { newPassword: 'new' },
    }, resMissingCurrentPass);
    expect(resMissingCurrentPass.statusCode).toBe(400);

    const resInvalidCurrentPass = createMockRes();
    await handlers.updateProfileHandler({
      session: { adminUser: { id: 1 } },
      body: { currentPassword: 'wrong', newPassword: 'newvalidpassword' },
    }, resInvalidCurrentPass);
    expect(resInvalidCurrentPass.statusCode).toBe(400);

    const resShortNewPass = createMockRes();
    await handlers.updateProfileHandler({
      session: { adminUser: { id: 1 } },
      body: { currentPassword: 'secret', newPassword: '123' },
    }, resShortNewPass);
    expect(resShortNewPass.statusCode).toBe(400);

    // Successful update with name and password
    adminRepo.query = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    });
    const reqProfOk = {
      session: { adminUser: { id: 1, email: 'admin@webspresso.com', name: 'Admin' } },
      body: { name: 'Super Admin', currentPassword: 'secret', newPassword: 'brandnewpassword' },
    };
    const resProfOk = createMockRes();
    await handlers.updateProfileHandler(reqProfOk, resProfOk);
    expect(resProfOk._json.success).toBe(true);
    expect(reqProfOk.session.adminUser.name).toBe('Super Admin');
  });

  it('covers modelsHandler and modelHandler branches', async () => {
    // modelsHandler
    const resModels = createMockRes();
    handlers.modelsHandler({}, resModels);
    expect(resModels._json.models.some((m) => m.name === 'Article')).toBe(true);
    expect(resModels._json.models.some((m) => m.name === 'Secret')).toBe(false);

    // modelHandler 404
    const resModel404 = createMockRes();
    handlers.modelHandler({ params: { model: 'NonExistent' } }, resModel404);
    expect(resModel404.statusCode).toBe(404);

    // modelHandler 403 not enabled
    const resModel403 = createMockRes();
    handlers.modelHandler({ params: { model: 'Secret' } }, resModel403);
    expect(resModel403.statusCode).toBe(403);

    // modelHandler success with sortable, hidden columns, badges, custom actions
    const resModelOk = createMockRes();
    handlers.modelHandler({ params: { model: 'Article' } }, resModelOk);
    expect(resModelOk._json.name).toBe('Article');
    expect(resModelOk._json.columns.find((c) => c.name === 'id').sortable).toBe(true);
    expect(resModelOk._json.columns.find((c) => c.name === 'json_col').sortable).toBe(false);
    expect(resModelOk._json.actions.some((a) => a.id === 'archive-article')).toBe(true);
    expect(resModelOk._json.bulkActions.some((a) => a.id === 'bulk-publish')).toBe(true);
  });

  it('covers recordsListHandler filters, search, sort, and date hierarchy', async () => {
    // 404 for missing/disabled model
    const res404 = createMockRes();
    await handlers.recordsListHandler({ params: { model: 'Fake' }, query: {} }, res404);
    expect(res404.statusCode).toBe(404);

    // trashed only and include
    const resTrashedOnly = createMockRes();
    await handlers.recordsListHandler({ params: { model: 'Article' }, query: { trashed: 'only' } }, resTrashedOnly);
    expect(resTrashedOnly.statusCode).toBe(200);

    const resTrashedInclude = createMockRes();
    await handlers.recordsListHandler({ params: { model: 'Article' }, query: { trashed: 'include' } }, resTrashedInclude);
    expect(resTrashedInclude.statusCode).toBe(200);

    // date hierarchy query variants: year, year+month, year+month+day, date_from, date_to
    const resDateHier = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: { year: '2026', month: '5', day: '10', date_from: '2026-01-01', date_to: '2026-12-31' },
    }, resDateHier);
    expect(resDateHier.statusCode).toBe(200);

    const resDateMonthOnly = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: { year: '2026', month: '5' },
    }, resDateMonthOnly);
    expect(resDateMonthOnly.statusCode).toBe(200);

    const resDateYearOnly = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: { year: '2026' },
    }, resDateYearOnly);
    expect(resDateYearOnly.statusCode).toBe(200);

    // All filter operators: is_null, is_not_null, boolean true/false, between, in, contains, equals, starts_with, ends_with, gt, gte, lt, lte, eq
    const resFilters = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: {
        filter: {
          title: { op: 'contains', value: 'Post' },
          content: { op: 'starts_with', value: '<p>' },
          file_col: { op: 'ends_with', value: '.jpg' },
          views: { op: 'gt', value: '5' },
          published: { op: 'eq', value: 'true' },
          created_at: { op: 'between', from: '2026-01-01', to: '2026-12-31' },
          status: { op: 'in', value: ['draft', 'active'] },
          json_col: { op: 'is_null' },
        },
      },
    }, resFilters);
    expect(resFilters.statusCode).toBe(200);

    // Filters edge cases: between only from, between only to, is_not_null, gte, lt, lte, equals
    const resFilters2 = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: {
        filter: {
          views: { op: 'gte', value: '10' },
          status: { op: 'equals', value: 'draft' },
          created_at: { op: 'between', from: '2026-01-01' },
          json_col: { op: 'is_not_null' },
        },
      },
    }, resFilters2);
    expect(resFilters2.statusCode).toBe(200);

    const resFilters3 = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: {
        filter: {
          views: { op: 'lt', value: '100' },
          created_at: { op: 'between', to: '2026-12-31' },
          published: { op: 'eq', value: false },
        },
      },
    }, resFilters3);
    expect(resFilters3.statusCode).toBe(200);

    // Search query & sort branches
    const resSearch = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: { search: 'Post', sort: 'title', order: 'asc' },
    }, resSearch);
    expect(resSearch.statusCode).toBe(200);

    // Sort by non-sortable column falls back to primary key
    const resSortFallback = createMockRes();
    await handlers.recordsListHandler({
      params: { model: 'Article' },
      query: { sort: 'json_col' },
    }, resSortFallback);
    expect(resSortFallback.statusCode).toBe(200);
  });

  it('covers recordHandler, createRecordHandler, and updateRecordHandler with rich text and inlines', async () => {
    // recordHandler 404
    const resRec404 = createMockRes();
    await handlers.recordHandler({ params: { model: 'Article', id: 999 } }, resRec404);
    expect(resRec404.statusCode).toBe(404);

    // recordHandler success with inlines auto-loading
    const resRecOk = createMockRes();
    await handlers.recordHandler({ params: { model: 'Article', id: 1 }, session: {} }, resRecOk);
    expect(resRecOk._json.data.id).toBe(1);
    expect(resRecOk._json.data._inlines.Comment).toBeDefined();

    // createRecordHandler validation and inlines sync
    const resCreate = createMockRes();
    await handlers.createRecordHandler({
      params: { model: 'Article' },
      body: {
        title: 'New Article',
        content: '<p>Fresh rich text</p>',
        _inlines: {
          Comment: [
            { body: 'Inline comment 1' },
          ],
        },
      },
      session: {},
    }, resCreate);
    expect(resCreate.statusCode).toBe(201);

    // updateRecordHandler with inline item updates and deletions
    const resUpdate = createMockRes();
    await handlers.updateRecordHandler({
      params: { model: 'Article', id: 1 },
      body: {
        title: 'Updated Title',
        _inlines: {
          Comment: [
            { id: 101, body: 'Updated comment text' },
            { id: 102, _delete: true },
          ],
        },
      },
      session: {},
    }, resUpdate);
    expect(resUpdate.statusCode).toBe(200);

    // updateRecordHandler 404
    const resUp404 = createMockRes();
    await handlers.updateRecordHandler({ params: { model: 'Article', id: 999 }, body: {} }, resUp404);
    expect(resUp404.statusCode).toBe(404);

    // deleteRecordHandler
    const resDel = createMockRes();
    await handlers.deleteRecordHandler({ params: { model: 'Article', id: 2 }, session: {} }, resDel);
    expect(resDel._json.success).toBe(true);

    // deleteRecordHandler 404
    const resDel404 = createMockRes();
    await handlers.deleteRecordHandler({ params: { model: 'Article', id: 999 } }, resDel404);
    expect(resDel404.statusCode).toBe(404);

    // restoreRecordHandler
    const resRestore = createMockRes();
    await handlers.restoreRecordHandler({ params: { model: 'Article', id: 2 }, session: {} }, resRestore);
    expect(resRestore._json.success).toBe(true);

    // restoreRecordHandler on model without softDelete
    const resRestoreNoSD = createMockRes();
    await handlers.restoreRecordHandler({ params: { model: 'Comment', id: 101 } }, resRestoreNoSD);
    expect(resRestoreNoSD.statusCode).toBe(400);
  });

  it('covers relationHandler, queryHandler, and custom actions', async () => {
    // relationHandler 404s
    const resRel404Model = createMockRes();
    await handlers.relationHandler({ params: { model: 'Fake', relation: 'comments' }, query: {} }, resRel404Model);
    expect(resRel404Model.statusCode).toBe(404);

    const resRel404Rel = createMockRes();
    await handlers.relationHandler({ params: { model: 'Article', relation: 'nonexistent' }, query: {} }, resRel404Rel);
    expect(resRel404Rel.statusCode).toBe(404);

    // relationHandler search, all, and selectedId inclusion
    const resRelOk = createMockRes();
    await handlers.relationHandler({
      params: { model: 'Article', relation: 'comments' },
      query: { search: 'Nice', all: 'true', selected: '101' },
    }, resRelOk);
    expect(resRelOk.statusCode).toBe(200);
    expect(resRelOk._json.data).toBeDefined();

    // queryHandler
    const resQuery404 = createMockRes();
    await handlers.queryHandler({ params: { model: 'Article', query: 'unknown' } }, resQuery404);
    expect(resQuery404.statusCode).toBe(404);

    const resQueryOk = createMockRes();
    await handlers.queryHandler({ params: { model: 'Article', query: 'trending' } }, resQueryOk);
    expect(resQueryOk._json.data[0].title).toBe('Trending 1');

    // modelActionHandler
    const resActionMissingIds = createMockRes();
    await handlers.modelActionHandler({ params: { model: 'Article', actionId: 'archive-article' }, body: {} }, resActionMissingIds);
    expect(resActionMissingIds.statusCode).toBe(400);

    const resActionOk = createMockRes();
    await handlers.modelActionHandler({
      params: { model: 'Article', actionId: 'archive-article' },
      body: { ids: [1] },
      session: {},
    }, resActionOk);
    expect(resActionOk._json.success).toBe(true);

    const resAction404 = createMockRes();
    await handlers.modelActionHandler({
      params: { model: 'Article', actionId: 'missing-action' },
      body: { ids: [1] },
    }, resAction404);
    expect(resAction404.statusCode).toBe(404);
  });

  it('covers inline sub-resource handlers (list, create, update, delete)', async () => {
    // inlineListHandler
    const resInList = createMockRes();
    await handlers.inlineListHandler({ params: { model: 'Article', id: 1, inlineModel: 'Comment' } }, resInList);
    expect(resInList.statusCode).toBe(200);

    // inlineCreateHandler
    const resInCreate = createMockRes();
    await handlers.inlineCreateHandler({
      params: { model: 'Article', id: 1, inlineModel: 'Comment' },
      body: { body: 'Inline sub comment' },
    }, resInCreate);
    expect(resInCreate.statusCode).toBe(201);

    // inlineUpdateHandler
    const resInUpdate = createMockRes();
    await handlers.inlineUpdateHandler({
      params: { inlineModel: 'Comment', inlineId: 101 },
      body: { body: 'Updated text inline' },
    }, resInUpdate);
    expect(resInUpdate.statusCode).toBe(200);

    // inlineDeleteHandler
    const resInDel = createMockRes();
    await handlers.inlineDeleteHandler({
      params: { inlineModel: 'Comment', inlineId: 101 },
    }, resInDel);
    expect(resInDel._json.success).toBe(true);
  });

  it('covers quickEditHandler and batchEditHandler', async () => {
    // quickEdit disallowed column
    const resDisallowed = createMockRes();
    await handlers.quickEditHandler({
      params: { model: 'Article', id: 1 },
      body: { views: 999 }, // not in listEditable ['title', 'status']
    }, resDisallowed);
    expect(resDisallowed.statusCode).toBe(400);

    // quickEdit success
    const resQuickOk = createMockRes();
    await handlers.quickEditHandler({
      params: { model: 'Article', id: 1 },
      body: { status: 'published' },
    }, resQuickOk);
    expect(resQuickOk._json.success).toBe(true);

    // batchEditHandler empty updates
    const resBatchEmpty = createMockRes();
    await handlers.batchEditHandler({ params: { model: 'Article' }, body: {} }, resBatchEmpty);
    expect(resBatchEmpty.statusCode).toBe(400);

    // batchEditHandler success
    const resBatchOk = createMockRes();
    await handlers.batchEditHandler({
      params: { model: 'Article' },
      body: {
        updates: [
          { id: 1, changes: { title: 'Batch Post 1' } },
        ],
      },
    }, resBatchOk);
    expect(resBatchOk._json.success).toBe(true);
    expect(resBatchOk._json.count).toBe(1);
  });

  it('covers dateHierarchyHandler and filterFacetsHandler', async () => {
    // dateHierarchyHandler drilldown to days
    const resDays = createMockRes();
    await handlers.dateHierarchyHandler({
      params: { model: 'Article' },
      query: { year: '2026', month: '5' },
    }, resDays);
    expect(resDays._json.level).toBe('days');

    // dateHierarchyHandler drilldown to months
    const resMonths = createMockRes();
    await handlers.dateHierarchyHandler({
      params: { model: 'Article' },
      query: { year: '2026' },
    }, resMonths);
    expect(resMonths._json.level).toBe('months');

    // dateHierarchyHandler top level years
    const resYears = createMockRes();
    await handlers.dateHierarchyHandler({
      params: { model: 'Article' },
      query: {},
    }, resYears);
    expect(resYears._json.level).toBe('years');

    // filterFacetsHandler
    const resFacets = createMockRes();
    await handlers.filterFacetsHandler({
      params: { model: 'Article' },
      query: {},
    }, resFacets);
    expect(resFacets._json.facets).toBeDefined();
  });
});

describe('Coverage Boost: Auth Middleware Branches', () => {
  let mockAuthManager;
  let middleware;

  beforeEach(() => {
    mockAuthManager = {
      config: {
        routes: { login: '/login', redirectAfterLogin: '/dashboard', twoFactor: '/2fa' },
        session: { secret: 'session-secret' },
      },
      getSessionConfig: vi.fn().mockReturnValue({
        secret: 'session-secret',
        resave: false,
        saveUninitialized: false,
        store: new session.MemoryStore(),
      }),
      createRequestAuth: vi.fn((req) => ({
        can: vi.fn((action) => action !== 'forbidden-action'),
        is2FaVerified: vi.fn(() => Boolean(req.session?.twoFactorVerified)),
      })),
      verifyJwt: vi.fn((token) => {
        if (token === 'valid-user-token') return { id: 1, email: 'user@test.com' };
        if (token === 'valid-payload-token') return { role: 'service' };
        throw new Error('Invalid JWT');
      }),
      findUserById: vi.fn(async (id) => (id === 1 ? { id: 1, name: 'Test User' } : null)),
      isSessionValid: vi.fn(async (sessionId, userId) => sessionId !== 'revoked-session'),
      touchSession: vi.fn().mockResolvedValue(undefined),
      trackSession: vi.fn().mockResolvedValue(undefined),
      sessionManager: {},
      rememberTokens: {},
      verifyRememberToken: vi.fn(async (req) => (req.headers.cookie?.includes('remember_token') ? { id: 1, name: 'Remembered' } : null)),
    };
    middleware = createAuthMiddleware(mockAuthManager);
  });

  it('covers authenticate with Bearer JWT (user found, payload only, invalid token)', async () => {
    // 1. Valid JWT with user in DB
    const req1 = { headers: { authorization: 'Bearer valid-user-token' } };
    const next1 = vi.fn();
    await middleware.authenticate(req1, createMockRes(), next1);
    expect(req1.user.name).toBe('Test User');
    expect(next1).toHaveBeenCalled();

    // 2. Valid JWT payload only
    const req2 = { headers: { authorization: 'Bearer valid-payload-token' } };
    const next2 = vi.fn();
    await middleware.authenticate(req2, createMockRes(), next2);
    expect(req2.user.role).toBe('service');

    // 3. Invalid JWT header
    const req3 = { headers: { authorization: 'Bearer expired-bad-token' } };
    const next3 = vi.fn();
    await middleware.authenticate(req3, createMockRes(), next3);
    expect(req3.user).toBeNull();
  });

  it('covers authenticate with Session and Remember Me tokens', async () => {
    // Active valid session
    const req1 = { sessionID: 'valid-sess', session: { userId: 1 } };
    const next1 = vi.fn();
    await middleware.authenticate(req1, createMockRes(), next1);
    expect(req1.user.id).toBe(1);

    // Revoked session
    const destroyFn = vi.fn((cb) => cb());
    const req2 = { sessionID: 'revoked-session', session: { userId: 1, destroy: destroyFn } };
    const next2 = vi.fn();
    await middleware.authenticate(req2, createMockRes(), next2);
    expect(req2.session.userId).toBeUndefined();
    expect(destroyFn).toHaveBeenCalled();

    // Remember me cookie fallback
    const req3 = { headers: { cookie: 'remember_token=abc' }, session: {} };
    const next3 = vi.fn();
    await middleware.authenticate(req3, createMockRes(), next3);
    expect(req3.user.name).toBe('Remembered');
    expect(req3.session.userId).toBe(1);
  });

  it('covers requireAuth, requireJwt, and requireGuest', async () => {
    // requireAuth without user: API 401 vs HTML redirect
    const resAuthApi = createMockRes();
    middleware.requireAuth({ api: true })({}, resAuthApi, vi.fn());
    expect(resAuthApi.statusCode).toBe(401);

    const resAuthHtml = createMockRes();
    const reqHtml = { session: {}, originalUrl: '/protected' };
    middleware.requireAuth()(reqHtml, resAuthHtml, vi.fn());
    expect(resAuthHtml._redirect).toBe('/login');
    expect(reqHtml.session.intendedUrl).toBe('/protected');

    // requireJwt without header vs valid header
    const resJwtMissing = createMockRes();
    await middleware.requireJwt()({}, resJwtMissing, vi.fn());
    expect(resJwtMissing.statusCode).toBe(401);

    const reqJwtOk = { headers: { authorization: 'Bearer valid-user-token' } };
    const nextJwtOk = vi.fn();
    await middleware.requireJwt()(reqJwtOk, createMockRes(), nextJwtOk);
    expect(nextJwtOk).toHaveBeenCalled();

    // requireGuest: redirect when user present vs next when guest
    const resGuestRedirect = createMockRes();
    middleware.requireGuest()({ user: { id: 1 } }, resGuestRedirect, vi.fn());
    expect(resGuestRedirect._redirect).toBe('/dashboard');

    const nextGuest = vi.fn();
    middleware.requireGuest()({}, createMockRes(), nextGuest);
    expect(nextGuest).toHaveBeenCalled();
  });

  it('covers requireCan and requireVerified', async () => {
    const reqCan = {
      user: { id: 1 },
      auth: { can: vi.fn(() => false) },
      headers: { accept: 'application/json' },
    };
    const resCanJson = createMockRes();
    await middleware.requireCan('edit', 'post')(reqCan, resCanJson, vi.fn());
    expect(resCanJson.statusCode).toBe(403);

    // requireVerified: missing verification
    const reqUnver = { user: { id: 1 }, headers: { accept: 'application/json' } };
    const resUnver = createMockRes();
    middleware.requireVerified()(reqUnver, resUnver, vi.fn());
    expect(resUnver.statusCode).toBe(403);

    // requireVerified: verified user
    const reqVer = { user: { id: 1, email_verified_at: '2026-01-01' } };
    const nextVer = vi.fn();
    middleware.requireVerified()(reqVer, createMockRes(), nextVer);
    expect(nextVer).toHaveBeenCalled();
  });

  it('covers require2Fa branches', () => {
    // 1. Unauthenticated -> 401
    const res2faUnauth = createMockRes();
    middleware.require2Fa({ api: true })({}, res2faUnauth, vi.fn());
    expect(res2faUnauth.statusCode).toBe(401);

    // 2. User without 2FA enabled -> passes
    const nextNo2Fa = vi.fn();
    middleware.require2Fa()({ user: { id: 1 } }, createMockRes(), nextNo2Fa);
    expect(nextNo2Fa).toHaveBeenCalled();

    // 3. User with 2FA enabled but not verified -> 403
    const res2faRequired = createMockRes();
    middleware.require2Fa({ api: true })({ user: { id: 1, two_factor_enabled: true } }, res2faRequired, vi.fn());
    expect(res2faRequired.statusCode).toBe(403);

    // 4. User with 2FA verified -> passes
    const next2FaVerified = vi.fn();
    middleware.require2Fa()({
      user: { id: 1, two_factor_enabled: true },
      session: { twoFactorVerified: true },
    }, createMockRes(), next2FaVerified);
    expect(next2FaVerified).toHaveBeenCalled();
  });

  it('covers parseMiddlewareString', () => {
    expect(typeof middleware.parseMiddlewareString('auth')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('auth:api')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('jwt')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('guest')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('2fa:api,always')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('totp')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('can:read,Article')).toBe('function');
    expect(typeof middleware.parseMiddlewareString('verified')).toBe('function');
    expect(() => middleware.parseMiddlewareString('invalid:name')).toThrow('Unknown auth middleware');
  });
});

describe('Coverage Boost: File Manager API Handlers Branches', () => {
  it('covers isActionAllowed and operation handlers', async () => {
    const handlers = createFileManagerApiHandlers({
      baseDir: './tests/fixtures/uploads',
      publicBasePath: '/uploads',
      permissions: {
        delete: ['admin'],
        upload: ['admin', 'editor'],
      },
    });

    // 1. Permission denied for delete action
    const reqUser = { session: { adminUser: { role: 'viewer' } } };
    const resDenied = createMockRes();
    await handlers.delete(reqUser, resDenied);
    expect(resDenied.statusCode).toBe(403);

    // 2. Missing targetPath on delete
    const reqAdmin = { session: { adminUser: { role: 'admin' } }, body: {} };
    const resMissingTarget = createMockRes();
    await handlers.delete(reqAdmin, resMissingTarget);
    expect(resMissingTarget.statusCode).toBe(400);

    // 3. Missing name on mkdir
    const resMissingName = createMockRes();
    await handlers.mkdir({ session: { adminUser: { role: 'admin' } }, body: {} }, resMissingName);
    expect(resMissingName.statusCode).toBe(400);

    // 4. Missing paths on rename and move
    const resMissingRename = createMockRes();
    await handlers.rename({ session: { adminUser: { role: 'admin' } }, body: {} }, resMissingRename);
    expect(resMissingRename.statusCode).toBe(400);

    const resMissingMove = createMockRes();
    await handlers.move({ session: { adminUser: { role: 'admin' } }, body: {} }, resMissingMove);
    expect(resMissingMove.statusCode).toBe(400);
  });
});

describe('Coverage Boost: Site Analytics and Audit Log Branches', () => {
  it('covers site analytics parseDays and stats calculations', async () => {
    const mockKnex = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue([{ count: 120 }]),
      countDistinct: vi.fn().mockResolvedValue([{ count: 45 }]),
    });

    const handlers = createAnalyticsApiHandlers({ knex: mockKnex });

    // Days query parameter: default, lower bound, upper bound
    const res1 = createMockRes();
    await handlers.getStats({ query: {} }, res1);
    expect(res1._json.days).toBe(30);

    const res2 = createMockRes();
    await handlers.getStats({ query: { days: '500' } }, res2);
    expect(res2._json.days).toBe(365);

    const res3 = createMockRes();
    await handlers.getStats({ query: { days: '-5' } }, res3);
    expect(res3._json.days).toBe(1);
  });

  it('covers audit log filters, timeline, purge, and query helpers', async () => {
    const sampleRows = [
      { id: 1, action: 'create', resource_model: 'Article', resource_id: '1', created_at: '2026-01-01T00:00:00Z', metadata: '{"changedFields":["title"]}' },
    ];
    const qb = {
      modify: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      whereRaw: vi.fn().mockReturnThis(),
      del: vi.fn().mockResolvedValue(5),
      delete: vi.fn().mockResolvedValue(5),
      count: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ cnt: 1 }),
      }),
      then(onFulfilled, onRejected) {
        return Promise.resolve(sampleRows).then(onFulfilled, onRejected);
      },
    };
    const mockKnex = vi.fn().mockReturnValue(qb);

    const handlers = createAuditLogHandlers({ knex: mockKnex });

    // 1. List with all filters: model, action, recordId, actorId, actorEmail, from, to, search
    const reqList = {
      query: {
        model: 'Article',
        action: 'create',
        recordId: '1',
        actorId: '10',
        actorEmail: 'admin@webspresso.com',
        from: '2026-01-01',
        to: '2026-12-31',
        search: 'Article',
      },
    };
    const resList = createMockRes();
    await handlers.listHandler(reqList, resList);
    expect(resList._json.meta.total).toBe(1);

    // 2. Timeline handler: missing params 400
    const resTimelineMissing = createMockRes();
    await handlers.timelineHandler({ query: {} }, resTimelineMissing);
    expect(resTimelineMissing.statusCode).toBe(400);

    // 3. Timeline handler success
    const resTimelineOk = createMockRes();
    await handlers.timelineHandler({ query: { model: 'Article', id: '1' } }, resTimelineOk);
    expect(resTimelineOk.statusCode).toBe(200);
    expect(resTimelineOk._json.timeline[0].id).toBe(1);

    // 4. Purge handler invalid days
    const resPurgeInvalid = createMockRes();
    await handlers.purgeHandler({ body: { days: -1 } }, resPurgeInvalid);
    expect(resPurgeInvalid.statusCode).toBe(400);

    // 5. Purge handler invalid date
    const resPurgeBadDate = createMockRes();
    await handlers.purgeHandler({ body: { olderThan: 'not-a-date' } }, resPurgeBadDate);
    expect(resPurgeBadDate.statusCode).toBe(400);

    // 6. Purge handler success
    const resPurgeOk = createMockRes();
    await handlers.purgeHandler({ body: { days: 30 } }, resPurgeOk);
    expect(resPurgeOk._json.ok).toBe(true);

    // 7. queryLogs and queryTimeline
    const logs = await handlers.queryLogs({ model: 'Article', limit: 10 });
    expect(logs).toHaveLength(1);

    const timeline = await handlers.queryTimeline('Article', '1');
    expect(timeline).toHaveLength(1);

    const emptyTimeline = await handlers.queryTimeline(null, '1');
    expect(emptyTimeline).toHaveLength(0);
  });
});

describe('Coverage Boost: ORM Repository & Scopes Branches', () => {
  it('covers findById, findOne, findAll, create, update, delete, restore, and lifecycle cancellation', async () => {
    const itemSchema = z.object({
      id: z.number().optional(),
      title: z.string().min(1),
      payload: z.any().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
      deleted_at: z.string().nullable().optional(),
    });

    const model = {
      name: 'RepoItem',
      table: 'repo_items',
      primaryKey: 'id',
      columns: new Map([
        ['id', { type: 'id', primary: true }],
        ['title', { type: 'string' }],
        ['payload', { type: 'json' }],
        ['created_at', { type: 'timestamp', auto: 'create' }],
        ['updated_at', { type: 'timestamp', auto: 'update' }],
        ['deleted_at', { type: 'timestamp', nullable: true }],
      ]),
      schema: itemSchema,
      relations: {},
      scopes: {
        softDelete: { deletedAtColumn: 'deleted_at' },
      },
    };

    const initialRows = [
      { id: 1, title: 'Item 1', payload: '{"hello":"world"}', created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null },
    ];

    const qb = {
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(async () => initialRows[0] || null),
      insert: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([2]),
      }),
      update: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(1),
      count: vi.fn().mockResolvedValue([{ count: 1 }]),
      then(onFulfilled, onRejected) {
        return Promise.resolve(initialRows).then(onFulfilled, onRejected);
      },
    };

    const mockKnex = vi.fn().mockReturnValue(qb);
    mockKnex.client = { config: { client: 'sqlite3' } };

    const repo = createRepository(model, mockKnex);

    // 1. findById
    const found = await repo.findById(1, { select: ['id', 'title'] });
    expect(found.title).toBe('Item 1');
    expect(found.payload.hello).toBe('world');

    // 2. findById not found
    qb.first.mockResolvedValueOnce(null);
    const notFound = await repo.findById(999);
    expect(notFound).toBeNull();

    // 3. findOne
    const one = await repo.findOne({ title: 'Item 1' });
    expect(one.id).toBe(1);

    // 4. findAll
    const all = await repo.findAll({ select: ['id'] });
    expect(all).toHaveLength(1);

    // 5. create
    const created = await repo.create({ title: 'Item 2', payload: { test: true } });
    expect(created.id).toBe(1);

    // 6. createMany
    const createdList = await repo.createMany([{ title: 'Item 3' }]);
    expect(createdList).toHaveLength(1);

    // 7. update
    const updated = await repo.update(1, { title: 'Updated Item' });
    expect(updated).toBeDefined();

    // 8. delete (soft delete branch)
    const deleted = await repo.delete(1);
    expect(deleted).toBe(true);

    // 9. restore
    const restored = await repo.restore(1);
    expect(restored).toBeDefined();

    // 10. Hook cancellation branch
    const { createRequire } = await import('module');
    const reqCjs = createRequire(import.meta.url);
    const { ModelEvents: cjsModelEvents } = reqCjs('../../../core/orm/events.js');
    const cancelHandler = (data, ctx) => {
      ctx.cancel('Cancelled by test');
    };
    const unsub = cjsModelEvents.on('RepoItem.beforeValidation', cancelHandler);

    await expect(repo.create({ title: 'Blocked Item' })).rejects.toThrow('Cancelled by test');

    unsub();
  });
});

describe('Coverage Boost: WebhookDispatcher Branches', () => {
  it('covers static endpoints CRUD, dispatch filters, and knex-less delivery queries', async () => {
    const staticEndpoints = [
      { id: 1, name: 'EP 1', url: 'https://example.com/hook1', events: ['order.*'], is_active: true },
      { id: 2, name: 'EP 2', url: 'https://example.com/hook2', events: ['user.created'], is_active: false },
    ];

    const dispatcher = new WebhookDispatcher({
      endpoints: staticEndpoints,
    });

    // 1. generateDeliveryId
    const dId = generateDeliveryId();
    expect(dId).toMatch(/^dlv_/);

    // 2. getEndpointsForEvent
    const orderEndpoints = await dispatcher.getEndpointsForEvent('order.created');
    expect(orderEndpoints).toHaveLength(1);
    expect(orderEndpoints[0].id).toBe(1);

    const userEndpoints = await dispatcher.getEndpointsForEvent('user.created');
    expect(userEndpoints).toHaveLength(0); // inactive

    // 3. createEndpoint static
    const createdEp = await dispatcher.createEndpoint({
      name: 'EP 3',
      url: 'https://example.com/hook3',
      events: ['*'],
    });
    expect(createdEp.id).toBe(3);

    // 4. updateEndpoint static: all fields
    const updatedEp = await dispatcher.updateEndpoint(1, {
      name: 'EP 1 Updated',
      url: 'https://example.com/new',
      secret: 'new-secret',
      events: ['invoice.*'],
      is_active: true,
      description: 'Desc',
      headers: { 'X-Custom': '1' },
      metadata: { env: 'prod' },
    });
    expect(updatedEp.name).toBe('EP 1 Updated');

    // updateEndpoint not found
    const notFoundEp = await dispatcher.updateEndpoint(999, { name: 'None' });
    expect(notFoundEp).toBeNull();

    // 5. deleteEndpoint static
    const deleted = await dispatcher.deleteEndpoint(3);
    expect(deleted).toBe(true);

    const deleteNotFound = await dispatcher.deleteEndpoint(999);
    expect(deleteNotFound).toBe(false);

    // 6. dispatch invalid event
    await expect(dispatcher.dispatch('', {})).rejects.toThrow('Event name must be a non-empty string');

    // 7. dispatch unmatched event
    const noMatch = await dispatcher.dispatch('unmatched.event', {});
    expect(noMatch.dispatched).toBe(0);

    // 8. knex-less delivery queries
    const deliveries = await dispatcher.listDeliveries();
    expect(deliveries.total).toBe(0);

    const singleDelivery = await dispatcher.getDelivery('dlv_123');
    expect(singleDelivery).toBeNull();

    const purged = await dispatcher.purgeDeliveries();
    expect(purged).toBe(0);

    await expect(dispatcher.retryDelivery('dlv_123')).rejects.toThrow('Database connection required');

    // 9. dispose
    dispatcher.dispose();
  });
});


