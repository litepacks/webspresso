# Webspresso Background Job Queue Guide

Webspresso features a high-performance background job queue engine (`core/queue`) and plugin (`plugins/queue`), supporting In-Memory, Knex Database, and Distributed Redis adapters, automatic retries with exponential backoff, priority scheduling, and graceful shutdown draining.

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
Built-in in-memory priority queue. Ideal for lightweight background tasks, single-process apps, and development.

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

### 4. `SqsQueueAdapter` (AWS SQS)
Native AWS SQS adapter powered by standard Node.js HTTP and AWS SigV4 request signing. Supports long-polling worker loops (`dequeue`), direct enqueue with delay seconds calculation, and AWS Lambda push batch execution (`processBatch`).

```js
const { SqsQueueAdapter } = require('webspresso');

// Worker daemon or long-polling runner:
const adapter = new SqsQueueAdapter({
  queueUrl: process.env.AWS_SQS_QUEUE_URL,
  region: process.env.AWS_REGION || 'us-east-1',
  waitTimeSeconds: 10,
  visibilityTimeout: 30,
});

// AWS Lambda SQS Event Handler:
exports.handler = async (event) => {
  return adapter.processBatch(event.Records, queueManager);
};
```

### 5. `PubSubQueueAdapter` (Google Cloud Pub/Sub)
Native Google Cloud Pub/Sub adapter using standard REST API (`:publish`, `:pull`, `:acknowledge`, `:modifyAckDeadline`) with base64 payload serialization. Supports both background pull workers and Cloud Run / App Engine Push Subscription HTTP webhooks (`processPushRequest`).

```js
const { PubSubQueueAdapter } = require('webspresso');

const adapter = new PubSubQueueAdapter({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  topic: 'app-jobs',
  subscription: 'app-jobs-sub',
});

// Cloud Run Push Subscription Webhook Route:
app.post('/api/queue/push', async (req, res) => {
  await adapter.processPushRequest(req, res, req.queue);
});
```

### 6. `WaitUntilQueueAdapter` & `CloudflareQueueAdapter`
- `WaitUntilQueueAdapter`: Serverless & Edge execution (Cloudflare Workers `ctx.waitUntil`, Vercel Edge).
- `CloudflareQueueAdapter`: Cloudflare Queues integration (`env.MY_QUEUE.send`).

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

---

## 5. Job Retention & Pruning

To prevent the queue database table or memory cache from accumulating indefinitely:

### 1. Auto-Retention in `createQueueManager` / `queuePlugin`
```js
queuePlugin({
  adapter: 'database',
  db: appDb,
  retentionDays: 7, // Keep completed jobs for 7 days
  cleanupIntervalMs: 24 * 60 * 60 * 1000, // Run every 24h
  autoCleanup: true,
  retentionStatuses: ['completed'], // or ['completed', 'failed']
});
```

### 2. Programmatic `clean()`
```js
// Delete completed jobs older than 7 days
const deletedCount = await queue.clean({
  days: 7,
  status: ['completed'], // or 'failed', or ['completed', 'failed']
});

// Or with an explicit cutoff date:
await queue.clean({
  olderThan: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  status: 'failed',
});
```

### 3. CLI Command: `queue:prune`
```bash
# Delete completed jobs older than 7 days
webspresso queue:prune --days 7

# Delete both completed and failed jobs older than 14 days
webspresso queue:prune --days 14 --status completed,failed
```

---

## 6. Cron & Recurring Task Scheduler

Webspresso includes a native task scheduler with a POSIX-compliant 5-field cron parser (`core/queue/cron.js` & `core/queue/scheduler.js`).

### 1. Cron Expression Syntax
- Standard 5 fields: `minute hour day-of-month month day-of-week`
- Wildcards: `*`, `?` (supported in day-of-month and day-of-week)
- Steps & Offsets: `*/5`, `10/15` (starting at minute 10, every 15 min), `10-30/5`
- Ranges: `1-5`, `5-7` (Fri-Sun), `MON-FRI`, `MON-SUN`, `JAN-DEC`
- Lists: `1,15,30`, `MON,WED,FRI`
- Descriptive aliases:
  - `@yearly`, `@annually` (`0 0 1 1 *`)
  - `@monthly` (`0 0 1 * *`)
  - `@weekly` (`0 0 * * 0`)
  - `@weekdays`, `@workdays` (`0 0 * * 1-5`)
  - `@weekends` (`0 0 * * 6,0`)
  - `@daily`, `@midnight` (`0 0 * * *`)
  - `@hourly`, `@every_hour` (`0 * * * *`)
  - `@every_minute`, `@minutely` (`* * * * *`)
  - `@every <N>m` (e.g. `@every 5m` → `*/5 * * * *`)
  - `@every <N>h` (e.g. `@every 2h` → `0 */2 * * *`)
  - `@every <N>d` (e.g. `@every 2d` → `0 0 */2 * *`)

