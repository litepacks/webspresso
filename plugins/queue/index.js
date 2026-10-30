/**
 * Webspresso Background Job Queue Plugin
 * @module plugins/queue
 */

'use strict';

const path = require('path');
const fs = require('fs');
const {
  createQueueManager,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  RedisQueueAdapter,
  WaitUntilQueueAdapter,
  CloudflareQueueAdapter,
} = require('../../core/queue');

/**
 * @param {Object} [options]
 * @param {'memory'|'database'|'redis'|'wait-until'|'cloudflare'|Object} [options.adapter='memory'] - Queue backend adapter or name
 * @param {Object} [options.db] - Knex/ORM database instance for database adapter
 * @param {Object} [options.redisClient] - Redis client instance for redis adapter
 * @param {Object} [options.queue] - Cloudflare Queue binding for cloudflare adapter
 * @param {Function} [options.waitUntil] - Optional global waitUntil handler for wait-until adapter
 * @param {string} [options.tableName='webspresso_jobs'] - Database queue table name
 * @param {number} [options.concurrency=2] - Worker concurrency
 * @param {number} [options.pollInterval=500] - Idle poll interval in ms
 * @param {string} [options.jobsDir] - Path to jobs directory (defaults to <cwd>/jobs)
 * @param {boolean} [options.autoStart=true] - Auto start processing
 * @returns {Object} Plugin definition
 */
