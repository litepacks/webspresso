/**
 * Webspresso Webhooks Plugin
 * Outgoing Webhook Dispatcher, Signature Verification, Event Matching & Admin Inspector
 * @module plugins/webhooks
 */

'use strict';

const { generateSecret, safeCompare, signPayload, verifySignature } = require('./crypto');
const { matchEvent, matchesAnyEvent, normalizeEvents } = require('./matcher');
const { sendWebhook } = require('./sender');
const { createWebhookEndpointModel, createWebhookDeliveryModel } = require('./models');
const { generateWebhooksMigration } = require('./migration-template');
const { WebhookDispatcher, generateDeliveryId } = require('./dispatcher');
const { createWebhookApiHandlers } = require('./api-handlers');
const { generateWebhooksComponent } = require('./admin-component');

/**
 * Webhooks Plugin Factory
 * 
 * @param {Object} [options]
 * @param {any} [options.db] - Webspresso database or Knex instance
 * @param {any} [options.knex] - Knex instance
 * @param {string} [options.endpointsTable='webhook_endpoints']
 * @param {string} [options.deliveriesTable='webhook_deliveries']
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts
 * @param {number} [options.backoffBaseMs=1000] - Base delay for exponential backoff (ms)
 * @param {number} [options.timeoutMs=10000] - Request timeout (ms)
 * @param {boolean} [options.wrapPayload=true] - Wrap data in standard event envelope
 * @param {any} [options.queue] - Webspresso QueueManager instance
 * @param {Array<Object>} [options.endpoints] - Static in-memory endpoints
 * @param {string} [options.apiPrefix='/webhooks'] - Admin API prefix
 * @param {boolean} [options.includeDefaultPage=true] - Register Admin Panel page & menu
 * @param {string} [options.pageTitle='Webhooks'] - Admin page title
 * @param {number} [options.menuOrder=92] - Admin sidebar menu order
 * @returns {Object} Webspresso Plugin Definition
 */
function webhooksPlugin(options = {}) {
  const {
    endpointsTable = 'webhook_endpoints',
    deliveriesTable = 'webhook_deliveries',
    apiPrefix = '/webhooks',
    includeDefaultPage = true,
    pageTitle = 'Webhooks',
    menuOrder = 92,
  } = options;

  const dispatcher = new WebhookDispatcher({
    ...options,
    endpointsTable,
    deliveriesTable,
  });

  const apiHandlers = createWebhookApiHandlers(dispatcher, options);

  return {
    name: 'webhooks',
    version: '1.0.0',
    description: 'Outgoing Webhook Dispatcher with HMAC-SHA256 signatures, wildcard matching, retries, and Admin UI',
    options,

    api: {
      dispatcher,
      dispatch: (event, payload, opts) => dispatcher.dispatch(event, payload, opts),
      pingEndpoint: (id) => dispatcher.pingEndpoint(id),
      retryDelivery: (id) => dispatcher.retryDelivery(id),
      createEndpoint: (data) => dispatcher.createEndpoint(data),
      getEndpoint: (id) => dispatcher.getEndpoint(id),
      updateEndpoint: (id, data) => dispatcher.updateEndpoint(id, data),
      deleteEndpoint: (id) => dispatcher.deleteEndpoint(id),
      listEndpoints: (filters) => dispatcher.listEndpoints(filters),
      listDeliveries: (filters) => dispatcher.listDeliveries(filters),
      getDelivery: (id) => dispatcher.getDelivery(id),
      purgeDeliveries: (opts) => dispatcher.purgeDeliveries(opts),
      generateSecret,
      safeCompare,
      signPayload,
      verifySignature,
      matchEvent,
      matchesAnyEvent,
      sendWebhook,
      getMigrationTemplate: (epTable, dlvTable) =>
        generateWebhooksMigration(epTable || endpointsTable, dlvTable || deliveriesTable),
      getModels: () => ({
        WebhookEndpoint: createWebhookEndpointModel(endpointsTable),
        WebhookDelivery: createWebhookDeliveryModel(deliveriesTable),
      }),
    },

    register(ctx) {
      const db = options.db || (ctx && ctx.db);
      if (db && typeof db.registerModel === 'function' && typeof db.hasModel === 'function') {
        if (!db.hasModel('WebhookEndpoint')) {
          db.registerModel(createWebhookEndpointModel(endpointsTable));
        }
        if (!db.hasModel('WebhookDelivery')) {
          db.registerModel(createWebhookDeliveryModel(deliveriesTable));
        }
      }

      // If DB was not passed in plugin options, bind it from ctx
      if (!dispatcher.db && db) {
        dispatcher.db = db;
        dispatcher.knex = db.knex || db;
      }

      // Sync timeouts from app context if not explicitly passed
      const timeouts = ctx?.timeouts || (ctx?.app && typeof ctx.app.get === 'function' ? ctx.app.get('timeouts') : null);
      if (timeouts && timeouts.webhook && dispatcher.timeoutMs === 10000 && options.timeoutMs === undefined && options.timeout === undefined) {
        dispatcher.timeoutMs = timeouts.webhook;
      }

      // Attach dispatcher to app and request objects
      if (ctx.app) {
        ctx.app.webhooks = dispatcher;
        ctx.app.use((req, res, next) => {
          req.webhooks = dispatcher;
          next();
        });

        // Register built-in services in app.serviceRegistry if available
        if (ctx.app.serviceRegistry && typeof ctx.app.serviceRegistry.register === 'function') {
          if (!ctx.app.serviceRegistry.has('webhook.dispatch')) {
            ctx.app.serviceRegistry.register('webhook.dispatch', {
              handler: async (input) => dispatcher.dispatch(input.event, input.payload, input),
            });
          }
          if (!ctx.app.serviceRegistry.has('webhook.ping')) {
            ctx.app.serviceRegistry.register('webhook.ping', {
              handler: async (input) => dispatcher.pingEndpoint(input.endpointId),
            });
          }
          if (!ctx.app.serviceRegistry.has('webhook.retry')) {
            ctx.app.serviceRegistry.register('webhook.retry', {
              handler: async (input) => dispatcher.retryDelivery(input.deliveryId),
            });
          }
        }

        // Integrate with core/queue if queue is present
        const queueManager = options.queue || ctx.app.queue;
        if (queueManager && typeof queueManager.define === 'function') {
          dispatcher.setQueue(queueManager);
          if (!queueManager.handlers?.has?.('webhooks.deliver')) {
            queueManager.define('webhooks.deliver', async (job) => {
              const { endpointId, deliveryId, event, payload, attempt } = job.data;
              const endpoint = await dispatcher.getEndpoint(endpointId);
              if (!endpoint) {
                throw new Error(`Endpoint #${endpointId} no longer exists.`);
              }
              const outcome = await dispatcher.executeDelivery({
                endpoint,
                deliveryId,
                event,
                payload,
                attempt: attempt || 1,
                autoRetry: false, // Let queue handle retries
              });
              if (!outcome.success) {
                throw new Error(outcome.error || `Delivery failed with status ${outcome.statusCode}`);
              }
              return outcome;
            }, {
              attempts: options.maxAttempts || 3,
              backoff: { type: 'exponential', delay: options.backoffBaseMs || 1000 },
              timeout: options.timeoutMs || 10000,
            });
          }
        }
      }

      return () => {
        dispatcher.dispose();
      };
    },

    dispose() {
      dispatcher.dispose();
    },

    shutdown() {
      dispatcher.dispose();
    },

    onRoutesReady(ctx) {
      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        return;
      }

      adminApi.registerModule({
        id: 'webhooks',
        title: pageTitle,

        pages: includeDefaultPage
          ? [{
              id: 'webhooks',
              title: pageTitle,
              path: '/webhooks',
              icon: 'send',
              component: generateWebhooksComponent({ apiPrefix }),
            }]
          : [],

        menu: includeDefaultPage
          ? [{
              id: 'webhooks',
              label: pageTitle,
              path: '/webhooks',
              icon: 'send',
              order: menuOrder,
            }]
          : [],

        api: {
          prefix: apiPrefix,
          routes: [
            { method: 'get', path: '/endpoints', handler: apiHandlers.listEndpointsHandler },
            { method: 'post', path: '/endpoints', handler: apiHandlers.createEndpointHandler },
            { method: 'get', path: '/endpoints/:id', handler: apiHandlers.getEndpointHandler },
            { method: 'put', path: '/endpoints/:id', handler: apiHandlers.updateEndpointHandler },
            { method: 'patch', path: '/endpoints/:id', handler: apiHandlers.updateEndpointHandler },
            { method: 'delete', path: '/endpoints/:id', handler: apiHandlers.deleteEndpointHandler },
            { method: 'post', path: '/endpoints/:id/ping', handler: apiHandlers.pingEndpointHandler },
            { method: 'get', path: '/deliveries', handler: apiHandlers.listDeliveriesHandler },
            { method: 'get', path: '/deliveries/:id', handler: apiHandlers.getDeliveryHandler },
            { method: 'post', path: '/deliveries/:id/retry', handler: apiHandlers.retryDeliveryHandler },
            { method: 'post', path: '/deliveries/purge', handler: apiHandlers.purgeDeliveriesHandler },
          ],
        },
      });
    },
  };
}

