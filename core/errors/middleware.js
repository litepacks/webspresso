/**
 * Central Error Boundary Middleware
 * @module core/errors/middleware
 */

const { normalizeError, toErrorResponseObject } = require('./normalize');
const { RequestAbortedError } = require('./domain');

/**
 * Check if the request prefers a JSON error response
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function preferJsonErrorResponse(req) {
  if (req.path.startsWith('/api/') || req.path.startsWith('/_admin/api/')) {
    return true;
  }
  const accept = req.headers['accept'] || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return true;
  }
  return req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest';
}

/**
 * Default HTML error renderer fallback
 * @param {import('./http').HttpError|Error} err
 * @param {boolean} isDev
 * @returns {string}
 */
function renderDefaultErrorHtml(err, isDev) {
  const status = err.status || 500;
  const message = (err.expose !== false || isDev) ? (err.message || 'Internal Server Error') : 'Internal Server Error';
  const stackHtml = isDev && err.stack
    ? `<pre style="background:#1e293b;color:#f87171;padding:16px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.5;">${escapeHtml(err.stack)}</pre>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} - ${escapeHtml(message)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
    .card { background: #1e293b; padding: 32px; border-radius: 12px; max-width: 650px; width: 100%; border: 1px solid #334155; }
    h1 { margin-top: 0; color: #ef4444; font-size: 24px; }
    p { color: #cbd5e1; line-height: 1.6; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Error ${status}</h1>
    <p>${escapeHtml(message)}</p>
    ${stackHtml}
    <p><a href="/">← Back to Home</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Create Webspresso Central Error Handler Middleware
 * @param {Object} [options]
 * @param {boolean} [options.isDev=false]
 * @param {Function} [options.getCustomHandler]
 * @param {Function} [options.renderHtmlError]
 * @returns {import('express').ErrorRequestHandler}
 */
function createCentralErrorHandler(options = {}) {
  const isDev = Boolean(options.isDev);
  const getCustomHandler = typeof options.getCustomHandler === 'function' ? options.getCustomHandler : () => null;
  const renderHtmlError = typeof options.renderHtmlError === 'function' ? options.renderHtmlError : null;

  return async function centralErrorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }

    // Handle Client Request Aborted
    if (err instanceof RequestAbortedError || req.aborted || (req.socket && req.socket.destroyed)) {
      // Do not attempt to write to closed socket
      return;
    }

    // Normalize error
    const normalized = normalizeError(err, isDev);
    const status = normalized.status || 500;

    // Attach custom headers from HttpError if present
    if (normalized.headers && typeof normalized.headers === 'object') {
      for (const [key, value] of Object.entries(normalized.headers)) {
        res.setHeader(key, value);
      }
    }

    // Check for custom error handler registered via app.setErrorHandler(...)
    const customHandler = getCustomHandler();
    if (typeof customHandler === 'function') {
      try {
        const handled = await customHandler(err, req, res, next);
        if (res.headersSent || handled === true) {
          return;
        }
      } catch (customErr) {
        // Prevent infinite error loops by logging custom handler error and continuing with fallback
        if (typeof console !== 'undefined' && console.error) {
          console.error('[webspresso] Error in custom error handler:', customErr);
        }
      }
    }

    // Log errors based on severity
    if (status >= 500) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[webspresso] Server Error:', err);
      }
    } else if (isDev && status >= 400) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[webspresso] HTTP ${status}:`, normalized.message);
      }
    }

    res.status(status);

    // Format response (JSON vs HTML)
    if (preferJsonErrorResponse(req)) {
      return res.json(toErrorResponseObject(normalized, isDev));
    }

    if (renderHtmlError) {
      try {
        const html = await renderHtmlError(normalized, req, res);
        if (html && !res.headersSent) {
          return res.send(html);
        }
      } catch (renderErr) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[webspresso] Error rendering HTML error page:', renderErr);
        }
      }
    }

    return res.send(renderDefaultErrorHtml(normalized, isDev));
  };
}

module.exports = {
  preferJsonErrorResponse,
  createCentralErrorHandler,
  renderDefaultErrorHtml,
};
