/**
 * Built-in Webhook Dispatcher Services
 * @module core/services/builtins/webhook
 */

'use strict';

const { z } = require('zod');

/**
 * Create built-in webhook services map
 * 
 * @param {Object} options
 * @param {import('../../../plugins/webhooks/dispatcher').WebhookDispatcher} options.dispatcher
 * @returns {Record<string, Object>}
 */
function createWebhookServices(options = {}) {
  const { dispatcher } = options;

  if (!dispatcher) {
    throw new Error('dispatcher instance is required for createWebhookServices');
  }

  return {
    'webhook.dispatch': {
      schema: z.object({
        event: z.string().min(1, 'Event name is required'),
        payload: z.any().optional(),
        endpointId: z.union([z.number(), z.string()]).optional(),
      }),
      async handler(input) {
        return dispatcher.dispatch(input.event, input.payload, input);
      },
    },

    'webhook.ping': {
      schema: z.object({
        endpointId: z.union([z.number(), z.string()]),
        payload: z.any().optional(),
        event: z.string().optional(),
      }),
      async handler(input) {
        return dispatcher.pingEndpoint(input.endpointId, input);
      },
    },

    'webhook.test': {
      schema: z.object({
        endpointId: z.union([z.number(), z.string()]),
        event: z.string().optional(),
        payload: z.any().optional(),
        headers: z.record(z.any()).optional(),
      }),
      async handler(input) {
        return dispatcher.testEndpoint(input.endpointId, input);
      },
    },

    'webhook.retry': {
      schema: z.object({
        deliveryId: z.union([z.number(), z.string()]),
      }),
      async handler(input) {
        return dispatcher.retryDelivery(input.deliveryId);
      },
    },

    'webhook.replay': {
      schema: z.object({
        deliveryId: z.union([z.number(), z.string()]),
        event: z.string().optional(),
        payload: z.any().optional(),
        endpointId: z.union([z.number(), z.string()]).optional(),
      }),
      async handler(input) {
        return dispatcher.replayDelivery(input.deliveryId, input);
      },
    },

    'webhook.rotate-secret': {
      schema: z.object({
        endpointId: z.union([z.number(), z.string()]),
        prefix: z.string().optional(),
      }),
      async handler(input) {
        return dispatcher.rotateSecret(input.endpointId, input);
      },
    },

    'webhook.bulk-retry': {
      schema: z.object({
        deliveryIds: z.array(z.union([z.number(), z.string()])),
      }),
      async handler(input) {
        return dispatcher.bulkRetryDeliveries(input.deliveryIds);
      },
    },

    'webhook.get-stats': {
      schema: z.object({}).optional(),
      async handler() {
        return dispatcher.getStats();
      },
    },
  };
}

module.exports = {
  createWebhookServices,
};