### 2. Programmatic Scheduling
```js
// Schedule daily digest at 09:00 AM with Timezone support
queue.schedule('0 9 * * *', 'reports.daily-digest', { channel: 'slack' }, {
  timezone: 'Europe/Istanbul', // IANA timezone support ('Europe/Istanbul', 'America/New_York')
  overlap: false,              // Prevent concurrent execution if previous run is still active (default: false)
  maxRuns: 10,                 // Optional maximum executions before auto-unscheduling
});

// Or use the .cron() alias
queue.cron('@every 15m', 'metrics.collect');

// Query schedules
const schedules = queue.getSchedules();
// [{ id, name, cronExpression, nextRunAt, lastRunAt, isRunning, activeJobId, activeJobIds, runsCount, ... }]

// Manually trigger a schedule immediately
await queue.triggerSchedule('reports.daily-digest');

// Unschedule by schedule ID or job name (removes all schedules matching the job name)
queue.unschedule('metrics.collect');
```

### 3. Schedule Options
| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `schedule:${job}:${cron}` | Custom unique identifier |
| `overlap` | `boolean` | `false` | When `false`, skips tick if a previous job run is still processing |
| `preventOverlap` | `boolean` | `true` | Alias for `overlap: false` |
| `maxRuns` | `number` | `null` | Automatically unschedules task after N runs |
| `utc` | `boolean` | `false` | Evaluate cron expressions in UTC instead of local timezone |
| `timezone` (`tz`) | `string` | `null` | IANA timezone name (e.g. `'Europe/Istanbul'`, `'America/New_York'`) |
| `runImmediately` | `boolean` | `false` | Triggers a run right after scheduling |

### 4. File-Based Cron Discovery (`jobs/`)
Jobs in the `jobs/` folder can automatically declare their recurrence in two ways:

#### Option A: `cron` / `schedule` property in job module
```js
// jobs/reports/summary.js
module.exports = async function(job, ctx) {
  // run summary logic...
};

module.exports.cron = '0 8 * * 1-5'; // Every weekday at 8:00 AM
module.exports.data = { reportType: 'executive' };
module.exports.options = {
  overlap: false,
};
```

#### Option B: `.cron.js` file naming
```js
// jobs/cleanup-logs.cron.js (auto-discovers job name 'cleanup-logs')
module.exports = {
  cron: '@daily',
  handler: async function(job, ctx) {
    // perform cleanup
  },
};
```

### 5. Lifecycle & Overlap Management
- The scheduler automatically pauses when `queue.pause()` is called and resumes with `queue.resume()`.
- On `queue.drain()` or `queue.stop()`, recurring schedules are stopped and active dispatched jobs are given time to complete.
- Overlap prevention (`overlap: false`) hooks into `job:completed` and `job:failed` events, ensuring slow asynchronous tasks never collide or duplicate.

---

## 4. Admin Panel SPA Dashboard (`/_admin#!/queue`)

When `adminPanelPlugin` is enabled alongside `queuePlugin`, a modern Mithril.js management interface is automatically mounted at `/_admin#!/queue`:
- **Real-Time KPI Cards**: Live counters for Pending, Running, Delayed, Completed, and Failed jobs, plus worker slot capacity.
- **Status Tabs & Filtering**: 1-click status filtering, registered job type dropdown, and multi-field search across IDs, names, errors, and JSON payloads.
- **Job Detail Modal (`JobDetailModal`)**: Full multiline execution error stack trace with 1-click copy, formatted JSON data payload, execution result, and metadata grid.
- **1-Click & Bulk Retries**: Re-queue failed or completed jobs individually or in bulk.
- **Manual Dispatch Modal (`JobDispatchModal`)**: Enqueue ad-hoc jobs on-demand with preset templates (`email.send`, `report.generate`, `cache.warm`, `data.sync`, `custom`), custom priority, delay, timeout, and JSON payload editor.
- **Worker Controls**: Pause or resume worker processing with 1 click.

---

## 5. Built-in Framework Services

Official services registered under `ctx.serviceRegistry` for programmatic queue control:

```javascript
// Fetch stats
const stats = await ctx.service('queue.stats');

// List jobs
const { jobs, total } = await ctx.service('queue.list', { status: 'failed', limit: 10 });

// Retry single or bulk
await ctx.service('queue.retry', { id: 'job_123' });
await ctx.service('queue.bulk-retry', { ids: ['job_1', 'job_2'] });

// Cancel / remove job
await ctx.service('queue.cancel', { id: 'job_123' });

// Purge completed and failed jobs
await ctx.service('queue.purge', { status: ['completed', 'failed'] });

// Dispatch ad-hoc job
await ctx.service('queue.dispatch', {
  name: 'email.welcome',
  data: { email: 'user@example.com' },
  priority: 20,
  delay: '10s',
});

// Pause / Resume
await ctx.service('queue.pause');
await ctx.service('queue.resume');
```


