import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher, generateDeliveryId } from '../../../plugins/webhooks/dispatcher';

describe('WebhookDispatcher Comprehensive Scenarios', () => {
  describe('generateDeliveryId()', () => {
    it('generates unique delivery identifiers with dlv_ prefix', () => {
      const id1 = generateDeliveryId();
      const id2 = generateDeliveryId();
      expect(id1.startsWith('dlv_')).toBe(true);
      expect(id2.startsWith('dlv_')).toBe(true);
      expect(id1).not.toBe(id2);
    });
  });

  describe('Static Endpoints Lifecycle & Matching', () => {
    let dispatcher;

    beforeEach(() => {
      dispatcher = new WebhookDispatcher({
        maxAttempts: 3,
        backoffBaseMs: 50,
        endpoints: [
          {
            id: 'ep_1',
            url: 'https://api.example.com/orders',
            events: ['order.created', 'order.paid'],
            secret: 'sec_1',
            is_active: true,
          },
          {
            id: 'ep_2',
            url: 'https://api.example.com/all',
            events: ['*'],
            secret: 'sec_2',
            is_active: true,
          },
          {
            id: 'ep_inactive',
            url: 'https://api.example.com/inactive',
            events: ['*'],
            is_active: false,
          },
        ],
      });
    });

    afterEach(() => {
      dispatcher.dispose();
    });

    it('matches endpoints by exact event and wildcard, excluding inactive ones', async () => {
      const orderEndpoints = await dispatcher.getEndpointsForEvent('order.created');
      expect(orderEndpoints.map((e) => e.id)).toEqual(['ep_1', 'ep_2']);

      const userEndpoints = await dispatcher.getEndpointsForEvent('user.registered');
      expect(userEndpoints.map((e) => e.id)).toEqual(['ep_2']);
    });

    it('creates, updates, and deletes static endpoints', async () => {
      const newEp = await dispatcher.createEndpoint({
        name: 'New Static Endpoint',
        url: 'https://new.example.com',
        events: ['invoice.sent'],
      });
      expect(newEp.id).toBeDefined();
      expect(newEp.secret).toBeDefined();

      const updated = await dispatcher.updateEndpoint(newEp.id, {
        url: 'https://updated.example.com',
      });
      expect(updated.url).toBe('https://updated.example.com');

      const nonExistentUpdate = await dispatcher.updateEndpoint('nonexistent', { url: 'http://a' });
      expect(nonExistentUpdate).toBeNull();

      const deleted = await dispatcher.deleteEndpoint(newEp.id);
      expect(deleted).toBe(true);

      const deleteAgain = await dispatcher.deleteEndpoint(newEp.id);
      expect(deleteAgain).toBe(false);
    });
  });

  describe('Dispatch Execution with Queue Integration', () => {
    let queueJobs;
    let dispatcher;

    beforeEach(() => {
      queueJobs = [];
      const mockQueue = {
        dispatch: async (jobName, payload, options) => {
          queueJobs.push({ jobName, payload, options });
          return { id: 'job_' + queueJobs.length };
        },
      };

      dispatcher = new WebhookDispatcher({
        queue: mockQueue,
        maxAttempts: 2,
        backoffBaseMs: 100,
        endpoints: [
          {
            id: 'ep_queue_1',
            url: 'https://receiver.example.com/webhook',
            events: ['test.event'],
            secret: 'test-secret',
            is_active: true,
          },
        ],
      });
    });

    afterEach(() => {
      dispatcher.dispose();
    });

    it('delegates delivery to queue when queue is configured', async () => {
      const result = await dispatcher.dispatch('test.event', { foo: 'bar' }, { wait: true });
      expect(result.dispatched).toBe(1);
      expect(queueJobs.length).toBe(1);
      expect(queueJobs[0].jobName).toBe('webhooks.deliver');
      expect(queueJobs[0].payload.endpointId).toBe('ep_queue_1');
      expect(queueJobs[0].payload.event).toBe('test.event');
      expect(queueJobs[0].options.attempts).toBe(2);
    });

    it('validates event name and returns empty array when no endpoint matches', async () => {
      await expect(dispatcher.dispatch('', {})).rejects.toThrow(/non-empty string/i);
      await expect(dispatcher.dispatch(null, {})).rejects.toThrow(/non-empty string/i);

      const noMatch = await dispatcher.dispatch('unmatched.event', {});
      expect(noMatch.dispatched).toBe(0);
      expect(noMatch.deliveries).toEqual([]);
    });

    it('filters dispatch by options.endpointId', async () => {
      const result = await dispatcher.dispatch('test.event', {}, { endpointId: 'different_id' });
      expect(result.dispatched).toBe(0);
    });
  });

  describe('HTTP Delivery, Retries, and Error Handling', () => {
    let dispatcher;

    beforeEach(() => {
      dispatcher = new WebhookDispatcher({
        maxAttempts: 2,
        backoffBaseMs: 20,
        timeoutMs: 500,
        endpoints: [
          {
            id: 'ep_mock_http',
            url: 'https://mock.example.com/hook',
            events: ['item.created'],
            secret: 'test_sec',
            is_active: true,
          },
        ],
      });
    });

    afterEach(() => {
      dispatcher.dispose();
    });

    it('emits delivered on successful 200 HTTP response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () => 'OK',
      });

      const deliveredEvents = [];
      dispatcher.on('delivered', (ev) => deliveredEvents.push(ev));

      const outcome = await dispatcher.executeDelivery({
        endpoint: {
          id: 'ep_mock_http',
          url: 'https://mock.example.com/hook',
          secret: 'test_sec',
        },
        deliveryId: 'dlv_success_test',
        event: 'item.created',
        payload: { item: 123 },
        attempt: 1,
      });

      expect(outcome.success).toBe(true);
      expect(outcome.statusCode).toBe(200);
      expect(deliveredEvents.length).toBe(1);
    });

    it('emits failed and schedules retry on 500 HTTP response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const failedEvents = [];
      dispatcher.on('failed', (ev) => failedEvents.push(ev));

      const outcome = await dispatcher.executeDelivery({
        endpoint: {
          id: 'ep_mock_http',
          url: 'https://mock.example.com/hook',
          secret: 'test_sec',
        },
        deliveryId: 'dlv_fail_test',
        event: 'item.created',
        payload: { item: 123 },
        attempt: 1,
        autoRetry: true,
      });

      expect(outcome.success).toBe(false);
      expect(outcome.willRetry).toBe(true);
      expect(outcome.nextRetryAt).toBeInstanceOf(Date);
      expect(failedEvents.length).toBe(1);
    });

    it('does not retry when attempt equals maxAttempts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 502,
        text: async () => 'Bad Gateway',
      });

      const outcome = await dispatcher.executeDelivery({
        endpoint: {
          id: 'ep_mock_http',
          url: 'https://mock.example.com/hook',
          secret: 'test_sec',
        },
        deliveryId: 'dlv_max_test',
        event: 'item.created',
        payload: {},
        attempt: 2, // maxAttempts is 2
        autoRetry: true,
      });

      expect(outcome.success).toBe(false);
      expect(outcome.willRetry).toBe(false);
      expect(outcome.nextRetryAt).toBeNull();
    });
  });

  describe('Database Knex Integration & Queries', () => {
    let dbEndpoints;
    let dbDeliveries;
    let mockKnex;
    let dispatcher;

    beforeEach(() => {
      dbEndpoints = new Map();
      dbDeliveries = new Map();

      mockKnex = vi.fn((table) => {
        const queryObj = {
          _where: {},
          where(w) {
            queryObj._where = { ...queryObj._where, ...w };
            return queryObj;
          },
          whereNot(w) {
            return queryObj;
          },
          orderBy() {
            return queryObj;
          },
          limit() {
            return queryObj;
          },
          offset() {
            return queryObj;
          },
          first: async () => {
            if (table === 'webhook_endpoints') {
              return dbEndpoints.get(queryObj._where.id) || null;
            }
            if (table === 'webhook_deliveries') {
              return dbDeliveries.get(queryObj._where.id) || null;
            }
            return null;
          },
          insert: async (data) => {
            const id = data.id || `rec_${Date.now()}`;
            const row = { id, ...data };
            if (table === 'webhook_endpoints') dbEndpoints.set(id, row);
            if (table === 'webhook_deliveries') dbDeliveries.set(id, row);
            return [id];
          },
          update: async (data) => {
            const target = table === 'webhook_endpoints' ? dbEndpoints : dbDeliveries;
            const existing = target.get(queryObj._where.id);
            if (!existing) return 0;
            Object.assign(existing, data);
            return 1;
          },
          delete: async () => {
            const target = table === 'webhook_endpoints' ? dbEndpoints : dbDeliveries;
            if (queryObj._where.id) {
              const existed = target.has(queryObj._where.id);
              target.delete(queryObj._where.id);
              return existed ? 1 : 0;
            }
            return 1;
          },
          select: async () => {
            const target = table === 'webhook_endpoints' ? dbEndpoints : dbDeliveries;
            return Array.from(target.values());
          },
        };
        return queryObj;
      });

      dispatcher = new WebhookDispatcher({
        knex: mockKnex,
        maxAttempts: 3,
      });
    });

    afterEach(() => {
      dispatcher.dispose();
    });

    it('creates, reads, updates, and deletes endpoints via Knex', async () => {
      const ep = await dispatcher.createEndpoint({
        name: 'DB Endpoint',
        url: 'https://db.example.com',
        events: ['user.*'],
      });
      expect(ep.id).toBeDefined();

      const retrieved = await dispatcher.getEndpoint(ep.id);
      expect(retrieved.id).toBe(ep.id);
      expect(retrieved.name).toBe('DB Endpoint');

      const updated = await dispatcher.updateEndpoint(ep.id, { url: 'https://db2.example.com' });
      expect(updated.url).toBe('https://db2.example.com');

      const deleted = await dispatcher.deleteEndpoint(ep.id);
      expect(deleted).toBe(true);

      const afterDelete = await dispatcher.getEndpoint(ep.id);
      expect(afterDelete).toBeNull();
    });

    it('pings endpoint with ping payload and records delivery', async () => {
      const ep = await dispatcher.createEndpoint({
        name: 'Ping Ep',
        url: 'https://ping.example.com',
        events: ['ping'],
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () => 'pong',
      });

      const outcome = await dispatcher.pingEndpoint(ep.id);
      expect(outcome.event).toBe('ping');
      expect(outcome.success).toBe(true);

      // Ping non-existent endpoint throws
      await expect(dispatcher.pingEndpoint('ghost_ep')).rejects.toThrow(/not found/i);
    });

    it('retries a delivery record from database', async () => {
      const ep = await dispatcher.createEndpoint({
        name: 'Retry Ep',
        url: 'https://retry.example.com',
        events: ['test'],
      });

      dbDeliveries.set('dlv_saved_1', {
        id: 'dlv_saved_1',
        endpoint_id: ep.id,
        event: 'test',
        payload: JSON.stringify({ amount: 100 }),
        attempt: 1,
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () => 'OK',
      });

      const outcome = await dispatcher.retryDelivery('dlv_saved_1');
      expect(outcome.attempt).toBe(2);
      expect(outcome.success).toBe(true);

      // Non-existent delivery
      await expect(dispatcher.retryDelivery('unknown_dlv')).rejects.toThrow(/not found/i);
    });

    it('manages queue updates via setQueue', () => {
      const q = { dispatch: vi.fn() };
      dispatcher.setQueue(q);
      expect(dispatcher.queue).toBe(q);
    });
  });
});
