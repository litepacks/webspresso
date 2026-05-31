const fs = require('fs');
const path = require('path');
const PKG = require('../../../package.json');

/**
 * @param {string} status
 * @returns {'healthy'|'warning'|'critical'}
 */
function aggregateStatus(statuses) {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

/**
 * @param {object} ctx
 */
async function collectHealth(ctx) {
  const checks = [];
  const nodeEnv = process.env.NODE_ENV || 'development';

  checks.push({
    id: 'runtime',
    label: 'Node.js runtime',
    status: 'healthy',
    detail: `${process.version} (${process.platform})`,
  });

  checks.push({
    id: 'framework',
    label: 'Webspresso',
    status: 'healthy',
    detail: PKG.version || 'unknown',
  });

  checks.push({
    id: 'adapter',
    label: 'Adapter',
    status: 'healthy',
    detail: ctx.options?._manifestMode ? 'cloudflare-manifest' : 'node',
  });

  let dbStatus = 'healthy';
  let dbDetail = 'Not configured';
  const db = ctx.db || ctx.options?.db;
  if (db?.knex) {
    try {
      await db.knex.raw('select 1');
      dbDetail = 'Connected';
    } catch (e) {
      dbStatus = 'critical';
      dbDetail = e.message;
    }
  }
  checks.push({ id: 'database', label: 'Database', status: dbStatus, detail: dbDetail });

  let migrationStatus = 'healthy';
  let migrationDetail = 'No database';
  if (db?.knex) {
    try {
      const migrationConfig = db.knex.client.config.migrations || { directory: './migrations' };
      const [, pending] = await db.knex.migrate.list(migrationConfig);
      if (pending.length > 0) {
        migrationStatus = 'warning';
        migrationDetail = `${pending.length} pending migration(s)`;
      } else {
        migrationDetail = 'Up to date';
      }
    } catch (e) {
      migrationStatus = 'warning';
      migrationDetail = e.message;
    }
  }
  checks.push({ id: 'migrations', label: 'Migrations', status: migrationStatus, detail: migrationDetail });

  const pm = ctx.pluginManager;
  let pluginStatus = 'healthy';
  let pluginDetail = 'No plugins';
  if (pm?.plugins?.size) {
    const health = pm.pluginHealth || new Map();
    const failed = [...health.values()].filter((h) => h.status === 'failed');
    if (failed.length) {
      pluginStatus = 'warning';
      pluginDetail = `${failed.length} plugin issue(s)`;
    } else {
      pluginDetail = `${pm.plugins.size} loaded`;
    }
  }
  checks.push({ id: 'plugins', label: 'Plugins', status: pluginStatus, detail: pluginDetail });

  const pagesDir = ctx.options?.pagesDir;
  const publicDir = ctx.options?.publicDir || 'public';
  for (const [id, dir] of [
    ['pages_dir', pagesDir],
    ['public_dir', publicDir],
  ]) {
    if (!dir) continue;
    const full = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    const ok = fs.existsSync(full);
    checks.push({
      id,
      label: id.replace('_', ' '),
      status: ok ? 'healthy' : 'warning',
      detail: ok ? full : 'Missing',
    });
  }

  const mem = process.memoryUsage();
  checks.push({
    id: 'memory',
    label: 'Memory (heap)',
    status: 'healthy',
    detail: `${Math.round(mem.heapUsed / 1024 / 1024)} MB used`,
  });

  checks.push({
    id: 'uptime',
    label: 'Uptime',
    status: 'healthy',
    detail: `${Math.round(process.uptime())}s`,
  });

  checks.push({
    id: 'base_url',
    label: 'Base URL',
    status: 'healthy',
    detail: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  });

  const overall = aggregateStatus(checks.map((c) => c.status));

  return {
    status: overall,
    nodeEnv,
    checks,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { collectHealth };
