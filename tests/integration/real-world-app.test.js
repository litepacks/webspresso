const {
  wait
} = require('../utils');

'use strict';

/**
 * Comprehensive Real-World Application Integration Test: Express & Hono Runtime Parity
 *
 * Verifies that a full-stack, enterprise-grade Webspresso application featuring:
 * - Knex & SQLite ORM Models (User, Note, ApiKey)
 * - Domain Services Layer with schema validation, password hashing, and ambient DB transactions (transaction: true)
 * - Dual Authentication (Password Hashing + Stateless HS256 JWT Bearer)
 * - Enterprise Resilience: Three-State Circuit Breaker & Exponential Backoff Retry Engine
 * - High-Performance Tagged LRU Cache Engine (getOrSet + atomic tag invalidation)
 * - Decoupled Events & Signals Architecture (defineSignal, listeners, and audit logs)
 * - Background Job Queue (core/queue: QueueManager + MemoryQueueAdapter + SqsQueueAdapter + PubSubQueueAdapter)
 * - Cloud Metrics & Distributed Tracing (core/metrics: Prometheus /metrics, JSON /metrics.json, W3C traceparent & x-trace-id)
 * - HTTP 103 Early Hints (core/early-hints RFC 8288 / RFC 8297)
 * - Payload Limits & DoS Protection (core/limits: 413 PayloadTooLargeError)
 * - Official Webspresso Plugins:
 *     * corsPlugin: Cross-Origin Resource Sharing & OPTIONS preflight
 *     * redirectPlugin: Declarative HTTP 301/302 Redirect Rules
 *     * csvPlugin: RFC 4180 CSV export and streaming
 *     * xlsxPlugin: Binary Excel spreadsheet export and streaming (PK\x03\x04)
 *     * apiKeyPlugin: B2B Developer API Keys with constant-time verification & scopes
 *     * basicAuthPlugin: HTTP Basic Authentication (RFC 7617) for Ops & Metrics
 * - Cloud & Kubernetes Health & Readiness Probes (/healthz & /readyz)
 * - Zod Schema-validated API Endpoints (defineApi)
 * - Server-Side Rendered (SSR) HTML Page Loaders (definePage)
 *
 * executes with 100% architectural and behavioral parity on BOTH:
 * 1. Express runtime (default)
 * 2. Hono runtime (via HonoHttpAdapter)
 */

const request = require('supertest');
const {
  createCoreApp,
  createExpressHttpAdapter,
  createHonoHttpAdapter,
  executeApiPipeline,
  executePagePipeline,
  authenticateRequest,
  defineApi,
  definePage,
  defineService,
  createServiceRegistry,
} = require('../../core');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../../core/orm');
const { createAuth, hash, verify, signJwt } = require('../../core/auth');
const { createTaggedLruCache } = require('../../core/cache');
const { createEventDispatcher, defineSignal } = require('../../core/events');
const { CircuitBreakerRegistry } = require('../../core/resilience');
const { setupHealthMiddleware } = require('../../core/health');
const {
  createQueueManager,
  MemoryQueueAdapter,
  SqsQueueAdapter,
  PubSubQueueAdapter,
} = require('../../core/queue');
const {
  setupMetricsMiddleware,
  createMetricsManager,
} = require('../../core/metrics');
const { createLimitsMiddleware, setupLimitsMiddleware } = require('../../core/limits');
const { createEarlyHintsMiddleware } = require('../../core/early-hints');
const { z } = require('../../core/validation');
const { NotFoundError, ValidationError } = require('../../core/errors');
const { createFeatureFlagManager } = require('../../core/flags');
const { createWebspressoClient } = require('../../src/dev/client-gen');

const corsPlugin = require('../../plugins/cors');
const { redirectPlugin } = require('../../plugins/redirect');
const { csvPlugin } = require('../../plugins/csv');
const { xlsxPlugin } = require('../../plugins/xlsx');
const apiKeyPlugin = require('../../plugins/api-key');
const basicAuthPlugin = require('../../plugins/basic-auth');

