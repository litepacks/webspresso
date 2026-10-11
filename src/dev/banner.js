'use strict';

/**
 * Webspresso Development Startup Banner & Route Table Formatter
 * Beautiful terminal dashboard with zero external dependencies
 * @module src/dev/banner
 */

const { colors: defaultColors, stripAnsi } = require('./colors');

let pkgVersion = '1.0.0';
try {
  const pkg = require('../../package.json');
  if (pkg && pkg.version) pkgVersion = pkg.version;
} catch (_) {}

/**
 * Formats a clean, readable ASCII table of registered application routes
 * @param {import('../routing/route-table').RouteTable|Array} routeTable
 * @param {Object} [options]
 * @param {boolean} [options.colors=true]
 * @param {number} [options.limit=100]
 * @returns {string} Formatted route table
 */
function formatRouteTable(routeTable, options = {}) {
  const useColors = options.colors !== false;
  const c = useColors ? defaultColors : {
    cyan: (s) => s,
    green: (s) => s,
    yellow: (s) => s,
    red: (s) => s,
    magenta: (s) => s,
    white: (s) => s,
    gray: (s) => s,
    bold: (s) => s,
    dim: (s) => s,
  };

  const rawRoutes = Array.isArray(routeTable)
    ? routeTable
    : (routeTable && typeof routeTable.list === 'function'
      ? routeTable.list()
      : (routeTable && routeTable.routes ? routeTable.routes : []));

  if (!rawRoutes || rawRoutes.length === 0) {
    return c.gray('   (no routes registered)');
  }

  // Sort: API first or alphabetical by path
  const sorted = [...rawRoutes].sort((a, b) => {
    const pa = a.path || '';
    const pb = b.path || '';
    return pa.localeCompare(pb) || (a.method || '').localeCompare(b.method || '');
  });

  const limit = options.limit || 100;
  const visible = sorted.slice(0, limit);

  const lines = [];
  lines.push(`  ${c.bold('🛣️  Discovered Routes')} ${c.gray(`(${sorted.length} total)`)}:`);

  for (const r of visible) {
    const m = (r.method || 'GET').toUpperCase();
    let mCol = m.padEnd(7);
    if (m === 'GET') mCol = c.cyan(mCol);
    else if (m === 'POST') mCol = c.green(mCol);
    else if (m === 'PUT' || m === 'PATCH') mCol = c.yellow(mCol);
    else if (m === 'DELETE') mCol = c.red(mCol);
    else mCol = c.white(mCol);

    const p = (r.path || '/').padEnd(28);
    const typeLabel = r.type === 'api' ? c.magenta('[API] ') : c.gray('[SSR] ');
    const source = r.source || r.file || '';
    const cleanSource = source ? c.dim(`→ ${source.replace(/\\/g, '/')}`) : '';

    lines.push(`     ${mCol} ${c.bold(p)} ${typeLabel} ${cleanSource}`);
  }

  if (sorted.length > limit) {
    lines.push(c.gray(`     ... and ${sorted.length - limit} more routes (use webspresso routes to list all)`));
  }

  return lines.join('\n');
}

/**
 * Gathers system and application summary metrics for banner display
 * @param {Object} context
 * @returns {Object}
 */
