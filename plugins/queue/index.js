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
