/**
 * Analytics Tracking Middleware
 * Records page views to the database (non-blocking)
 * @module plugins/site-analytics/tracking
 */

const crypto = require('crypto');
const { getClientIp: resolveClientIp } = require('../../core/utils/ip');
const { detectBot } = require('./bot-patterns');
const { detectCountry } = require('./geo');

const STATIC_EXT = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|mp4|webm)$/i;
const DEFAULT_EXCLUDE = ['/_admin', '/api/', '/health', '/_next', '/__'];

/**
 * Permanent / Fatal DB error codes that cannot be recovered by immediate retries.
 */
const PERMANENT_ERROR_CODES = new Set([
  'SQLITE_FULL',
  'SQLITE_IOERR',
  'SQLITE_CORRUPT',
  'SQLITE_CANTOPEN',
  'SQLITE_NOTADB',
  'ER_DISK_FULL',
  'ENOSPC',
]);

/**
 * Patterns matching fatal disk full or corrupted database errors.
 */
const PERMANENT_ERROR_PATTERNS = [
  /database or disk is full/i,
  /disk full/i,
  /no space left on device/i,
  /disk i\/o error/i,
  /database disk image is malformed/i,
  /file is not a database/i,
];

/**
 * Sanitize and format database error messages to prevent raw SQL query leakage in logs.
 * Knex appends executed queries ("insert into ... - <actual error>") which can be 50-100 KB.
 * @param {Error|Object|string} e
 * @returns {string}
 */
function formatDbError(e) {
  if (!e) return 'Unknown error';

  let msg;
  if (typeof e.message === 'string' && e.message.includes(' - ')) {
    msg = e.message.split(' - ').pop().trim();
  } else if (typeof e.message === 'string') {
    msg = e.message.trim();
  } else if (typeof e === 'string') {
    msg = e.trim();
  } else {
    msg = String(e.code || 'Database error');
  }

  return msg.replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
}

/**
 * Detect whether a database error is permanent/fatal (e.g. disk full, corruption).
 * @param {Error|Object|string} e
 * @returns {boolean}
 */
function isPermanentDbError(e) {
  if (!e) return false;
  if (e.code && PERMANENT_ERROR_CODES.has(e.code)) return true;
  const msg = typeof e.message === 'string' ? e.message : (typeof e === 'string' ? e : '');
  return PERMANENT_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

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
  return resolveClientIp(req, '');
}

/**
 * Create tracking middleware
 * @param {Object} [options={}]
 * @param {Object} [options.knex] - Knex instance
 * @param {string[]} [options.excludePaths] - Paths to exclude from tracking
 * @param {boolean} [options.trackBots=true] - Whether to record bot visits
 * @param {string} [options.tableName='analytics_page_views'] - DB table name
 * @param {number} [options.batchSize=20] - Flush when queue reaches this size
 * @param {number} [options.flushIntervalMs=3000] - Flush interval for low traffic
 * @param {number} [options.maxRetries=3] - Maximum retry attempts per batch item before dropping
 * @param {number} [options.maxBackoffMs=60000] - Max exponential backoff cooldown
 * @param {number} [options.maxQueueSize=5000] - Queue memory cap to prevent OOM
 * @param {number} [options.errorLogIntervalMs=60000] - Rate limit window for batch failure logs
 */
