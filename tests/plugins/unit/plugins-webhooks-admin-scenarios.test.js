import { createMockSpyRes, createMockRes } from '../../utils';
/**
 * Coverage Boost Branches Test
 * Specifically targets branches in plugins/webhooks, plugins/admin-panel,
 * plugins/api-key, and core/queue to surpass global branch coverage threshold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebhookApiHandlers } from '../../../plugins/webhooks/api-handlers.js';
import { createApiHandlers } from '../../../plugins/admin-panel/api.js';
import { createQueueManager } from '../../../core/queue/manager.js';
import {
  createApiKeyMiddleware,
  extractApiKey,
  sendUnauthorized,
  sendForbidden,
  shouldApplyToRoute,
  isSkipped,
} from '../../../plugins/api-key/middleware.js';
import { WebhookDispatcher, generateDeliveryId } from '../../../plugins/webhooks/dispatcher.js';
import * as csvEngine from '../../../plugins/csv/engine.js';
import * as xlsxEngine from '../../../plugins/xlsx/engine.js';
import { createAuthMiddleware } from '../../../core/auth/middleware.js';
import { createContentService } from '../../../core/content/service.js';
import { Readable, Writable } from 'stream';

describe('Coverage Boost: Webhooks API Handlers', () => {
  let mockDispatcher;
  let handlers;

  beforeEach(() => {
    mockDispatcher = {
      deliveriesTable: 'webhook_deliveries',
      resolveKnex: vi.fn(),
      listEndpoints: vi.fn().mockResolvedValue([]),
      createEndpoint: vi.fn().mockResolvedValue({ id: 1, name: 'Ep 1' }),
      getEndpoint: vi.fn().mockResolvedValue(null),
      updateEndpoint: vi.fn().mockResolvedValue(null),
      deleteEndpoint: vi.fn().mockResolvedValue(false),
      pingEndpoint: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
      listDeliveries: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getDelivery: vi.fn().mockResolvedValue(null),
      retryDelivery: vi.fn().mockResolvedValue({ success: true }),
      purgeDeliveries: vi.fn().mockResolvedValue(5),
    };
    handlers = createWebhookApiHandlers(mockDispatcher);
  });

  it('listEndpointsHandler: handles filters and knex delivery stats aggregation', async () => {
    // 1. Without knex
    const req1 = { query: { active: 'true', q: 'test' } };
    const res1 = createMockRes();
    mockDispatcher.listEndpoints.mockResolvedValueOnce([{ id: '1', name: 'ep1' }]);
    await handlers.listEndpointsHandler(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1._json.items[0].name).toBe('ep1');

    // 2. With knex stats aggregation
    const mockKnex = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      sum: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([
        { endpoint_id: '1', total_deliveries: 10, success_count: 8 },
      ]),
    });
    mockKnex.raw = vi.fn().mockReturnValue('RAW_EXPR');
    mockDispatcher.resolveKnex.mockReturnValue(mockKnex);
    mockDispatcher.listEndpoints.mockResolvedValueOnce([{ id: '1', name: 'ep1' }, { id: '2', name: 'ep2' }]);

    const req2 = { query: { active: 'false', search: 'ep' } };
    const res2 = createMockRes();
    await handlers.listEndpointsHandler(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2._json.items[0].stats.total).toBe(10);
    expect(res2._json.items[0].stats.successRate).toBe(80);
    expect(res2._json.items[1].stats.successRate).toBe(100);

    // 3. Error branch
    mockDispatcher.listEndpoints.mockRejectedValueOnce(new Error('DB failure'));
    const req3 = { query: {} };
    const res3 = createMockRes();
    await handlers.listEndpointsHandler(req3, res3);
    expect(res3.statusCode).toBe(500);
    expect(res3._json.error).toBe('DB failure');
  });

  it('createEndpointHandler: handles validation, creation, and errors', async () => {
    // Missing fields
    const req1 = { body: { name: 'Only name' } };
    const res1 = createMockRes();
    await handlers.createEndpointHandler(req1, res1);
    expect(res1.statusCode).toBe(400);

    // Success
    const req2 = { body: { name: 'Valid', url: 'https://example.com/hook' } };
    const res2 = createMockRes();
    await handlers.createEndpointHandler(req2, res2);
    expect(res2.statusCode).toBe(201);
    expect(res2._json.id).toBe(1);

    // Rejection
    mockDispatcher.createEndpoint.mockRejectedValueOnce(new Error('Invalid URL format'));
    const req3 = { body: { name: 'Valid', url: 'not-url' } };
    const res3 = createMockRes();
    await handlers.createEndpointHandler(req3, res3);
    expect(res3.statusCode).toBe(400);
    expect(res3._json.error).toBe('Invalid URL format');
  });

  it('getEndpointHandler, updateEndpointHandler, deleteEndpointHandler: 404 and success branches', async () => {
    // get 404
    const res1 = createMockRes();
    await handlers.getEndpointHandler({ params: { id: 99 } }, res1);
    expect(res1.statusCode).toBe(404);

    // get 200
    mockDispatcher.getEndpoint.mockResolvedValueOnce({ id: 1, name: 'Found' });
    const res2 = createMockRes();
    await handlers.getEndpointHandler({ params: { id: 1 } }, res2);
    expect(res2.statusCode).toBe(200);

    // delete 404
    const res3 = createMockRes();
    await handlers.deleteEndpointHandler({ params: { id: 99 } }, res3);
    expect(res3.statusCode).toBe(404);

    // delete 200
    mockDispatcher.deleteEndpoint.mockResolvedValueOnce(true);
    const res4 = createMockRes();
    await handlers.deleteEndpointHandler({ params: { id: 1 } }, res4);
    expect(res4.statusCode).toBe(200);
    expect(res4._json.success).toBe(true);

    // ping success and failure
    const res5 = createMockRes();
    await handlers.pingEndpointHandler({ params: { id: 1 } }, res5);
    expect(res5.statusCode).toBe(200);

    mockDispatcher.pingEndpoint.mockRejectedValueOnce(new Error('Connection timed out'));
    const res6 = createMockRes();
    await handlers.pingEndpointHandler({ params: { id: 2 } }, res6);
    expect(res6.statusCode).toBe(400);
    expect(res6._json.error).toBe('Connection timed out');
  });

  it('listDeliveriesHandler, getDeliveryHandler, retryDeliveryHandler, purgeDeliveriesHandler', async () => {
    const res1 = createMockRes();
    await handlers.listDeliveriesHandler(
      { query: { endpoint_id: '1', event: 'user.created', success: 'true', page: '2', perPage: '15' } },
      res1
    );
    expect(res1.statusCode).toBe(200);

    // getDelivery 404 and 200
    const res2 = createMockRes();
    await handlers.getDeliveryHandler({ params: { id: 10 } }, res2);
    expect(res2.statusCode).toBe(404);

    mockDispatcher.getDelivery.mockResolvedValueOnce({ id: 10, status: 'delivered' });
    const res3 = createMockRes();
    await handlers.getDeliveryHandler({ params: { id: 10 } }, res3);
    expect(res3.statusCode).toBe(200);

    // retryDelivery 200 and error
    const res4 = createMockRes();
    await handlers.retryDeliveryHandler({ params: { id: 10 } }, res4);
    expect(res4.statusCode).toBe(200);

    mockDispatcher.retryDelivery.mockRejectedValueOnce(new Error('Retry failed'));
    const res5 = createMockRes();
    await handlers.retryDeliveryHandler({ params: { id: 10 } }, res5);
    expect(res5.statusCode).toBe(400);

    // purgeDeliveries 200 and error
    const res6 = createMockRes();
    await handlers.purgeDeliveriesHandler({ body: { days: 60 } }, res6);
    expect(res6.statusCode).toBe(200);
    expect(res6._json.purged).toBe(5);

    mockDispatcher.purgeDeliveries.mockRejectedValueOnce(new Error('Purge failed'));
    const res7 = createMockRes();
    await handlers.purgeDeliveriesHandler({ body: {} }, res7);
    expect(res7.statusCode).toBe(500);
  });
});

describe('Coverage Boost: Admin Panel Inlines & Quick Edit Handlers', () => {
  let mockDb;
  let mockRegistry;
  let adminApi;

  beforeEach(() => {
    const sampleModel = {
      name: 'Order',
      table: 'orders',
      columns: new Map([
        ['id', { type: 'id' }],
        ['status', { type: 'string' }],
        ['total', { type: 'number' }],
      ]),
      admin: {
        enabled: true,
        listEditable: ['status'],
        inlines: [
          { model: 'OrderItem', foreignKey: 'order_id' },
        ],
      },
    };

    const inlineModel = {
      name: 'OrderItem',
      table: 'order_items',
      columns: new Map([
        ['id', { type: 'id' }],
        ['order_id', { type: 'integer' }],
        ['product', { type: 'string' }],
        ['price', { type: 'number' }],
      ]),
      admin: { enabled: true },
    };

    const modelsMap = new Map([
      ['order', sampleModel],
      ['Order', sampleModel],
      ['orderitem', inlineModel],
      ['OrderItem', inlineModel],
    ]);

    mockDb = {
      models: modelsMap,
      getModel: vi.fn((name) => modelsMap.get(name) || modelsMap.get(name?.toLowerCase())),
      getRepository: vi.fn((name) => ({
        query: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          find: vi.fn().mockResolvedValue([{ id: 101, product: 'Widget', order_id: 1 }]),
        }),
        create: vi.fn().mockResolvedValue({ id: 102, product: 'New Widget', order_id: 1 }),
        update: vi.fn().mockImplementation((id, data) => Promise.resolve({ id: Number(id), ...data })),
        delete: vi.fn().mockResolvedValue(true),
      })),
    };

    mockRegistry = {
      has: vi.fn((name) => modelsMap.has(name)),
      get: vi.fn((name) => modelsMap.get(name)),
      getModel: vi.fn((name) => modelsMap.get(name)),
      getAllModels: vi.fn(() => [sampleModel, inlineModel]),
      formatters: new Map(),
    };

    adminApi = createApiHandlers({ db: mockDb, registry: mockRegistry });
  });

  it('inlineListHandler: retrieves inlines or returns 404 for missing models', async () => {
    const res1 = createMockRes();
    await adminApi.inlineListHandler({ params: { model: 'Order', id: 1, inlineModel: 'OrderItem' } }, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1._json.data).toHaveLength(1);

    const res2 = createMockRes();
    await adminApi.inlineListHandler({ params: { model: 'NonExistent', id: 1, inlineModel: 'OrderItem' } }, res2);
    expect(res2.statusCode).toBe(404);
  });

  it('inlineCreateHandler, inlineUpdateHandler, inlineDeleteHandler: execution and error branches', async () => {
    // create 201
    const res1 = createMockRes();
    await adminApi.inlineCreateHandler(
      { params: { model: 'Order', id: 1, inlineModel: 'OrderItem' }, body: { product: 'New Widget', price: 25 } },
      res1
    );
    expect(res1.statusCode).toBe(201);
    expect(res1._json.data.product).toBe('New Widget');

    // update 200
    const res2 = createMockRes();
    await adminApi.inlineUpdateHandler(
      { params: { model: 'Order', id: 1, inlineModel: 'OrderItem', inlineId: 101 }, body: { price: 30 } },
      res2
    );
    expect(res2.statusCode).toBe(200);

    // update 404 when record not found
    mockDb.getRepository.mockReturnValueOnce({
      update: vi.fn().mockResolvedValue(null),
    });
    const res3 = createMockRes();
    await adminApi.inlineUpdateHandler(
      { params: { model: 'Order', id: 1, inlineModel: 'OrderItem', inlineId: 999 }, body: { price: 30 } },
      res3
    );
    expect(res3.statusCode).toBe(404);

    // delete 200
    const res4 = createMockRes();
    await adminApi.inlineDeleteHandler(
      { params: { model: 'Order', id: 1, inlineModel: 'OrderItem', inlineId: 101 } },
      res4
    );
    expect(res4.statusCode).toBe(200);
    expect(res4._json.success).toBe(true);

    // delete 404
    const res5 = createMockRes();
    await adminApi.inlineDeleteHandler(
      { params: { model: 'Order', id: 1, inlineModel: 'UnknownModel', inlineId: 101 } },
      res5
    );
    expect(res5.statusCode).toBe(404);
  });

  it('quickEditHandler: enforces permissions, listEditable whitelist, and performs updates', async () => {
    // 1. Success on listEditable column
    const res1 = createMockRes();
    await adminApi.quickEditHandler(
      { params: { model: 'Order', id: 42 }, body: { status: 'shipped' } },
      res1
    );
    expect(res1.statusCode).toBe(200);
    expect(res1._json.success).toBe(true);
    expect(res1._json.data.status).toBe('shipped');

    // 2. Disallowed column
    const res2 = createMockRes();
    await adminApi.quickEditHandler(
      { params: { model: 'Order', id: 42 }, body: { total: 500 } },
      res2
    );
    expect(res2.statusCode).toBe(400);
    expect(res2._json.error).toContain('not list-editable');

    // 3. Model not found
    const res3 = createMockRes();
    await adminApi.quickEditHandler(
      { params: { model: 'Ghost', id: 42 }, body: { status: 'shipped' } },
      res3
    );
    expect(res3.statusCode).toBe(404);

    // 4. Record not found
    mockDb.getRepository.mockReturnValueOnce({
      update: vi.fn().mockResolvedValue(null),
    });
    const res4 = createMockRes();
    await adminApi.quickEditHandler(
      { params: { model: 'Order', id: 999 }, body: { status: 'shipped' } },
      res4
    );
    expect(res4.statusCode).toBe(404);
  });

  it('batchEditHandler: handles batch inline updates and errors', async () => {
    // 1. Non-array payload
    // 1. Non-array payload
    const res1 = createMockRes();
    await adminApi.batchEditHandler(
      { params: { model: 'Order' }, body: { updates: 'not-array' } },
      res1
    );
    expect(res1.statusCode).toBe(400);

    // 2. Batch update
    const res2 = createMockRes();
    await adminApi.batchEditHandler(
      {
        params: { model: 'Order' },
        body: {
          updates: [
            { id: 1, changes: { status: 'shipped' } },
            { id: 2, changes: { status: 'cancelled' } },
          ],
        },
      },
      res2
    );
    expect(res2.statusCode).toBe(200);
    expect(res2._json.success).toBe(true);
    expect(res2._json.count).toBe(2);
  });

  it('recordsListHandler: exercises all filter operators, search, and sorting branches', async () => {
    const listRes = createMockRes();
    const mockQuery = {
      whereNull: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      whereBetween: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(10),
      list: vi.fn().mockResolvedValue([{ id: 1, status: 'pending', total: 50 }]),
    };

    mockDb.getRepository.mockReturnValue({
      query: vi.fn().mockReturnValue(mockQuery),
    });

    // 1. Model not found or not enabled
    const notFoundRes = createMockRes();
    await adminApi.recordsListHandler({ params: { model: 'Unknown' }, query: {} }, notFoundRes);
    expect(notFoundRes.statusCode).toBe(404);

    // 2. All filter operators
    const reqWithFilters = {
      params: { model: 'Order' },
      query: {
        page: '2',
        perPage: '5',
        search: 'test',
        sort: 'total',
        order: 'asc',
        filter: {
          non_existent_col: { value: 'skip me' },
          id: { op: 'is_null' },
          status: { op: 'is_not_null' },
          total: { op: 'between', from: 10, to: 100 },
        },
      },
    };
    await adminApi.recordsListHandler(reqWithFilters, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(mockQuery.whereNull).toHaveBeenCalledWith('id');
    expect(mockQuery.whereNotNull).toHaveBeenCalledWith('status');
    expect(mockQuery.whereBetween).toHaveBeenCalledWith('total', [10, 100]);
    expect(mockQuery.orderBy).toHaveBeenCalledWith('total', 'asc');

    // 3. More filter operators (between with only from, between with only to, in, string operators, comparisons)
    for (const [col, filter] of Object.entries({
      total_from: { col: 'total', filter: { op: 'between', from: 20 } },
      total_to: { col: 'total', filter: { op: 'between', to: 80 } },
      status_in: { col: 'status', filter: { op: 'in', value: ['pending', 'shipped'] } },
      status_eq: { col: 'status', filter: { op: 'equals', value: 'completed' } },
      status_sw: { col: 'status', filter: { op: 'starts_with', value: 'pen' } },
      status_ew: { col: 'status', filter: { op: 'ends_with', value: 'ing' } },
      total_gt: { col: 'total', filter: { op: 'gt', value: 10 } },
      total_gte: { col: 'total', filter: { op: 'gte', value: 15 } },
      total_lt: { col: 'total', filter: { op: 'lt', value: 100 } },
      total_lte: { col: 'total', filter: { op: 'lte', value: 90 } },
      status_contains: { col: 'status', filter: { op: 'contains', value: 'pend' } },
    })) {
      const res = createMockRes();
      await adminApi.recordsListHandler(
        {
          params: { model: 'Order' },
          query: { filter: { [filter.col]: filter.filter } },
        },
        res
      );
      expect(res.statusCode).toBe(200);
    }
  });

  it('recordHandler, create, update, delete, restore, facets, actions: covers admin CRUD branches', async () => {
    // 1. recordHandler
    const recRes = createMockRes();
    mockDb.getRepository.mockReturnValueOnce({
      findById: vi.fn().mockResolvedValue({ id: 1, status: 'pending' }),
      query: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        find: vi.fn().mockResolvedValue([]),
      }),
    });
    await adminApi.recordHandler({ params: { model: 'Order', id: 1 } }, recRes);
    expect(recRes.statusCode).toBe(200);

    // 2. createRecordHandler read-only model
    const orderModel = mockDb.getModel('Order');
    orderModel.admin.readOnly = true;
    const createRes1 = createMockRes();
    await adminApi.createRecordHandler({ params: { model: 'Order' }, body: {} }, createRes1);
    expect(createRes1.statusCode).toBe(403);
    orderModel.admin.readOnly = false;

    // 3. updateRecordHandler record not found
    mockDb.getRepository.mockReturnValueOnce({
      update: vi.fn().mockResolvedValue(null),
    });
    const updateRes1 = createMockRes();
    await adminApi.updateRecordHandler({ params: { model: 'Order', id: 999 }, body: {} }, updateRes1);
    expect(updateRes1.statusCode).toBe(404);

    // 4. deleteRecordHandler record not found
    mockDb.getRepository.mockReturnValueOnce({
      delete: vi.fn().mockResolvedValue(false),
    });
    const delRes1 = createMockRes();
    await adminApi.deleteRecordHandler({ params: { model: 'Order', id: 999 } }, delRes1);
    expect(delRes1.statusCode).toBe(404);

    // 5. restoreRecordHandler when softDelete not configured
    const restoreRes1 = createMockRes();
    await adminApi.restoreRecordHandler({ params: { model: 'Order', id: 1 } }, restoreRes1);
    expect(restoreRes1.statusCode).toBe(400);

    // 6. filterFacetsHandler
    const facetsRes = createMockRes();
    mockDb.getRepository.mockReturnValueOnce({
      query: vi.fn().mockReturnValue({
        whereNotNull: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        find: vi.fn().mockResolvedValue([{ status: 'pending' }, { status: 'shipped' }]),
      }),
    });
    await adminApi.filterFacetsHandler({ params: { model: 'Order' }, query: { fields: 'status' } }, facetsRes);
    expect(facetsRes.statusCode).toBe(200);
    expect(facetsRes._json.facets.status).toBeDefined();

    // 7. modelActionHandler
    const actionRes1 = createMockRes();
    await adminApi.modelActionHandler({ params: { model: 'Order', actionId: 'test' }, body: { ids: 'invalid' } }, actionRes1);
    expect(actionRes1.statusCode).toBe(400);

    const actionRes2 = createMockRes();
    await adminApi.modelActionHandler({ params: { model: 'Order', actionId: 'missing' }, body: { ids: [1] } }, actionRes2);
    expect(actionRes2.statusCode).toBe(404);
  });
});

describe('Coverage Boost: API Key Middleware Branches', () => {
  it('shouldApplyToRoute and isSkipped: test path evaluation branches', () => {
    expect(shouldApplyToRoute('/api/users', true)).toBe(true);
    expect(shouldApplyToRoute('/api/users', null)).toBe(true);
    expect(shouldApplyToRoute('/api/users', '/api')).toBe(true);
    expect(shouldApplyToRoute('/public/page', ['/api', '/admin'])).toBe(false);

    expect(isSkipped({ path: '/health' }, ['/health'])).toBe(true);
    expect(isSkipped({ path: '/api/v1' }, ['/health'], (req) => req.path.startsWith('/api'))).toBe(true);
    expect(isSkipped({ path: '/other' }, ['/health'])).toBe(false);
  });

  it('extractApiKey: tests all header, query, and bearer extraction variants', () => {
    // Custom extractKey function
    expect(extractApiKey({}, { extractKey: () => 'custom-key-1' })).toBe('custom-key-1');
    expect(extractApiKey({}, { extractKey: () => null })).toBe(null);

    // Custom headerName
    expect(extractApiKey({ headers: { 'x-my-key': 'val-hdr' } }, { headerName: 'X-My-Key' })).toBe('val-hdr');

    // Standard x-api-key & api-key
    expect(extractApiKey({ headers: { 'x-api-key': 'hdr-1' } })).toBe('hdr-1');
    expect(extractApiKey({ headers: { 'api-key': 'hdr-2' } })).toBe('hdr-2');

    // Authorization header
    expect(extractApiKey({ headers: { authorization: 'Bearer tok-bearer' } })).toBe('tok-bearer');
    expect(extractApiKey({ headers: { authorization: 'ApiKey tok-apikey' } })).toBe('tok-apikey');
    expect(extractApiKey({ headers: { authorization: 'Api-Key tok-hyphen' } })).toBe('tok-hyphen');
    expect(extractApiKey({ headers: { authorization: 'Basic dXNlcjpwYXNz' } })).toBe(null);

    // Query param extraction
    expect(extractApiKey({ query: { apiKey: 'q-key-1' } }, { allowQueryParam: true })).toBe('q-key-1');
    expect(extractApiKey({ query: { api_key: 'q-key-2' } }, { allowQueryParam: true })).toBe('q-key-2');
    expect(extractApiKey({ query: { customToken: 'q-custom' } }, { allowQueryParam: true, queryParamName: 'customToken' })).toBe('q-custom');
  });

  it('sendUnauthorized and sendForbidden: tests response format permutations', () => {
    // sendUnauthorized function response
    const res1 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const customFn = vi.fn();
    sendUnauthorized({}, res1, { unauthorizedResponse: customFn });
    expect(res1.statusCode).toBe(401);
    expect(customFn).toHaveBeenCalled();

    // sendUnauthorized object response
    const res2 = createMockSpyRes();
    sendUnauthorized({}, res2, { unauthorizedResponse: { custom: 'unauth' } });
    expect(res2.end).toHaveBeenCalledWith(JSON.stringify({ custom: 'unauth' }));

    // sendUnauthorized string response
    const res3 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    sendUnauthorized({}, res3, { unauthorizedResponse: 'Forbidden string' });
    expect(res3.end).toHaveBeenCalledWith('Forbidden string');

    // sendUnauthorized JSON fallback
    const res4 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    sendUnauthorized({ path: '/api/test' }, res4, {});
    expect(res4.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');

    // sendForbidden function response
    const res5 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    sendForbidden({}, res5, { forbiddenResponse: customFn }, 'Custom msg', { requiredScopes: ['admin'] });
    expect(res5.statusCode).toBe(403);

    // sendForbidden object response
    const res6 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    sendForbidden({}, res6, { forbiddenResponse: { error: 'denied' } });
    expect(res6.end).toHaveBeenCalledWith(JSON.stringify({ error: 'denied' }));

    // sendForbidden string response
    const res7 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    sendForbidden({}, res7, { forbiddenResponse: 'Denied text' });
    expect(res7.end).toHaveBeenCalledWith('Denied text');
  });

  it('createApiKeyMiddleware: tests authentication lifecycle and validation rules', async () => {
    const mw = createApiKeyMiddleware({
      keys: [
        { key: 'valid-secret-key-12345678', name: 'Service1', scopes: ['read:data'], is_active: true },
        { key: 'expired-key-12345678', name: 'Expired', is_active: true, expires_at: new Date(Date.now() - 10000) },
        { key: 'inactive-key-12345678', name: 'Inactive', is_active: false },
        { key: 'scoped-key-12345678', name: 'Scoped', is_active: true, scopes: ['read:only'] },
      ],
      routes: ['/api'],
      scopes: ['admin:write'],
    });

    // 1. Skips non-matching route
    const req1 = { path: '/home', headers: {} };
    const res1 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const next1 = vi.fn();
    await mw(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // 2. Missing key
    const req2 = { path: '/api/data', headers: {} };
    const res2 = createMockSpyRes();
    const next2 = vi.fn();
    await mw(req2, res2, next2);
    expect(res2.statusCode).toBe(401);

    // 3. Expired key
    const req3 = { path: '/api/data', headers: { 'x-api-key': 'expired-key-12345678' } };
    const res3 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const next3 = vi.fn();
    await mw(req3, res3, next3);
    expect(res3.statusCode).toBe(401);

    // 4. Inactive key
    const req4 = { path: '/api/data', headers: { 'x-api-key': 'inactive-key-12345678' } };
    const res4 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const next4 = vi.fn();
    await mw(req4, res4, next4);
    expect(res4.statusCode).toBe(401);

    // 5. Insufficient scopes -> 403
    const req5 = { path: '/api/data', headers: { 'x-api-key': 'scoped-key-12345678' } };
    const res5 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const next5 = vi.fn();
    await mw(req5, res5, next5);
    expect(res5.statusCode).toBe(403);

    // 6. Valid key with required scopes
    const mw2 = createApiKeyMiddleware({
      keys: [
        { key: 'valid-secret-key-12345678', name: 'Service1', scopes: ['read:data'], is_active: true },
      ],
      routes: ['/api'],
      scopes: ['read:data'],
    });
    const req6 = { path: '/api/data', headers: { 'x-api-key': 'valid-secret-key-12345678' } };
    const res6 = { statusCode: 200, end: vi.fn(), setHeader: vi.fn() };
    const next6 = vi.fn();
    await mw2(req6, res6, next6);
    expect(next6).toHaveBeenCalled();
    expect(req6.apiKey).toBeDefined();
    expect(req6.apiKey.name).toBe('Service1');
  });
});

describe('Coverage Boost: Queue Manager & Backoff Branches', () => {
  it('manages job retries, backoff delays, and priority ordering', async () => {
    const q = createQueueManager({ concurrency: 2 });

    // Validation branches
    expect(() => q.define('', () => {})).toThrow('Job name must be a non-empty string');
    expect(() => q.define('job.test', 'not-a-func')).toThrow("Job handler for 'job.test' must be a function");

    let attempts = 0;
    q.define(
      'flaky',
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Transient network error');
        }
        return 'done';
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10 },
      }
    );

    // Dispatch with Date delay
    const jobWithDate = await q.dispatch('flaky', { id: 1 }, { delay: new Date(Date.now() + 50) });
    expect(jobWithDate).toBeDefined();

    // Stats
    const stats = await q.getStats();
    expect(stats.concurrency).toBe(2);
    expect(stats.registeredJobs).toContain('flaky');

    // Retention cleanup
    await q.runCleanup();

    // Pause & resume
    q.pause();
    expect(q.isPaused).toBe(true);
    q.resume();
    expect(q.isPaused).toBe(false);

    // Drain
    await q.drain();
  });
});

describe('Coverage Boost: WebhookDispatcher Class', () => {
  it('instantiates with various options and handles dispose and setQueue', () => {
    const d1 = new WebhookDispatcher();
    expect(d1.endpointsTable).toBe('webhook_endpoints');
    expect(d1.deliveriesTable).toBe('webhook_deliveries');
    expect(d1.maxAttempts).toBe(3);
    expect(d1.backoffBaseMs).toBe(1000);
    expect(d1.timeoutMs).toBe(10000);
    expect(d1.wrapPayload).toBe(true);

    const mockQ = { dispatch: vi.fn() };
    d1.setQueue(mockQ);
    expect(d1.queue).toBe(mockQ);

    d1.dispose();

    const d2 = new WebhookDispatcher({
      endpointsTable: 'custom_ep',
      deliveriesTable: 'custom_dlv',
      maxAttempts: 5,
      backoffBaseMs: 500,
      timeoutMs: 5000,
      wrapPayload: false,
      endpoints: [{ id: 1, name: 'Static', url: 'https://example.com', events: ['*'], is_active: true }],
    });
    expect(d2.endpointsTable).toBe('custom_ep');
    expect(d2.maxAttempts).toBe(5);
    expect(d2.wrapPayload).toBe(false);

    const delivId = generateDeliveryId();
    expect(delivId.startsWith('dlv_')).toBe(true);
  });

  it('getEndpointsForEvent with static and knex sources', async () => {
    // Static endpoints
    const staticDispatcher = new WebhookDispatcher({
      endpoints: [
        { id: 1, name: 'Active', events: ['user.*'], is_active: true },
        { id: 2, name: 'Inactive', events: ['user.*'], is_active: false },
        { id: 3, name: 'Other', events: ['order.*'], is_active: true },
      ],
    });
    const eps = await staticDispatcher.getEndpointsForEvent('user.created');
    expect(eps).toHaveLength(1);
    expect(eps[0].name).toBe('Active');

    // Knex endpoints - no knex
    const noKnexDispatcher = new WebhookDispatcher();
    expect(await noKnexDispatcher.getEndpointsForEvent('test')).toEqual([]);

    // Knex endpoints - with knex
    const mockKx = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([
        { id: 10, name: 'KnexEp', events: JSON.stringify(['item.*']), is_active: true },
      ]),
    });
    const knexDispatcher = new WebhookDispatcher({ knex: mockKx });
    const knexEps = await knexDispatcher.getEndpointsForEvent('item.added');
    expect(knexEps).toHaveLength(1);
    expect(knexEps[0].name).toBe('KnexEp');
  });

  it('listEndpoints, getEndpoint, createEndpoint, updateEndpoint, deleteEndpoint static & knex branches', async () => {
    // 1. Static CRUD
    const d = new WebhookDispatcher({
      endpoints: [
        { id: 1, name: 'Alpha', url: 'https://alpha.com', events: ['*'], is_active: true },
        { id: 2, name: 'Beta', url: 'https://beta.com', events: ['*'], is_active: false },
      ],
    });

    // listEndpoints filters
    const all = await d.listEndpoints();
    expect(all).toHaveLength(2);
    const active = await d.listEndpoints({ active: true });
    expect(active).toHaveLength(1);
    const searched = await d.listEndpoints({ search: 'alpha' });
    expect(searched).toHaveLength(1);

    // getEndpoint
    expect(await d.getEndpoint(1)).toBeDefined();
    expect(await d.getEndpoint('999')).toBeNull();

    // createEndpoint validation
    await expect(d.createEndpoint({})).rejects.toThrow('Endpoint name is required');
    await expect(d.createEndpoint({ name: 'test' })).rejects.toThrow('Endpoint URL is required');

    // createEndpoint static
    const created = await d.createEndpoint({
      name: 'Gamma',
      url: 'https://gamma.com',
      events: ['test.*'],
      headers: { 'X-Custom': '1' },
      metadata: { env: 'prod' },
    });
    expect(created.id).toBe(3);
    expect(created.name).toBe('Gamma');

    // updateEndpoint static
    const updated = await d.updateEndpoint(3, {
      name: 'Gamma Updated',
      url: 'https://gamma2.com',
      secret: 'new-secret',
      events: ['new.*'],
      is_active: false,
      description: 'desc',
      headers: JSON.stringify({ a: 1 }),
      metadata: JSON.stringify({ b: 2 }),
    });
    expect(updated.name).toBe('Gamma Updated');
    expect(await d.updateEndpoint(999, { name: 'None' })).toBeNull();

    // deleteEndpoint static
    expect(await d.deleteEndpoint(3)).toBe(true);
    expect(await d.deleteEndpoint(999)).toBe(false);

    // 2. Knex CRUD branches
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 5, name: 'K1' }),
      insert: vi.fn().mockResolvedValue([5]),
      update: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(1),
    };
    const mockKx = vi.fn().mockReturnValue(mockQueryBuilder);
    const kd = new WebhookDispatcher({ knex: mockKx });

    // listEndpoints knex
    await kd.listEndpoints({ active: true, search: 'test', limit: 10, offset: 5 });
    expect(mockKx).toHaveBeenCalled();

    // getEndpoint knex
    const ep = await kd.getEndpoint(5);
    expect(ep.id).toBe(5);

    // createEndpoint knex
    const kCreated = await kd.createEndpoint({
      name: 'KnexEp',
      url: 'https://knex.com',
      headers: '{"x":1}',
      metadata: '{"y":2}',
    });
    expect(kCreated.id).toBe(5);

    // updateEndpoint knex
    const kUpdated = await kd.updateEndpoint(5, { name: 'KnexEpUpdated', active: true });
    expect(kUpdated).toBeDefined();

    mockQueryBuilder.update.mockResolvedValueOnce(0);
    expect(await kd.updateEndpoint(999, { name: 'KnexNone' })).toBeNull();

    // deleteEndpoint knex
    expect(await kd.deleteEndpoint(5)).toBe(true);

    mockQueryBuilder.delete.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    expect(await kd.deleteEndpoint(999)).toBe(false);
  });

  it('dispatch with queue, in-process, endpointId filter, and options.wait', async () => {
    const d = new WebhookDispatcher({
      endpoints: [
        { id: 1, name: 'E1', url: 'https://e1.com', events: ['test.*'], is_active: true },
        { id: 2, name: 'E2', url: 'https://e2.com', events: ['test.*'], is_active: true },
      ],
    });

    // Validation
    await expect(d.dispatch('')).rejects.toThrow('Event name must be a non-empty string');

    // No matching
    const resNoMatch = await d.dispatch('other.event', {});
    expect(resNoMatch.dispatched).toBe(0);

    // Mock executeDelivery
    const mockExec = vi.spyOn(d, 'executeDelivery').mockResolvedValue({ success: true });

    // Dispatch with endpointId filter
    const resFilter = await d.dispatch('test.event', { foo: 'bar' }, { endpointId: 1 });
    expect(resFilter.dispatched).toBe(1);

    // Dispatch with queue
    const mockQueue = { dispatch: vi.fn().mockResolvedValue({ id: 'job_1' }) };
    d.setQueue(mockQueue);
    const resQueue = await d.dispatch('test.event', 'payload-str', { wait: true });
    expect(resQueue.dispatched).toBe(2);
    expect(mockQueue.dispatch).toHaveBeenCalledTimes(2);

    mockExec.mockRestore();
  });

  it('executeDelivery success, failure retry timer, pingEndpoint, retryDelivery, listDeliveries, purgeDeliveries', async () => {
    const d = new WebhookDispatcher({ maxAttempts: 2, backoffBaseMs: 50 });

    // Mock fetch for sendWebhook
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
    });

    let dWithEp, kd;
    try {
      // executeDelivery success
      const deliveredListener = vi.fn();
      d.on('delivered', deliveredListener);

      const out1 = await d.executeDelivery({
        endpoint: { id: 1, url: 'https://example.com/wh', secret: 'sec' },
        deliveryId: 'd_1',
        event: 'user.created',
        payload: { user: 'alice' },
      });
      expect(out1.success).toBe(true);
      expect(deliveredListener).toHaveBeenCalled();

      // executeDelivery failure with retry
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });
      const failedListener = vi.fn();
      d.on('failed', failedListener);

      const out2 = await d.executeDelivery({
        endpoint: { id: 1, url: 'https://example.com/wh', secret: 'sec' },
        deliveryId: 'd_2',
        event: 'user.created',
        payload: { user: 'bob' },
        attempt: 1,
        autoRetry: false,
      });
      expect(out2.success).toBe(false);
      expect(out2.willRetry).toBe(true);
      expect(failedListener).toHaveBeenCalled();

      // pingEndpoint 404
      await expect(d.pingEndpoint(999)).rejects.toThrow('Endpoint #999 not found');

      // pingEndpoint success on static endpoint
      dWithEp = new WebhookDispatcher({
        endpoints: [{ id: 10, name: 'PingTarget', url: 'https://example.com/ping', events: ['*'] }],
      });
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('PONG'),
      });
      const pingRes = await dWithEp.pingEndpoint(10);
      expect(pingRes.statusCode).toBe(200);

      // retryDelivery without knex -> throws
      await expect(d.retryDelivery(1)).rejects.toThrow('Database connection required');

      // retryDelivery with mock knex
      const mockDeliveriesQb = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn(),
        clone: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue([{ count: '1' }]),
        select: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        delete: vi.fn().mockResolvedValue(3),
      };
      const mockKx = vi.fn().mockReturnValue(mockDeliveriesQb);
      kd = new WebhookDispatcher({
        knex: mockKx,
        endpoints: [{ id: 1, name: 'Target', url: 'https://target.com', events: ['*'] }],
      });

      // Delivery not found
      mockDeliveriesQb.first.mockResolvedValueOnce(null);
      await expect(kd.retryDelivery(1)).rejects.toThrow('Delivery #1 not found');

      // Target endpoint no longer exists
      mockDeliveriesQb.first.mockResolvedValueOnce({ id: 2, endpoint_id: 999, payload: '{}' });
      await expect(kd.retryDelivery(2)).rejects.toThrow('Target endpoint #999 no longer exists');

      // Successful retry execution
      mockDeliveriesQb.first.mockResolvedValueOnce({
        id: 3,
        endpoint_id: 1,
        event: 'user.login',
        payload: '{"uid":42}',
        attempt: 1,
      });
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('RETRY_OK'),
      });
      const retryOutcome = await kd.retryDelivery(3);
      expect(retryOutcome.success).toBe(true);

      // listDeliveries without knex
      expect((await d.listDeliveries()).items).toEqual([]);

      // listDeliveries with knex
      mockDeliveriesQb.offset.mockResolvedValueOnce([{ id: 10, event: 'item.created' }]);
      const deliveriesList = await kd.listDeliveries({
        endpointId: 1,
        event: 'item',
        success: 'true',
        page: 1,
        limit: 10,
      });
      expect(deliveriesList.total).toBe(1);
      expect(deliveriesList.items).toHaveLength(1);

      // getDelivery without knex vs with knex
      expect(await d.getDelivery(1)).toBeNull();
      mockDeliveriesQb.first.mockResolvedValueOnce({ id: 10 });
      expect(await kd.getDelivery(10)).toEqual({ id: 10 });

      // purgeDeliveries without knex vs with knex
      expect(await d.purgeDeliveries()).toBe(0);
      const purged = await kd.purgeDeliveries({ days: 15 });
      expect(purged).toBe(3);
    } finally {
      global.fetch = originalFetch;
      d.dispose();
      dWithEp?.dispose();
      kd?.dispose();
    }
  });
});

describe('Coverage Boost: CSV Engine Branches', () => {
  it('escapeCsvField tests formatting, objects, dates, formula injection, and quoting', () => {
    expect(csvEngine.escapeCsvField(null)).toBe('');
    expect(csvEngine.escapeCsvField(undefined)).toBe('');

    // Dates
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(csvEngine.escapeCsvField(d)).toBe('2026-01-01T00:00:00.000Z');

    // Objects
    expect(csvEngine.escapeCsvField({ a: 1 })).toBe('"{""a"":1}"');

    // Formula injection sanitization
    expect(csvEngine.escapeCsvField('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");
    expect(csvEngine.escapeCsvField('+100')).toBe("'+100");
    expect(csvEngine.escapeCsvField('-50')).toBe("'-50");
    expect(csvEngine.escapeCsvField('@cmd')).toBe("'@cmd");
    expect(csvEngine.escapeCsvField('\tTabbed')).toBe("'\tTabbed");

    // sanitizeFormulas disabled
    expect(csvEngine.escapeCsvField('=SUM(A1:A5)', { sanitizeFormulas: false })).toBe('=SUM(A1:A5)');

    // Delimiters and quotes needing quotes
    expect(csvEngine.escapeCsvField('hello,world')).toBe('"hello,world"');
    expect(csvEngine.escapeCsvField('say "hello"')).toBe('"say ""hello"""');
    expect(csvEngine.escapeCsvField('spaced ')).toBe('"spaced "');
    expect(csvEngine.escapeCsvField(' leading')).toBe('" leading"');
    expect(csvEngine.escapeCsvField('multiline\nrow')).toBe('"multiline\nrow"');
    expect(csvEngine.escapeCsvField('pure', { alwaysQuote: true })).toBe('"pure"');
  });

  it('generate and parse tests auto-delimiters, streaming, buffer vs string, and transforms', async () => {
    // Generate without columns -> derived from rows
    const csvBuf = csvEngine.generate({
      rows: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ],
      asBuffer: true,
      bom: true,
    });
    expect(Buffer.isBuffer(csvBuf)).toBe(true);

    // Generate with explicit string columns and asBuffer: false
    const csvStr = csvEngine.generate({
      columns: ['name', 'age'],
      data: [{ name: 'Charlie', age: 40 }],
      header: false,
      asBuffer: false,
      bom: false,
    });
    expect(typeof csvStr).toBe('string');
    expect(csvStr.trim()).toBe('Charlie,40');

    // Parse auto-detection of delimiters (; \t | ,)
    const semiCsv = 'name;role\r\nAlice;Admin\r\nBob;User';
    const parsedSemi = await csvEngine.parse(semiCsv);
    expect(parsedSemi).toHaveLength(2);
    expect(parsedSemi[0].role).toBe('Admin');

    const tabCsv = 'col1\tcol2\r\nA\tB';
    const parsedTab = await csvEngine.parse(tabCsv);
    expect(parsedTab).toHaveLength(1);
    expect(parsedTab[0].col2).toBe('B');

    const pipeCsv = 'id|status\r\n1|active';
    const parsedPipe = await csvEngine.parse(pipeCsv);
    expect(parsedPipe).toHaveLength(1);
    expect(parsedPipe[0].status).toBe('active');

    // Parse stream
    const readable = Readable.from(['id,title\n1,First\n2,Second\n']);
    const parsedStream = await csvEngine.parse(readable, {
      transformRow: (row) => ({ ...row, parsed: true }),
    });
    expect(parsedStream).toHaveLength(2);
    expect(parsedStream[0].parsed).toBe(true);

    // Parse error on invalid input
    await expect(csvEngine.parse(12345)).rejects.toThrow('parseCsv requires a valid Buffer');
  });

  it('fromModel tests repository queries, find, and column filtering', async () => {
    // Error on invalid repo
    await expect(csvEngine.fromModel(null)).rejects.toThrow('fromModel requires a valid Webspresso Model Repository');

    // Query callback
    const mockRepo = {
      query: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, name: 'Test' }]),
      }),
      find: vi.fn().mockResolvedValue([{ id: 2, name: 'FindTest' }]),
      model: {
        schema: { shape: { id: {}, name: {}, password: {} } },
        hidden: ['password'],
      },
    };

    const buf1 = await csvEngine.fromModel(mockRepo, (q) => q.where());
    expect(Buffer.isBuffer(buf1)).toBe(true);

    // Object filter
    const buf2 = await csvEngine.fromModel(mockRepo, { status: 'active' });
    expect(Buffer.isBuffer(buf2)).toBe(true);
  });

  it('createStreamWriter tests writing headers and rows', () => {
    const chunks = [];
    const outStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });

    const writer = csvEngine.createStreamWriter(outStream, {
      columns: ['id', 'name'],
      bom: true,
    });
    writer.writeHeader();
    writer.writeRow({ id: 1, name: 'Alice' });
    writer.writeRows([{ id: 2, name: 'Bob' }]);
    writer.end();

    const output = chunks.join('');
    expect(output).toContain('\uFEFF');
    expect(output).toContain('id,name');
    expect(output).toContain('1,Alice');
    expect(output).toContain('2,Bob');
  });
});

describe('Coverage Boost: XLSX Engine Branches', () => {
  it('hexToArgb and sanitizeFormula branches', () => {
    expect(xlsxEngine.hexToArgb(null)).toBe('FF4F46E5');
    expect(xlsxEngine.hexToArgb('')).toBe('FF4F46E5');
    expect(xlsxEngine.hexToArgb('#FFF')).toBe('FFFFFFFF');
    expect(xlsxEngine.hexToArgb('123456')).toBe('FF123456');
    expect(xlsxEngine.hexToArgb('#AABBCCDD')).toBe('AABBCCDD');
    expect(xlsxEngine.hexToArgb('invalid')).toBe('FF4F46E5');

    expect(xlsxEngine.sanitizeFormula('=1+1')).toBe("'=1+1");
    expect(xlsxEngine.sanitizeFormula('-10')).toBe("'-10");
    expect(xlsxEngine.sanitizeFormula('+cmd')).toBe("'+cmd");
    expect(xlsxEngine.sanitizeFormula('@test')).toBe("'@test");
    expect(xlsxEngine.sanitizeFormula('safe text')).toBe('safe text');
    expect(xlsxEngine.sanitizeFormula(123)).toBe(123);
  });

  it('generate XLSX with multi-sheets, autoWidth, and custom headers', async () => {
    const buf = await xlsxEngine.generate({
      creator: 'TestRunner',
      title: 'Monthly Report',
      sheets: [
        {
          name: 'Orders',
          columns: [
            { header: 'Order ID', key: 'id', width: 20 },
            { header: 'Created', key: 'created_at' },
            { header: 'Total', key: 'total' },
          ],
          rows: [
            { id: 101, created_at: new Date('2026-02-01'), total: 99.99 },
            { id: 102, created_at: '2026-02-02', total: '=DANGEROUS()' },
          ],
          striped: true,
          autoWidth: true,
          headerStyle: { bg: '#10B981', color: '#000000', bold: true },
        },
        {
          name: 'Summary',
          data: [{ metric: 'Count', val: 2 }],
          autoWidth: false,
          striped: false,
        },
      ],
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('fromModel XLSX export', async () => {
    await expect(xlsxEngine.fromModel(null)).rejects.toThrow('fromModel requires a valid Webspresso Model Repository');

    const mockRepo = {
      find: vi.fn().mockResolvedValue([{ id: 1, name: 'Item 1' }]),
      model: {
        name: 'Item',
        schema: { shape: { id: {}, name: {} } },
      },
    };

    const buf = await xlsxEngine.fromModel(mockRepo, { id: 1 });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

describe('Coverage Boost: Auth Middleware Deep Branches', () => {
  let mockAuthManager;
  let mw;

  beforeEach(() => {
    mockAuthManager = {
      config: {
        session: { secret: 'test-secret' },
        routes: { login: '/login', redirectAfterLogin: '/dashboard' },
      },
      getSessionConfig: vi.fn().mockReturnValue({ secret: 'test-secret', resave: false, saveUninitialized: false }),
      createRequestAuth: vi.fn().mockReturnValue({
        can: vi.fn().mockReturnValue(false),
        is2FaVerified: vi.fn().mockReturnValue(false),
      }),
      verifyJwt: vi.fn(),
      findUserById: vi.fn(),
      isSessionValid: vi.fn().mockResolvedValue(true),
      touchSession: vi.fn().mockResolvedValue(),
      trackSession: vi.fn().mockResolvedValue(),
      verifyRememberToken: vi.fn().mockResolvedValue(null),
      sessionManager: {},
      rememberTokens: {},
    };
    mw = createAuthMiddleware(mockAuthManager);
  });

  it('cookieMiddleware with already present cookies and signedCookies', () => {
    const req1 = { cookies: { 'auth': 'abc' }, signedCookies: { 'auth': 'abc' } };
    const next1 = vi.fn();
    mw.cookie(req1, {}, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = { cookies: { 'auth': 'abc' }, signedCookies: {} };
    const next2 = vi.fn();
    mw.cookie(req2, {}, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('authenticate: Bearer token variants (valid with user, valid without user, invalid)', async () => {
    // 1. Valid JWT with user found
    mockAuthManager.verifyJwt.mockReturnValueOnce({ id: 10, role: 'user' });
    mockAuthManager.findUserById.mockResolvedValueOnce({ id: 10, name: 'Alice' });
    const req1 = { headers: { authorization: 'Bearer valid.jwt.token' } };
    const next1 = vi.fn();
    await mw.authenticate(req1, {}, next1);
    expect(req1.user.name).toBe('Alice');
    expect(next1).toHaveBeenCalled();

    // 2. Valid JWT but user not found -> fallback to payload
    mockAuthManager.verifyJwt.mockReturnValueOnce({ id: 11, role: 'guest' });
    mockAuthManager.findUserById.mockResolvedValueOnce(null);
    const req2 = { headers: { Authorization: 'Bearer token-2' } };
    const next2 = vi.fn();
    await mw.authenticate(req2, {}, next2);
    expect(req2.user.role).toBe('guest');

    // 3. Valid JWT without id in payload
    mockAuthManager.verifyJwt.mockReturnValueOnce({ sub: 'service-acc' });
    const req3 = { headers: { authorization: 'Bearer token-3' } };
    await mw.authenticate(req3, {}, vi.fn());
    expect(req3.user.sub).toBe('service-acc');

    // 4. Invalid JWT
    mockAuthManager.verifyJwt.mockImplementationOnce(() => { throw new Error('Expired'); });
    const req4 = { headers: { authorization: 'Bearer invalid.token' } };
    await mw.authenticate(req4, {}, vi.fn());
    expect(req4.user).toBeNull();
  });

  it('authenticate: session and remember-me branches', async () => {
    // 1. Session revoked remotely
    mockAuthManager.isSessionValid.mockResolvedValueOnce(false);
    const req1 = { session: { userId: 5, destroy: vi.fn() }, sessionID: 'sess_1' };
    await mw.authenticate(req1, {}, vi.fn());
    expect(req1.session.userId).toBeUndefined();
    expect(req1.session.destroy).toHaveBeenCalled();

    // 2. Session valid & user found
    mockAuthManager.isSessionValid.mockResolvedValueOnce(true);
    mockAuthManager.findUserById.mockResolvedValueOnce({ id: 5, name: 'Bob' });
    const req2 = { session: { userId: 5 }, sessionID: 'sess_2' };
    await mw.authenticate(req2, {}, vi.fn());
    expect(req2.user.name).toBe('Bob');
    expect(mockAuthManager.touchSession).toHaveBeenCalledWith('sess_2');

    // 3. Session valid but user no longer exists
    mockAuthManager.isSessionValid.mockResolvedValueOnce(true);
    mockAuthManager.findUserById.mockResolvedValueOnce(null);
    const req3 = { session: { userId: 999 }, sessionID: 'sess_3' };
    await mw.authenticate(req3, {}, vi.fn());
    expect(req3.session.userId).toBeUndefined();

    // 4. Remember me token login
    mockAuthManager.verifyRememberToken.mockResolvedValueOnce({ id: 7, name: 'Charlie' });
    const req4 = { session: {}, sessionID: 'sess_4' };
    await mw.authenticate(req4, {}, vi.fn());
    expect(req4.user.name).toBe('Charlie');
    expect(req4.session.userId).toBe(7);
  });

  it('requireAuth, requireJwt, requireGuest, requireRole, requireVerified, require2Fa branches', async () => {
    // 1. requireAuth: API vs HTML redirect
    const apiMw = mw.requireAuth({ api: true });
    const res1 = createMockRes();
    apiMw({ user: null }, res1, vi.fn());
    expect(res1.statusCode).toBe(401);

    const redirectRes = { redirect: vi.fn() };
    const htmlMw = mw.requireAuth({ redirectTo: '/custom-login' });
    const reqSession = { session: {}, originalUrl: '/secret' };
    htmlMw(reqSession, redirectRes, vi.fn());
    expect(redirectRes.redirect).toHaveBeenCalledWith('/custom-login');
    expect(reqSession.session.intendedUrl).toBe('/secret');

    // 2. requireJwt: missing header, invalid token, valid token
    const jwtMw = mw.requireJwt();
    const resJwt1 = createMockRes();
    await jwtMw({ headers: {} }, resJwt1, vi.fn());
    expect(resJwt1.statusCode).toBe(401);

    mockAuthManager.verifyJwt.mockImplementationOnce(() => { throw new Error('Bad token'); });
    const resJwt2 = createMockRes();
    await jwtMw({ headers: { authorization: 'Bearer bad' } }, resJwt2, vi.fn());
    expect(resJwt2.statusCode).toBe(401);

    mockAuthManager.verifyJwt.mockReturnValueOnce({ id: 20 });
    mockAuthManager.findUserById.mockResolvedValueOnce({ id: 20, name: 'User20' });
    const nextJwt = vi.fn();
    const reqJwtOk = { headers: { authorization: 'Bearer good' } };
    await jwtMw(reqJwtOk, {}, nextJwt);
    expect(nextJwt).toHaveBeenCalled();
    expect(reqJwtOk.user.name).toBe('User20');

    // 3. requireGuest: logged in vs guest
    const guestMw = mw.requireGuest({ redirectTo: '/home' });
    const guestRes = { redirect: vi.fn() };
    guestMw({ user: { id: 1 } }, guestRes, vi.fn());
    expect(guestRes.redirect).toHaveBeenCalledWith('/home');

    const nextGuest = vi.fn();
    guestMw({ user: null }, {}, nextGuest);
    expect(nextGuest).toHaveBeenCalled();

    // 4. requireVerified: unauthenticated, unverified API/HTML, verified
    const verMw = mw.requireVerified({ redirectTo: '/verify' });
    const resVer1 = createMockRes();
    verMw({ user: { email_verified_at: null }, xhr: true, headers: {} }, resVer1, vi.fn());
    expect(resVer1.statusCode).toBe(403);

    const resVer2 = { redirect: vi.fn() };
    verMw({ user: { email_verified_at: null }, headers: {} }, resVer2, vi.fn());
    expect(resVer2.redirect).toHaveBeenCalledWith('/verify');

    const nextVer = vi.fn();
    verMw({ user: { email_verified_at: new Date() }, headers: {} }, {}, nextVer);
    expect(nextVer).toHaveBeenCalled();

    // 5. require2Fa: unauthenticated, 2FA not required, 2FA required and verified, 2FA required and pending
    const twoFaMw = mw.require2Fa({ redirectToLogin: '/login-2fa' });
    const res2Fa1 = { redirect: vi.fn() };
    twoFaMw({ user: null, session: {}, headers: {} }, res2Fa1, vi.fn());
    expect(res2Fa1.redirect).toHaveBeenCalledWith('/login-2fa');

    // 2FA not enabled on user
    const next2Fa1 = vi.fn();
    twoFaMw({ user: { id: 1, two_factor_enabled: false }, auth: {}, headers: {} }, {}, next2Fa1);
    expect(next2Fa1).toHaveBeenCalled();

    // 2FA enabled and verified in session
    const next2Fa2 = vi.fn();
    twoFaMw({ user: { id: 1, two_factor_enabled: true }, session: { twoFactorVerified: true }, auth: {}, headers: {} }, {}, next2Fa2);
    expect(next2Fa2).toHaveBeenCalled();

    // 2FA always required and pending -> redirect to /2fa
    const res2Fa2 = { redirect: vi.fn() };
    const twoFaAlways = mw.require2Fa({ always: true, redirectTo: '/custom-2fa' });
    twoFaAlways({ user: { id: 1 }, auth: {}, session: {} }, res2Fa2, vi.fn());
    expect(res2Fa2.redirect).toHaveBeenCalledWith('/custom-2fa');
  });
});

describe('Coverage Boost: Content Service Branches', () => {
  it('handles types and entries CRUD, caching, and validation errors', async () => {
    // 1. Throws without db
    expect(() => createContentService(null)).toThrow('createContentService requires a database instance');

    const sampleType = {
      id: 1,
      slug: 'blog-post',
      name: 'Blog Post',
      schema: { fields: [{ name: 'title', type: 'text', required: true }] },
    };

    const sampleEntry = {
      id: 10,
      content_type_id: 1,
      slug: 'first-post',
      locale: 'en',
      status: 'published',
      published_at: new Date(),
      data: { title: 'First Post' },
    };

    const mockTypeRepo = {
      findById: vi.fn().mockImplementation((id) => Promise.resolve(id === 1 ? sampleType : null)),
      findOne: vi.fn().mockImplementation(({ slug }) => Promise.resolve(slug === 'blog-post' ? sampleType : null)),
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 2, ...data })),
      update: vi.fn().mockImplementation((id, patch) => Promise.resolve({ id, ...sampleType, ...patch })),
      delete: vi.fn().mockResolvedValue(true),
    };

    const mockEntryRepo = {
      findById: vi.fn().mockImplementation((id) => Promise.resolve(id === 10 ? sampleEntry : null)),
      findOne: vi.fn().mockImplementation(({ slug }) => Promise.resolve(slug === 'first-post' ? sampleEntry : null)),
      create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 11, ...data })),
      update: vi.fn().mockImplementation((id, patch) => Promise.resolve({ id, ...sampleEntry, ...patch })),
      delete: vi.fn().mockResolvedValue(true),
    };

    const mockDb = {
      getRepository: vi.fn((name) => (name === 'ContentType' ? mockTypeRepo : mockEntryRepo)),
      query: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        list: vi.fn().mockResolvedValue([sampleType]),
      })),
    };

    const svc = createContentService(mockDb, { cacheTtlMs: 5000 });

    // listTypes (cache miss, then hit)
    const types1 = await svc.listTypes();
    expect(types1).toHaveLength(1);
    const types2 = await svc.listTypes();
    expect(types2).toHaveLength(1);

    // getTypeById string vs number
    expect(await svc.getTypeById(1)).toBeDefined();
    expect(await svc.getTypeById('1')).toBeDefined();

    // getTypeBySlug
    expect(await svc.getTypeBySlug('blog-post')).toBeDefined();

    // createType validation
    await expect(svc.createType({ slug: 'INVALID SLUG!', name: 'Bad', schema: { fields: [] } })).rejects.toThrow('Invalid content type slug');
    await expect(svc.createType({ slug: 'blog-post', name: 'Duplicate', schema: { fields: [] } })).rejects.toThrow('already exists');

    // createType success
    const createdType = await svc.createType({
      slug: 'news',
      name: 'News',
      schema: { fields: [] },
    });
    expect(createdType.slug).toBe('news');

    // updateType validation and execution
    await expect(svc.updateType(999, {})).rejects.toThrow('Content type not found');
    await expect(svc.updateType(1, { slug: 'BAD SLUG' })).rejects.toThrow('Invalid content type slug');

    const updatedType = await svc.updateType(1, { name: 'Updated Blog', description: 'desc' });
    expect(updatedType.name).toBe('Updated Blog');

    // deleteType
    await expect(svc.deleteType(999)).rejects.toThrow('Content type not found');
    const deleteRes = await svc.deleteType(1);
    expect(deleteRes.success).toBe(true);
  });
});

describe('Coverage Boost: Queue Manager Extended Scheduling & Retention', () => {
  it('covers schedule, cron, triggers, clean, and retention lifecycle', async () => {
    const q = createQueueManager({
      concurrency: 1,
      retention: { enabled: true, days: 5, statuses: ['completed', 'failed'] },
    });

    // 1. schedule & cron aliases
    const sched = q.schedule('*/15 * * * *', 'report.hourly', { type: 'summary' });
    expect(sched).toBeDefined();

    const cr = q.cron('0 0 * * *', 'report.daily', { type: 'daily' });
    expect(cr).toBeDefined();

    // 2. getSchedules and getSchedule
    const all = q.getSchedules();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(q.getSchedule('report.hourly')).toBeDefined();
    expect(q.getSchedule('nonexistent')).toBeNull();

    // 3. triggerSchedule & triggerCron
    const trigRes = await q.triggerSchedule('report.hourly');
    expect(trigRes).toBeDefined();
    const trigCronRes = await q.triggerCron('report.daily');
    expect(trigCronRes).toBeDefined();

    // 4. unschedule
    expect(q.unschedule('report.hourly')).toBe(true);
    expect(q.unschedule('nonexistent')).toBe(false);

    // 5. clean, runCleanup, startCleanup, stopCleanup
    const cleanedCount = await q.clean({ status: 'completed', days: 10 });
    expect(typeof cleanedCount).toBe('number');

    const runCleanCount = await q.runCleanup();
    expect(typeof runCleanCount).toBe('number');

    q.startCleanup(60000);
    expect(q._cleanupInterval).toBeDefined();
    q.stopCleanup();
    expect(q._cleanupInterval).toBeNull();

    // 6. drain and stop
    await q.drain(100);
    await q.stop();
  });
});