function collectBannerSummary(context = {}) {
  const {
    routeTable,
    db,
    serviceRegistry,
    pluginManager,
    port = 3000,
    host = 'localhost',
  } = context;

  // 1. Routes summary
  const routes = Array.isArray(routeTable)
    ? routeTable
    : (routeTable && typeof routeTable.list === 'function' ? routeTable.list() : (routeTable?.routes || []));
  const apiRoutes = routes.filter((r) => r.type === 'api' || (r.path && r.path.startsWith('/api')));
  const pageRoutes = routes.filter((r) => r.type === 'page' || !apiRoutes.includes(r));

  // 2. Database client
  let dbDialect = 'None';
  if (db && db.knex) {
    const client = db.knex.client;
    const clientName = client?.config?.client || client?.dialect || 'Connected';
    dbDialect = String(clientName);
    if (dbDialect === 'better-sqlite3' || dbDialect === 'sqlite3') {
      dbDialect = 'SQLite (' + dbDialect + ')';
    } else if (dbDialect === 'pg') {
      dbDialect = 'PostgreSQL';
    } else if (dbDialect === 'mysql' || dbDialect === 'mysql2') {
      dbDialect = 'MySQL';
    }
  }

  // 3. Models
  let modelsList = [];
  if (db && typeof db.getAllModels === 'function') {
    try {
      modelsList = db.getAllModels().map((m) => (typeof m === 'object' ? m.name : m));
    } catch (_) {}
  }

  // 4. Services
  let servicesList = [];
  if (serviceRegistry) {
    if (serviceRegistry.services instanceof Map) {
      servicesList = Array.from(serviceRegistry.services.keys());
    } else if (typeof serviceRegistry.list === 'function') {
      servicesList = serviceRegistry.list().map((s) => (typeof s === 'object' ? s.name : s));
    }
  }

  // 5. Plugins
  let pluginsList = [];
  let hasAdmin = false;
  if (pluginManager && pluginManager.plugins instanceof Map) {
    pluginsList = Array.from(pluginManager.plugins.keys());
    hasAdmin = pluginManager.plugins.has('adminPanel') || pluginManager.plugins.has('admin');
  }

  // URLs
  const baseUrl = `http://${host}:${port}`;
  const adminUrl = hasAdmin ? `${baseUrl}/_admin` : null;

  return {
    version: pkgVersion,
    nodeVersion: process.version,
    port,
    host,
    urls: {
      local: baseUrl,
      admin: adminUrl,
    },
    counts: {
      routesTotal: routes.length,
      apiRoutes: apiRoutes.length,
      pageRoutes: pageRoutes.length,
      models: modelsList.length,
      services: servicesList.length,
      plugins: pluginsList.length,
    },
    dbDialect,
    models: modelsList,
    services: servicesList,
    plugins: pluginsList,
  };
}

/**
 * Formats the full development startup banner with frame, URLs, and summaries
 * @param {Object} context
 * @param {Object} [options]
 * @returns {{ bannerText: string, plainText: string, summary: Object }}
 */
