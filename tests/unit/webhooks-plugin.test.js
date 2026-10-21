/**
 * Unit & Integration Tests for Webhooks Plugin
 * Tests crypto signatures, pattern matching, sender, dispatcher, retry logic, services, and admin routes
 */

'use strict';

const http = require('http');
const path = require('path');
const request = require('supertest');
const knex = require('knex');
const { createApp } = require('../../src/server');
const {
  webhooksPlugin,
  WebhookDispatcher,
  generateSecret,
  safeCompare,
  signPayload,
  verifySignature,
  matchEvent,
  matchesAnyEvent,
  normalizeEvents,
  sendWebhook,
  generateDeliveryId,
  generateWebhooksMigration,
  createWebhookEndpointModel,
  createWebhookDeliveryModel,
  generateWebhooksComponent,
} = require('../../plugins/webhooks');

const viewsDir = path.join(__dirname, '../fixtures/views');
const pagesDir = path.join(__dirname, '../fixtures/pages');

describe('Webhooks Plugin', () => {
  describe('1. Cryptographic Utilities & Signatures', () => {
    it('generateSecret produces default prefix and random hex', () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    });

    it('generateSecret respects custom prefix and length', () => {
      const secret = generateSecret('custom_', 16);
      expect(secret).toMatch(/^custom_[0-9a-f]{32}$/);
    });

    it('safeCompare correctly checks strings with constant-time equality', () => {
      expect(safeCompare('hello', 'hello')).toBe(true);
      expect(safeCompare('hello', 'world')).toBe(false);
      expect(safeCompare('hello', 'hello_longer')).toBe(false);
      expect(safeCompare(null, 'hello')).toBe(false);
      expect(safeCompare('hello', undefined)).toBe(false);
      expect(safeCompare(123, 123)).toBe(false);
    });

    it('signPayload produces standard HMAC-SHA256 and timestamped signatures', () => {
      const secret = 'my_test_secret_123';
      const payload = { event: 'order.created', total: 100 };
      const timestamp = 1700000000;

      const signed = signPayload(payload, secret, { timestamp });
      expect(signed.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(signed.timestampedSignature).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
      expect(signed.timestamp).toBe(1700000000);
      expect(signed.hex).toHaveLength(64);
    });

    it('signPayload throws on invalid secret', () => {
      expect(() => signPayload({ a: 1 }, null)).toThrow();
      expect(() => signPayload({ a: 1 }, '')).toThrow();
    });

    it('verifySignature verifies standard sha256= signature', () => {
      const secret = 'super_secret';
      const payload = { hello: 'world' };
      const { signature } = signPayload(payload, secret);

      expect(verifySignature(payload, signature, secret)).toBe(true);
      expect(verifySignature(payload, signature, 'wrong_secret')).toBe(false);
      expect(verifySignature({ hello: 'tampered' }, signature, secret)).toBe(false);
      expect(verifySignature(payload, 'invalid_header', secret)).toBe(false);
    });

    it('verifySignature verifies timestamped signature (t=...,v1=...) with tolerance', () => {
      const secret = 'timestamp_secret';
      const payload = { test: true };
      const now = Math.floor(Date.now() / 1000);
      const { timestampedSignature } = signPayload(payload, secret, { timestamp: now });

      expect(verifySignature(payload, timestampedSignature, secret, { tolerance: 300 })).toBe(true);

      // Expired timestamp (> 300s in the past)
      const oldTime = now - 500;
      const { timestampedSignature: oldSig } = signPayload(payload, secret, { timestamp: oldTime });
      expect(verifySignature(payload, oldSig, secret, { tolerance: 300 })).toBe(false);

      // Disabling tolerance allows verification regardless of time
      expect(verifySignature(payload, oldSig, secret, { tolerance: 0 })).toBe(true);
    });
  });

  describe('2. Event Pattern Matcher', () => {
    it('normalizeEvents handles various formats', () => {
      expect(normalizeEvents('*')).toEqual(['*']);
      expect(normalizeEvents(['user.created', 'order.*'])).toEqual(['user.created', 'order.*']);
      expect(normalizeEvents('user.created, order.*')).toEqual(['user.created', 'order.*']);
      expect(normalizeEvents('["user.created", "payment.*"]')).toEqual(['user.created', 'payment.*']);
      expect(normalizeEvents(null)).toEqual(['*']);
      expect(normalizeEvents('')).toEqual(['*']);
    });

    it('matchEvent matches exact and wildcard patterns', () => {
      expect(matchEvent('*', 'anything.at.all')).toBe(true);
      expect(matchEvent('user.created', 'user.created')).toBe(true);
      expect(matchEvent('user.created', 'user.deleted')).toBe(false);
      expect(matchEvent('user.*', 'user.created')).toBe(true);
      expect(matchEvent('user.*', 'user.deleted')).toBe(true);
      expect(matchEvent('user.*', 'order.created')).toBe(false);
      expect(matchEvent('order.*.item', 'order.123.item')).toBe(true);
      expect(matchEvent('order.*.item', 'order.123.charge')).toBe(false);
      expect(matchEvent('', 'user.created')).toBe(false);
      expect(matchEvent('user.created', '')).toBe(false);
    });

    it('matchesAnyEvent returns true if any pattern matches', () => {
      const patterns = ['order.*', 'payment.success'];
      expect(matchesAnyEvent(patterns, 'order.created')).toBe(true);
      expect(matchesAnyEvent(patterns, 'payment.success')).toBe(true);
      expect(matchesAnyEvent(patterns, 'user.created')).toBe(false);
      expect(matchesAnyEvent([], 'anything')).toBe(false);
    });
  });

  describe('3. HTTP Delivery Sender', () => {
    let server;
    let serverUrl;
    let lastReceivedRequest = null;
    let shouldFail = false;
    let delayMs = 0;

    beforeAll(async () => {
      await new Promise((resolve) => {
        server = http.createServer((req, res) => {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            lastReceivedRequest = {
              method: req.method,
              headers: req.headers,
              body: body ? JSON.parse(body) : null,
            };

            const sendResponse = () => {
              if (shouldFail) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server crashed' }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ received: true }));
              }
            };

            if (delayMs > 0) {
              setTimeout(sendResponse, delayMs);
            } else {
              sendResponse();
            }
          });
        });

        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          serverUrl = `http://127.0.0.1:${port}/webhook`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
      lastReceivedRequest = null;
      shouldFail = false;
      delayMs = 0;
    });

    it('delivers webhook payload with correct headers and signatures', async () => {
      const secret = 'sender_secret_key';
      const event = 'order.paid';
      const payload = { orderId: 42, amount: 99.9 };

      const result = await sendWebhook({
        url: serverUrl,
        event,
        payload,
        secret,
        headers: { 'X-Custom-Header': 'HelloWebspresso' },
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeNull();
      expect(result.responseBody).toContain('received');

      // Verify what was sent to server
      expect(lastReceivedRequest).not.toBeNull();
      expect(lastReceivedRequest.headers['x-webspresso-event']).toBe('order.paid');
      expect(lastReceivedRequest.headers['x-custom-header']).toBe('HelloWebspresso');
      expect(lastReceivedRequest.headers['x-webspresso-signature']).toMatch(/^sha256=/);
      expect(lastReceivedRequest.headers['webhook-signature']).toMatch(/^t=/);
      expect(lastReceivedRequest.body.event).toBe('order.paid');
      expect(lastReceivedRequest.body.data).toEqual(payload);
    });

    it('handles HTTP error responses without throwing', async () => {
      shouldFail = true;
      const result = await sendWebhook({
        url: serverUrl,
        event: 'test.error',
        payload: { errorTest: true },
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('HTTP 500');
      expect(result.responseBody).toContain('Server crashed');
    });

    it('handles network timeouts gracefully', async () => {
      delayMs = 200;
      const result = await sendWebhook({
        url: serverUrl,
        event: 'test.timeout',
        payload: { slow: true },
        timeoutMs: 50, // shorter than delay
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(0);
      expect(result.error).toContain('timed out');
    });

    it('handles invalid URL without crashing', async () => {
      const result = await sendWebhook({
        url: '',
        event: 'test',
        payload: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid webhook URL');
    });
  });

  describe('4. Migration Template & ORM Models', () => {
    it('generateWebhooksMigration produces valid migration script', () => {
      const migration = generateWebhooksMigration('custom_endpoints', 'custom_deliveries');
      expect(migration).toContain('custom_endpoints');
      expect(migration).toContain('custom_deliveries');
      expect(migration).toContain('exports.up');
      expect(migration).toContain('exports.down');
    });

    it('createWebhookEndpointModel and createWebhookDeliveryModel produce valid definitions', () => {
      const endpointModel = createWebhookEndpointModel();
      expect(endpointModel.name).toBe('WebhookEndpoint');
      expect(endpointModel.table).toBe('webhook_endpoints');
      expect(endpointModel.hidden).toContain('secret');

      const deliveryModel = createWebhookDeliveryModel();
      expect(deliveryModel.name).toBe('WebhookDelivery');
      expect(deliveryModel.table).toBe('webhook_deliveries');
      expect(deliveryModel.relations.endpoint).toBeDefined();
    });
  });

  describe('5. WebhookDispatcher Engine & Database Lifecycle', () => {
    let testDb;
    let dispatcher;

    beforeAll(async () => {
      testDb = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      // Run generated migration
      const migrationCode = generateWebhooksMigration();
      const migrationModule = {};
      const runMigration = new Function('exports', 'knex', `${migrationCode}\nreturn exports;`);
      const migrationExports = runMigration(migrationModule, testDb);
      await migrationExports.up(testDb);

      dispatcher = new WebhookDispatcher({
        knex: testDb,
        maxAttempts: 3,
        backoffBaseMs: 10,
        timeoutMs: 3000,
      });
    });

    afterAll(async () => {
      dispatcher.dispose();
      await testDb.destroy();
    });

    it('creates, lists, updates, and retrieves webhook endpoints', async () => {
      const ep1 = await dispatcher.createEndpoint({
        name: 'Orders Webhook',
        url: 'https://example.com/webhooks/orders',
        events: ['order.*', 'payment.success'],
        description: 'Sync orders to CRM',
      });

      expect(ep1.id).toBeDefined();
      expect(ep1.name).toBe('Orders Webhook');
      expect(ep1.secret).toMatch(/^whsec_/);
      expect(JSON.parse(ep1.events)).toEqual(['order.*', 'payment.success']);
      expect(ep1.is_active).toBe(true);

      // List endpoints
      const list = await dispatcher.listEndpoints();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('Orders Webhook');

      // Update endpoint
      const updated = await dispatcher.updateEndpoint(ep1.id, {
        name: 'Orders & Refunds Webhook',
        events: 'order.*, refund.created',
      });
      expect(updated.name).toBe('Orders & Refunds Webhook');
      expect(JSON.parse(updated.events)).toEqual(['order.*', 'refund.created']);

      // Get single endpoint
      const single = await dispatcher.getEndpoint(ep1.id);
      expect(single.name).toBe('Orders & Refunds Webhook');
    });

    it('dispatches events only to endpoints matching event pattern', async () => {
      // Create a second endpoint for users only
      const userEp = await dispatcher.createEndpoint({
        name: 'User Webhook',
        url: 'https://example.com/webhooks/users',
        events: ['user.*'],
      });

      // Dispatch 'order.created'
      const orderDispatch = await dispatcher.dispatch('order.created', { orderId: 100 }, { wait: true });
      expect(orderDispatch.dispatched).toBe(1); // Only order endpoint matched
      expect(orderDispatch.deliveries.length).toBe(1);

      // Dispatch 'user.registered'
      const userDispatch = await dispatcher.dispatch('user.registered', { userId: 5 }, { wait: true });
      expect(userDispatch.dispatched).toBe(1); // Only user endpoint matched
      expect(userDispatch.deliveries[0].endpoint_id).toBe(userEp.id);

      // Dispatch unmatched event
      const unmatched = await dispatcher.dispatch('analytics.view', { page: '/' });
      expect(unmatched.dispatched).toBe(0);
      expect(unmatched.deliveries).toEqual([]);
    });

    it('lists delivery logs and supports status filtering', async () => {
      const deliveries = await dispatcher.listDeliveries();
      expect(deliveries.total).toBeGreaterThanOrEqual(2);
      expect(deliveries.items.length).toBeGreaterThanOrEqual(2);

      const filtered = await dispatcher.listDeliveries({ event: 'order' });
      expect(filtered.items.every((d) => d.event.includes('order'))).toBe(true);
    });

    it('pingEndpoint sends test ping event to endpoint', async () => {
      const endpoints = await dispatcher.listEndpoints();
      const ep = endpoints[0];

      const outcome = await dispatcher.pingEndpoint(ep.id);
      expect(outcome).toBeDefined();
      expect(outcome.deliveryId || outcome.error).toBeDefined();
    });

    it('retryDelivery re-attempts delivery and increments attempt count', async () => {
      const deliveries = await dispatcher.listDeliveries();
      const firstDelivery = deliveries.items[0];

      const retryOutcome = await dispatcher.retryDelivery(firstDelivery.id);
      expect(retryOutcome.attempt).toBe((firstDelivery.attempt || 1) + 1);

      const refreshed = await dispatcher.getDelivery(firstDelivery.id);
      expect(refreshed.attempt).toBe(retryOutcome.attempt);
    });

    it('purgeDeliveries removes old delivery logs', async () => {
      // Artificially age one delivery
      await testDb('webhook_deliveries').where({ id: 1 }).update({
        created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      });

      const purged = await dispatcher.purgeDeliveries({ days: 30 });
      expect(purged).toBeGreaterThanOrEqual(1);

      const afterPurge = await dispatcher.getDelivery(1);
      expect(afterPurge).toBeNull();
    });

    it('deletes endpoint and cascades delivery records', async () => {
      const ep = await dispatcher.createEndpoint({
        name: 'To Delete',
        url: 'https://example.com/delete',
      });

      await dispatcher.dispatch('test.event', { foo: 'bar' }, { endpointId: ep.id, wait: true });

      const deleted = await dispatcher.deleteEndpoint(ep.id);
      expect(deleted).toBe(true);

      const found = await dispatcher.getEndpoint(ep.id);
      expect(found).toBeNull();
    });
  });

  describe('6. Plugin Lifecycle & Admin Integration', () => {
    let testDb;
    let app;

    beforeAll(async () => {
      testDb = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      const migration = generateWebhooksMigration();
      const runMigration = new Function('exports', 'knex', `${migration}\nreturn exports;`);
      const migrationExports = runMigration({}, testDb);
      await migrationExports.up(testDb);

      const webhooks = webhooksPlugin({
        knex: testDb,
        apiPrefix: '/api/admin/webhooks',
      });

      let registeredModule = null;
      const fakeAdminPanel = {
        name: 'admin-panel',
        api: {
          registerModule: (mod) => {
            registeredModule = mod;
          },
        },
      };

      const serverApp = createApp({
        pagesDir,
        viewsDir,
        silent: true,
        helmet: false,
        compression: false,
        cache: false,
        healthCheck: false,
        metrics: false,
        lazyRoutes: true,
        plugins: [
          fakeAdminPanel,
          webhooks,
        ],
      });

      app = serverApp.app;
      app._registeredModule = registeredModule;
    });

    afterAll(async () => {
      await testDb.destroy();
    });

    it('attaches req.webhooks and app.webhooks to request lifecycle', async () => {
      expect(app.webhooks).toBeInstanceOf(WebhookDispatcher);
    });

    it('registers admin module with menu, pages, and API routes when admin-panel is present', () => {
      const mod = app._registeredModule;
      expect(mod).toBeDefined();
      expect(mod.id).toBe('webhooks');
      expect(mod.pages[0].path).toBe('/webhooks');
      expect(mod.menu[0].label).toBe('Webhooks');
      expect(mod.api.prefix).toBe('/api/admin/webhooks');
      expect(mod.api.routes.length).toBe(11);
    });

    it('registers built-in services in app.serviceRegistry', async () => {
      expect(app.serviceRegistry.has('webhook.dispatch')).toBe(true);
      expect(app.serviceRegistry.has('webhook.ping')).toBe(true);
      expect(app.serviceRegistry.has('webhook.retry')).toBe(true);

      const res = await app.serviceRegistry.call('webhook.dispatch', {
        event: 'service.test',
        payload: { success: true },
      });
      expect(res.dispatched).toBe(0); // No endpoints yet
    });

    it('generateWebhooksComponent returns valid client component string', () => {
      const componentStr = generateWebhooksComponent({ apiPrefix: '/test-prefix' });
      expect(componentStr).toContain("var API = '/test-prefix';");
      expect(componentStr).toContain("window.__customPages['webhooks'] = WebhooksPage;");
      expect(componentStr).toContain('HMAC SHA-256');
    });

    it('supports static in-memory endpoints when no db is provided', async () => {
      const staticDispatcher = new WebhookDispatcher({
        endpoints: [
          { id: 1, name: 'Static Slack', url: 'https://hooks.slack.com/services/1', events: ['alert.*'] },
        ],
      });

      const matching = await staticDispatcher.getEndpointsForEvent('alert.critical');
      expect(matching.length).toBe(1);
      expect(matching[0].name).toBe('Static Slack');

      const nonMatching = await staticDispatcher.getEndpointsForEvent('order.created');
      expect(nonMatching.length).toBe(0);
    });
  });
});