describe('Coverage Boost: User Management API Full CRUD Branches', () => {
  it('covers createUser, updateUser, deleteUser, and session revocation paths', async () => {
    const { createUserManagementApiHandlers } = await import('../../../plugins/admin-panel/modules/user-management.js');

    const mockRepo = {
      model: { table: 'users' },
      findById: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const mockDb = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
      knex: Object.assign(
        vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([{ id: 1, user_email: 'a@b.com' }]),
          where: vi.fn().mockReturnThis(),
          delete: vi.fn().mockResolvedValue(1),
        }),
        {
          schema: {
            hasTable: vi.fn().mockResolvedValue(true),
          },
        }
      ),
    };

    const authMock = {
      rememberTokens: {},
    };

    const userApi = createUserManagementApiHandlers({
      db: mockDb,
      auth: authMock,
      config: { model: 'User' },
    });

    // 1. createUser: email required
    const cRes1 = createMockRes();
    await userApi.createUser({ body: {} }, cRes1);
    expect(cRes1.statusCode).toBe(400);
    expect(cRes1._json.error).toBe('Email is required');

    // 2. createUser: duplicate email
    mockRepo.findOne.mockResolvedValueOnce({ id: 1, email: 'alice@test.com' });
    const cRes2 = createMockRes();
    await userApi.createUser({ body: { email: 'alice@test.com' } }, cRes2);
    expect(cRes2.statusCode).toBe(400);
    expect(cRes2._json.error).toBe('Email already exists');

    // 3. createUser: success with hashed password
    mockRepo.findOne.mockResolvedValueOnce(null);
    mockRepo.create.mockResolvedValueOnce({ id: 10, email: 'alice@test.com', password: 'hashed' });
    const cRes3 = createMockRes();
    await userApi.createUser({ body: { email: 'alice@test.com', password: 'plain' } }, cRes3);
    expect(cRes3.statusCode).toBe(201);
    expect(cRes3._json.data.password).toBeUndefined();

    // 4. updateUser: user not found
    mockRepo.findById.mockResolvedValueOnce(null);
    const uRes1 = createMockRes();
    await userApi.updateUser({ params: { id: 99 }, body: {} }, uRes1);
    expect(uRes1.statusCode).toBe(404);

    // 5. updateUser: email conflict
    mockRepo.findById.mockResolvedValueOnce({ id: 10, email: 'old@test.com' });
    mockRepo.findOne.mockResolvedValueOnce({ id: 20, email: 'new@test.com' });
    const uRes2 = createMockRes();
    await userApi.updateUser({ params: { id: 10 }, body: { email: 'new@test.com' } }, uRes2);
    expect(uRes2.statusCode).toBe(400);
    expect(uRes2._json.error).toBe('Email already exists');

    // 6. updateUser: success with password hash
    mockRepo.findById.mockResolvedValueOnce({ id: 10, email: 'old@test.com' });
    mockRepo.findOne.mockResolvedValueOnce(null);
    mockRepo.update.mockResolvedValueOnce({ id: 10, email: 'new@test.com', password: 'hash' });
    const uRes3 = createMockRes();
    await userApi.updateUser({ params: { id: 10 }, body: { email: 'new@test.com', password: 'newsecret' } }, uRes3);
    expect(uRes3.statusCode).toBe(200);

    // 7. deleteUser: not found vs success
    mockRepo.delete.mockResolvedValueOnce(false);
    const dRes1 = createMockRes();
    await userApi.deleteUser({ params: { id: 99 } }, dRes1);
    expect(dRes1.statusCode).toBe(404);

    mockRepo.delete.mockResolvedValueOnce(true);
    const dRes2 = createMockRes();
    await userApi.deleteUser({ params: { id: 10 } }, dRes2);
    expect(dRes2.statusCode).toBe(200);
    expect(dRes2._json.success).toBe(true);

    // 8. getSessions: with and without auth.rememberTokens
    const userApiNoAuth = createUserManagementApiHandlers({ db: mockDb, config: {} });
    const sRes1 = createMockRes();
    await userApiNoAuth.getSessions({}, sRes1);
    expect(sRes1._json.message).toContain('not enabled');

    const sRes2 = createMockRes();
    await userApi.getSessions({}, sRes2);
    expect(sRes2._json.data).toBeDefined();

    // 9. revokeSession: with and without auth.rememberTokens
    const rRes1 = createMockRes();
    await userApiNoAuth.revokeSession({ params: { token: 't' } }, rRes1);
    expect(rRes1.statusCode).toBe(400);

    const rRes2 = createMockRes();
    await userApi.revokeSession({ params: { token: 't' } }, rRes2);
    expect(rRes2._json.success).toBe(true);

    // 10. revokeUserSessions: with and without auth.rememberTokens
    const ruRes1 = createMockRes();
    await userApiNoAuth.revokeUserSessions({ params: { userId: '1' } }, ruRes1);
    expect(ruRes1.statusCode).toBe(400);

    const ruRes2 = createMockRes();
    await userApi.revokeUserSessions({ params: { userId: '1' } }, ruRes2);
    expect(ruRes2._json.success).toBe(true);
  });
});

