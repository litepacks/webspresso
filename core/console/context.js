'use strict';

/**
 * Webspresso - Interactive Console Context Builder
 * Bootstraps database, models, services, background queues, events, feature flags,
 * and caches into a unified REPL execution context.
 * @module core/console/context
 */

const path = require('path');
const fs = require('fs');
const { resolveDbConfigIfExists, createDbInstance } = require('../../bin/utils/db');
const { createDatabase, getAllModels } = require('../orm');
const { createServiceRegistry } = require('../../src/services');
const { createQueueDispatcher } = require('../queue');
const { createEventDispatcher } = require('../events');
const { createFeatureFlagManager } = require('../flags');
const { createTaggedLruCache } = require('../cache');
const { createMailer } = require('../mail');

/**
 * Check if a string is a valid JavaScript identifier that can be bound directly to context
 * @param {string} name
 * @returns {boolean}
 */
function isValidIdentifier(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Clear require cache for all files inside a given directory
 * @param {string} dirPath
 */
function clearRequireCacheForDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const resolved = path.resolve(dirPath);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(resolved)) {
      delete require.cache[key];
    }
  }
}

/**
 * Build the full Webspresso console context
 * @param {Object} [options]
 * @param {string} [options.rootDir] - Application root directory (default: process.cwd())
 * @param {string} [options.configPath] - Optional path to database configuration
 * @param {string} [options.env] - Node environment (default: 'development')
 * @param {Object} [options.db] - Pre-instantiated database
 * @param {Object} [options.services] - Pre-instantiated service registry
 * @param {Object} [options.queue] - Pre-instantiated queue dispatcher
 * @param {Object} [options.flags] - Pre-instantiated feature flag manager
 * @returns {Promise<{ context: Object, meta: Object, teardown: Function }>}
 */
async function buildConsoleContext(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const env = options.env || process.env.NODE_ENV || 'development';

  let knexInstance = null;
  let db = options.db || null;
  let services = options.services || null;
  let queue = options.queue || null;
  const events = options.events || createEventDispatcher();
  const mailer = options.mailer || createMailer({ backend: 'console' });
  const cache = options.cache || createTaggedLruCache({ maxEntries: 1000 });
  const flags = options.flags || createFeatureFlagManager();

  // 1. Initialize Database & Models
  const models = {};
  if (!db) {
    try {
      const dbInfo = resolveDbConfigIfExists(options.configPath);
      if (dbInfo) {
        knexInstance = await createDbInstance(dbInfo.config, env);
        db = createDatabase({
          knex: knexInstance,
          models: path.resolve(rootDir, 'models'),
        });
      }
    } catch (err) {
      // Allow console to open even if DB fails to boot
    }
  }

  // Populate models map and direct model shortcuts
  function refreshModels() {
    for (const key of Object.keys(models)) {
      delete models[key];
    }
    if (db) {
      const registered = getAllModels();
      for (const [name] of registered) {
        try {
          const repo = db.getRepository(name);
          models[name] = repo;
        } catch (_) {}
      }
    }
  }
  refreshModels();

  // 2. Initialize Services
  const servicesDir = path.resolve(rootDir, 'services');
  if (!services && fs.existsSync(servicesDir)) {
    try {
      services = createServiceRegistry({ servicesDir, isDev: true });
    } catch (_) {}
  }

  // 3. Initialize Queue
  if (!queue) {
    try {
      queue = createQueueDispatcher({ db: knexInstance });
    } catch (_) {
      queue = { dispatch: async () => {} };
    }
  }

  // Framework main entry point
  let webspresso = null;
  try {
    webspresso = require('../../index');
  } catch (_) {}

  // Ensure events has dispatch alias for emitAsync
  if (events && typeof events.emitAsync === 'function' && typeof events.dispatch !== 'function') {
    events.dispatch = events.emitAsync.bind(events);
  }

  // 4. Build Context Sandbox
  const context = {
    db,
    models,
    services,
    service: (name, input, ctx = {}) => {
      if (!services) throw new Error('No services registered in this application.');
      return services.call(name, input, ctx);
    },
    queue,
    events,
    flags,
    cache,
    mailer,
    webspresso,
    env,
    rootDir,
  };
  context.context = context;

  // Helpful help() function
  context.help = function help() {
    console.log(`
☕ Webspresso Interactive Console Help
─────────────────────────────────────────────────────────────────
Preloaded objects in context:
  • db                     - Knex / ORM database instance
  • <Model>                - Model repository shortcuts (e.g. Note.find())
  • models                 - Map of all loaded model repositories
  • services               - Service registry
  • service(name, payload) - Invoke any business service directly
  • queue                  - Background job queue dispatcher
  • events                 - Decoupled event dispatcher
  • flags                  - Feature flag manager
  • cache                  - High-performance Tagged LRU cache
  • mailer                 - Framework mailer service
  • webspresso             - Framework root module
  • reload()               - Hot-reload models and services from disk

REPL Dot Commands:
  • .models    - List loaded models, tables, and relations
  • .services  - List registered business services
  • .routes    - Scan and list API endpoints and SSR pages
  • .flags     - List active feature flags and targeting rules
  • .reload    - Hot-reload models and services without restarting
  • .exit      - Exit the console (Ctrl+D)
─────────────────────────────────────────────────────────────────
`);
  };

  // Bind model shortcuts directly on context (e.g. Note, User)
  function bindModelShortcuts() {
    for (const [name, repo] of Object.entries(models)) {
      if (isValidIdentifier(name) && !(name in context && name !== 'Note' && name !== 'User')) {
        context[name] = repo;
      }
    }
  }
  bindModelShortcuts();

  // 5. Reload helper
  context.reload = async function reload() {
    const modelsDir = path.resolve(rootDir, 'models');
    clearRequireCacheForDir(modelsDir);
    clearRequireCacheForDir(servicesDir);

    // Re-require model files
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
      for (const file of files) {
        try {
          require(path.join(modelsDir, file));
        } catch (_) {}
      }
    }

    refreshModels();
    bindModelShortcuts();

    if (fs.existsSync(servicesDir)) {
      try {
        const newRegistry = createServiceRegistry({ servicesDir, isDev: true });
        context.services = newRegistry;
        services = newRegistry;
      } catch (_) {}
    }

    return {
      models: Object.keys(models),
      services: services ? services.list().map((s) => (typeof s === 'string' ? s : (s?.name || s))) : [],
    };
  };

  // 6. Metadata summary
  const modelNames = Object.keys(models);
  const serviceList = services && typeof services.list === 'function' ? services.list() : [];
  const serviceNames = serviceList.map((s) => (typeof s === 'string' ? s : (s?.name || s)));

  const meta = {
    env,
    rootDir,
    hasDb: Boolean(db),
    modelsCount: modelNames.length,
    modelNames,
    hasServices: Boolean(services),
    servicesCount: serviceNames.length,
    serviceNames,
  };

  // 7. Graceful teardown
  const teardown = async function teardown() {
    if (knexInstance && typeof knexInstance.destroy === 'function') {
      try {
        await knexInstance.destroy();
      } catch (_) {}
    }
  };

  return {
    context,
    meta,
    teardown,
  };
}

module.exports = {
  buildConsoleContext,
  isValidIdentifier,
  clearRequireCacheForDir,
};
