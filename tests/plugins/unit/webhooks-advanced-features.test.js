/**
 * Unit & Integration tests for Webhooks Advanced Features:
 * Live Payload & Ping Tester, Secret Rotation, Replay Engine, Bulk Retry, Stats & Built-in Services
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookDispatcher } from '../../../plugins/webhooks/dispatcher';
import { createWebhookApiHandlers } from '../../../plugins/webhooks/api-handlers';
import { createWebhookServices } from '../../../core/services/builtins/webhook';
import { generateWebhooksComponent } from '../../../plugins/webhooks/admin-component';
import { createMockSpyRes as createMockRes } from '../../utils';

describe('Webhooks Advanced Features', () => {
  describe('WebhookDispatcher enhancements', () => {
    let dispatcher;
    let mockEndpoint;

    beforeEach(() => {
      mockEndpoint = {
        id: 10,
        name: 'Stripe Webhook',
        url: 'https://example.com/webhook',
        secret: 'whsec_oldsecret1234567890abcdef',
        events: ['order.*'],
        is_active: true,
        metadata: { env: 'test' },
      };

      dispatcher = new WebhookDispatcher({
        endpoints: [mockEndpoint],
      });
    });

    it('testEndpoint executes delivery with custom event and payload', async () => {
      const executeSpy = vi.spyOn(dispatcher, 'executeDelivery').mockResolvedValue({
        success: true,
        statusCode: 200,
        durationMs: 42,
        error: null,
        responseBody: '{"received":true}',
      });

      const result = await dispatcher.testEndpoint(10, {
        event: 'order.created',
        payload: { orderId: 'ord_123', amount: 99.5 },
      });

      expect(executeSpy).toHaveBeenCalled();
      const callArg = executeSpy.mock.calls[0][0];
      expect(callArg.event).toBe('order.created');
      expect(callArg.payload).toEqual({ orderId: 'ord_123', amount: 99.5 });
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.durationMs).toBe(42);
      expect(result.event).toBe('order.created');
    });

    it('pingEndpoint delegates to testEndpoint', async () => {
      const testSpy = vi.spyOn(dispatcher, 'testEndpoint').mockResolvedValue({
        success: true,
        statusCode: 200,
      });

      const res = await dispatcher.pingEndpoint(10, { custom: true });
      expect(testSpy).toHaveBeenCalledWith(10, { custom: true });
      expect(res.success).toBe(true);
    });

    it('rotateSecret generates new secret and preserves previous_secret in metadata', async () => {
      const res = await dispatcher.rotateSecret(10, { prefix: 'whsec_test_' });

      expect(res.success).toBe(true);
      expect(res.secret).toMatch(/^whsec_test_/);
      expect(res.previousSecret).toBe('whsec_oldsecret1234567890abcdef');
      expect(res.rotatedAt).toBeDefined();

      const ep = await dispatcher.getEndpoint(10);
      expect(ep.secret).toBe(res.secret);
      expect(ep.metadata.previous_secret).toBe('whsec_oldsecret1234567890abcdef');
      expect(ep.metadata.secret_rotated_at).toBe(res.rotatedAt);
    });

    it('bulkRetryDeliveries retries multiple deliveries and tallies results', async () => {
      vi.spyOn(dispatcher, 'retryDelivery').mockImplementation(async (id) => {
        if (id === 1) return { success: true, statusCode: 200 };
        if (id === 2) return { success: true, statusCode: 200 };
        throw new Error('Target unreachable');
      });

      const result = await dispatcher.bulkRetryDeliveries([1, 2, 3]);
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.items).toHaveLength(3);
    });

    it('getStats returns stats from static endpoints when DB is absent', async () => {
      const stats = await dispatcher.getStats();
      expect(stats.totalEndpoints).toBe(1);
      expect(stats.activeEndpoints).toBe(1);
      expect(stats.totalDeliveries).toBe(0);
      expect(stats.successRate).toBe(100);
    });
  });

  describe('Admin API Handlers enhancements', () => {
    let mockDispatcher;
    let handlers;

    beforeEach(() => {
      mockDispatcher = {
        testEndpoint: vi.fn(),
        rotateSecret: vi.fn(),
        replayDelivery: vi.fn(),
        bulkRetryDeliveries: vi.fn(),
        getStats: vi.fn(),
        listDeliveries: vi.fn(),
      };
      handlers = createWebhookApiHandlers(mockDispatcher);
    });

    it('testEndpointHandler forwards body payload and returns 200', async () => {
      mockDispatcher.testEndpoint.mockResolvedValue({
        success: true,
        statusCode: 200,
        durationMs: 35,
        responseBody: 'ok',
      });
      const res = createMockRes();

      await handlers.testEndpointHandler({
        params: { id: 10 },
        body: { event: 'order.refunded', payload: { refundId: 'ref_1' } },
      }, res);

      expect(mockDispatcher.testEndpoint).toHaveBeenCalledWith(10, {
        event: 'order.refunded',
        payload: { refundId: 'ref_1' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, statusCode: 200 }));
    });

    it('rotateSecretHandler calls rotateSecret and returns 200', async () => {
      mockDispatcher.rotateSecret.mockResolvedValue({
        success: true,
        secret: 'whsec_new123',
        previousSecret: 'whsec_old456',
      });
      const res = createMockRes();

      await handlers.rotateSecretHandler({ params: { id: 10 }, body: {} }, res);

      expect(mockDispatcher.rotateSecret).toHaveBeenCalledWith(10, {});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ secret: 'whsec_new123' }));
    });

    it('replayDeliveryHandler replays delivery with overrides', async () => {
      mockDispatcher.replayDelivery.mockResolvedValue({
        success: true,
        deliveryId: 99,
        statusCode: 200,
      });
      const res = createMockRes();

      await handlers.replayDeliveryHandler({
        params: { id: 5 },
        body: { payload: { modified: true } },
      }, res);

      expect(mockDispatcher.replayDelivery).toHaveBeenCalledWith(5, { payload: { modified: true } });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 99 }));
    });

    it('bulkRetryDeliveriesHandler retries list of ids', async () => {
      mockDispatcher.bulkRetryDeliveries.mockResolvedValue({
        total: 2,
        succeeded: 2,
        failed: 0,
      });
      const res = createMockRes();

      await handlers.bulkRetryDeliveriesHandler({ body: { ids: [1, 2] } }, res);

      expect(mockDispatcher.bulkRetryDeliveries).toHaveBeenCalledWith([1, 2]);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 2, succeeded: 2 }));
    });

    it('getStatsHandler returns metrics', async () => {
      mockDispatcher.getStats.mockResolvedValue({
        totalEndpoints: 5,
        activeEndpoints: 4,
        totalDeliveries: 100,
        successRate: 98,
        avgDurationMs: 45,
      });
      const res = createMockRes();

      await handlers.getStatsHandler({}, res);

      expect(mockDispatcher.getStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ successRate: 98, totalDeliveries: 100 }));
    });
  });

  describe('Built-in Webhook Services', () => {
    let mockDispatcher;
    let services;

    beforeEach(() => {
      mockDispatcher = {
        dispatch: vi.fn().mockResolvedValue({ success: true }),
        pingEndpoint: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        testEndpoint: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        retryDelivery: vi.fn().mockResolvedValue({ success: true }),
        replayDelivery: vi.fn().mockResolvedValue({ success: true }),
        rotateSecret: vi.fn().mockResolvedValue({ success: true, secret: 'whsec_abc' }),
        bulkRetryDeliveries: vi.fn().mockResolvedValue({ total: 1, succeeded: 1 }),
        getStats: vi.fn().mockResolvedValue({ totalDeliveries: 10 }),
      };

      services = createWebhookServices({ dispatcher: mockDispatcher });
    });

    it('defines standard webhook service names', () => {
      expect(services['webhook.dispatch']).toBeDefined();
      expect(services['webhook.ping']).toBeDefined();
      expect(services['webhook.test']).toBeDefined();
      expect(services['webhook.retry']).toBeDefined();
      expect(services['webhook.replay']).toBeDefined();
      expect(services['webhook.rotate-secret']).toBeDefined();
      expect(services['webhook.bulk-retry']).toBeDefined();
      expect(services['webhook.get-stats']).toBeDefined();
    });

    it('executes webhook.test service', async () => {
      const res = await services['webhook.test'].handler({
        endpointId: 10,
        event: 'order.paid',
        payload: { amount: 50 },
      });
      expect(mockDispatcher.testEndpoint).toHaveBeenCalledWith(10, expect.objectContaining({ event: 'order.paid' }));
      expect(res.success).toBe(true);
    });

    it('executes webhook.rotate-secret service', async () => {
      const res = await services['webhook.rotate-secret'].handler({ endpointId: 10 });
      expect(mockDispatcher.rotateSecret).toHaveBeenCalledWith(10, expect.any(Object));
      expect(res.secret).toBe('whsec_abc');
    });
  });

  describe('Client-side Mithril Component Script', () => {
    it('generates valid, executable JavaScript without syntax errors', () => {
      const code = generateWebhooksComponent({ apiPrefix: '/_admin/api/webhooks' });
      expect(code).toContain('/_admin/api/webhooks');
      expect(code).toContain('EVENT_PRESETS');
      expect(code).toContain('rotateSecret');
      expect(code).toContain('runWebhookTest');
      expect(code).toContain('bulkRetrySelected');

      // Verify parseable by JS engine
      expect(() => new Function(code)).not.toThrow();
    });
  });
});