function formatDevBanner(context = {}, options = {}) {
  const useColors = options.colors !== false;
  const c = useColors ? defaultColors : {
    cyan: (s) => s,
    green: (s) => s,
    yellow: (s) => s,
    red: (s) => s,
    magenta: (s) => s,
    white: (s) => s,
    gray: (s) => s,
    bold: (s) => s,
    dim: (s) => s,
  };

  const summary = collectBannerSummary(context);
  const showRouteTable = options.showRouteTable ?? false;

  const width = 64;
  const topBorder = '┌' + '─'.repeat(width) + '┐';
  const bottomBorder = '└' + '─'.repeat(width) + '┘';

  function padLine(content, rawLength) {
    const pad = Math.max(0, width - rawLength);
    return '│  ' + content + ' '.repeat(pad > 2 ? pad - 2 : 0) + '│';
  }

  const lines = [];
  lines.push('');
  lines.push(c.cyan(topBorder));

  // Header line
  const title = `☕ ${c.bold('Webspresso')} ${c.dim(`v${summary.version}`)}`;
  const nodeTag = c.gray(`Node ${summary.nodeVersion}`);
  const rawHeader = `☕ Webspresso v${summary.version} Node ${summary.nodeVersion}`;
  const spaceCount = Math.max(2, width - 4 - rawHeader.length);
  lines.push('│  ' + title + ' '.repeat(spaceCount) + nodeTag + '  │');

  lines.push('│' + ' '.repeat(width) + '│');

  // URLs
  const localStr = `${c.green('➜')}  ${c.bold('Local:')}    ${c.cyan(summary.urls.local)}`;
  lines.push(padLine(localStr, `➜  Local:    ${summary.urls.local}`.length));

  if (summary.urls.admin) {
    const adminStr = `${c.green('➜')}  ${c.bold('Admin:')}    ${c.cyan(summary.urls.admin)}`;
    lines.push(padLine(adminStr, `➜  Admin:    ${summary.urls.admin}`.length));
  }

  const dbStr = `${c.gray('•')}  ${c.bold('Database:')} ${summary.dbDialect}`;
  lines.push(padLine(dbStr, `•  Database: ${summary.dbDialect}`.length));

  lines.push('│' + ' '.repeat(width) + '│');

  // Summary header
  const sumHdr = c.bold('📦 Summary:');
  lines.push(padLine(sumHdr, '📦 Summary:'.length));

  // Route counts
  const routeCountStr = `   ${c.gray('•')} Routes:   ${c.bold(String(summary.counts.routesTotal))} ${c.gray(`(${summary.counts.apiRoutes} API, ${summary.counts.pageRoutes} Pages)`)}`;
  lines.push(padLine(routeCountStr, `   • Routes:   ${summary.counts.routesTotal} (${summary.counts.apiRoutes} API, ${summary.counts.pageRoutes} Pages)`.length));

  // Models
  const modelsPreview = summary.models.length > 0 ? ` ${c.gray(`(${summary.models.slice(0, 3).join(', ')}${summary.models.length > 3 ? '...' : ''})`)}` : '';
  const modelsPlain = summary.models.length > 0 ? ` (${summary.models.slice(0, 3).join(', ')}${summary.models.length > 3 ? '...' : ''})` : '';
  const modelStr = `   ${c.gray('•')} Models:   ${c.bold(String(summary.counts.models))}${modelsPreview}`;
  lines.push(padLine(modelStr, `   • Models:   ${summary.counts.models}${modelsPlain}`.length));

  // Services
  const servicesPreview = summary.services.length > 0 ? ` ${c.gray(`(${summary.services.slice(0, 3).join(', ')}${summary.services.length > 3 ? '...' : ''})`)}` : '';
  const servicesPlain = summary.services.length > 0 ? ` (${summary.services.slice(0, 3).join(', ')}${summary.services.length > 3 ? '...' : ''})` : '';
  const servStr = `   ${c.gray('•')} Services: ${c.bold(String(summary.counts.services))}${servicesPreview}`;
  lines.push(padLine(servStr, `   • Services: ${summary.counts.services}${servicesPlain}`.length));

  // Plugins
  const pluginsPreview = summary.plugins.length > 0 ? ` ${c.gray(`(${summary.plugins.slice(0, 4).join(', ')}${summary.plugins.length > 4 ? '...' : ''})`)}` : '';
  const pluginsPlain = summary.plugins.length > 0 ? ` (${summary.plugins.slice(0, 4).join(', ')}${summary.plugins.length > 4 ? '...' : ''})` : '';
  const plugStr = `   ${c.gray('•')} Plugins:  ${c.bold(String(summary.counts.plugins))}${pluginsPreview}`;
  lines.push(padLine(plugStr, `   • Plugins:  ${summary.counts.plugins}${pluginsPlain}`.length));

  lines.push(c.cyan(bottomBorder));
  lines.push('');

  // Route Table append
  if (showRouteTable && context.routeTable) {
    lines.push(formatRouteTable(context.routeTable, { colors: useColors }));
    lines.push('');
  }

  const bannerText = lines.join('\n');
  const plainText = stripAnsi(bannerText);

  return { bannerText, plainText, summary };
}

/**
 * Prints the development banner to console or designated logger
 * @param {Object} context
 * @param {Object} [options]
 * @returns {void}
 */
function printDevBanner(context = {}, options = {}) {
  const logger = options.logger || context.logger || console;
  const { bannerText } = formatDevBanner(context, options);
  if (logger && typeof logger.log === 'function') {
    logger.log(bannerText);
  }
}

module.exports = {
  formatRouteTable,
  collectBannerSummary,
  formatDevBanner,
  printDevBanner,
};