webhooksPlugin.webhooksPlugin = webhooksPlugin;
webhooksPlugin.WebhookDispatcher = WebhookDispatcher;
webhooksPlugin.generateSecret = generateSecret;
webhooksPlugin.safeCompare = safeCompare;
webhooksPlugin.signPayload = signPayload;
webhooksPlugin.verifySignature = verifySignature;
webhooksPlugin.matchEvent = matchEvent;
webhooksPlugin.matchesAnyEvent = matchesAnyEvent;
webhooksPlugin.normalizeEvents = normalizeEvents;
webhooksPlugin.sendWebhook = sendWebhook;
webhooksPlugin.generateDeliveryId = generateDeliveryId;
webhooksPlugin.generateWebhooksMigration = generateWebhooksMigration;
webhooksPlugin.createWebhookEndpointModel = createWebhookEndpointModel;
webhooksPlugin.createWebhookDeliveryModel = createWebhookDeliveryModel;
webhooksPlugin.createWebhookApiHandlers = createWebhookApiHandlers;
webhooksPlugin.generateWebhooksComponent = generateWebhooksComponent;

module.exports = webhooksPlugin;
module.exports.webhooksPlugin = webhooksPlugin;
module.exports.WebhookDispatcher = WebhookDispatcher;
module.exports.generateSecret = generateSecret;
module.exports.safeCompare = safeCompare;
module.exports.signPayload = signPayload;
module.exports.verifySignature = verifySignature;
module.exports.matchEvent = matchEvent;
module.exports.matchesAnyEvent = matchesAnyEvent;
module.exports.normalizeEvents = normalizeEvents;
module.exports.sendWebhook = sendWebhook;
module.exports.generateDeliveryId = generateDeliveryId;
module.exports.generateWebhooksMigration = generateWebhooksMigration;
module.exports.createWebhookEndpointModel = createWebhookEndpointModel;
module.exports.createWebhookDeliveryModel = createWebhookDeliveryModel;
module.exports.createWebhookApiHandlers = createWebhookApiHandlers;
module.exports.generateWebhooksComponent = generateWebhooksComponent;
