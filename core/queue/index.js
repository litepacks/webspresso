/**
 * Webspresso Core Background Job Queue Engine
 * @module core/queue
 */

'use strict';

const { Job } = require('./job');
const { QueueManager, createQueueManager } = require('./manager');
const { MemoryQueueAdapter } = require('./adapters/memory');
const { DatabaseQueueAdapter } = require('./adapters/database');
const { RedisQueueAdapter } = require('./adapters/redis');

module.exports = {
  Job,
  QueueManager,
  createQueueManager,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  RedisQueueAdapter,
};
