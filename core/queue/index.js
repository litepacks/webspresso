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
const { WaitUntilQueueAdapter } = require('./adapters/wait-until');
const { CloudflareQueueAdapter } = require('./adapters/cloudflare');
const { SqsQueueAdapter } = require('./adapters/sqs');
const { PubSubQueueAdapter } = require('./adapters/pubsub');
const { CronExpression, isValidCron, parseCron, resolveCronAlias } = require('./cron');
const { TaskScheduler } = require('./scheduler');

module.exports = {
  Job,
  QueueManager,
  createQueueManager,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  RedisQueueAdapter,
  WaitUntilQueueAdapter,
  CloudflareQueueAdapter,
  SqsQueueAdapter,
  PubSubQueueAdapter,
  CronExpression,
  isValidCron,
  parseCron,
  resolveCronAlias,
  TaskScheduler,
};
