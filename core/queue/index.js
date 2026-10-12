/**
 * Webspresso Core Background Job Queue & Task Scheduler Engine
 * @module core/queue
 */

'use strict';

const { Job } = require('./job');
const { QueueManager, createQueueManager } = require('./manager');
const { MemoryQueueAdapter } = require('./adapters/memory');
const { DatabaseQueueAdapter } = require('./adapters/database');
const { RedisQueueAdapter } = require('./adapters/redis');
const { CronExpression, isValidCron, parseCron, resolveCronAlias } = require('./cron');
const { TaskScheduler } = require('./scheduler');

module.exports = {
  Job,
  QueueManager,
  createQueueManager,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  RedisQueueAdapter,
  CronExpression,
  isValidCron,
  parseCron,
  resolveCronAlias,
  TaskScheduler,
};