describe('Coverage Boost: Admin Panel Advanced Filtering and Permissions', () => {
  it('covers all filter operators in recordsListHandler and permission guards', async () => {
    const { createApiHandlers } = await import('../../../plugins/admin-panel/api.js');

    const mockModel = {
      name: 'AdvancedItem',
      columns: new Map([
        ['id', { type: 'id' }],
        ['name', { type: 'string' }],
        ['price', { type: 'float' }],
        ['in_stock', { type: 'boolean' }],
        ['created_at', { type: 'timestamp' }],
      ]),
      admin: {
        enabled: true,
        searchFields: ['name'],
        dateHierarchy: 'created_at',
        permissions: { edit: true, delete: true },
      },
    };

    const mockQueryBuilder = {
      whereNull: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      whereBetween: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      where: vi.fn(function(col) {
        if (typeof col === 'function') col.call(this);
        return this;
      }),
      orWhere: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      find: vi.fn().mockResolvedValue([{ id: 1, name: 'Item A', price: 10, in_stock: 1 }]),
      list: vi.fn().mockResolvedValue([{ id: 1, name: 'Item A', price: 10, in_stock: 1 }]),
      count: vi.fn().mockResolvedValue(1),
    };

    const mockDb = {
      getModel: vi.fn().mockReturnValue(mockModel),
      getRepository: vi.fn().mockReturnValue({
        query: vi.fn().mockReturnValue(mockQueryBuilder),
        findById: vi.fn().mockResolvedValue({ id: 1, name: 'Item A' }),
        update: vi.fn().mockResolvedValue({ id: 1, name: 'Updated' }),
        delete: vi.fn().mockResolvedValue(true),
      }),
    };

    const adminApi = createApiHandlers({ db: mockDb, path: '/_admin' });

    // 1. Exercise all operators: is_null, is_not_null, boolean, between, in, starts_with, ends_with, gt, gte, lt, lte, eq, date hierarchy
    const req1 = {
      params: { model: 'AdvancedItem' },
      query: {
        page: '1',
        perPage: '10',
        search: 'widget',
        date_field: 'created_at',
        year: '2026',
        month: '10',
        day: '15',
        filter: {
          name: { op: 'starts_with', value: 'Wid' },
          price: { op: 'between', from: '5', to: '50' },
          in_stock: { op: 'eq', value: 'true' },
        },
      },
    };
    const res1 = createMockRes();
    await adminApi.recordsListHandler(req1, res1);
    expect(res1.statusCode).toBe(200);

    const req2 = {
      params: { model: 'AdvancedItem' },
      query: {
        year: '2026',
        month: '10',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
        filter: {
          name: { op: 'ends_with', value: 'get' },
          price: { op: 'gt', value: '10' },
        },
      },
    };
    const res2 = createMockRes();
    await adminApi.recordsListHandler(req2, res2);
    expect(res2.statusCode).toBe(200);

    const req3 = {
      params: { model: 'AdvancedItem' },
      query: {
        year: '2026',
        filter: {
          name: { op: 'is_null' },
          price: { op: 'lt', value: '100' },
        },
      },
    };
    const res3 = createMockRes();
    await adminApi.recordsListHandler(req3, res3);
    expect(res3.statusCode).toBe(200);

    const req4 = {
      params: { model: 'AdvancedItem' },
      query: {
        filter: {
          name: { op: 'is_not_null' },
          price: { op: 'lte', value: '99' },
        },
      },
    };
    const res4 = createMockRes();
    await adminApi.recordsListHandler(req4, res4);
    expect(res4.statusCode).toBe(200);

    const req5 = {
      params: { model: 'AdvancedItem' },
      query: {
        filter: {
          price: { op: 'gte', value: '1' },
          id: { op: 'in', value: [1, 2, 3] },
        },
      },
    };
    const res5 = createMockRes();
    await adminApi.recordsListHandler(req5, res5);
    expect(res5.statusCode).toBe(200);

    // 2. Permission checks: readOnly and permissions.edit = false
    mockModel.admin.readOnly = true;
    const updateResReadOnly = createMockRes();
    await adminApi.updateRecordHandler({ params: { model: 'AdvancedItem', id: 1 }, body: {} }, updateResReadOnly);
    expect(updateResReadOnly.statusCode).toBe(403);

    const delResReadOnly = createMockRes();
    await adminApi.deleteRecordHandler({ params: { model: 'AdvancedItem', id: 1 } }, delResReadOnly);
    expect(delResReadOnly.statusCode).toBe(403);

    mockModel.admin.readOnly = false;
    mockModel.admin.permissions.edit = false;
    const updateResNoEdit = createMockRes();
    await adminApi.updateRecordHandler({ params: { model: 'AdvancedItem', id: 1 }, body: {} }, updateResNoEdit);
    expect(updateResNoEdit.statusCode).toBe(403);

    mockModel.admin.permissions.delete = false;
    const delResNoDel = createMockRes();
    await adminApi.deleteRecordHandler({ params: { model: 'AdvancedItem', id: 1 } }, delResNoDel);
    expect(delResNoDel.statusCode).toBe(403);
  });
});

