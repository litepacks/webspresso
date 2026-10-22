/**
 * Unit tests for Webhooks API Route Handlers
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebhookApiHandlers } from '../../../plugins/webhooks/api-handlers';
import { createMockSpyRes as createMockRes } from '../../utils';

describe('Webhooks Admin API Handlers', () => {
  let mockDispatcher;
  let handlers;

  beforeEach(() => {
    mockDispatcher = {
      resolveKnex: vi.fn().mockReturnValue(null),
      deliveriesTable: 'sys_webhook_deliveries',
      listEndpoints: vi.fn(),
      createEndpoint: vi.fn(),
      getEndpoint: vi.fn(),
      updateEndpoint: vi.fn(),
      deleteEndpoint: vi.fn(),
      pingEndpoint: vi.fn(),
      listDeliveries: vi.fn(),
      getDelivery: vi.fn(),
      retryDelivery: vi.fn(),
      purgeDeliveries: vi.fn(),
    };

    handlers = createWebhookApiHandlers(mockDispatcher);
  });

  describe('Endpoints handlers', () => {
    it('listEndpointsHandler lists endpoints without knex enrichment', async () => {
      const endpoints = [{ id: 1, name: 'Billing Hook', url: 'https://api.test/webhook' }];
      mockDispatcher.listEndpoints.mockResolvedValue(endpoints);
      const res = createMockRes();

      await handlers.listEndpointsHandler({ query: { active: 'true', search: 'bill' } }, res);

      expect(mockDispatcher.listEndpoints).toHaveBeenCalledWith({ active: true, search: 'bill' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ items: endpoints, total: 1 });
    });

    it('listEndpointsHandler enriches stats when knex is available', async () => {
      const endpoints = [{ id: 1, name: 'Hook 1', url: 'https://h1.test' }];
      mockDispatcher.listEndpoints.mockResolvedValue(endpoints);

      const mockStats = [
        { endpoint_id: 1, total_deliveries: 10, success_count: 8 },
      ];

      const mockKnex = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        sum: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(mockStats),
      });
      mockKnex.raw = vi.fn();
      mockDispatcher.resolveKnex.mockReturnValue(mockKnex);

      const res = createMockRes();
      await handlers.listEndpointsHandler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.items[0].stats).toEqual({
        total: 10,
        successful: 8,
        failed: 2,
        successRate: 80,
      });
    });

    it('listEndpointsHandler returns 500 when dispatcher throws', async () => {
      mockDispatcher.listEndpoints.mockRejectedValue(new Error('DB failure'));
      const res = createMockRes();

      await handlers.listEndpointsHandler({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'DB failure' });
    });

    it('createEndpointHandler rejects missing name or url with 400', async () => {
      const res = createMockRes();
      await handlers.createEndpointHandler({ body: { name: 'Only Name' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Endpoint name and URL are required.' });
    });

    it('createEndpointHandler creates endpoint and returns 201', async () => {
      const payload = { name: 'Payment Hook', url: 'https://pay.test/hook' };
      mockDispatcher.createEndpoint.mockResolvedValue({ id: 12, ...payload });
      const res = createMockRes();

      await handlers.createEndpointHandler({ body: payload }, res);

      expect(mockDispatcher.createEndpoint).toHaveBeenCalledWith(payload);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 12, ...payload });
    });

    it('getEndpointHandler returns 200 when found or 404 when missing', async () => {
      mockDispatcher.getEndpoint.mockResolvedValueOnce({ id: 7, name: 'Hook 7' });
      let res = createMockRes();

      await handlers.getEndpointHandler({ params: { id: 7 } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 7, name: 'Hook 7' });

      // Not found
      mockDispatcher.getEndpoint.mockResolvedValueOnce(null);
      res = createMockRes();
      await handlers.getEndpointHandler({ params: { id: 99 } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Webhook endpoint #99 not found' });
    });

    it('updateEndpointHandler updates endpoint or returns 404', async () => {
      mockDispatcher.updateEndpoint.mockResolvedValueOnce({ id: 3, name: 'Updated Hook' });
      let res = createMockRes();

      await handlers.updateEndpointHandler({ params: { id: 3 }, body: { name: 'Updated Hook' } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 3, name: 'Updated Hook' });

      // Not found
      mockDispatcher.updateEndpoint.mockResolvedValueOnce(null);
      res = createMockRes();
      await handlers.updateEndpointHandler({ params: { id: 99 }, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deleteEndpointHandler deletes endpoint or returns 404', async () => {
      mockDispatcher.deleteEndpoint.mockResolvedValueOnce(true);
      let res = createMockRes();

      await handlers.deleteEndpointHandler({ params: { id: 5 } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Not found
      mockDispatcher.deleteEndpoint.mockResolvedValueOnce(false);
      res = createMockRes();
      await handlers.deleteEndpointHandler({ params: { id: 99 } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('pingEndpointHandler dispatches ping and returns 200', async () => {
      mockDispatcher.pingEndpoint.mockResolvedValue({ success: true, statusCode: 200 });
      const res = createMockRes();

      await handlers.pingEndpointHandler({ params: { id: 1 } }, res);

      expect(mockDispatcher.pingEndpoint).toHaveBeenCalledWith(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, statusCode: 200 });
    });
  });

  describe('Deliveries handlers', () => {
    it('listDeliveriesHandler parses query and returns paginated list', async () => {
      const result = { items: [{ id: 101 }], total: 1, page: 1, limit: 20 };
      mockDispatcher.listDeliveries.mockResolvedValue(result);
      const res = createMockRes();

      await handlers.listDeliveriesHandler(
        { query: { endpoint_id: 2, event: 'order.created', success: 'true', page: 1, limit: 10 } },
        res
      );

      expect(mockDispatcher.listDeliveries).toHaveBeenCalledWith({
        endpointId: 2,
        event: 'order.created',
        success: 'true',
        page: 1,
        limit: 10,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(result);
    });

    it('getDeliveryHandler returns delivery log or 404', async () => {
      mockDispatcher.getDelivery.mockResolvedValueOnce({ id: 202, payload: {} });
      let res = createMockRes();

      await handlers.getDeliveryHandler({ params: { id: 202 } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 202, payload: {} });

      // Not found
      mockDispatcher.getDelivery.mockResolvedValueOnce(null);
      res = createMockRes();
      await handlers.getDeliveryHandler({ params: { id: 999 } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('retryDeliveryHandler retries failed delivery', async () => {
      mockDispatcher.retryDelivery.mockResolvedValue({ id: 303, retried: true });
      const res = createMockRes();

      await handlers.retryDeliveryHandler({ params: { id: 303 } }, res);
      expect(mockDispatcher.retryDelivery).toHaveBeenCalledWith(303);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 303, retried: true });
    });

    it('purgeDeliveriesHandler purges deliveries with default days', async () => {
      mockDispatcher.purgeDeliveries.mockResolvedValue(15);
      const res = createMockRes();

      await handlers.purgeDeliveriesHandler({ body: {}, query: {} }, res);

      expect(mockDispatcher.purgeDeliveries).toHaveBeenCalledWith({ days: 30 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          purged: 15,
        })
      );
    });
  });
});