const JWT_SECRET = 'super-secret-jwt-key-32-chars-long!!';
const ALLOWED_ORIGIN = 'https://client.webspresso.io';
const BASIC_AUTH_USER = 'opsadmin';
const BASIC_AUTH_PASS = 'ops-pass-987';
const BASIC_AUTH_HEADER = 'Basic ' + Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}`).toString('base64');

/**
 * Set up in-memory SQLite schema and Webspresso ORM Models
 */
async function setupDatabase() {
  clearRegistry();

  defineModel({
    name: 'User',
    table: 'users',
    schema: {
      id: zdb.id(),
      email: zdb.string({ unique: true }),
      password: zdb.string(),
      role: zdb.string({ default: 'user' }),
    },
  });

  defineModel({
    name: 'Note',
    table: 'notes',
    schema: {
      id: zdb.id(),
      userId: zdb.integer(),
      title: zdb.string(),
      content: zdb.string(),
      published: zdb.boolean({ default: true }),
    },
  });

  const db = createDatabase({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await db.knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table.string('password').notNullable();
    table.string('role').defaultTo('user');
    table.timestamp('created_at').defaultTo(db.knex.fn.now());
    table.timestamp('updated_at').defaultTo(db.knex.fn.now());
  });

  await db.knex.schema.createTable('notes', (table) => {
    table.increments('id').primary();
    table.integer('userId').notNullable();
    table.string('title').notNullable();
    table.text('content').notNullable();
    table.boolean('published').defaultTo(true);
    table.timestamp('created_at').defaultTo(db.knex.fn.now());
    table.timestamp('updated_at').defaultTo(db.knex.fn.now());
  });

  await db.knex.schema.createTable('api_keys', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('key_hash', 64).notNullable().unique();
    table.string('key_hint').notNullable();
    table.string('prefix').notNullable();
    table.integer('user_id').nullable();
    table.text('scopes').notNullable();
    table.integer('rate_limit').nullable();
    table.text('metadata').nullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('last_used_at').nullable();
    table.timestamp('revoked_at').nullable();
    table.timestamp('created_at').defaultTo(db.knex.fn.now());
    table.timestamp('updated_at').defaultTo(db.knex.fn.now());
  });

  return db;
}

/**
 * Set up Domain Services with Circuit Breakers, Retries, Tagged Cache, and Events
 */
function setupServices(db, authManager, cache, events) {
  const registry = createServiceRegistry();

  // 1. user.register
  registry.register('user.register', defineService({
    schema: ({ z }) => ({
      email: z.string().email(),
      password: z.string().min(6),
    }),
    handler: async (input) => {
      const UserRepo = db.getRepository('User');
      const existing = await UserRepo.findOne({ email: input.email });
      if (existing) {
        const err = new Error('Email already registered');
        err.status = 409;
        throw err;
      }
      const hashedPassword = await hash(input.password);
      const user = await UserRepo.create({
        email: input.email,
        password: hashedPassword,
        role: 'user',
      });
      return { id: user.id, email: user.email, role: user.role };
    },
  }));

  // 2. user.login
  registry.register('user.login', defineService({
    schema: ({ z }) => ({
      email: z.string().email(),
      password: z.string().min(1),
    }),
    handler: async (input) => {
      const user = await authManager.findUserByCredentials(input.email, input.password);
      if (!user) {
        const err = new Error('Invalid email or password');
        err.status = 401;
        throw err;
      }
      const token = authManager.signJwt({ id: user.id, email: user.email, role: user.role });
      return {
        token,
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
  }));

  // 3. notes.create (with cache invalidation and signal dispatch)
  registry.register('notes.create', defineService({
    schema: ({ z }) => ({
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    handler: async (input, ctx) => {
      const NoteRepo = db.getRepository('Note');
      const userId = ctx.user?.id || input.userId || 1;
      const note = await NoteRepo.create({
        userId,
        title: input.title,
        content: input.content,
        published: true,
      });

      // Atomic cache invalidation of the 'notes' tag
      if (cache) {
        cache.invalidateTag('notes');
      }

      // Decoupled Signal Dispatch
      if (events) {
        await events.dispatch('note.created', note);
      }

      return note;
    },
  }));

  // 4. notes.list (with Tagged LRU Cache)
  registry.register('notes.list', defineService({
    handler: async (_input, ctx) => {
      const fetchFromDb = async () => {
        const NoteRepo = db.getRepository('Note');
        const query = ctx.user ? { userId: ctx.user.id } : { published: true };
        return await NoteRepo.find(query);
      };

      if (!cache) {
        return fetchFromDb();
      }

      const cacheKey = `notes:${ctx.user?.id || 'public'}`;
      return cache.getOrSet(cacheKey, fetchFromDb, { ttl: 60000, tags: ['notes'] });
    },
  }));

  // 5. notes.get
  registry.register('notes.get', defineService({
    schema: ({ z }) => ({
      id: z.number().or(z.string()),
    }),
    handler: async (input) => {
      const NoteRepo = db.getRepository('Note');
      const note = await NoteRepo.findById(Number(input.id));
      if (!note) {
        throw new NotFoundError(`Note with id ${input.id} not found`);
      }
      return note;
    },
  }));

  // 6. notes.update (with cache invalidation)
  registry.register('notes.update', defineService({
    schema: ({ z }) => ({
      id: z.number().or(z.string()),
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    handler: async (input) => {
      const NoteRepo = db.getRepository('Note');
      const updated = await NoteRepo.update(Number(input.id), {
        title: input.title,
        content: input.content,
      });
      if (!updated) {
        throw new NotFoundError(`Note with id ${input.id} not found`);
      }
      if (cache) {
        cache.invalidateTag('notes');
      }
      return updated;
    },
  }));

  // 7. notes.delete (with cache invalidation and signal dispatch)
  registry.register('notes.delete', defineService({
    schema: ({ z }) => ({
      id: z.number().or(z.string()),
    }),
    handler: async (input) => {
      const NoteRepo = db.getRepository('Note');
      const existing = await NoteRepo.findById(Number(input.id));
      if (!existing) {
        throw new NotFoundError(`Note with id ${input.id} not found`);
      }
      await NoteRepo.delete(Number(input.id));
      if (cache) {
        cache.invalidateTag('notes');
      }
      if (events) {
        await events.dispatch('note.deleted', existing);
      }
      return { success: true, id: Number(input.id) };
    },
  }));

  // 8. notes.batch-create (ACID Ambient Transactions)
  registry.register('notes.batch-create', defineService({
    transaction: true,
    schema: ({ z }) => ({
      items: z.array(z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        shouldFail: z.boolean().optional(),
      })),
    }),
    handler: async (input, ctx) => {
      const NoteRepo = db.getRepository('Note');
      const userId = ctx.user?.id || 1;
      const created = [];
      for (const item of input.items) {
        if (item.shouldFail) {
          throw new Error('Forced transactional abort');
        }
        const note = await NoteRepo.create({
          userId,
          title: item.title,
          content: item.content,
          published: true,
        });
        created.push(note);
      }
      if (cache) {
        cache.invalidateTag('notes');
      }
      return created;
    },
  }));

  // 9. sync.upstream (Resilience: Circuit Breaker + Exponential Backoff Retry)
  let syncAttempts = 0;
  registry.register('sync.upstream', defineService({
    circuitBreaker: {
      name: 'upstream-sync-breaker',
      failureThreshold: 2,
      resetTimeout: 500,
      fallback: async () => ({ status: 'degraded', fallback: true, message: 'Upstream service is currently degraded' }),
    },
    retry: {
      maxRetries: 2,
      delay: 5,
    },
    handler: async (input) => {
      syncAttempts++;
      if (input && input.simulateFailure) {
        const transientErr = new Error('Upstream Connection Reset');
        transientErr.code = 'ECONNRESET';
        throw transientErr;
      }
      return { status: 'synced', attempts: syncAttempts, records: 1 };
    },
  }));

  return registry;
}

/**
 * Creates API & Page route definitions
 */
function createRouteDefinitions(authManager, db, queue) {
  const requireAuth = async (req, res, next) => {
    const user = await authenticateRequest(req, res, authManager);
    if (!user) {
      if (res && typeof res.status === 'function') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid Bearer token required' });
      }
      const err = new Error('Valid Bearer token required');
      err.status = 401;
      throw err;
    }
    req.user = user;
    next();
  };

  const registerApi = defineApi({
    schema: ({ z }) => ({
      body: z.object({
        email: z.string().email(),
        password: z.string().min(6),
      }),
    }),
    handler: async (req, res) => {
      const result = await req.service('user.register', req.input.body);
      return res.status(201).json(result);
    },
  });

  const loginApi = defineApi({
    schema: ({ z }) => ({
      body: z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    }),
    handler: async (req, res) => {
      const result = await req.service('user.login', req.input.body);
      return res.status(200).json(result);
    },
  });

  const createNoteApi = defineApi({
    middleware: [requireAuth],
    schema: ({ z }) => ({
      body: z.object({
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    }),
    handler: async (req, res) => {
      const note = await req.service('notes.create', req.input.body);
      // Dispatch background job to Queue
      if (queue) {
        await queue.dispatch('notes.audit-log', {
          noteId: note.id,
          title: note.title,
          userId: req.user?.id || 1,
        });
      }
      return res.status(201).json(note);
    },
  });

  const listNotesApi = defineApi({
    middleware: [requireAuth],
    handler: async (req, res) => {
      const notes = await req.service('notes.list');
      return res.status(200).json(notes);
    },
  });

  const getNoteApi = defineApi({
    middleware: [requireAuth],
    schema: ({ z }) => ({
      params: z.object({
        id: z.string().min(1),
      }),
    }),
    handler: async (req, res) => {
      const note = await req.service('notes.get', { id: req.params.id });
      return res.status(200).json(note);
    },
  });

  const updateNoteApi = defineApi({
    middleware: [requireAuth],
    schema: ({ z }) => ({
      params: z.object({
        id: z.string().min(1),
      }),
      body: z.object({
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    }),
    handler: async (req, res) => {
      const note = await req.service('notes.update', { id: req.params.id, ...req.input.body });
      return res.status(200).json(note);
    },
  });

  const deleteNoteApi = defineApi({
    middleware: [requireAuth],
    schema: ({ z }) => ({
      params: z.object({
        id: z.string().min(1),
      }),
    }),
    handler: async (req, res) => {
      const result = await req.service('notes.delete', { id: req.params.id });
      return res.status(200).json(result);
    },
  });

  const batchCreateNotesApi = defineApi({
    middleware: [requireAuth],
    schema: ({ z }) => ({
      body: z.object({
        items: z.array(z.object({
          title: z.string().min(1),
          content: z.string().min(1),
          shouldFail: z.boolean().optional(),
        })),
      }),
    }),
    handler: async (req, res) => {
      const result = await req.service('notes.batch-create', req.input.body);
      return res.status(201).json(result);
    },
  });

  const syncUpstreamApi = defineApi({
    schema: ({ z }) => ({
      body: z.object({
        simulateFailure: z.boolean().optional(),
      }).optional(),
    }),
    handler: async (req, res) => {
      const result = await req.service('sync.upstream', req.input.body || {});
      return res.status(200).json(result);
    },
  });

  // CSV Export via csvPlugin
  const exportCsvApi = defineApi({
    handler: async (req, res) => {
      const csvData = await req.service('csv.exportModel', {
        model: 'Note',
        fields: ['id', 'title', 'content'],
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="notes.csv"');
      return res.send(csvData);
    },
  });

  // XLSX Export via xlsxPlugin
  const exportXlsxApi = defineApi({
    handler: async (req, res) => {
      const result = await req.service('xlsx.exportModel', {
        model: 'Note',
        columns: ['id', 'title', 'content'],
        filename: 'notes.xlsx',
      });
      const buffer = Buffer.from(result.base64, 'base64');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(buffer);
    },
  });

  // Developer API Key Protected Route via apiKeyPlugin
  const developerNotesApi = defineApi({
    middleware: [
      apiKeyPlugin.createApiKeyMiddleware({
        knex: db.knex,
        tableName: 'api_keys',
        scopes: ['notes:read'],
      }),
    ],
    handler: async (req, res) => {
      const notes = await req.service('notes.list');
      return res.status(200).json({
        apiKeyName: req.apiKey?.name,
        scopes: req.apiKey?.scopes,
        data: notes,
      });
    },
  });

  // Ops Monitoring Metrics via basicAuthPlugin
  const opsMetricsApi = defineApi({
    middleware: [
      basicAuthPlugin.createBasicAuthMiddleware({
        users: { [BASIC_AUTH_USER]: BASIC_AUTH_PASS },
        realm: 'Ops Monitoring System',
      }),
    ],
    handler: async (req, res) => {
      return res.status(200).json({
        status: 'healthy',
        operator: req.user?.username || req.auth?.user?.username || BASIC_AUTH_USER,
        activeJobs: queue ? queue.runningCount : 0,
      });
    },
  });

  // Strict Payload Limit via core/limits
  const strictLimitApi = defineApi({
    middleware: [
      createLimitsMiddleware({ json: '500b' }),
    ],
    handler: async (req, res) => {
      return res.status(200).json({ status: 'ok', body: req.body });
    },
  });

  // Cloud Run / PubSub push subscription webhook route
  const pubsubAdapter = new PubSubQueueAdapter({
    topic: 'projects/p/topics/notes-jobs',
  });

  const pubsubPushApi = defineApi({
    handler: async (req, res) => {
      return pubsubAdapter.processPushRequest(req, res, queue);
    },
  });

  // SSR Page with HTTP 103 Early Hints
  const notesPage = definePage({
    earlyHints: ['/assets/main.css', '/assets/app.js'],
    load: async ({ service, res }) => {
      if (res && typeof res.earlyHints === 'function') {
        res.earlyHints(['/assets/main.css', '/assets/app.js']);
      }
      const notes = await service('notes.list');
      return { notes, count: notes.length };
    },
    render: async (data) => {
      const listHtml = data.notes.map((n) => `<li>${n.title}</li>`).join('');
      return `<!DOCTYPE html><html><head><title>Notes</title></head><body><h1>All Notes (${data.count})</h1><ul>${listHtml}</ul></body></html>`;
    },
  });

  // Feature Flag guarded API
  const canaryApi = defineApi({
    flag: 'canary_feature',
    handler: async (req, res) => {
      return res.json({ allowed: true, message: 'Canary feature unlocked' });
    },
  });

  return {
    registerApi,
    loginApi,
    createNoteApi,
    listNotesApi,
    getNoteApi,
    updateNoteApi,
    deleteNoteApi,
    batchCreateNotesApi,
    syncUpstreamApi,
    exportCsvApi,
    exportXlsxApi,
    developerNotesApi,
    opsMetricsApi,
    strictLimitApi,
    pubsubPushApi,
    pubsubAdapter,
    notesPage,
    requireAuth,
    canaryApi,
  };
}

describe.sequential('Comprehensive Real-World Application: Express & Hono Runtime Parity', () => {
  let db;
  let authManager;
  let cache;
  let events;
  let breakers;
  let queue;
  let services;
  let routes;
  let auditLog = [];
  let deletedLog = [];
  let queuedJobs = [];
  let devApiKey;
  let limitedApiKey;

  beforeAll(async () => {
    db = await setupDatabase();

    authManager = createAuth({
      jwt: { secret: JWT_SECRET },
      findUserById: async (id) => db.getRepository('User').findById(id),
      findUserByCredentials: async (email, password) => {
        const user = await db.getRepository('User').findOne({ email });
        if (user && (await verify(password, user.password))) return user;
        return null;
      },
    });

    cache = createTaggedLruCache({ maxEntries: 500 });
    events = createEventDispatcher();
    breakers = new CircuitBreakerRegistry();

    // Set up Background Job Queue
    queue = createQueueManager({
      adapter: new MemoryQueueAdapter(),
      concurrency: 2,
      pollInterval: 50,
    });

    queue.define('notes.audit-log', async (job) => {
      queuedJobs.push(job.data);
      return { success: true };
    });

    queue.define('notes.push-notification', async (job) => {
      queuedJobs.push({ type: 'push', ...job.data });
      return { sent: true };
    });

    queue.start();

    // Register event listeners for audit logging
    events.on('note.created', (note) => {
      auditLog.push({ id: note.id, title: note.title, timestamp: Date.now() });
    });

    events.on('note.deleted', (note) => {
      deletedLog.push({ id: note.id, title: note.title, timestamp: Date.now() });
    });

    // Create API Keys for B2B developer access
    const devKeyRes = await apiKeyPlugin.createApiKey(
      { name: 'Developer Partner', scopes: ['notes:read', 'notes:write'] },
      { knex: db.knex, tableName: 'api_keys' }
    );
    devApiKey = devKeyRes.key;

    const limitedKeyRes = await apiKeyPlugin.createApiKey(
      { name: 'Restricted Partner', scopes: ['reports:read'] },
      { knex: db.knex, tableName: 'api_keys' }
    );
    limitedApiKey = limitedKeyRes.key;

    services = setupServices(db, authManager, cache, events);
    routes = createRouteDefinitions(authManager, db, queue);
  });

  afterAll(async () => {
    if (queue) {
      await queue.drain();
    }
    if (db && db.knex) {
      await db.knex.destroy();
    }
  });

  describe('1. Express Runtime with Full Plugin & Feature Ecosystem', () => {
    let expressApp;
    let expressAdapter;
    let authToken;

    beforeAll(() => {
      const express = require('express');
      const app = express();
      setupLimitsMiddleware(app, {
        json: '1mb',
        routes: {
          '/api/notes/strict-limit': { json: '500b' },
        },
      });

      expressAdapter = createExpressHttpAdapter(app);

      // Mount Metrics & Distributed Tracing Middleware (/metrics, /metrics.json)
      setupMetricsMiddleware(app, { enabled: true }, {
        db,
        cache,
        breakers,
      });

      // Mount Early Hints Middleware
      app.use(createEarlyHintsMiddleware({ links: ['/assets/main.css', '/assets/app.js'] }));

      // Register Official Plugins on Express
      const plugins = [
        corsPlugin({ origin: ALLOWED_ORIGIN }),
        redirectPlugin({ rules: [{ from: '/legacy-notes', to: '/notes', status: 301 }] }),
        csvPlugin({ db }),
        xlsxPlugin({ db }),
        apiKeyPlugin({ db, knex: db.knex }),
        basicAuthPlugin(),
      ];

      const pluginCtx = {
        app,
        http: expressAdapter,
        db,
        serviceRegistry: services,
        services,
        queue,
      };

      for (const plugin of plugins) {
        if (typeof plugin.register === 'function') {
          plugin.register(pluginCtx);
        }
      }

      // Mount Health Check Probes (/healthz, /readyz)
      setupHealthMiddleware(app, { enabled: true, db, eventLoopThresholdMs: 5000 });

      // Feature Flags Manager
      const flagManager = createFeatureFlagManager({
        flags: {
          canary_feature: {
            users: ['vip_user'],
            rollout: 0,
          },
        },
      });
      app.use(flagManager.middleware());

      const routeCtx = {
        options: {},
        isDev: false,
        db,
        serviceRegistry: services,
        queue,
        flags: flagManager,
      };

      // Mount Endpoints
      const mountApi = (method, path, apiDef) => {
        app[method.toLowerCase()](path, async (req, res) => {
          try {
            req.queue = queue;
            await executeApiPipeline({
              descriptor: { path, method: method.toUpperCase(), file: 'api.js' },
              context: routeCtx,
              apiDef,
              handlerFn: apiDef.handler,
              compiledSchema: apiDef.schema,
              middlewares: apiDef.middleware || [],
              req,
              res,
            });
          } catch (err) {
            const status = err.status || err.statusCode || 500;
            res.status(status).json({
              error: err.name || 'Error',
              message: err.message,
              status,
              ...(err.issues ? { issues: err.issues } : {}),
            });
          }
        });
      };

      mountApi('POST', '/api/auth/register', routes.registerApi);
      mountApi('POST', '/api/auth/login', routes.loginApi);
      mountApi('POST', '/api/notes', routes.createNoteApi);
      mountApi('GET', '/api/notes', routes.listNotesApi);
      mountApi('GET', '/api/notes/:id', routes.getNoteApi);
      mountApi('PUT', '/api/notes/:id', routes.updateNoteApi);
      mountApi('DELETE', '/api/notes/:id', routes.deleteNoteApi);
      mountApi('POST', '/api/notes/batch', routes.batchCreateNotesApi);
      mountApi('POST', '/api/sync', routes.syncUpstreamApi);
      mountApi('GET', '/api/notes/export/csv', routes.exportCsvApi);
      mountApi('GET', '/api/notes/export/xlsx', routes.exportXlsxApi);
      mountApi('GET', '/api/v1/developer/notes', routes.developerNotesApi);
      mountApi('GET', '/api/internal/ops-metrics', routes.opsMetricsApi);
      mountApi('POST', '/api/notes/strict-limit', routes.strictLimitApi);
      mountApi('POST', '/api/queue/pubsub-push', routes.pubsubPushApi);
      mountApi('GET', '/api/canary', routes.canaryApi);

      // SSR Page
      app.get('/notes', async (req, res) => {
        try {
          await executePagePipeline({
            descriptor: { path: '/notes', method: 'GET', file: 'notes.js' },
            context: routeCtx,
            pageDef: routes.notesPage,
            middlewares: [],
            req,
            res,
          });
        } catch (err) {
          res.status(err.status || 500).send(`Error: ${err.message}`);
        }
      });

      expressApp = app;
    });

    it('handles CORS preflight OPTIONS request with configured origin (corsPlugin)', async () => {
      const res = await request(expressApp)
        .options('/api/notes')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('redirects /legacy-notes to /notes with HTTP 301 (redirectPlugin)', async () => {
      const res = await request(expressApp)
        .get('/legacy-notes')
        .expect(301);

      expect(res.headers.location).toBe('/notes');
    });

    it('responds to cloud liveness probe (/healthz)', async () => {
      const res = await request(expressApp).get('/healthz').expect(200);
      expect(['ok', 'degraded']).toContain(res.body.status);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('responds to cloud readiness probe (/readyz) verifying database connectivity', async () => {
      const res = await request(expressApp).get('/readyz').expect(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.checks.database.status).toBe('up');
    });

    it('successfully registers user and generates JWT token', async () => {
      const regRes = await request(expressApp)
        .post('/api/auth/register')
        .send({ email: 'enterprise@webspresso.io', password: 'securePassword123' })
        .expect(201);

      expect(regRes.body.email).toBe('enterprise@webspresso.io');

      const loginRes = await request(expressApp)
        .post('/api/auth/login')
        .send({ email: 'enterprise@webspresso.io', password: 'securePassword123' })
        .expect(200);

      expect(typeof loginRes.body.token).toBe('string');
      authToken = loginRes.body.token;
    });

    it('rejects registration with HTTP 422 ValidationError when input fails Zod schema', async () => {
      const res = await request(expressApp)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: '123' })
        .expect(422);

      expect(res.body.error).toBe('ValidationError');
      expect(res.body.status).toBe(422);
      expect(res.body.issues).toBeDefined();
    });

    it('rejects unauthenticated requests to protected note endpoints with HTTP 401', async () => {
      const missingAuth = await request(expressApp).get('/api/notes').expect(401);
      expect(missingAuth.body.error).toBe('Unauthorized');

      const tamperedAuth = await request(expressApp)
        .get('/api/notes')
        .set('Authorization', 'Bearer invalid.tampered.token')
        .expect(401);
      expect(tamperedAuth.body.error).toBe('Unauthorized');
    });

    it('creates note, invalidates cache tag, dispatches Signal, and enqueues background job', async () => {
      const initialLogCount = auditLog.length;
      const initialQueueCount = queuedJobs.length;

      const res = await request(expressApp)
        .post('/api/notes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Microservices & Core Decoupling', content: 'Webspresso running on Express' })
        .expect(201);

      expect(res.body.title).toBe('Microservices & Core Decoupling');

      // Assert event listener intercepted note.created
      expect(auditLog.length).toBe(initialLogCount + 1);
      expect(auditLog[auditLog.length - 1].title).toBe('Microservices & Core Decoupling');

      // Allow background worker to process job
      for (let i = 0; i < 20; i++) {
        if (queuedJobs.length >= initialQueueCount + 1) break;
        await wait(5);
      }
      expect(queuedJobs.length).toBeGreaterThanOrEqual(initialQueueCount + 1);
      const enqueued = queuedJobs.find((j) => j.title === 'Microservices & Core Decoupling');
      expect(enqueued).toBeDefined();
    });

    it('serves cached note list from TaggedLruCache', async () => {
      const res1 = await request(expressApp)
        .get('/api/notes')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res1.body.length).toBeGreaterThanOrEqual(1);

      // Verify that cache key exists in TaggedLruCache
      const cached = cache.get(`notes:${res1.body[0].userId}`);
      expect(cached).toBeDefined();
      expect(cached.length).toBe(res1.body.length);
    });

    it('updates note via PUT /api/notes/:id and invalidates TaggedLruCache', async () => {
      const listRes = await request(expressApp)
        .get('/api/notes')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const noteToUpdate = listRes.body[0];

      const updateRes = await request(expressApp)
        .put(`/api/notes/${noteToUpdate.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Updated Title', content: 'Updated Content' })
        .expect(200);

      expect(updateRes.body.title).toBe('Updated Title');

      // Verify that cache tag was invalidated
      const cachedAfterUpdate = cache.get(`notes:${noteToUpdate.userId}`);
      expect(cachedAfterUpdate).toBeUndefined();

      // Subsequent fetch returns fresh updated record
      const freshRes = await request(expressApp)
        .get(`/api/notes/${noteToUpdate.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(freshRes.body.title).toBe('Updated Title');
    });

    it('returns HTTP 404 NotFoundError when fetching non-existent note', async () => {
      const res = await request(expressApp)
        .get('/api/notes/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body.error).toBe('NotFoundError');
    });

    it('atomically rolls back ambient transaction when batch creation fails (transaction: true)', async () => {
      const initialCount = (await db.getRepository('Note').find()).length;

      const res = await request(expressApp)
        .post('/api/notes/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { title: 'Atomic Note 1', content: 'Valid' },
            { title: 'Atomic Note 2', content: 'Invalid', shouldFail: true },
          ],
        })
        .expect(500);

      expect(res.body.message).toContain('Forced transactional abort');

      // Assert zero notes were inserted (all rolled back)
      const currentCount = (await db.getRepository('Note').find()).length;
      expect(currentCount).toBe(initialCount);
    });

    it('atomically commits ambient transaction when batch creation succeeds (transaction: true)', async () => {
      const initialCount = (await db.getRepository('Note').find()).length;

      const res = await request(expressApp)
        .post('/api/notes/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { title: 'Atomic Success 1', content: 'Valid 1' },
            { title: 'Atomic Success 2', content: 'Valid 2' },
          ],
        })
        .expect(201);

      expect(res.body.length).toBe(2);

      const currentCount = (await db.getRepository('Note').find()).length;
      expect(currentCount).toBe(initialCount + 2);
    });

    it('deletes note via DELETE /api/notes/:id and dispatches note.deleted signal', async () => {
      const initialDelCount = deletedLog.length;

      // Create a temporary note to delete
      const NoteRepo = db.getRepository('Note');
      const tempNote = await NoteRepo.create({
        userId: 1,
        title: 'Temp Note for Deletion',
        content: 'To be deleted',
        published: true,
      });

      const delRes = await request(expressApp)
        .delete(`/api/notes/${tempNote.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(delRes.body.success).toBe(true);

      // Verify deletion event intercepted
      expect(deletedLog.length).toBe(initialDelCount + 1);
      expect(deletedLog[deletedLog.length - 1].title).toBe('Temp Note for Deletion');

      // Verify record no longer exists
      const check = await NoteRepo.findById(tempNote.id);
      expect(check).toBeNull();
    });

    it('exports notes as RFC 4180 CSV via csvPlugin (csv.exportModel)', async () => {
      const res = await request(expressApp)
        .get('/api/notes/export/csv')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Atomic Success 1');
      expect(res.text).toContain('Valid 1');
    });

    it('exports notes as XLSX spreadsheet via xlsxPlugin (xlsx.exportModel)', async () => {
      const res = await request(expressApp)
        .get('/api/notes/export/xlsx')
        .expect(200);

      expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('attachment; filename="notes.xlsx"');
      const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text);
      // Valid XLSX file starts with ZIP magic header PK\x03\x04
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    });

    it('authenticates B2B developer via apiKeyPlugin with granular scopes', async () => {
      // 1. Missing API Key -> 401 Unauthorized
      await request(expressApp)
        .get('/api/v1/developer/notes')
        .expect(401);

      // 2. API Key with insufficient scope -> 403 Forbidden
      await request(expressApp)
        .get('/api/v1/developer/notes')
        .set('X-API-Key', limitedApiKey)
        .expect(403);

      // 3. API Key with notes:read scope -> 200 OK
      const devRes = await request(expressApp)
        .get('/api/v1/developer/notes')
        .set('X-API-Key', devApiKey)
        .expect(200);

      expect(devRes.body.apiKeyName).toBe('Developer Partner');
      expect(devRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('authenticates ops operator via basicAuthPlugin with WWW-Authenticate header', async () => {
      // 1. Missing credentials -> 401 with WWW-Authenticate header
      const unauthRes = await request(expressApp)
        .get('/api/internal/ops-metrics')
        .expect(401);

      expect(unauthRes.headers['www-authenticate']).toContain('Basic realm="Ops Monitoring System"');

      // 2. Invalid credentials -> 401
      await request(expressApp)
        .get('/api/internal/ops-metrics')
        .set('Authorization', 'Basic ' + Buffer.from('opsadmin:wrongpassword').toString('base64'))
        .expect(401);

      // 3. Valid credentials -> 200 OK
      const okRes = await request(expressApp)
        .get('/api/internal/ops-metrics')
        .set('Authorization', BASIC_AUTH_HEADER)
        .expect(200);

      expect(okRes.body.status).toBe('healthy');
      expect(okRes.body.operator).toBe(BASIC_AUTH_USER);
    });

    it('enforces payload limits and protects against DoS via core/limits (413)', async () => {
      // Small payload (< 500 bytes) -> 200 OK
      await request(expressApp)
        .post('/api/notes/strict-limit')
        .send({ text: 'Small normal payload' })
        .expect(200);

      // Oversized payload (> 500 bytes) -> 413 Payload Too Large
      const oversizedPayload = { data: 'A'.repeat(800) };
      await request(expressApp)
        .post('/api/notes/strict-limit')
        .send(oversizedPayload)
        .expect(413);
    });

    it('exercises Circuit Breaker & Retry resilience fallback on upstream degradation', async () => {
      // 1. Successful execution
      const successRes = await request(expressApp)
        .post('/api/sync')
        .send({ simulateFailure: false })
        .expect(200);
      expect(successRes.body.status).toBe('synced');

      // 2. Trigger failures that trip the circuit breaker and invoke fallback gracefully
      await request(expressApp).post('/api/sync').send({ simulateFailure: true });
      const failRes2 = await request(expressApp).post('/api/sync').send({ simulateFailure: true });

      // Circuit trips to OPEN and returns degraded fallback payload
      expect(failRes2.body.fallback).toBe(true);
      expect(failRes2.body.status).toBe('degraded');
    });

    it('serves Prometheus exposition format at /metrics and JSON telemetry at /metrics.json', async () => {
      const promRes = await request(expressApp).get('/metrics').expect(200);
      expect(promRes.headers['content-type']).toContain('text/plain');
      expect(promRes.text).toContain('webspresso_http_requests_total');
      expect(promRes.text).toContain('nodejs_heap_size_used_bytes');

      const jsonRes = await request(expressApp).get('/metrics.json').expect(200);
      expect(jsonRes.headers['content-type']).toContain('application/json');
      expect(jsonRes.body.webspresso_http_requests_total).toBeDefined();
    });

    it('propagates W3C distributed tracing context through response headers', async () => {
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const incomingSpanId = '00f067aa0ba902b7';
      const w3cTraceparent = `00-${incomingTraceId}-${incomingSpanId}-01`;

      const res = await request(expressApp)
        .get('/healthz')
        .set('traceparent', w3cTraceparent)
        .expect(200);

      expect(res.headers['x-trace-id']).toBe(incomingTraceId);
      expect(res.headers['traceparent']).toContain(incomingTraceId);
    });

    it('processes Google Cloud Pub/Sub push subscription webhook (/api/queue/pubsub-push)', async () => {
      const initialCount = queuedJobs.length;

      const pubsubPayload = {
        message: {
          messageId: 'pubsub-webhook-msg-1',
          data: Buffer.from(JSON.stringify({
            name: 'notes.push-notification',
            data: { recipient: 'user_42', alert: 'New note created' },
          })).toString('base64'),
        },
      };

      const res = await request(expressApp)
        .post('/api/queue/pubsub-push')
        .send(pubsubPayload)
        .expect(200);

      expect(res.text).toBe('OK');

      // Verify that job was processed by QueueManager
      expect(queuedJobs.length).toBeGreaterThanOrEqual(initialCount + 1);
      const found = queuedJobs.find((j) => j.recipient === 'user_42');
      expect(found).toBeDefined();
    });

    it('handles Pub/Sub push webhook error scenarios (missing payload -> 400, unhandled job -> 204)', async () => {
      // 1. Missing message payload -> 400 Bad Request
      await request(expressApp)
        .post('/api/queue/pubsub-push')
        .send({})
        .expect(400);

      // 2. Unhandled job name -> 204 No Content
      const unhandledPayload = {
        message: {
          data: Buffer.from(JSON.stringify({ name: 'unregistered.custom.job' })).toString('base64'),
        },
      };

      await request(expressApp)
        .post('/api/queue/pubsub-push')
        .send(unhandledPayload)
        .expect(204);
    });

    it('executes AWS Lambda SQS event batch via SqsQueueAdapter.processBatch()', async () => {
      const sqsAdapter = new SqsQueueAdapter({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
        accessKeyId: 'test',
        secretAccessKey: 'test',
      });

      const lambdaEventRecords = [
        {
          messageId: 'sqs-lambda-1',
          body: JSON.stringify({
            name: 'notes.push-notification',
            data: { recipient: 'lambda_user', alert: 'SQS Lambda test' },
          }),
        },
      ];

      const batchResult = await sqsAdapter.processBatch(lambdaEventRecords, queue);
      expect(batchResult.processed).toBe(1);
      expect(batchResult.failed).toBe(0);

      const found = queuedJobs.find((j) => j.recipient === 'lambda_user');
      expect(found).toBeDefined();
    });

    it('renders server-side HTML page with loaded data', async () => {
      const res = await request(expressApp).get('/notes').expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('All Notes');
    });

    it('enforces feature flag guards via core/flags (404 for regular users, 200 for VIP)', async () => {
      // 1. Regular request gets 404
      const blockedRes = await request(expressApp).get('/api/canary');
      expect(blockedRes.status).toBe(404);
      expect(blockedRes.body).toHaveProperty('error', 'Not Found');
      expect(blockedRes.body).toHaveProperty('feature', 'canary_feature');

      // 2. VIP user gets 200
      const allowedRes = await request(expressApp)
        .get('/api/canary')
        .set('x-user-id', 'vip_user');
      expect(allowedRes.status).toBe(200);
      expect(allowedRes.body).toEqual({ allowed: true, message: 'Canary feature unlocked' });
    });

    it('executes type-safe client operations end-to-end via createWebspressoClient', async () => {
      const mockFetch = async (url, opts = {}) => {
        const parsed = new URL(url, 'http://localhost');
        let reqBuilder;
        const method = (opts.method || 'GET').toLowerCase();
        if (method === 'get') reqBuilder = request(expressApp).get(parsed.pathname + parsed.search);
        else if (method === 'post') reqBuilder = request(expressApp).post(parsed.pathname + parsed.search);
        else if (method === 'put') reqBuilder = request(expressApp).put(parsed.pathname + parsed.search);
        else if (method === 'delete') reqBuilder = request(expressApp).delete(parsed.pathname + parsed.search);

        if (opts.headers) {
          for (const [k, v] of Object.entries(opts.headers)) {
            reqBuilder.set(k, v);
          }
        }
        if (opts.body) {
          reqBuilder.send(typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body);
        }

        const res = await reqBuilder;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          statusText: res.statusText || 'OK',
          headers: new Headers(res.headers),
          json: async () => res.body,
          text: async () => res.text,
        };
      };

      const client = createWebspressoClient({
        baseUrl: 'http://localhost',
        fetch: mockFetch,
        getToken: () => authToken,
      });

      // 1. List notes via client
      const notes = await client.api.notes.get();
      expect(Array.isArray(notes)).toBe(true);

      // 2. Create note via client
      const created = await client.api.notes.post({
        body: {
          title: 'Client Created Note',
          content: 'Created via type-safe client proxy',
          tags: ['client', 'integration'],
        },
      });
      expect(created).toBeDefined();
      expect(created.title).toBe('Client Created Note');
    });
  });

  describe('2. Hono Runtime with Full Plugin & Feature Ecosystem (via HonoHttpAdapter)', () => {
    let honoAdapter;
    let authToken;

    beforeAll(() => {
      honoAdapter = createHonoHttpAdapter();

      // Register Plugins on Hono via ctx.http
      const plugins = [
        corsPlugin({ origin: ALLOWED_ORIGIN }),
        redirectPlugin({ rules: [{ from: '/legacy-notes', to: '/notes', status: 301 }] }),
        csvPlugin({ db }),
        xlsxPlugin({ db }),
        apiKeyPlugin({ db, knex: db.knex }),
        basicAuthPlugin(),
      ];

      const pluginCtx = {
        app: honoAdapter.getApp(),
        http: honoAdapter,
        db,
        serviceRegistry: services,
        services,
        queue,
      };

      for (const plugin of plugins) {
        if (typeof plugin.register === 'function') {
          plugin.register(pluginCtx);
        }
      }

      // Mount Health Check Probes (/healthz, /readyz) on Hono
      setupHealthMiddleware(honoAdapter, { enabled: true, db, eventLoopThresholdMs: 5000 });

      // Feature Flags Manager on Hono
      const flagManagerHono = createFeatureFlagManager({
        flags: {
          canary_feature: {
            users: ['vip_user'],
            rollout: 0,
          },
        },
      });
      honoAdapter.use(flagManagerHono.middleware());

      const routeCtx = {
        options: {},
        isDev: false,
        db,
        serviceRegistry: services,
        queue,
        flags: flagManagerHono,
      };

      // Register API endpoints on Hono
      honoAdapter.registerApi('post', '/api/auth/register', routes.registerApi, routeCtx);
      honoAdapter.registerApi('post', '/api/auth/login', routes.loginApi, routeCtx);
      honoAdapter.registerApi('post', '/api/notes', routes.createNoteApi, routeCtx);
      honoAdapter.registerApi('get', '/api/notes', routes.listNotesApi, routeCtx);
      honoAdapter.registerApi('get', '/api/notes/:id', routes.getNoteApi, routeCtx);
      honoAdapter.registerApi('put', '/api/notes/:id', routes.updateNoteApi, routeCtx);
      honoAdapter.registerApi('delete', '/api/notes/:id', routes.deleteNoteApi, routeCtx);
      honoAdapter.registerApi('post', '/api/notes/batch', routes.batchCreateNotesApi, routeCtx);
      honoAdapter.registerApi('post', '/api/sync', routes.syncUpstreamApi, routeCtx);
      honoAdapter.registerApi('get', '/api/notes/export/csv', routes.exportCsvApi, routeCtx);
      honoAdapter.registerApi('get', '/api/notes/export/xlsx', routes.exportXlsxApi, routeCtx);
      honoAdapter.registerApi('get', '/api/v1/developer/notes', routes.developerNotesApi, routeCtx);
      honoAdapter.registerApi('get', '/api/internal/ops-metrics', routes.opsMetricsApi, routeCtx);
      honoAdapter.registerApi('post', '/api/queue/pubsub-push', routes.pubsubPushApi, routeCtx);
      honoAdapter.registerApi('get', '/api/canary', routes.canaryApi, routeCtx);

      // Prometheus metrics on Hono
      const honoMetricsManager = createMetricsManager({ enabled: true }, {
        db,
        cache,
        breakers,
      });

      honoAdapter.route('get', '/metrics', async (_req, res) => {
        const metricsStr = await honoMetricsManager.getPrometheusMetrics();
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return res.send(metricsStr);
      });

      honoAdapter.route('get', '/metrics.json', async (_req, res) => {
        const json = await honoMetricsManager.getJsonMetrics();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.send(JSON.stringify(json));
      });

      // Register SSR page on Hono
      honoAdapter.registerPage('/notes', routes.notesPage, routeCtx);
    });

    it('handles CORS preflight OPTIONS request on Hono (corsPlugin)', async () => {
      const res = await honoAdapter.request('http://localhost/api/notes', {
        method: 'OPTIONS',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('redirects /legacy-notes to /notes with HTTP 301 on Hono (redirectPlugin)', async () => {
      const res = await honoAdapter.request('http://localhost/legacy-notes', {
        method: 'GET',
      });

      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/notes');
    });

    it('responds to cloud liveness probe (/healthz) on Hono', async () => {
      const res = await honoAdapter.request('http://localhost/healthz', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(['ok', 'degraded']).toContain(data.status);
      expect(data).toHaveProperty('timestamp');
    });

    it('responds to cloud readiness probe (/readyz) on Hono verifying database connectivity', async () => {
      const res = await honoAdapter.request('http://localhost/readyz', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ready).toBe(true);
      expect(data.checks.database.status).toBe('up');
    });

    it('registers user and generates JWT token on Hono', async () => {
      const regRes = await honoAdapter.request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'hono-enterprise@webspresso.io', password: 'securePassword123' }),
      });
      expect(regRes.status).toBe(201);

      const loginRes = await honoAdapter.request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'hono-enterprise@webspresso.io', password: 'securePassword123' }),
      });
      expect(loginRes.status).toBe(200);
      const loginData = await loginRes.json();
      expect(typeof loginData.token).toBe('string');
      authToken = loginData.token;
    });

    it('rejects registration with HTTP 422 ValidationError on Hono when schema fails', async () => {
      const res = await honoAdapter.request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email', password: '12' }),
      });

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe('ValidationError');
      expect(data.status).toBe(422);
      expect(data.issues).toBeDefined();
    });

    it('rejects unauthenticated requests on Hono with HTTP 401', async () => {
      const missingRes = await honoAdapter.request('http://localhost/api/notes', {
        method: 'GET',
      });
      expect(missingRes.status).toBe(401);

      const tamperedRes = await honoAdapter.request('http://localhost/api/notes', {
        method: 'GET',
        headers: { Authorization: 'Bearer bad.token.here' },
      });
      expect(tamperedRes.status).toBe(401);
    });

    it('creates note on Hono, invalidates cache tag, dispatches Signal, and enqueues background job', async () => {
      const initialLogCount = auditLog.length;
      const initialQueueCount = queuedJobs.length;

      const res = await honoAdapter.request('http://localhost/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: 'High-Throughput Hono Worker',
          content: 'Webspresso running on Hono',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.title).toBe('High-Throughput Hono Worker');

      // Assert event listener intercepted note.created
      expect(auditLog.length).toBe(initialLogCount + 1);
      expect(auditLog[auditLog.length - 1].title).toBe('High-Throughput Hono Worker');

      // Allow background worker to process job
      for (let i = 0; i < 20; i++) {
        if (queuedJobs.length >= initialQueueCount + 1) break;
        await wait(5);
      }
      expect(queuedJobs.length).toBeGreaterThanOrEqual(initialQueueCount + 1);
      const enqueued = queuedJobs.find((j) => j.title === 'High-Throughput Hono Worker');
      expect(enqueued).toBeDefined();
    });

    it('serves cached note list from TaggedLruCache on Hono', async () => {
      const res = await honoAdapter.request('http://localhost/api/notes', {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBeGreaterThanOrEqual(1);

      const cached = cache.get(`notes:${data[0].userId}`);
      expect(cached).toBeDefined();
    });

    it('updates note via PUT /api/notes/:id on Hono and invalidates cache tag', async () => {
      const listRes = await honoAdapter.request('http://localhost/api/notes', {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const notes = await listRes.json();
      const targetNote = notes[0];

      const updateRes = await honoAdapter.request(`http://localhost/api/notes/${targetNote.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: 'Hono Updated Title',
          content: 'Hono Updated Content',
        }),
      });

      expect(updateRes.status).toBe(200);
      const updatedData = await updateRes.json();
      expect(updatedData.title).toBe('Hono Updated Title');

      // Verify cache tag evicted
      const cached = cache.get(`notes:${targetNote.userId}`);
      expect(cached).toBeUndefined();
    });

    it('returns HTTP 404 NotFoundError on Hono when fetching non-existent note', async () => {
      const res = await honoAdapter.request('http://localhost/api/notes/888888', {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('NotFoundError');
    });

    it('atomically rolls back ambient transaction on Hono when batch creation fails (transaction: true)', async () => {
      const initialCount = (await db.getRepository('Note').find()).length;

      const res = await honoAdapter.request('http://localhost/api/notes/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          items: [
            { title: 'Hono Atomic 1', content: 'C1' },
            { title: 'Hono Atomic 2', content: 'C2', shouldFail: true },
          ],
        }),
      });

      expect(res.status).toBe(500);

      // Verify zero records were inserted
      const currentCount = (await db.getRepository('Note').find()).length;
      expect(currentCount).toBe(initialCount);
    });

    it('atomically commits ambient transaction on Hono when batch creation succeeds (transaction: true)', async () => {
      const initialCount = (await db.getRepository('Note').find()).length;

      const res = await honoAdapter.request('http://localhost/api/notes/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          items: [
            { title: 'Hono Batch 1', content: 'Content 1' },
            { title: 'Hono Batch 2', content: 'Content 2' },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(2);

      const currentCount = (await db.getRepository('Note').find()).length;
      expect(currentCount).toBe(initialCount + 2);
    });

    it('deletes note via DELETE /api/notes/:id on Hono and dispatches note.deleted signal', async () => {
      const initialDelCount = deletedLog.length;

      const NoteRepo = db.getRepository('Note');
      const tempNote = await NoteRepo.create({
        userId: 2,
        title: 'Hono Deletion Target',
        content: 'Bye',
        published: true,
      });

      const res = await honoAdapter.request(`http://localhost/api/notes/${tempNote.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);

      // Assert event listener intercepted
      expect(deletedLog.length).toBe(initialDelCount + 1);
      expect(deletedLog[deletedLog.length - 1].title).toBe('Hono Deletion Target');
    });

    it('exports notes as RFC 4180 CSV on Hono via csvPlugin (csv.exportModel)', async () => {
      const res = await honoAdapter.request('http://localhost/api/notes/export/csv', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const csvText = await res.text();
      expect(csvText).toContain('Hono Batch 1');
      expect(csvText).toContain('Hono Updated Title');
    });

    it('exports notes as XLSX spreadsheet on Hono via xlsxPlugin (xlsx.exportModel)', async () => {
      const res = await honoAdapter.request('http://localhost/api/notes/export/xlsx', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.headers.get('content-disposition')).toContain('attachment; filename="notes.xlsx"');

      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      // Valid XLSX file starts with ZIP magic header PK\x03\x04
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    });

    it('authenticates B2B developer on Hono via apiKeyPlugin with granular scopes', async () => {
      // 1. Missing API Key -> 401 Unauthorized
      const unauthRes = await honoAdapter.request('http://localhost/api/v1/developer/notes', {
        method: 'GET',
      });
      expect(unauthRes.status).toBe(401);

      // 2. API Key with insufficient scope -> 403 Forbidden
      const forbidRes = await honoAdapter.request('http://localhost/api/v1/developer/notes', {
        method: 'GET',
        headers: { 'X-API-Key': limitedApiKey },
      });
      expect(forbidRes.status).toBe(403);

      // 3. API Key with notes:read scope -> 200 OK
      const okRes = await honoAdapter.request('http://localhost/api/v1/developer/notes', {
        method: 'GET',
        headers: { 'X-API-Key': devApiKey },
      });
      expect(okRes.status).toBe(200);
      const data = await okRes.json();
      expect(data.apiKeyName).toBe('Developer Partner');
      expect(data.data.length).toBeGreaterThanOrEqual(1);
    });

    it('authenticates ops operator on Hono via basicAuthPlugin with WWW-Authenticate header', async () => {
      // 1. Missing credentials -> 401 with WWW-Authenticate header
      const unauthRes = await honoAdapter.request('http://localhost/api/internal/ops-metrics', {
        method: 'GET',
      });
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.headers.get('www-authenticate')).toContain('Basic realm="Ops Monitoring System"');

      // 2. Invalid credentials -> 401
      const badRes = await honoAdapter.request('http://localhost/api/internal/ops-metrics', {
        method: 'GET',
        headers: { Authorization: 'Basic ' + Buffer.from('opsadmin:wrongpass').toString('base64') },
      });
      expect(badRes.status).toBe(401);

      // 3. Valid credentials -> 200 OK
      const okRes = await honoAdapter.request('http://localhost/api/internal/ops-metrics', {
        method: 'GET',
        headers: { Authorization: BASIC_AUTH_HEADER },
      });
      expect(okRes.status).toBe(200);
      const data = await okRes.json();
      expect(data.status).toBe('healthy');
      expect(data.operator).toBe(BASIC_AUTH_USER);
    });

    it('exercises Circuit Breaker & Retry resilience fallback on Hono', async () => {
      const failRes = await honoAdapter.request('http://localhost/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateFailure: true }),
      });

      const data = await failRes.json();
      expect(data.fallback).toBe(true);
      expect(data.status).toBe('degraded');
    });

    it('serves Prometheus exposition format at /metrics on Hono', async () => {
      const res = await honoAdapter.request('http://localhost/metrics', {
        method: 'GET',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toContain('webspresso_http_requests_total');
    });

    it('processes Google Cloud Pub/Sub push subscription webhook on Hono (/api/queue/pubsub-push)', async () => {
      const initialCount = queuedJobs.length;

      const pubsubPayload = {
        message: {
          messageId: 'pubsub-hono-msg-1',
          data: Buffer.from(JSON.stringify({
            name: 'notes.push-notification',
            data: { recipient: 'hono_push_user', alert: 'Push via Hono' },
          })).toString('base64'),
        },
      };

      const res = await honoAdapter.request('http://localhost/api/queue/pubsub-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pubsubPayload),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('OK');

      expect(queuedJobs.length).toBeGreaterThanOrEqual(initialCount + 1);
      const found = queuedJobs.find((j) => j.recipient === 'hono_push_user');
      expect(found).toBeDefined();
    });

    it('renders server-side HTML page on Hono with loaded data', async () => {
      const res = await honoAdapter.request('http://localhost/notes', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('All Notes');
      expect(html).toContain('Hono Updated Title');
    });

    it('supports native TCP socket binding via listen() on Hono', async () => {
      const server = honoAdapter.listen(0);
      await new Promise((resolve) => server.on('listening', resolve));
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/healthz`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(['ok', 'degraded']).toContain(data.status);

      await new Promise((resolve) => server.close(resolve));
    });

    it('enforces feature flag guards on Hono via core/flags (404 for regular users, 200 for VIP)', async () => {
      // 1. Regular request gets 404
      const blockedRes = await honoAdapter.request('http://localhost/api/canary', {
        method: 'GET',
      });
      expect(blockedRes.status).toBe(404);
      const blockedBody = await blockedRes.json();
      expect(blockedBody).toHaveProperty('error', 'Not Found');
      expect(blockedBody).toHaveProperty('feature', 'canary_feature');

      // 2. VIP user gets 200
      const allowedRes = await honoAdapter.request('http://localhost/api/canary', {
        method: 'GET',
        headers: {
          'x-user-id': 'vip_user',
        },
      });
      expect(allowedRes.status).toBe(200);
      const allowedBody = await allowedRes.json();
      expect(allowedBody).toEqual({ allowed: true, message: 'Canary feature unlocked' });
    });

    it('executes type-safe client operations end-to-end on Hono via createWebspressoClient', async () => {
      const mockFetch = async (url, opts = {}) => {
        const fullUrl = url.startsWith('http') ? url : `http://localhost${url.startsWith('/') ? '' : '/'}${url}`;
        return honoAdapter.request(fullUrl, opts);
      };

      const client = createWebspressoClient({
        baseUrl: 'http://localhost',
        fetch: mockFetch,
        getToken: () => authToken,
      });

      // 1. List notes via client
      const notes = await client.api.notes.get();
      expect(Array.isArray(notes)).toBe(true);

      // 2. Create note via client
      const created = await client.api.notes.post({
        body: {
          title: 'Hono Client Created Note',
          content: 'Created via type-safe client proxy on Hono',
          tags: ['hono', 'client', 'integration'],
        },
      });
      expect(created).toBeDefined();
      expect(created.title).toBe('Hono Client Created Note');
    });
  });

  describe('3. Cross-Framework Consistency & Parity Verification', () => {
    it('shares underlying database records seamlessly between Express and Hono', async () => {
      const allNotes = await db.getRepository('Note').find();
      expect(allNotes.length).toBeGreaterThanOrEqual(4);

      const expressNote = allNotes.find((n) => n.title.includes('Microservices & Core Decoupling') || n.title.includes('Updated Title'));
      const honoNote = allNotes.find((n) => n.title.includes('High-Throughput Hono Worker') || n.title.includes('Hono Updated Title'));

      expect(expressNote).toBeDefined();
      expect(honoNote).toBeDefined();
    });

    it('shares domain services, circuit breaker state, events, and background jobs seamlessly', async () => {
      expect(services.has('user.register')).toBe(true);
      expect(services.has('user.login')).toBe(true);
      expect(services.has('notes.create')).toBe(true);
      expect(services.has('notes.list')).toBe(true);
      expect(services.has('notes.update')).toBe(true);
      expect(services.has('notes.delete')).toBe(true);
      expect(services.has('notes.batch-create')).toBe(true);
      expect(services.has('sync.upstream')).toBe(true);
      expect(services.has('csv.exportModel')).toBe(true);
      expect(services.has('xlsx.exportModel')).toBe(true);

      // Verify audit logs contain creations from both Express and Hono
      const expressAudited = auditLog.find((a) => a.title === 'Microservices & Core Decoupling');
      const honoAudited = auditLog.find((a) => a.title === 'High-Throughput Hono Worker');

      expect(expressAudited).toBeDefined();
      expect(honoAudited).toBeDefined();

      // Verify deletion log contains deletions from both Express and Hono
      const expressDeleted = deletedLog.find((d) => d.title === 'Temp Note for Deletion');
      const honoDeleted = deletedLog.find((d) => d.title === 'Hono Deletion Target');

      expect(expressDeleted).toBeDefined();
      expect(honoDeleted).toBeDefined();

      // Verify background queue executed jobs from both Express and Hono
      const expressQueued = queuedJobs.find((j) => j.title === 'Microservices & Core Decoupling');
      const honoQueued = queuedJobs.find((j) => j.title === 'High-Throughput Hono Worker');

      expect(expressQueued).toBeDefined();
      expect(honoQueued).toBeDefined();
    });

    it('verifies transactional atomicity integrity across all batch operations', async () => {
      // Ensure no dangling partial notes exist from aborted batch transactions
      const failedNotes = await db.getRepository('Note').find({ title: 'Atomic Note 1' });
      expect(failedNotes.length).toBe(0);

      const failedHonoNotes = await db.getRepository('Note').find({ title: 'Hono Atomic 1' });
      expect(failedHonoNotes.length).toBe(0);

      // Verify successfully committed batches exist
      const committedNotes = await db.getRepository('Note').find({ title: 'Atomic Success 1' });
      expect(committedNotes.length).toBe(1);

      const committedHonoNotes = await db.getRepository('Note').find({ title: 'Hono Batch 1' });
      expect(committedHonoNotes.length).toBe(1);
    });
  });
});