describe('Coverage Boost: File Manager Core & Security Branches', () => {
  it('covers resolveSafePath, sanitizeName, getFileType, getMimeType, buildBreadcrumbs, and security checks', async () => {
    const {
      resolveSafePath,
      sanitizeName,
      getFileType,
      getMimeType,
      buildBreadcrumbs,
    } = await import('../../../plugins/file-manager/core.js');

    const {
      validateSafeExtension,
      validateMagicBytes,
      sanitizeSvgContent,
    } = await import('../../../plugins/file-manager/security.js');

    const os = await import('os');
    const path = await import('path');
    const tmp = os.tmpdir();

    // 1. resolveSafePath
    expect(() => resolveSafePath(null)).toThrow('Invalid base directory');
    expect(() => resolveSafePath('')).toThrow('Invalid base directory');
    expect(resolveSafePath(tmp)).toBe(path.resolve(tmp));
    expect(resolveSafePath(tmp, '')).toBe(path.resolve(tmp));
    expect(() => resolveSafePath(tmp, 123)).toThrow('Path must be a string');
    expect(() => resolveSafePath(tmp, 'file\0.txt')).toThrow('Null byte detected');
    expect(() => resolveSafePath(tmp, '%00file.txt')).toThrow('Null byte detected');
    expect(() => resolveSafePath(tmp, '../secret')).toThrow('Directory traversal attempt detected');
    expect(() => resolveSafePath(tmp, './subdir')).toThrow('Directory traversal attempt detected');
    expect(resolveSafePath(tmp, 'uploads/file.png')).toBe(path.resolve(tmp, 'uploads/file.png'));

    // 2. sanitizeName
    expect(() => sanitizeName(null)).toThrow('Name is required');
    expect(() => sanitizeName(123)).toThrow('Name is required');
    expect(() => sanitizeName('   ')).toThrow('Invalid file or directory name');
    expect(() => sanitizeName('.')).toThrow('Invalid file or directory name');
    expect(() => sanitizeName('..')).toThrow('Invalid file or directory name');
    expect(() => sanitizeName('folder/file')).toThrow('cannot contain path separators');
    expect(() => sanitizeName('folder\\file')).toThrow('cannot contain path separators');
    expect(() => sanitizeName('.hidden')).toThrow('Dotfiles are not allowed');
    expect(sanitizeName('  Valid_File-123.jpg  ')).toBe('Valid_File-123.jpg');

    // 3. getFileType
    expect(getFileType('jpg')).toBe('image');
    expect(getFileType('.PNG')).toBe('image');
    expect(getFileType('pdf')).toBe('document');
    expect(getFileType('txt')).toBe('text');
    expect(getFileType('json')).toBe('code');
    expect(getFileType('mp3')).toBe('audio');
    expect(getFileType('mp4')).toBe('video');
    expect(getFileType('zip')).toBe('archive');
    expect(getFileType('unknown_xyz')).toBe('other');
    expect(getFileType(null)).toBe('other');

    // 4. getMimeType
    expect(getMimeType('jpg')).toBe('image/jpeg');
    expect(getMimeType('.png')).toBe('image/png');
    expect(getMimeType('txt')).toBe('text/plain');
    expect(getMimeType('unknown')).toBe('application/octet-stream');
    expect(getMimeType(null)).toBe('application/octet-stream');

    // 5. buildBreadcrumbs
    expect(buildBreadcrumbs('')).toEqual([{ name: 'Root', path: '' }]);
    expect(buildBreadcrumbs(null)).toEqual([{ name: 'Root', path: '' }]);
    const bc = buildBreadcrumbs('uploads/images/2026');
    expect(bc).toHaveLength(4);
    expect(bc[1]).toEqual({ name: 'uploads', path: 'uploads' });
    expect(bc[3]).toEqual({ name: '2026', path: 'uploads/images/2026' });

    // 6. validateSafeExtension
    expect(() => validateSafeExtension(null)).toThrow('Filename is required');
    expect(() => validateSafeExtension('')).toThrow('Filename is required');
    expect(() => validateSafeExtension('.')).toThrow('Filename must have a valid extension');
    expect(() => validateSafeExtension('script.php')).toThrow('Dangerous extension');
    expect(() => validateSafeExtension('payload.php.jpg')).toThrow('Dangerous extension or double-extension detected');
    expect(validateSafeExtension('photo.JPG')).toBe('jpg');

    // 7. validateMagicBytes
    expect(() => validateMagicBytes(null, 'jpg')).toThrow('Valid buffer is required');
    expect(() => validateMagicBytes('not-a-buffer', 'jpg')).toThrow('Valid buffer is required');
    expect(validateMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'jpg')).toBe(true);
    expect(() => validateMagicBytes(Buffer.from([0x00, 0x00]), 'jpg')).toThrow('File signature mismatch');
    expect(validateMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png')).toBe(true);
    expect(validateMagicBytes(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), 'gif')).toBe(true);
    expect(validateMagicBytes(Buffer.from('RIFF0000WEBP'), 'webp')).toBe(true);
    expect(validateMagicBytes(Buffer.from('plain text'), 'txt')).toBe(true);

    // 8. sanitizeSvgContent
    const rawSvg = '<svg><script>alert("xss")</script><circle cx="5" cy="5" r="5"/></svg>';
    const cleanSvg = sanitizeSvgContent(rawSvg);
    expect(cleanSvg.toString('utf8')).not.toContain('<script>');
    expect(cleanSvg.toString('utf8')).toContain('<circle');
  });
});

