/**
 * Built-in Queue Services
 * @module core/services/builtins/queue
 */

'use strict';

const { z } = require('zod');

/**
 * Create built-in queue services map
 * 
 * @param {Object} options
 * @param {import('../../queue/manager').QueueManager} options.queueManager
 * @returns {Record<string, Object>}
 */
function createQueueServices(options = {}) {
  const queueManager = options.queueManager || options.queue;

  if (!queueManager) {
    throw new Error('queueManager instance is required for createQueueServices');
  }

  return {
    'queue.stats': {
      schema: z.object({}).optional(),
      async handler() {
        return queueManager.getStats();
      },
    },

    'queue.list': {
      schema: z.object({
        status: z.string().optional(),
        name: z.string().optional(),
        search: z.string().optional(),
        page: z.number().optional(),
        limit: z.number().optional(),
        sortBy: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
      }).optional(),
      async handler(input = {}) {
        return queueManager.listJobs(input || {});
      },
    },

    'queue.get': {
      schema: z.object({
        id: z.union([z.string(), z.number()]),
      }),
      async handler(input) {
        return queueManager.getJob(input.id);
      },
    },

    'queue.retry': {
      schema: z.object({
        id: z.union([z.string(), z.number()]),
        delayMs: z.number().optional(),
        resetAttempts: z.boolean().optional(),
      }),
      async handler(input) {
        return queueManager.retryJob(input.id, input);
      },
    },

    'queue.bulk-retry': {
      schema: z.object({
        ids: z.array(z.union([z.string(), z.number()])),
        delayMs: z.number().optional(),
        resetAttempts: z.boolean().optional(),
      }),
      async handler(input) {
        return queueManager.bulkRetry(input.ids, input);
      },
    },

    'queue.cancel': {
      schema: z.object({
        id: z.union([z.string(), z.number()]),
      }),
      async handler(input) {
        return queueManager.cancelJob(input.id);
      },
    },

    'queue.clean': {
      schema: z.object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
        days: z.number().optional(),
        limit: z.number().optional(),
      }).optional(),
      async handler(input = {}) {
        return queueManager.clean(input || {});
      },
    },

    'queue.purge': {
      schema: z.object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
      }).optional(),
      async handler(input = {}) {
        return queueManager.purgeJobs(input || {});
      },
    },

    'queue.dispatch': {
      schema: z.object({
        name: z.string().min(1, 'Job name is required'),
        data: z.any().optional(),
        delay: z.union([z.number(), z.string()]).optional(),
        delayMs: z.number().optional(),
        priority: z.number().optional(),
        attempts: z.number().optional(),
        timeout: z.union([z.number(), z.string()]).optional(),
        backoff: z.any().optional(),
      }),
      async handler(input) {
        const { name, data, ...opts } = input;
        return queueManager.dispatch(name, data || {}, opts);
      },
    },

    'queue.pause': {
      schema: z.object({}).optional(),
      async handler() {
        queueManager.pause();
        return { paused: true, isPaused: queueManager.isPaused };
      },
    },

    'queue.resume': {
      schema: z.object({}).optional(),
      async handler() {
        queueManager.resume();
        return { resumed: true, isPaused: queueManager.isPaused };
      },
    },
  };
}

module.exports = {
  createQueueServices,
};
