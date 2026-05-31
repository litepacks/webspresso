/**
 * In-memory log ring buffer for Studio logs viewer.
 */

const MAX_LOGS = 500;

/** @type {object[]} */
const logs = [];

/**
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} source
 * @param {string} message
 * @param {object} [meta]
 */
function appendLog(level, source, message, meta = {}) {
  logs.unshift({
    level,
    source,
    message,
    meta,
    at: new Date().toISOString(),
    requestId: meta.requestId || null,
  });
  if (logs.length > MAX_LOGS) {
    logs.length = MAX_LOGS;
  }
}

/**
 * @param {object} [query]
 */
function getLogs(query = {}) {
  let list = logs;
  if (query.level) {
    list = list.filter((l) => l.level === query.level);
  }
  if (query.source) {
    list = list.filter((l) => l.source === String(query.source));
  }
  return list;
}

function clearLogs() {
  logs.length = 0;
}

module.exports = { appendLog, getLogs, clearLogs, MAX_LOGS };
