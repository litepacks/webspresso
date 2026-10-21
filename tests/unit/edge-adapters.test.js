'use strict';

/**
 * Upper-Layer Edge Support & Adapters Tests
 * Tests WaitUntilQueueAdapter, CloudflareQueueAdapter, createKvSessionTracker, and CLI generators
 */

const {
  WaitUntilQueueAdapter,
  CloudflareQueueAdapter,
  QueueManager,
  createQueueManager,
  Job,
} = require('../../core/queue');
const { createKvSessionTracker } = require('../../core/auth');
const {
  generateWranglerToml,
  generateWorkerJs,
} = require('../../bin/commands/add-cloudflare');

describe('WaitUntilQueueAdapter (core/queue/adapters/wait-until)', () => {
  it('enqueues jobs and tracks them in memory', async () => {
    const adapter = new WaitUntilQueueAdapter();
    const job = new Job({ name: 'test.job', data: { foo: 'bar' } });

    const enqueued = await adapter.enqueue(job);
    expect(enqueued.name).toBe('test.job');
    expect(adapter.jobs.has(enqueued.id)).toBe(true);
  });

  it('invokes waitUntil handler when scheduling background tasks', async () => {
    let capturedPromise = null;
    const adapter = new WaitUntilQueueAdapter({
      waitUntil: (promise) => {
        capturedPromise = promise;
      },
    });

    const testPromise = Promise.resolve('ok');
    adapter.scheduleBackground(testPromise);

    expect(capturedPromise).toBe(testPromise);
    await capturedPromise;
  });

  it('evicts completed jobs when maxRetainedJobs is reached', async () => {
    const adapter = new WaitUntilQueueAdapter({ maxRetainedJobs: 3 });

    for (let i = 1; i <= 5; i++) {
      const job = new Job({ id: i, name: `job.${i}`, data: {} });
      job.status = 'completed';
      await adapter.enqueue(job);
    }

    // Should have pruned completed jobs to maintain bounded memory
    expect(adapter.jobs.size).toBeLessThanOrEqual(5);
  });
});

describe('CloudflareQueueAdapter (core/queue/adapters/cloudflare)', () => {
  it('fails fast if queue binding is missing', () => {
    expect(() => new CloudflareQueueAdapter({})).toThrow(/Requires a valid Cloudflare Queue binding/);
  });

  it('sends job messages via queue.send()', async () => {
    const sentMessages = [];
    const mockQueue = {
      send: async (msg, opts) => {
        sentMessages.push({ msg, opts });
      },
    };

    const adapter = new CloudflareQueueAdapter({ queue: mockQueue });
    const job = new Job({ name: 'email.welcome', data: { email: 'user@test.com' } });

    await adapter.enqueue(job);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].msg.name).toBe('email.welcome');
    expect(sentMessages[0].msg.data.email).toBe('user@test.com');
  });

  it('processes incoming batches and acks successful messages', async () => {
    const mockQueue = { send: async () => {} };
    const adapter = new CloudflareQueueAdapter({ queue: mockQueue });

    const qm = new QueueManager({ autoStart: false });
    let jobExecuted = false;

    qm.define('email.welcome', async (job) => {
      expect(job.data.email).toBe('test@example.com');
      jobExecuted = true;
      return { sent: true };
    });

    let ackCalled = false;
    const batch = {
      messages: [
        {
          id: 'msg-1',
          body: { name: 'email.welcome', data: { email: 'test@example.com' } },
          ack: () => { ackCalled = true; },
          retry: () => {},
        },
      ],
    };

    const res = await adapter.processBatch(batch, qm);
    expect(res.processed).toBe(1);
    expect(jobExecuted).toBe(true);
    expect(ackCalled).toBe(true);
  });

  it('retries failed messages on error', async () => {
    const mockQueue = { send: async () => {} };
    const adapter = new CloudflareQueueAdapter({ queue: mockQueue });

    const qm = new QueueManager({ autoStart: false });
    qm.define('fail.job', async () => {
      throw new Error('Simulated worker crash');
    });

    let retryCalled = false;
    const batch = {
      messages: [
        {
          id: 'msg-err',
          body: { name: 'fail.job', data: {} },
          ack: () => {},
          retry: () => { retryCalled = true; },
        },
      ],
    };

    const res = await adapter.processBatch(batch, qm);
    expect(res.failed).toBe(1);
    expect(retryCalled).toBe(true);
  });
});

describe('createKvSessionTracker (core/auth/sessions)', () => {
  it('stores, validates, lists, and revokes sessions in KV', async () => {
    const store = new Map();
    const mockKv = {
      get: async (k) => store.get(k) || null,
      put: async (k, v) => store.set(k, v),
      delete: async (k) => store.delete(k),
      list: async ({ prefix }) => ({
        keys: Array.from(store.keys()).filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      }),
    };

    const tracker = createKvSessionTracker(mockKv, { prefix: 'test_sess:' });

    // 1. Track session
    const tracked = await tracker.track('sess-100', 42, {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      ip: '192.168.1.1',
    });
    expect(tracked).toBeDefined();
    expect(tracked.user_id).toBe(42);

    // 2. Validate session
    const isValid = await tracker.validate('sess-100', 42);
    expect(isValid).toBe(true);

    const isWrongUser = await tracker.validate('sess-100', 999);
    expect(isWrongUser).toBe(false);

    // 3. List user sessions
    const sessions = await tracker.listUserSessions(42);
    expect(sessions.length).toBe(1);
    expect(sessions[0].session_id).toBe('sess-100');

    // 4. Revoke session
    await tracker.revoke('sess-100');
    const isValidAfterRevoke = await tracker.validate('sess-100', 42);
    expect(isValidAfterRevoke).toBe(false);
  });
});

describe('add:cloudflare CLI Generators (bin/commands/add-cloudflare)', () => {
  it('generates compliant wrangler.toml', () => {
    const toml = generateWranglerToml({
      appName: 'my-edge-app',
      d1: true,
      kv: true,
      queue: true,
      assets: true,
    });

    expect(toml).toContain('name = "my-edge-app"');
    expect(toml).toContain('compatibility_flags = ["nodejs_compat"]');
    expect(toml).toContain('[[d1_databases]]');
    expect(toml).toContain('database_name = "my-edge-app-db"');
    expect(toml).toContain('[[kv_namespaces]]');
    expect(toml).toContain('binding = "SESSIONS"');
    expect(toml).toContain('[[queues.producers]]');
    expect(toml).toContain('[assets]');
  });

  it('generates worker.js bridge entry point with Hono adapter', () => {
    const workerJs = generateWorkerJs({ d1: true, queue: true });

    expect(workerJs).toContain("adapter: 'hono'");
    expect(workerJs).toContain("createDatabase({ client: 'd1'");
    expect(workerJs).toContain('ctx.waitUntil(promise)');
    expect(workerJs).toContain('async queue(batch, env, ctx)');
  });
});
