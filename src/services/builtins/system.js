/**
 * Built-in System, Maintenance & Health Check Services
 * @module src/services/builtins/system
 */

const os = require('os');
const { z } = require('zod');
const { cleanExpiredTokens, createKnexAuthTokensAdapter } = require('../../../core/auth/tokens');

/**
 * Format memory usage bytes into human-readable MB
 * @param {number} bytes
 * @returns {string}
 */
function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Create built-in system services map
 * @param {Object} [options]
 * @param {Object} [options.db] - Database or knex instance
 * @param {import('../registry').ServiceRegistry} [options.serviceRegistry] - ServiceRegistry instance
 * @param {Object} [options.pluginManager] - PluginManager instance
 * @returns {Record<string, Object>}
 */
function createSystemServices(options = {}) {
  const { db, serviceRegistry, pluginManager } = options;

  return {
    'system.health': {
      schema: z.object({
        detailed: z.boolean().default(false),
      }),
      async handler(input, ctx) {
        const activeDb = ctx.db || db;
        const memory = process.memoryUsage();
        const uptime = process.uptime();
        const timestamp = new Date();

        let dbStatus = 'disconnected';
        let dbLatencyMs = null;

        if (activeDb) {
          const knex = activeDb.knex || activeDb;
          const startPing = Date.now();
          try {
            await knex.raw('SELECT 1');
            dbStatus = 'connected';
            dbLatencyMs = Date.now() - startPing;
          } catch (err) {
            dbStatus = 'error';
          }
        }

        const isHealthy = dbStatus !== 'error';

        const result = {
          status: isHealthy ? 'ok' : 'degraded',
          uptime,
          uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
          timestamp,
          database: {
            status: dbStatus,
            latencyMs: dbLatencyMs,
          },
          memory: {
            rss: formatMb(memory.rss),
            heapUsed: formatMb(memory.heapUsed),
            heapTotal: formatMb(memory.heapTotal),
            external: formatMb(memory.external),
          },
        };

        if (activeDb?.cache && typeof activeDb.cache.stats === 'function') {
          result.cache = activeDb.cache.stats();
        }

        return result;
      },
    },

    'system.cleanup': {
      schema: z.object({
        olderThanDays: z.number().int().positive().default(90),
        purgeAuthTokens: z.boolean().default(true),
        purgeAuditLogs: z.boolean().default(true),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { olderThanDays, purgeAuthTokens, purgeAuditLogs } = input;
        const activeDb = ctx.db || db;
        if (!activeDb) {
          throw new Error('Database instance is required for system.cleanup');
        }

        const knex = activeDb.knex || activeDb;
        const purged = {};

        // 1. Purge expired auth tokens
        if (purgeAuthTokens) {
          try {
            const hasAuthTokensTable = await knex.schema.hasTable('auth_tokens');
            if (hasAuthTokensTable) {
              const now = new Date();
              const count = await knex('auth_tokens').where('expires_at', '<', now).delete();
              purged.authTokens = count;
            } else {
              purged.authTokens = 0;
            }
          } catch (err) {
            purged.authTokens = 0;
          }
        }

        // 2. Purge old audit logs if table exists
        if (purgeAuditLogs) {
          try {
            const hasAuditTable = await knex.schema.hasTable('audit_logs');
            if (hasAuditTable) {
              const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
              const deleted = await knex('audit_logs').where('created_at', '<', cutoff).delete();
              purged.auditLogs = deleted;
            } else {
              purged.auditLogs = 0;
            }
          } catch (err) {
            purged.auditLogs = 0;
          }
        }

        return {
          success: true,
          purged,
          timestamp: new Date(),
        };
      },
    },

    'system.cache-flush': {
      schema: z.object({
        scope: z.enum(['all', 'orm', 'services']).default('all'),
        model: z.string().optional(),
      }),
      auth: 'admin',
      async handler(input, ctx) {
        const { scope, model } = input;
        const activeDb = ctx.db || db;
        const registry = ctx.serviceRegistry || serviceRegistry;

        let ormCachePurged = false;
        let serviceCacheCleared = false;

        // 1. Flush ORM Cache
        if (scope === 'all' || scope === 'orm') {
          if (activeDb?.cache && typeof activeDb.cache.purge === 'function') {
            activeDb.cache.purge(model);
            ormCachePurged = true;
          } else if (activeDb?.cache && typeof activeDb.cache.clear === 'function') {
            activeDb.cache.clear();
            ormCachePurged = true;
          }
        }

        // 2. Clear Service Memoization Caches
        if (scope === 'all' || scope === 'services') {
          if (registry && typeof registry.clearCache === 'function') {
            registry.clearCache();
            serviceCacheCleared = true;
          }
        }

        return {
          success: true,
          scope,
          model: model || null,
          ormCachePurged,
          serviceCacheCleared,
          timestamp: new Date(),
        };
      },
    },

    'system.info': {
      schema: z.object({}),
      auth: 'admin',
      async handler(input, ctx) {
        const activeDb = ctx.db || db;
        const registry = ctx.serviceRegistry || serviceRegistry;
        const pm = ctx.pluginManager || pluginManager;

        const models = activeDb && typeof activeDb.getAllModelInstances === 'function'
          ? activeDb.getAllModelInstances().map(m => m.name)
          : [];

        const services = registry && typeof registry.list === 'function'
          ? registry.list()
          : [];

        const plugins = pm && pm.plugins
          ? Array.from(pm.plugins.keys())
          : [];

        return {
          nodeVersion: process.version,
          platform: os.platform(),
          arch: os.arch(),
          pid: process.pid,
          uptime: process.uptime(),
          models,
          services,
          plugins,
        };
      },
    },
  };
}

module.exports = {
  createSystemServices,
};
