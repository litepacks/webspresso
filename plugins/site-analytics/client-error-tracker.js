/**
 * Client Error Tracker
 * Generates inline script to catch JS errors and unhandled rejections, reports to backend
 * @module plugins/site-analytics/client-error-tracker
 */

/**
 * Generate client-side error tracking script
 * @param {Object} options
 * @param {string} [options.endpoint='/_analytics/report-error'] - POST endpoint for error reports
 * @returns {string} Inline script content
 */
function generateErrorTrackerScript(options = {}) {
  const endpoint = options.endpoint || '/_analytics/report-error';

  return `
(function() {
  var endpoint = ${JSON.stringify(endpoint)};
  var reported = {};
  var MAX_STACK = 2000;

  function report(type, message, stack, extra) {
    var key = type + ':' + (message || '').slice(0, 100);
    if (reported[key]) return;
    reported[key] = true;

    var payload = {
      type: type,
      message: String(message || 'Unknown error').slice(0, 500),
      stack: stack ? String(stack).slice(0, MAX_STACK) : null,
      path: window.location.pathname || '/',
      referrer: document.referrer || null,
      userAgent: navigator.userAgent || null
    };
    if (extra) {
      for (var k in extra) payload[k] = extra[k];
    }

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function(){});
    } catch (e) {}
  }

  window.onerror = function(msg, url, line, col, err) {
    report('error', err ? err.message : msg, err ? err.stack : null, { line: line, column: col, source: url });
    return false;
  };

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason;
    var stack = null;
    if (msg && typeof msg === 'object') {
      stack = msg.stack;
      msg = msg.message || String(msg);
    } else {
      msg = String(msg);
    }
    report('unhandledrejection', msg, stack);
  });
})();
`.trim();
}

module.exports = { generateErrorTrackerScript };
