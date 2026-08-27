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
} = require('../../core/queue');

/**
 * @param {Object} [options]
 * @param {'memory'|'database'|'redis'|Object} [options.adapter='memory'] - Queue backend adapter or name
 * @param {Object} [options.db] - Knex/ORM database instance for database adapter
 * @param {Object} [options.redisClient] - Redis client instance for redis adapter
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
    description: 'Background Job Queue Engine with Memory, DB, and Redis adapters',

    register(ctx) {
      const { app, db } = ctx;

      let adapter = options.adapter;

      if (!adapter || adapter === 'memory') {
        adapter = new MemoryQueueAdapter();
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