describe('Coverage Boost: User Management Module Registration & Actions', () => {
  it('covers registerUserManagement, actions, bulk actions, and hooks', async () => {
    const {
      registerUserManagement,
      generateRandomPassword,
    } = await import('../../../plugins/admin-panel/modules/user-management.js');

    // 1. generateRandomPassword
    const pwd = generateRandomPassword(16);
    expect(pwd).toHaveLength(16);

    const registeredActions = new Map();
    const registeredBulkActions = new Map();
    const registeredWidgets = new Map();
    const registeredHooks = new Map();

    const mockRegistry = {
      enableUserManagement: vi.fn(),
      registerMenuGroup: vi.fn(),
      registerMenuItem: vi.fn(),
      registerAction: vi.fn((id, def) => registeredActions.set(id, def)),
      registerBulkAction: vi.fn((id, def) => registeredBulkActions.set(id, def)),
      registerWidget: vi.fn((id, def) => registeredWidgets.set(id, def)),
      registerHook: vi.fn((name, fn) => registeredHooks.set(name, fn)),
    };

    const mockRepo = {
      model: {
        columns: new Map([
          ['id', { type: 'id' }],
          ['active', { type: 'boolean' }],
          ['role', { type: 'string' }],
          ['created_at', { type: 'timestamp' }],
        ]),
        table: 'users',
      },
      count: vi.fn().mockResolvedValue(5),
      query: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue(2),
      }),
      update: vi.fn().mockResolvedValue({ id: 1, active: true }),
      delete: vi.fn().mockResolvedValue(true),
    };

    const mockDb = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
      knex: {
        client: { config: { client: 'sqlite3' } },
        schema: {
          hasColumn: vi.fn().mockResolvedValue(true),
        },
      },
    };

    // 2. registerUserManagement with auth and custom config
    const resReg = registerUserManagement({
      registry: mockRegistry,
      db: mockDb,
      auth: { rememberTokens: {} },
      config: { modelName: 'AppUser', passwordMinLength: 10 },
    });
    expect(resReg.modelName).toBe('AppUser');

    // 3. Widget dataLoader
    const statsWidget = registeredWidgets.get('user-stats');
    expect(statsWidget).toBeDefined();
    const statsData = await statsWidget.dataLoader({ db: mockDb });
    expect(statsData.total).toBe(5);

    // 4. Single actions: activate, deactivate, reset-password
    const actAction = registeredActions.get('user-activate');
    expect(actAction.visible({ active: false })).toBe(true);
    expect(actAction.visible({ active: true })).toBe(false);
    const actRes = await actAction.handler({ id: 1 }, 'AppUser', { db: mockDb });
    expect(actRes.message).toBe('User activated');

    const deactAction = registeredActions.get('user-deactivate');
    expect(deactAction.visible({ active: true })).toBe(true);
    const deactRes = await deactAction.handler({ id: 1 }, { name: 'AppUser' }, { db: mockDb });
    expect(deactRes.message).toBe('User deactivated');

    const resetAction = registeredActions.get('user-reset-password');
    const resetRes = await resetAction.handler({ id: 1 }, 'AppUser', { db: mockDb });
    expect(resetRes.newPassword).toBeDefined();

    // 5. Bulk actions: activate, deactivate, delete
    const bulkAct = registeredBulkActions.get('users-activate');
    const bulkActRes = await bulkAct.handler([{ id: 1 }, { id: 2 }], 'AppUser', { db: mockDb });
    expect(bulkActRes.message).toContain('2 users activated');

    const bulkDeact = registeredBulkActions.get('users-deactivate');
    const bulkDeactRes = await bulkDeact.handler([{ id: 1 }], 'AppUser', { db: mockDb });
    expect(bulkDeactRes.message).toContain('1 users deactivated');

    const bulkDel = registeredBulkActions.get('users-delete');
    const bulkDelRes = await bulkDel.handler([{ id: 1 }], 'AppUser', { db: mockDb });
    expect(bulkDelRes.message).toContain('1 users deleted');

    // 6. Hooks: beforeCreate and beforeUpdate
    const beforeCreate = registeredHooks.get('beforeCreate');
    const createCtx = { model: 'AppUser', data: { password: 'plainpassword' } };
    await beforeCreate(createCtx);
    expect(createCtx.data.password).not.toBe('plainpassword');

    const beforeUpdate = registeredHooks.get('beforeUpdate');
    const updateCtx1 = { model: 'AppUser', data: { password: '$2b$10$alreadyhashed' } };
    await beforeUpdate(updateCtx1);
    expect(updateCtx1.data.password).toBe('$2b$10$alreadyhashed');

    const updateCtx2 = { model: 'AppUser', data: { password: 'newsecret' } };
    await beforeUpdate(updateCtx2);
    expect(updateCtx2.data.password).not.toBe('newsecret');
  });
});