function createTrackingMiddleware(options = {}) {
  const opts = options || {};
  const {
    knex,
    excludePaths = [],
    trackBots = true,
    tableName = 'analytics_page_views',
    batchSize = 20,
    flushIntervalMs = 3000,
    maxRetries = 3,
    maxBackoffMs = 60000,
    maxQueueSize = 5000,
    errorLogIntervalMs = 60000,
  } = opts;

  const allExcludes = [...DEFAULT_EXCLUDE, ...excludePaths];
  let tableReady = false;
  const queue = [];

  // Circuit breaker & backoff state
  let failureCount = 0;
  let nextAllowedFlushTime = 0;
  let isFlushing = false;
  let flushPromise = null;
  let flushTimeout = null;

  // Log throttling state
  let lastErrorLogTime = 0;
  let suppressedErrorCount = 0;

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
      logError(e, 'Failed to ensure table');
      throw e;
    }
  }

  function logError(e, prefix = 'Batch insert failed') {
    const now = Date.now();
    const formatted = formatDbError(e);

    if (lastErrorLogTime === 0 || now - lastErrorLogTime >= errorLogIntervalMs) {
      const elapsedSec = lastErrorLogTime > 0 ? Math.round((now - lastErrorLogTime) / 1000) : 0;
      if (suppressedErrorCount > 0) {
        console.error(`[site-analytics] ${prefix} (suppressed ${suppressedErrorCount} occurrences in last ${elapsedSec}s): ${formatted}`);
      } else {
        console.error(`[site-analytics] ${prefix}: ${formatted}`);
      }
      lastErrorLogTime = now;
      suppressedErrorCount = 0;
    } else {
      suppressedErrorCount++;
    }
  }

  // Sessions tracked in-memory (visitor_id -> last activity timestamp)
  const sessionMap = new Map();
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const MAX_SESSIONS = 10000;

  // Periodic session cleanup
  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [vid, data] of sessionMap) {
      if (now - data.lastSeen > SESSION_TIMEOUT * 2) {
        sessionMap.delete(vid);
      }
    }
  }, 5 * 60 * 1000);
  if (sessionCleanupInterval.unref) sessionCleanupInterval.unref();

  function getSessionId(visitorId) {
    const now = Date.now();
    const existing = sessionMap.get(visitorId);

    if (existing && (now - existing.lastSeen) < SESSION_TIMEOUT) {
      existing.lastSeen = now;
      return existing.sessionId;
    }

    if (sessionMap.size >= MAX_SESSIONS) {
      const firstKey = sessionMap.keys().next().value;
      if (firstKey !== undefined) sessionMap.delete(firstKey);
    }

    const sessionId = quickHash(visitorId + '-' + now + '-' + Math.random());
    sessionMap.set(visitorId, { sessionId, lastSeen: now });
    return sessionId;
  }

  async function flushQueue() {
    if (flushPromise) return flushPromise;
    if (queue.length === 0 || !knex) return;

    const now = Date.now();
    if (now < nextAllowedFlushTime) {
      scheduleFlush(nextAllowedFlushTime - now);
      return;
    }

    isFlushing = true;
    flushPromise = (async () => {
      const batch = queue.splice(0, queue.length);

      try {
        await ensureTable();
        const dbBatch = batch.map(({ _retries, ...row }) => ({
          ...row,
          created_at: knex.fn.now(),
        }));
        await knex(tableName).insert(dbBatch);

        // Successfully inserted: reset circuit breaker & failure counters
        failureCount = 0;
        nextAllowedFlushTime = 0;
        lastErrorLogTime = 0;
        suppressedErrorCount = 0;
      } catch (e) {
        failureCount++;
        const backoffDelay = Math.min(flushIntervalMs * Math.pow(2, failureCount), maxBackoffMs);
        nextAllowedFlushTime = Date.now() + backoffDelay;

        // Rate-limited sanitized logging (no raw SQL query leakage)
        logError(e, 'Batch insert failed');

        // Schedule next attempt respecting backoff
        scheduleFlush(backoffDelay);

        // Drop policy: If fatal/permanent error (disk full, corrupted DB, etc.), drop entire batch
        if (!isPermanentDbError(e)) {
          const retryable = [];
          for (const item of batch) {
            item._retries = (item._retries || 0) + 1;
            if (item._retries < maxRetries) {
              retryable.push(item);
            }
          }

          // Re-queue items that haven't exceeded retry limits, respecting maxQueueSize
          if (retryable.length > 0) {
            const available = Math.max(0, maxQueueSize - queue.length);
            if (available > 0) {
              queue.unshift(...retryable.slice(0, available));
            }
          }
        }
      } finally {
        isFlushing = false;
        flushPromise = null;
      }
    })();

    return flushPromise;
  }

  function scheduleFlush(customDelay) {
    if (flushTimeout || queue.length === 0) return;
    const now = Date.now();
    const delay = customDelay !== undefined
      ? customDelay
      : Math.max(flushIntervalMs, nextAllowedFlushTime - now, 0);

    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      flushQueue().catch(() => {});
    }, delay);
    if (flushTimeout.unref) flushTimeout.unref();
  }

  // Periodic flush (catches low-traffic case)
  const periodicFlushInterval = setInterval(() => {
    if (queue.length > 0 && Date.now() >= nextAllowedFlushTime && !isFlushing) {
      flushQueue().catch(() => {});
    }
  }, flushIntervalMs);
  if (periodicFlushInterval.unref) periodicFlushInterval.unref();

  async function trackingMiddleware(req, res, next) {
    if (typeof next === 'function') next();

    if (!req || req.method !== 'GET') return;

    const path = req.path || req.url || '';
    if (!path || STATIC_EXT.test(path)) return;
    if (allExcludes.some(prefix => path.startsWith(prefix))) return;

    try {
      const headers = req.headers || {};
      const userAgent = headers['user-agent'] || '';
      const ip = getClientIp(req);
      const { isBot, botName } = detectBot(userAgent);

      if (isBot && !trackBots) return;

      // Protect queue under pressure or during active database failures:
      // Drop bots immediately to preserve queue capacity and avoid wasting DB I/O
      if (isBot && (failureCount > 0 || queue.length >= maxQueueSize * 0.7)) {
        return;
      }

      const ipHash = quickHash(ip);
      const visitorId = quickHash(ip + '|' + userAgent);

      // Do not thrash human sessionMap with bot/crawler visits
      const sessionId = isBot
        ? quickHash('bot-' + (botName || 'crawler') + '-' + visitorId)
        : getSessionId(visitorId);

      const country = detectCountry(req);
      const referrer = headers['referer'] || headers['referrer'] || null;

      if (queue.length < maxQueueSize) {
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
      }

      if (queue.length >= batchSize) {
        if (Date.now() >= nextAllowedFlushTime) {
          flushQueue().catch(() => {});
        } else {
          scheduleFlush();
        }
      } else {
        scheduleFlush();
      }
    } catch (e) {
      // Non-blocking: don't let tracking errors affect the app
    }
  }

  // Diagnostic / testing accessors
  trackingMiddleware.flush = () => flushQueue();
  trackingMiddleware.getQueue = () => queue;
  trackingMiddleware.getFailureCount = () => failureCount;
  trackingMiddleware.getNextAllowedFlushTime = () => nextAllowedFlushTime;
  trackingMiddleware.resetState = (opts = {}) => {
    failureCount = 0;
    nextAllowedFlushTime = 0;
    const resetLogs = typeof opts === 'boolean' ? opts : !!opts.resetLogs;
    if (resetLogs) {
      lastErrorLogTime = 0;
      suppressedErrorCount = 0;
    }
    queue.length = 0;
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
  };
  trackingMiddleware.stop = () => {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    clearInterval(sessionCleanupInterval);
    clearInterval(periodicFlushInterval);
    if (queue.length > 0 && knex) {
      return flushQueue().catch(() => {});
    }
    return Promise.resolve();
  };

  return trackingMiddleware;
}

module.exports = {
  createTrackingMiddleware,
  formatDbError,
  isPermanentDbError,
  PERMANENT_ERROR_CODES,
  PERMANENT_ERROR_PATTERNS,
};
