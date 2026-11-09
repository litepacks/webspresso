'use strict';

/**
 * Webspresso Fullstack Example — application factory.
 *
 * `createFullstackApp()` boots the database (migrations + seed), authentication and the
 * HTTP app. It is used by `server.js` for local development and by `benchmarks/` to run
 * every benchmark against a realistic, feature-complete application.
 */
const path = require('path');
const { createApp, createDatabase, quickAuth, plugins } = require('./lib/webspresso');
const { seed } = require('./db/seed');

const ROOT = __dirname;
const DEV_SECRET = 'webspresso-fullstack-example-dev-secret-change-me';

/**
 * @param {Object} [options]
 * @param {string} [options.filename=':memory:'] - SQLite file (use ':memory:' for ephemeral runs)
 * @param {boolean|Object} [options.seed=true] - Seed volumes `{ users, posts, commentsPerPost }` or false
 * @param {boolean} [options.logging] - Request logging (defaults to dev-mode behavior)
 * @param {boolean} [options.queueAutoStart] - Start the background queue worker
 * @returns {Promise<{ app: import('express').Express, db: any, auth: any, close: () => Promise<void> }>}
 */
async function createFullstackApp(options = {}) {
  const secret = process.env.APP_SECRET || DEV_SECRET;

  // 1. Database: models are auto-loaded from ./models, schema comes from ./migrations
  const db = createDatabase({
    client: 'better-sqlite3',
    connection: { filename: options.filename || ':memory:' },
    useNullAsDefault: true,
    models: path.join(ROOT, 'models'),
    migrations: { directory: path.join(ROOT, 'migrations') },
    // ORM query cache (memory provider); per-model strategy via `cache: 'auto'` in models/
    cache: true,
  });

  await db.migrate.latest();

  const seedOpts = options.seed === undefined ? true : options.seed;
  if (seedOpts) {
    const hasData = await db.getRepository('User').count();
    if (!hasData) await seed(db, typeof seedOpts === 'object' ? seedOpts : {});
  }

  // 2. Native dual auth (session + stateless JWT) backed by the User model
  const auth = quickAuth({
    db,
    rememberMe: false,
    session: { secret },
    jwt: { secret, expiresIn: '15m', refreshExpiresIn: '30d' },
  });

  // 3. HTTP application
  const { app } = createApp({
    rootDir: ROOT,
    pagesDir: path.join(ROOT, 'pages'),
    viewsDir: path.join(ROOT, 'views'),
    publicDir: path.join(ROOT, 'public'),
    servicesDir: path.join(ROOT, 'services'),
    jobsDir: path.join(ROOT, 'jobs'),
    listenersDir: path.join(ROOT, 'listeners'),
    queueAutoStart: options.queueAutoStart,
    logging: options.logging,
    secret,
    db,
    auth,
    errorPages: { notFound: '404.njk' },
    limits: { json: '256kb', urlencoded: '256kb' },
    healthCheck: true,
    metrics: true,
    earlyHints: true,
    cache: { maxEntries: 2000, maxMemoryMb: 32 },
    server: {
      compression: true,
      shutdown: { enabled: true, timeout: 5000 },
    },
    plugins: [
      plugins.corsPlugin({ origin: '*', methods: ['GET', 'POST'] }),
      plugins.redirectPlugin({ rules: [{ from: '/blog', to: '/posts', status: 301 }] }),
    ],
  });

  if (typeof app.whenReady === 'function') await app.whenReady();

  async function close() {
    try {
      if (app.queue && typeof app.queue.stop === 'function') await app.queue.stop();
    } catch (_) { /* ignore */ }
    await db.knex.destroy();
  }

  return { app, db, auth, close };
}

module.exports = { createFullstackApp };