function queuePlugin(options = {}) {
  const concurrency = options.concurrency || 2;
  const pollInterval = options.pollInterval || 500;
  const autoStart = options.autoStart !== false;
  const jobsDir = options.jobsDir || path.join(process.cwd(), 'jobs');

  let queueManager = null;

  return {
    name: 'queue',
    version: '1.0.0',
    description: 'Background Job Queue Engine with Memory, DB, Redis, WaitUntil, and Cloudflare adapters',

    register(ctx) {
      const { app, db } = ctx;

      let adapter = options.adapter;

      if (!adapter || adapter === 'memory') {
        adapter = new MemoryQueueAdapter();
      } else if (adapter === 'wait-until' || adapter === 'edge') {
        adapter = new WaitUntilQueueAdapter({
          waitUntil: options.waitUntil,
        });
      } else if (adapter === 'cloudflare' || adapter === 'cf') {
        const cfQueue = options.queue || options.cfQueue;
        if (!cfQueue) {
          throw new Error('[queuePlugin] Cloudflare queue adapter requires a valid queue binding in options.queue.');
        }
        adapter = new CloudflareQueueAdapter({
          queue: cfQueue,
        });
      } else if (adapter === 'database' || adapter === 'db') {
        const knexInstance = options.db?.knex || db?.knex || options.knex;
        if (!knexInstance) {
          throw new Error('[queuePlugin] Database queue adapter requires a valid database/knex instance.');
        }
        adapter = new DatabaseQueueAdapter({
          knex: knexInstance,
          tableName: options.tableName || 'webspresso_jobs',
        });
      } else if (adapter === 'redis') {
        const client = options.redisClient || options.redis;
        if (!client) {
          throw new Error('[queuePlugin] Redis queue adapter requires a valid redisClient in options.');
        }
        adapter = new RedisQueueAdapter({
          client,
          prefix: options.prefix,
        });
      }

      queueManager = createQueueManager({
        adapter,
        concurrency,
        pollInterval,
        jobsDir,
        autoStart,
        retention: options.retention,
        retentionDays: options.retentionDays,
        retentionStatuses: options.retentionStatuses,
        cleanupIntervalMs: options.cleanupIntervalMs,
        autoCleanup: options.autoCleanup,
        cleanupOnStart: options.cleanupOnStart,
      });

      // Expose to ctx & app
      ctx.queue = queueManager;
      if (app) {
        app.queue = queueManager;
        app.set('webspresso.queue', queueManager);

        // Attach req.queue middleware
        app.use((req, res, next) => {
          req.queue = queueManager;
          next();
        });
      }

      // Register built-in queue services if service registry is available
      const registry = ctx.serviceRegistry || ctx.services || ctx.app?.serviceRegistry;
      if (registry && typeof registry.register === 'function') {
        try {
          const { createQueueServices } = require('../../core/services/builtins/queue');
          const services = createQueueServices({ queueManager });
          for (const [name, def] of Object.entries(services)) {
            if (!registry.has(name)) {
              registry.register(name, def);
            }
          }
        } catch (svcErr) {
          console.warn('[queuePlugin] Failed to register built-in queue services:', svcErr.message);
        }
      }

      this.queue = queueManager;
    },

    api: {
      getQueueManager: () => queueManager,
      clean: (opts) => queueManager?.clean(opts),
      schedule: (expr, name, data, opts) => queueManager?.schedule(expr, name, data, opts),
      cron: (expr, name, data, opts) => queueManager?.cron(expr, name, data, opts),
      unschedule: (idOrName) => queueManager?.unschedule(idOrName),
      getSchedules: () => queueManager?.getSchedules() || [],
    },

    onRoutesReady(ctx) {
      if (jobsDir && fs.existsSync(jobsDir)) {
        queueManager.loadJobsFromDirectory(jobsDir);
      }

      // Check if admin-panel plugin is active
      const adminApi = ctx.usePlugin ? ctx.usePlugin('admin-panel') : null;
      if (adminApi && typeof adminApi.registerModule === 'function') {
        const { createQueueApiHandlers } = require('./api-handlers');
        const { generateQueueComponent } = require('./admin-component');

        const pageTitle = options.adminTitle || 'Job Queue';
        const apiPrefix = options.adminApiPrefix || '/queue';
        const menuOrder = options.menuOrder !== undefined ? options.menuOrder : 55;
        const apiHandlers = createQueueApiHandlers(queueManager, options);

        adminApi.registerModule({
          id: 'queue',
          title: pageTitle,
          pages: [
            {
              id: 'queue',
              title: pageTitle,
              path: '/queue',
              icon: 'clock',
              component: generateQueueComponent({ apiPrefix }),
            },
          ],
          menu: [
            {
              id: 'queue',
              label: pageTitle,
              path: '/queue',
              icon: 'clock',
              order: menuOrder,
            },
          ],
          api: {
            prefix: apiPrefix,
            routes: [
              { method: 'get', path: '/stats', handler: apiHandlers.getStatsHandler },
              { method: 'get', path: '/jobs', handler: apiHandlers.listJobsHandler },
              { method: 'get', path: '/jobs/:id', handler: apiHandlers.getJobHandler },
              { method: 'post', path: '/jobs/:id/retry', handler: apiHandlers.retryJobHandler },
              { method: 'post', path: '/jobs/bulk-retry', handler: apiHandlers.bulkRetryHandler },
              { method: 'post', path: '/jobs/:id/cancel', handler: apiHandlers.cancelJobHandler },
              { method: 'delete', path: '/jobs/:id', handler: apiHandlers.cancelJobHandler },
              { method: 'post', path: '/jobs/purge', handler: apiHandlers.purgeJobsHandler },
              { method: 'post', path: '/dispatch', handler: apiHandlers.dispatchJobHandler },
              { method: 'post', path: '/pause', handler: apiHandlers.pauseQueueHandler },
              { method: 'post', path: '/resume', handler: apiHandlers.resumeQueueHandler },
              { method: 'get', path: '/schedules', handler: apiHandlers.getSchedulesHandler },
              { method: 'post', path: '/schedules/:id/trigger', handler: apiHandlers.triggerScheduleHandler },
            ],
          },
        });
      }
    },

    async dispose() {
      if (queueManager) {
        await queueManager.drain(5000);
      }
    },
  };
}

module.exports = queuePlugin;
module.exports.queuePlugin = queuePlugin;
