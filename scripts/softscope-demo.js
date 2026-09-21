'use strict';

process.env.BENCHMARK = 'true';
process.env.NODE_ENV = 'production';

/**
 * Webspresso Fullstack Showcase & Traffic Harness for Softscope
 * 
 * Exercises:
 * - Server-Side Rendering (Nunjucks layouts, partials, i18n, fsy helpers)
 * - Dynamic routes & Loaders (pages/tools/[slug].js + [slug].njk)
 * - Compression (Brotli / Gzip streaming)
 * - SQLite in-memory ORM with relations & smart query caching
 * - Services layer (Zod schemas, cache memoization, transactions)
 * - File-based API routes & custom API routes with validation
 * - Centralized Error boundary (404 / 500)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const knexFactory = require('knex');

const { createApp } = require('../src/server');
const { createDatabase, defineModel, zdb, clearRegistry } = require('../core/orm');
const { defineService } = require('../src/services');

const SQLITE_FILE = path.join(__dirname, 'softscope-demo.sqlite');

async function setupDatabase() {
  if (fs.existsSync(SQLITE_FILE)) {
    fs.unlinkSync(SQLITE_FILE);
  }

  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: SQLITE_FILE },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('email').notNullable();
    t.string('role').defaultTo('author');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('articles', (t) => {
    t.increments('id').primary();
    t.string('title').notNullable();
    t.string('slug').notNullable().unique();
    t.text('content');
    t.integer('user_id').references('id').inTable('users');
    t.integer('views').defaultTo(0);
    t.boolean('is_published').defaultTo(true);
    t.timestamps(true, true);
  });

  // Seed sample data
  const [authorId] = await knex('users').insert({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
  });

  await knex('articles').insert([
    {
      title: 'Getting Started with Webspresso',
      slug: 'getting-started-with-webspresso',
      content: 'Webspresso is a lightweight SSR and API framework for Node.js.',
      user_id: authorId,
      views: 142,
      is_published: true,
    },
    {
      title: 'High Performance Node.js Routing',
      slug: 'high-performance-routing',
      content: 'Zero-overhead route matching and memoized resolution.',
      user_id: authorId,
      views: 95,
      is_published: true,
    },
    {
      title: 'Dual Authentication in Practice',
      slug: 'dual-authentication',
      content: 'Combining stateful sessions and stateless JWT tokens cleanly.',
      user_id: authorId,
      views: 230,
      is_published: true,
    },
  ]);

  clearRegistry();

  const db = createDatabase({
    client: 'better-sqlite3',
    connection: { filename: SQLITE_FILE },
    useNullAsDefault: true,
    cache: 'smart',
  });
  db.knex = knex;

  const User = defineModel({
    name: 'User',
    table: 'users',
    schema: z.object({
      id: zdb.id().optional(),
      name: zdb.string(),
      email: zdb.string().email(),
      role: zdb.string().default('author'),
    }),
    relations: {
      articles: {
        type: 'hasMany',
        model: () => Article,
        foreignKey: 'user_id',
      },
    },
  });

  const Article = defineModel({
    name: 'Article',
    table: 'articles',
    schema: z.object({
      id: zdb.id().optional(),
      title: zdb.string(),
      slug: zdb.string(),
      content: zdb.string().optional(),
      user_id: zdb.integer().optional(),
      views: zdb.integer().default(0),
      is_published: zdb.boolean().default(true),
    }),
    relations: {
      user: {
        type: 'belongsTo',
        model: () => User,
        foreignKey: 'user_id',
      },
    },
    scopes: {
      published: (qb) => qb.where('is_published', true),
      popular: (qb) => qb.where('views', '>', 100),
    },
    cache: 'smart',
  });

  db.registerModel(User);
  db.registerModel(Article);

  return { db, knex };
}

async function runHarness() {
  const { db, knex } = await setupDatabase();

  const appInstance = createApp({
    pagesDir: path.join(__dirname, '../pages'),
    viewsDir: path.join(__dirname, '../views'),
    publicDir: path.join(__dirname, '../public'),
    db,
    logging: false,
    server: {
      compression: true,
      shutdown: { enabled: true, timeout: 2000 },
    },
    pageAssets: true,
    clientRuntime: { alpine: true, swup: true },
    setupRoutes: (app) => {
      // Register custom services directly
      const registry = app.serviceRegistry;

      registry.register('article.get', defineService({
        schema: ({ z: zod }) => zod.object({ slug: zod.string() }),
        cache: { ttl: '30s' },
        handler: async ({ slug }, ctx) => {
          const repo = ctx.db.getRepository('Article');
          const article = await repo.findOne({ slug });
          return article;
        },
      }));

      registry.register('article.list', defineService({
        schema: ({ z: zod }) => zod.object({
          page: zod.coerce.number().default(1),
          limit: zod.coerce.number().default(10),
        }),
        handler: async ({ page, limit }, ctx) => {
          const repo = ctx.db.getRepository('Article');
          return repo.query().where('is_published', true).paginate({ page, limit });
        },
      }));

      registry.register('article.create', defineService({
        schema: ({ z: zod }) => zod.object({
          title: zod.string().min(3),
          slug: zod.string().min(3),
          content: zod.string().optional(),
        }),
        handler: async (input, ctx) => {
          const repo = ctx.db.getRepository('Article');
          return repo.create({ ...input, views: 0, is_published: true });
        },
      }));

      registry.register('stats.compute', defineService({
        handler: async (_input, ctx) => {
          const repo = ctx.db.getRepository('Article');
          const count = await repo.query().count();
          return { totalArticles: count, timestamp: Date.now() };
        },
      }));

      // Extra API endpoints to exercise services & ORM
      app.get('/api/demo/articles', async (req, res) => {
        const data = await req.service('article.list', req.query);
        res.json(data);
      });

      app.get('/api/demo/articles/:slug', async (req, res) => {
        const data = await req.service('article.get', { slug: req.params.slug });
        if (!data) return res.status(404).json({ error: 'Article not found' });
        res.json(data);
      });

      app.post('/api/demo/articles', async (req, res) => {
        const data = await req.service('article.create', req.body);
        res.status(201).json(data);
      });

      app.get('/api/demo/stats', async (req, res) => {
        const data = await req.service('stats.compute');
        res.json(data);
      });

      app.get('/api/demo/orm-include', async (req, res) => {
        const articles = await req.db.getRepository('Article').findAll({ with: ['user'] });
        res.json(articles);
      });
    },
  });

  const app = appInstance.app;

  // Start HTTP server on random port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: 50,
  });

  function makeRequest(pathName, options = {}) {
    return new Promise((resolve, reject) => {
      const reqOpts = {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        method: options.method || 'GET',
        headers: {
          'connection': 'keep-alive',
          'user-agent': 'Webspresso-LoadTest/1.0',
          ...(options.headers || {}),
        },
        agent,
      };

      const req = http.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  // Workload definition
  const tasks = [
    // SSR Home Page with Gzip compression
    { path: '/', headers: { 'accept-encoding': 'gzip', 'accept-language': 'en' } },
    // SSR Home Page in German
    { path: '/', headers: { 'accept-language': 'de' } },
    // Dynamic SSR Tool Page
    { path: '/tools/json-formatter', headers: { 'accept-encoding': 'gzip' } },
    // API Health
    { path: '/api/health' },
    // API Echo (POST JSON)
    {
      path: '/api/echo',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Softscope Benchmark', timestamp: Date.now() }),
    },
    // API Demo Articles List
    { path: '/api/demo/articles?page=1&limit=5' },
    // API Demo Single Article (smart cache hit/miss)
    { path: '/api/demo/articles/getting-started-with-webspresso' },
    // API ORM Relation Eager Loading
    { path: '/api/demo/orm-include' },
    // API Stats Service
    { path: '/api/demo/stats' },
    // 404 Error boundary
    { path: '/non-existent-benchmark-path' },
  ];

  const TOTAL_REQUESTS = 1200;
  const CONCURRENCY = 25;

  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  const taskStats = tasks.map((t) => ({ path: t.path, method: t.method || 'GET', count: 0, totalMs: 0 }));

  // Worker loop
  async function worker() {
    while (true) {
      const idx = completed++;
      if (idx >= TOTAL_REQUESTS) break;

      const taskIdx = idx % tasks.length;
      const task = tasks[taskIdx];
      const t0 = Date.now();
      try {
        const res = await makeRequest(task.path, task);
        const elapsed = Date.now() - t0;
        taskStats[taskIdx].count++;
        taskStats[taskIdx].totalMs += elapsed;
        if (res.statusCode >= 200 && res.statusCode < 500) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startTime;
  const reqPerSec = Math.round((TOTAL_REQUESTS / (durationMs / 1000)));

  console.log(`\n========================================`);
  console.log(`Webspresso Traffic Load Complete`);
  console.log(`========================================`);
  console.log(`Total Requests : ${TOTAL_REQUESTS}`);
  console.log(`Concurrency    : ${CONCURRENCY}`);
  console.log(`Successful     : ${successCount}`);
  console.log(`Failed (>=500) : ${errorCount}`);
  console.log(`Total Time     : ${durationMs} ms`);
  console.log(`Throughput     : ${reqPerSec} req/sec`);
  console.log(`========================================`);
  console.log(`Task Breakdown (Average Latency per Endpoint):`);
  for (const s of taskStats) {
    const avg = (s.totalMs / (s.count || 1)).toFixed(2);
    console.log(`  ${s.method.padEnd(5)} ${s.path.padEnd(45)} : ${avg.padStart(6)} ms avg (${s.count} reqs)`);
  }
  console.log(`========================================\n`);

  agent.destroy();
  await new Promise((resolve) => server.close(resolve));
  await knex.destroy();
  if (fs.existsSync(SQLITE_FILE)) {
    try { fs.unlinkSync(SQLITE_FILE); } catch {}
  }
}

runHarness()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Harness error:', err);
    if (fs.existsSync(SQLITE_FILE)) {
      try { fs.unlinkSync(SQLITE_FILE); } catch {}
    }
    process.exit(1);
  });
