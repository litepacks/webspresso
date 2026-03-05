/**
 * Analytics Tracking Middleware
 * Records page views to the database (non-blocking)
 * @module plugins/site-analytics/tracking
 */

const crypto = require('crypto');
const { detectBot } = require('./bot-patterns');
const { detectCountry } = require('./geo');

const STATIC_EXT = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|webm)$/i;
const DEFAULT_EXCLUDE = ['/_admin', '/api/', '/health', '/_next', '/__'];

/**
 * Hash a string with SHA-256 (truncated to 16 hex chars for compactness)
 */
function quickHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Get client IP from request, handling proxies
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.ip || req.connection?.remoteAddress || '';
}

/**
 * Create tracking middleware
 * @param {Object} options
 * @param {Object} options.knex - Knex instance
 * @param {string[]} [options.excludePaths] - Paths to exclude from tracking
 * @param {boolean} [options.trackBots=true] - Whether to record bot visits
 * @param {string} [options.tableName='analytics_page_views'] - DB table name
 * @param {number} [options.batchSize=20] - Flush when queue reaches this size
 * @param {number} [options.flushIntervalMs=3000] - Flush interval for low traffic
 */
function createTrackingMiddleware(options) {
  const {
    knex,
    excludePaths = [],
    trackBots = true,
    tableName = 'analytics_page_views',
    batchSize = 20,
    flushIntervalMs = 3000,
  } = options;

  const allExcludes = [...DEFAULT_EXCLUDE, ...excludePaths];
  let tableReady = false;
  const queue = [];
  let flushScheduled = false;

  async function ensureTable() {
    if (tableReady) return;
    try {
      const exists = await knex.schema.hasTable(tableName);
      if (!exists) {
        await knex.schema.createTable(tableName, (table) => {
          table.bigIncrements('id').primary();
          table.string('session_id', 64).index();
          table.string('visitor_id', 64).index();
          table.string('path', 500).notNullable();
          table.string('referrer', 500);
          table.text('user_agent');
          table.string('ip_hash', 64);
          table.string('country', 2).index();
          table.boolean('is_bot').defaultTo(false).index();
          table.string('bot_name', 100);
          table.timestamp('created_at').defaultTo(knex.fn.now()).index();
        });
      }
      tableReady = true;
    } catch (e) {
      console.error('[site-analytics] Failed to ensure table:', e.message);
    }
  }

  // Sessions tracked in-memory (visitor_id -> last activity timestamp)
  const sessionMap = new Map();
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  // Periodic session cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [vid, data] of sessionMap) {
      if (now - data.lastSeen > SESSION_TIMEOUT * 2) {
        sessionMap.delete(vid);
      }
    }
  }, 5 * 60 * 1000).unref();

  function getSessionId(visitorId) {
    const now = Date.now();
    const existing = sessionMap.get(visitorId);

    if (existing && (now - existing.lastSeen) < SESSION_TIMEOUT) {
      existing.lastSeen = now;
      return existing.sessionId;
    }

    const sessionId = quickHash(visitorId + '-' + now + '-' + Math.random());
    sessionMap.set(visitorId, { sessionId, lastSeen: now });
    return sessionId;
  }

  async function flushQueue() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);

    try {
      await ensureTable();
      for (const row of batch) {
        row.created_at = knex.fn.now();
      }
      await knex(tableName).insert(batch);
    } catch (e) {
      console.error('[site-analytics] Batch insert failed:', e.message);
      // Re-queue failed items (optional - could drop to avoid loops)
      queue.unshift(...batch);
    }
  }

  function scheduleFlush() {
    if (flushScheduled || queue.length === 0) return;
    flushScheduled = true;
    setTimeout(() => {
      flushScheduled = false;
      flushQueue().catch(() => {});
    }, flushIntervalMs);
  }

  // Periodic flush (catches low-traffic case)
  setInterval(() => {
    if (queue.length > 0) flushQueue().catch(() => {});
  }, flushIntervalMs).unref();

  return async function trackingMiddleware(req, res, next) {
    next();

    if (req.method !== 'GET') return;

    const path = req.path;
    if (STATIC_EXT.test(path)) return;
    if (allExcludes.some(prefix => path.startsWith(prefix))) return;

    try {
      const userAgent = req.headers['user-agent'] || '';
      const ip = getClientIp(req);
      const { isBot, botName } = detectBot(userAgent);

      if (isBot && !trackBots) return;

      const ipHash = quickHash(ip);
      const visitorId = quickHash(ip + '|' + userAgent);
      const sessionId = getSessionId(visitorId);
      const country = detectCountry(req);
      const referrer = req.headers['referer'] || req.headers['referrer'] || null;

      queue.push({
        session_id: sessionId,
        visitor_id: visitorId,
        path,
        referrer: referrer ? referrer.slice(0, 500) : null,
        user_agent: userAgent.slice(0, 1000),
        ip_hash: ipHash,
        country,
        is_bot: isBot,
        bot_name: botName,
      });

      if (queue.length >= batchSize) {
        flushQueue().catch(() => {});
      } else {
        scheduleFlush();
      }
    } catch (e) {
      // Non-blocking: don't let tracking errors affect the app
    }
  };
}

module.exports = { createTrackingMiddleware };
