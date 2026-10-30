/**
 * Unit & Integration Tests for Queue Admin API & Dashboard Features
 */

const express = require('express');
const request = require('supertest');
const knex = require('knex');
const { QueueManager } = require('../../../core/queue/manager');
const { MemoryQueueAdapter } = require('../../../core/queue/adapters/memory');
const { DatabaseQueueAdapter } = require('../../../core/queue/adapters/database');
const { createQueueServices } = require('../../../core/services/builtins/queue');
const { createQueueApiHandlers } = require('../../../plugins/queue/api-handlers');
const queuePlugin = require('../../../plugins/queue');

describe('Queue Dashboard & Admin API', () => {
  describe('MemoryQueueAdapter & QueueManager Job Operations', () => {
    let adapter;
    let manager;

    beforeEach(async () => {
      adapter = new MemoryQueueAdapter();
      manager = new QueueManager({ adapter, autoStart: false });
    });

    afterEach(async () => {
      await manager.drain(100);
    });

    it('reports pending and delayed metrics in getStats()', async () => {
      // 1 immediate pending job
      await manager.dispatch('email.send', { to: 'immediate@test.com' });

      // 1 delayed pending job
      await manager.dispatch('email.send', { to: 'delayed@test.com' }, { delay: 60000 });

      const stats = await manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.delayed).toBe(1);
    });

    it('lists jobs with filtering, pagination, and search', async () => {
      await manager.dispatch('email.send', { to: 'alex@example.com' });
      await manager.dispatch('report.generate', { format: 'pdf', title: 'Monthly Sales' });
      await manager.dispatch('cache.warm', { tag: 'products' });

      // List all
      const listAll = await manager.listJobs();
      expect(listAll.total).toBe(3);
      expect(listAll.jobs.length).toBe(3);

      // Filter by name
      const listByName = await manager.listJobs({ name: 'report.generate' });
      expect(listByName.total).toBe(1);
      expect(listByName.jobs[0].name).toBe('report.generate');

      // Search by payload keyword
      const searchRes = await manager.listJobs({ search: 'Monthly Sales' });
      expect(searchRes.total).toBe(1);
      expect(searchRes.jobs[0].name).toBe('report.generate');

      // Pagination
      const pageRes = await manager.listJobs({ limit: 2, page: 1 });
      expect(pageRes.jobs.length).toBe(2);
      expect(pageRes.totalPages).toBe(2);
    });

    it('retries single and bulk jobs', async () => {
      const job1 = await manager.dispatch('task.one', {});
      const job2 = await manager.dispatch('task.two', {});

      // Mark both failed
      await adapter.fail(job1.id, new Error('Test Failure 1'));
      await adapter.fail(job2.id, new Error('Test Failure 2'));

      let failedStats = await manager.getStats();
      expect(failedStats.failed).toBe(2);

      // Retry single
      const retried1 = await manager.retryJob(job1.id);
      expect(retried1.status).toBe('pending');
      expect(retried1.error).toBeNull();
      expect(retried1.attempts).toBe(0);

      // Bulk retry
      const bulkRes = await manager.bulkRetry([job2.id]);
      expect(bulkRes.retried).toBe(1);

      const statsAfter = await manager.getStats();
      expect(statsAfter.failed).toBe(0);
      expect(statsAfter.pending).toBe(2);
    });

    it('cancels/deletes a job by ID', async () => {
      const job = await manager.dispatch('cancel.me', {});
      expect((await manager.getStats()).total).toBe(1);

      const cancelRes = await manager.cancelJob(job.id);
      expect(cancelRes.success).toBe(true);
      expect((await manager.getStats()).total).toBe(0);
    });

    it('purges completed and failed jobs', async () => {
      const j1 = await manager.dispatch('j1', {});
      const j2 = await manager.dispatch('j2', {});
      const j3 = await manager.dispatch('j3', {});

      await adapter.complete(j1.id, { ok: true });
      await adapter.fail(j2.id, new Error('Boom'));

      const purgedCount = await manager.purgeJobs({ status: ['completed', 'failed'] });
      expect(purgedCount).toBe(2);

      const remaining = await manager.listJobs();
      expect(remaining.total).toBe(1);
      expect(remaining.jobs[0].id).toBe(j3.id);
    });
  });

  describe('DatabaseQueueAdapter Job Operations', () => {
    let db;
    let adapter;

    beforeAll(async () => {
      db = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      adapter = new DatabaseQueueAdapter({ knex: db, tableName: 'test_db_jobs' });
      await adapter.ensureTable();
    });

    afterAll(async () => {
      await db.destroy();
    });

    it('lists jobs with search and filtering from sqlite', async () => {
      const now = new Date();
      await adapter.enqueue({
        id: 'job-db-1',
        name: 'invoice.generate',
        data: { invoiceId: 1001, client: 'Acme Corp' },
        status: 'pending',
        runAt: now,
      });
      await adapter.enqueue({
        id: 'job-db-2',
        name: 'email.send',
        data: { to: 'bob@example.com' },
        status: 'pending',
        runAt: new Date(now.getTime() + 60000), // delayed
      });

      const stats = await adapter.getStats();
      expect(stats.total).toBe(2);
      expect(stats.delayed).toBe(1);

      const searchResult = await adapter.listJobs({ search: 'Acme' });
      expect(searchResult.total).toBe(1);
      expect(searchResult.jobs[0].name).toBe('invoice.generate');

      // Retry
      await adapter.fail('job-db-1', new Error('DB Error'));
      const retried = await adapter.retryJob('job-db-1');
      expect(retried.status).toBe('pending');
      expect(retried.error).toBeNull();

      // Cancel
      const cancelled = await adapter.cancelJob('job-db-2');
      expect(cancelled.success).toBe(true);
      expect((await adapter.getStats()).total).toBe(1);
    });
  });

  describe('Built-in Queue Services (createQueueServices)', () => {
    let manager;
    let services;

    beforeEach(() => {
      manager = new QueueManager({ adapter: new MemoryQueueAdapter(), autoStart: false });
      services = createQueueServices({ queueManager: manager });
    });

    afterEach(async () => {
      await manager.drain(50);
    });

    it('executes queue.dispatch, queue.stats, queue.list, and queue.retry services', async () => {
      // dispatch service
      const dispatched = await services['queue.dispatch'].handler({
        name: 'svc.job',
        data: { test: 123 },
        priority: 25,
      });
      expect(dispatched.id).toBeDefined();

      // stats service
      const stats = await services['queue.stats'].handler();
      expect(stats.total).toBe(1);

      // list service
      const list = await services['queue.list'].handler({});
      expect(list.total).toBe(1);
      expect(list.jobs[0].priority).toBe(25);

      // get service
      const fetched = await services['queue.get'].handler({ id: dispatched.id });
      expect(fetched.name).toBe('svc.job');

      // pause & resume services
      const pauseRes = await services['queue.pause'].handler();
      expect(pauseRes.isPaused).toBe(true);

      const resumeRes = await services['queue.resume'].handler();
      expect(resumeRes.isPaused).toBe(false);

      // cancel service
      const cancelRes = await services['queue.cancel'].handler({ id: dispatched.id });
      expect(cancelRes.success).toBe(true);
    });
  });

  describe('Queue Admin Express API Handlers', () => {
    let app;
    let manager;

    beforeAll(() => {
      app = express();
      app.use(express.json());

      manager = new QueueManager({ adapter: new MemoryQueueAdapter(), autoStart: false });
      manager.define('welcome.email', async (job) => ({ sent: true }));

      const handlers = createQueueApiHandlers(manager);

      app.get('/admin/queue/stats', handlers.getStatsHandler);
      app.get('/admin/queue/jobs', handlers.listJobsHandler);
      app.get('/admin/queue/jobs/:id', handlers.getJobHandler);
      app.post('/admin/queue/jobs/:id/retry', handlers.retryJobHandler);
      app.post('/admin/queue/jobs/bulk-retry', handlers.bulkRetryHandler);
      app.post('/admin/queue/jobs/:id/cancel', handlers.cancelJobHandler);
      app.post('/admin/queue/jobs/purge', handlers.purgeJobsHandler);
      app.post('/admin/queue/dispatch', handlers.dispatchJobHandler);
      app.post('/admin/queue/pause', handlers.pauseQueueHandler);
      app.post('/admin/queue/resume', handlers.resumeQueueHandler);
      app.get('/admin/queue/schedules', handlers.getSchedulesHandler);
      app.post('/admin/queue/schedules/:id/trigger', handlers.triggerScheduleHandler);
    });

    afterAll(async () => {
      await manager.drain(50);
    });

    it('GET /admin/queue/stats returns current stats', async () => {
      const res = await request(app).get('/admin/queue/stats').expect(200);
      expect(res.body.total).toBeDefined();
      expect(res.body.registeredJobs).toContain('welcome.email');
    });

    it('POST /admin/queue/dispatch enqueues a job', async () => {
      const res = await request(app)
        .post('/admin/queue/dispatch')
        .send({
          name: 'welcome.email',
          data: { email: 'admin@webspresso.io' },
          priority: 50,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.job.id).toBeDefined();

      const jobId = res.body.job.id;

      // GET /jobs/:id
      const getRes = await request(app)
        .get(`/admin/queue/jobs/${jobId}`)
        .expect(200);
      expect(getRes.body.id).toBe(jobId);

      // POST /jobs/:id/retry
      const retryRes = await request(app)
        .post(`/admin/queue/jobs/${jobId}/retry`)
        .expect(200);
      expect(retryRes.body.success).toBe(true);

      // POST /jobs/:id/cancel
      const cancelRes = await request(app)
        .post(`/admin/queue/jobs/${jobId}/cancel`)
        .expect(200);
      expect(cancelRes.body.success).toBe(true);
    });

    it('POST /admin/queue/pause and POST /admin/queue/resume toggle paused state', async () => {
      const pauseRes = await request(app)
        .post('/admin/queue/pause')
        .expect(200);
      expect(pauseRes.body.isPaused).toBe(true);

      const resumeRes = await request(app)
        .post('/admin/queue/resume')
        .expect(200);
      expect(resumeRes.body.isPaused).toBe(false);
    });
  });

  describe('Plugin Admin Registration Integration', () => {
    it('registers module with admin-panel and services with serviceRegistry', () => {
      const app = express();
      const mockRegisteredModules = [];
      const mockAdminApi = {
        registerModule: (mod) => {
          mockRegisteredModules.push(mod);
        },
      };

      const mockServices = new Map();
      const mockServiceRegistry = {
        has: (name) => mockServices.has(name),
        register: (name, def) => mockServices.set(name, def),
      };

      const plugin = queuePlugin({
        adapter: 'memory',
        autoStart: false,
      });

      const ctx = {
        app,
        serviceRegistry: mockServiceRegistry,
        usePlugin: (name) => (name === 'admin-panel' ? mockAdminApi : null),
      };

      plugin.register(ctx);
      plugin.onRoutesReady(ctx);

      // Check services registered
      expect(mockServices.has('queue.stats')).toBe(true);
      expect(mockServices.has('queue.dispatch')).toBe(true);
      expect(mockServices.has('queue.retry')).toBe(true);

      // Check admin module registered
      expect(mockRegisteredModules.length).toBe(1);
      expect(mockRegisteredModules[0].id).toBe('queue');
      expect(mockRegisteredModules[0].pages[0].path).toBe('/queue');
      expect(mockRegisteredModules[0].api.routes.length).toBeGreaterThan(5);
    });
  });
});
