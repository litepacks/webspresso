/**
 * Client Error Report Handler
 * Receives error reports from browser and stores in DB
 * @module plugins/site-analytics/client-error-handler
 */

const DEFAULT_TABLE = 'analytics_client_errors';

/**
 * Create the client errors table
 */
async function ensureErrorsTable(knex, tableName = DEFAULT_TABLE) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, (table) => {
      table.bigIncrements('id').primary();
      table.string('error_type', 50).index(); // 'error' | 'unhandledrejection'
      table.string('message', 500).index();
      table.text('stack');
      table.string('path', 500).index();
      table.string('referrer', 500);
      table.text('user_agent');
      table.string('source', 500); // script url
      table.integer('line');
      table.integer('column');
      table.timestamp('created_at').defaultTo(knex.fn.now()).index();
    });
  }
}

/**
 * Create error report handler
 * @param {Object} options
 * @param {Object} options.knex - Knex instance
 * @param {string} [options.tableName='analytics_client_errors']
 */
function createErrorReportHandler(options) {
  const { knex, tableName = DEFAULT_TABLE } = options;
  let tableReady = false;

  return async function errorReportHandler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      if (!tableReady) {
        await ensureErrorsTable(knex, tableName);
        tableReady = true;
      }

      const body = req.body || {};
      const { type, message, stack, path, referrer, userAgent, source, line, column } = body;

      if (!message && !stack) {
        return res.status(400).json({ error: 'message or stack required' });
      }

      await knex(tableName).insert({
        error_type: type || 'error',
        message: String(message || '').slice(0, 500),
        stack: stack ? String(stack).slice(0, 5000) : null,
        path: path ? String(path).slice(0, 500) : null,
        referrer: referrer ? String(referrer).slice(0, 500) : null,
        user_agent: userAgent ? String(userAgent).slice(0, 1000) : null,
        source: source ? String(source).slice(0, 500) : null,
        line: line != null ? parseInt(line) : null,
        column: column != null ? parseInt(column) : null,
        created_at: knex.fn.now(),
      });

      res.status(202).json({ ok: true });
    } catch (e) {
      console.error('[site-analytics] Client error report failed:', e.message);
      res.status(500).json({ error: 'Report failed' });
    }
  };
}

module.exports = {
  createErrorReportHandler,
  ensureErrorsTable,
  DEFAULT_TABLE,
};
