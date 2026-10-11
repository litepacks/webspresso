/**
 * Unit tests for Queue retention and clean()
 */

const knex = require('knex');
const {
  Job,
  MemoryQueueAdapter,
  DatabaseQueueAdapter,
  QueueManager,
  createQueueManager,
} = require('../../../core/queue');

describe('Queue clean() and retention', () => {
  describe('MemoryQueueAdapter.clean()', () => {
    let adapter;

    beforeEach(() => {
      adapter = new MemoryQueueAdapter();
    });

    it('cleans completed jobs older than cutoff date', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      const jobOld = new Job({ name: 'old.job', status: 'completed' });
      jobOld.updatedAt = oldDate;
      await adapter.enqueue(jobOld);

      const jobRecent = new Job({ name: 'recent.job', status: 'completed' });
      jobRecent.updatedAt = recentDate;
      await adapter.enqueue(jobRecent);

      const jobPending = new Job({ name: 'pending.job', status: 'pending' });
      jobPending.updatedAt = oldDate;
      await adapter.enqueue(jobPending);

      // Clean completed jobs older than 5 days
      const deleted = await adapter.clean({ days: 5, status: 'completed' });
      expect(deleted).toBe(1);

      expect(await adapter.getJob(jobOld.id)).toBeNull();
      expect(await adapter.getJob(jobRecent.id)).not.toBeNull();
      expect(await adapter.getJob(jobPending.id)).not.toBeNull();
    });

    it('cleans failed jobs when requested', async () => {
      const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

      const jobFailed = new Job({ name: 'failed.job', status: 'failed' });
      jobFailed.updatedAt = oldDate;
      await adapter.enqueue(jobFailed);

      const deleted = await adapter.clean({ days: 7, status: ['failed'] });
      expect(deleted).toBe(1);
      expect(await adapter.getJob(jobFailed.id)).toBeNull();
    });
  });

  describe('DatabaseQueueAdapter.clean()', () => {
    let db;
    let adapter;

    beforeAll(async () => {
      db = knex({
        client: 'better-sqlite3',
        connection: {
          filename: ':memory:',
        },
        useNullAsDefault: true,
      });

      adapter = new DatabaseQueueAdapter({ knex: db, tableName: 'test_clean_jobs' });
      await adapter.ensureTable();
    });

    afterAll(async () => {
      await db.destroy();
    });

    beforeEach(async () => {
      await adapter.clear();
    });

    it('cleans completed jobs older than retention window in database', async () => {
      const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const jobOld = new Job({ name: 'db.old', status: 'completed' });
      jobOld.updatedAt = oldDate;
      jobOld.createdAt = oldDate;
      await adapter.enqueue(jobOld);

      const jobRecent = new Job({ name: 'db.recent', status: 'completed' });
      jobRecent.updatedAt = recentDate;
      jobRecent.createdAt = recentDate;
      await adapter.enqueue(jobRecent);

      const jobPending = new Job({ name: 'db.pending', status: 'pending' });
      jobPending.updatedAt = oldDate;
      jobPending.createdAt = oldDate;
      await adapter.enqueue(jobPending);

      const deleted = await adapter.clean({ days: 7, status: ['completed'] });
      expect(deleted).toBe(1);

      expect(await adapter.getJob(jobOld.id)).toBeNull();
      expect(await adapter.getJob(jobRecent.id)).not.toBeNull();
      expect(await adapter.getJob(jobPending.id)).not.toBeNull();
    });

    it('supports limit parameter', async () => {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      for (let i = 0; i < 5; i++) {
        const job = new Job({ name: `job.${i}`, status: 'completed' });
        job.updatedAt = oldDate;
        job.createdAt = oldDate;
        await adapter.enqueue(job);
      }

      const deleted = await adapter.clean({ days: 7, limit: 3 });
      expect(deleted).toBe(3);

      const stats = await adapter.getStats();
      expect(stats.completed).toBe(2);
    });
  });

  describe('QueueManager clean() and retention config', () => {
    it('delegates clean() to adapter and manages retention lifecycle', async () => {
      const memoryAdapter = new MemoryQueueAdapter();
      const manager = createQueueManager({
        adapter: memoryAdapter,
        autoStart: false,
        retentionDays: 14,
        cleanupIntervalMs: 5000,
        autoCleanup: true,
      });

      const config = manager.getRetentionConfig();
      expect(config.enabled).toBe(true);
      expect(config.days).toBe(14);
      expect(config.intervalMs).toBe(5000);

      const oldDate = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
      const job = new Job({ name: 'mgr.clean', status: 'completed' });
      job.updatedAt = oldDate;
      await memoryAdapter.enqueue(job);

      const deleted = await manager.clean({ days: 14 });
      expect(deleted).toBe(1);

      await manager.stop();
    });

    it('registers queue:prune command on commander program', () => {
      const { registerCommand } = require('../../../bin/commands/queue-prune');
      const commands = [];
      const mockProgram = {
        command: (name) => {
          const cmd = {
            name,
            description: () => cmd,
            option: () => cmd,
            action: () => cmd,
          };
          commands.push(name);
          return cmd;
        },
      };

      registerCommand(mockProgram);
      expect(commands).toContain('queue:prune');
    });
  });
});
