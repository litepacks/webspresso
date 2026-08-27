# Webspresso Background Job Queue Guide

Webspresso features a high-performance, zero-dependency background job queue engine (`core/queue`) and plugin (`plugins/queue`), supporting In-Memory, Knex Database, and Distributed Redis adapters, automatic retries with exponential backoff, priority scheduling, and graceful shutdown draining.

---

## 1. Quick Start

### Basic Usage with `core/queue`
```js
const { createQueueManager } = require('webspresso/core/queue');

const queue = createQueueManager({
  concurrency: 4,
  pollInterval: 200,
});

// 1. Define job handler
queue.define('email.send', async (job, ctx) => {
  const { to, subject, body } = job.data;
  job.progress(20, 'Preparing template');
  // ... send email ...
  job.progress(100, 'Sent');
  return { delivered: true };
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  timeout: 10000,
  priority: 20,
});

// 2. Dispatch job
await queue.dispatch('email.send', {
  to: 'user@example.com',
  subject: 'Welcome!',
}, {
  priority: 50,
  delay: 5000, // delay 5 seconds
});
```

---

## 2. Using the Plugin (`plugins/queue`)

```js
const { createApp, queuePlugin } = require('webspresso');

const app = createApp({
  plugins: [
    queuePlugin({
      adapter: 'memory', // 'memory' | 'database' | 'redis'
      concurrency: 4,
      jobsDir: './jobs', // Auto-discovers jobs/ directory
    }),
  ],
});

// In Express route handlers:
app.post('/api/export', async (req, res) => {
  const job = await req.queue.dispatch('export.users', { format: 'csv' });
  res.json({ jobId: job.id, status: job.status });
});
```

---

## 3. Adapters

### 1. `MemoryQueueAdapter` (Default)
Zero-dependency in-memory priority queue. Ideal for lightweight background tasks, single-process apps, and development.

### 2. `DatabaseQueueAdapter`
Persistent queue backed by Knex database table (`webspresso_jobs`) supporting SQLite, PostgreSQL, and MySQL with row-level locking.

```js
queuePlugin({
  adapter: 'database',
  db: appDb,
  tableName: 'webspresso_jobs',
});
```

### 3. `RedisQueueAdapter`
Distributed queue backed by Redis for multi-instance PM2/Kubernetes cluster deployments.

```js
queuePlugin({
  adapter: 'redis',
  redisClient: redis,
  prefix: 'app:queue:',
});
```

---

## 4. File-Based Auto-Discovery (`jobs/`)

Files placed in `jobs/` are automatically mapped to dot-separated job names:
- `jobs/email/send.js` → `'email.send'`
- `jobs/user-report.js` → `'user-report'`

```js
// jobs/email/send.js
module.exports = async function(job, ctx) {
  // job.data
};

module.exports.options = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
};
```
