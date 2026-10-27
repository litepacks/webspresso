import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import supertest from 'supertest';
import { createApp } from '../../../src/server';
import { getQueue, hasQueue, resetAppContext } from '../../../core/context/app-context';
import { createQueueManager } from '../../../core/queue';

describe('Background Queue Auto-Discovery & Context Integration (Item #6)', () => {
  const tmpDir = path.join(process.cwd(), '.tmp-queue-test-' + Date.now());
  const jobsDir = path.join(tmpDir, 'jobs');

  beforeEach(() => {
    resetAppContext();
    fs.mkdirSync(jobsDir, { recursive: true });
    // Create dummy job file
    fs.writeFileSync(
      path.join(jobsDir, 'send-welcome.js'),
      `
      module.exports = async function(job, ctx) {
        return { delivered: true, to: job.data.email };
      };
      `
    );
  });

  afterEach(() => {
    resetAppContext();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('automatically discovers jobs/ directory, exposes app.queue, req.queue, and registers handlers', async () => {
    const { app, shutdownManager } = createApp({
      rootDir: tmpDir,
      pages: 'tests/fixtures/pages-basic',
      queueAutoStart: true,
    });

    expect(app.queue).toBeDefined();
    expect(hasQueue()).toBe(true);
    expect(getQueue()).toBe(app.queue);
    expect(app.queue.handlers.has('send-welcome')).toBe(true);

    app.post('/api/trigger-job', async (req, res) => {
      expect(req.queue).toBe(app.queue);
      expect(req.context.queue).toBe(app.queue);

      const job = await req.queue.dispatch('send-welcome', { email: 'user@example.com' });
      res.json({ queued: true, jobId: job.id, jobName: job.name });
    });

    const client = supertest(app);
    const res = await client.post('/api/trigger-job').expect(200);

    expect(res.body.queued).toBe(true);
    expect(res.body.jobName).toBe('send-welcome');

    // Wait briefly for in-memory worker to process
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Drain & clean up
    await app.queue.drain(500);
  });

  it('respects options.queue: false to explicitly disable queue even if jobs/ exists', async () => {
    const { app } = createApp({
      rootDir: tmpDir,
      pages: 'tests/fixtures/pages-basic',
      queue: false,
    });

    expect(app.queue).toBeUndefined();
    expect(hasQueue()).toBe(false);
    expect(getQueue()).toBeNull();

    app.get('/api/test-no-queue', (req, res) => {
      res.json({
        reqQueuePresent: Boolean(req.queue),
        contextQueuePresent: Boolean(req.context?.queue),
      });
    });

    const client = supertest(app);
    const res = await client.get('/api/test-no-queue').expect(200);
    expect(res.body.reqQueuePresent).toBe(false);
    expect(res.body.contextQueuePresent).toBe(false);
  });

  it('accepts options.queue as a configuration object', async () => {
    const { app } = createApp({
      rootDir: tmpDir,
      pages: 'tests/fixtures/pages-basic',
      queue: {
        concurrency: 5,
        pollInterval: 100,
        autoStart: false,
      },
    });

    expect(app.queue).toBeDefined();
    expect(app.queue.concurrency).toBe(5);
    expect(app.queue.pollInterval).toBe(100);
    expect(app.queue.isRunning).toBe(false); // autoStart: false
  });

  it('bridges events with auto-discovered queue via events.listenAndQueue()', async () => {
    const { app, events } = createApp({
      rootDir: tmpDir,
      pages: 'tests/fixtures/pages-basic',
      queueAutoStart: true,
    });

    const dispatchSpy = vi.spyOn(app.queue, 'dispatch');

    events.listenAndQueue('user.registered', 'send-welcome');

    await events.dispatch('user.registered', { email: 'newuser@domain.com' });

    expect(dispatchSpy).toHaveBeenCalledWith(
      'send-welcome',
      { email: 'newuser@domain.com' },
      expect.any(Object)
    );

    await app.queue.drain(500);
  });
});
