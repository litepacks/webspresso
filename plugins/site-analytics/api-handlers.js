/**
 * Analytics API Handlers
 * Aggregate query endpoints for the admin analytics page
 * @module plugins/site-analytics/api-handlers
 */

/**
 * Create analytics API handlers
 * @param {Object} options
 * @param {Object} options.knex - Knex instance
 * @param {string} [options.tableName='analytics_page_views']
 */
function createAnalyticsApiHandlers(options) {
  const { knex, tableName = 'analytics_page_views' } = options;

  function parseDays(req) {
    const days = parseInt(req.query.days) || 30;
    return Math.min(Math.max(days, 1), 365);
  }

  function sinceDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  /**
   * GET /stats - Summary statistics
   */
  async function getStats(req, res) {
    try {
      const days = parseDays(req);
      const since = sinceDate(days);

      const [views] = await knex(tableName)
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .count('id as count');

      const [visitors] = await knex(tableName)
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .countDistinct('visitor_id as count');

      const [uniquePages] = await knex(tableName)
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .countDistinct('path as count');

      const [sessions] = await knex(tableName)
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .countDistinct('session_id as count');

      res.json({
        views: parseInt(views.count) || 0,
        visitors: parseInt(visitors.count) || 0,
        uniquePages: parseInt(uniquePages.count) || 0,
        sessions: parseInt(sessions.count) || 0,
        days,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /views-over-time - Time-series data
   */
  async function getViewsOverTime(req, res) {
    try {
      const days = parseDays(req);
      const since = sinceDate(days);

      const isPostgres = knex.client.config.client === 'pg';
      const isSqlite = /sqlite/.test(knex.client.config.client || '');

      let dateExpr;
      if (isPostgres) {
        dateExpr = knex.raw("TO_CHAR(created_at, 'YYYY-MM-DD') as date");
      } else if (isSqlite) {
        dateExpr = knex.raw("strftime('%Y-%m-%d', created_at) as date");
      } else {
        dateExpr = knex.raw("DATE_FORMAT(created_at, '%Y-%m-%d') as date");
      }

      const rows = await knex(tableName)
        .select(dateExpr)
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .count('id as views')
        .countDistinct('visitor_id as visitors')
        .countDistinct('session_id as sessions')
        .groupByRaw(
          isPostgres
            ? "TO_CHAR(created_at, 'YYYY-MM-DD')"
            : isSqlite
              ? "strftime('%Y-%m-%d', created_at)"
              : "DATE_FORMAT(created_at, '%Y-%m-%d')"
        )
        .orderBy('date', 'asc');

      // Fill gaps for missing dates
      const result = [];
      const dataMap = new Map(rows.map(r => [r.date, r]));
      const start = new Date(since);
      const end = new Date();
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        const entry = dataMap.get(key);
        result.push({
          date: key,
          views: entry ? parseInt(entry.views) || 0 : 0,
          visitors: entry ? parseInt(entry.visitors) || 0 : 0,
          sessions: entry ? parseInt(entry.sessions) || 0 : 0,
        });
      }

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /top-pages - Most viewed pages
   */
  async function getTopPages(req, res) {
    try {
      const days = parseDays(req);
      const since = sinceDate(days);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);

      const rows = await knex(tableName)
        .select('path')
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .count('id as views')
        .countDistinct('visitor_id as visitors')
        .groupBy('path')
        .orderBy('views', 'desc')
        .limit(limit);

      res.json(rows.map(r => ({
        path: r.path,
        views: parseInt(r.views) || 0,
        visitors: parseInt(r.visitors) || 0,
      })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /bot-activity - Bot statistics
   */
  async function getBotActivity(req, res) {
    try {
      const days = parseDays(req);
      const since = sinceDate(days);

      const rows = await knex(tableName)
        .select('bot_name')
        .where('created_at', '>=', since)
        .where('is_bot', true)
        .whereNotNull('bot_name')
        .count('id as requests')
        .groupBy('bot_name')
        .orderBy('requests', 'desc')
        .limit(20);

      res.json(rows.map(r => ({
        name: r.bot_name,
        requests: parseInt(r.requests) || 0,
      })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /countries - Country breakdown
   */
  async function getCountries(req, res) {
    try {
      const days = parseDays(req);
      const since = sinceDate(days);

      const rows = await knex(tableName)
        .select('country')
        .where('created_at', '>=', since)
        .where('is_bot', false)
        .whereNotNull('country')
        .count('id as views')
        .countDistinct('visitor_id as visitors')
        .groupBy('country')
        .orderBy('views', 'desc')
        .limit(20);

      res.json(rows.map(r => ({
        country: r.country,
        views: parseInt(r.views) || 0,
        visitors: parseInt(r.visitors) || 0,
      })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /recent - Recent page views
   */
  async function getRecent(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 15, 50);

      const rows = await knex(tableName)
        .select('path', 'referrer', 'country', 'is_bot', 'bot_name', 'created_at')
        .where('is_bot', false)
        .orderBy('created_at', 'desc')
        .limit(limit);

      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  return {
    getStats,
    getViewsOverTime,
    getTopPages,
    getBotActivity,
    getCountries,
    getRecent,
  };
}

module.exports = { createAnalyticsApiHandlers };
