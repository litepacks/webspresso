/**
 * Webspresso Development Live & Hot Reload Hub
 * Zero-dependency SSE-based CSS Hot Reload & Page Reload
 * @module dev-reload
 */

const fs = require('fs');
const path = require('path');

const CLIENT_SCRIPT_PATH = '/__webspresso/dev-reload.js';
const SSE_ENDPOINT_PATH = '/__webspresso/dev-reload';

const CLIENT_RUNTIME_SCRIPT = `(function() {
  if (typeof window === 'undefined' || !window.EventSource) return;

  var es = null;
  var reconnectTimer = null;

  function reloadCss(targetFile) {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var fileName = targetFile ? targetFile.split(/[\\\\/]/).pop() : null;
    var count = 0;

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.getAttribute('href');
      if (!href) continue;

      var cleanHref = href.split('?')[0];
      var isLocal = !cleanHref.startsWith('http://') && !cleanHref.startsWith('https://') && !cleanHref.startsWith('//');
      if (isLocal) {
        if (!fileName || cleanHref.endsWith(fileName) || fileName.endsWith('.css')) {
          link.href = cleanHref + '?_ws_reload=' + Date.now();
          count++;
        }
      }
    }

    if (count > 0) {
      console.log('[Webspresso] ⚡ CSS hot reloaded (' + count + ' stylesheet' + (count > 1 ? 's' : '') + ')');
    }
  }

  var overlayEl = null;

  function clearOverlay() {
    if (overlayEl) {
      try { overlayEl.remove(); } catch (_) {}
      overlayEl = null;
    }
    var old = document.getElementById('webspresso-dev-error-overlay');
    if (old) {
      try { old.remove(); } catch (_) {}
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showOverlay(data) {
    clearOverlay();

    var title = data.title || 'Development Error';
    var message = data.message || 'An error occurred during build or rendering.';
    var file = data.file || (data.location && data.location.file) || '';
    var line = data.line || (data.location && data.location.line) || '';
    var column = data.column || (data.location && data.location.column) || '';
    var lineText = data.lineText || (data.location && data.location.lineText) || '';

    var locationStr = file ? (file + (line ? ':' + line + (column ? ':' + column : '') : '')) : '';

    var host = document.createElement('div');
    host.id = 'webspresso-dev-error-overlay';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;';

    var card = document.createElement('div');
    card.style.cssText = 'background:#18181b;color:#f4f4f5;border:1px solid #ef4444;border-radius:12px;width:100%;max-width:860px;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5),0 0 25px -5px rgba(239,68,68,0.3);box-sizing:border-box;display:flex;flex-direction:column;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #27272a;background:#09090b;border-top-left-radius:12px;border-top-right-radius:12px;';
    
    var titleBox = document.createElement('div');
    titleBox.style.cssText = 'display:flex;align-items:center;gap:10px;';
    titleBox.innerHTML = '<span style="display:inline-block;padding:3px 8px;background:#ef4444;color:#fff;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Error</span> <strong style="font-size:14px;color:#f87171;">' + escapeHtml(title) + '</strong>';

    var closeBtn = document.createElement('button');
    closeBtn.innerText = '✕';
    closeBtn.title = 'Dismiss overlay (Esc)';
    closeBtn.style.cssText = 'background:transparent;border:none;color:#a1a1aa;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;line-height:1;transition:color 0.15s,background 0.15s;';
    closeBtn.onmouseenter = function() { closeBtn.style.color = '#fff'; closeBtn.style.background = '#27272a'; };
    closeBtn.onmouseleave = function() { closeBtn.style.color = '#a1a1aa'; closeBtn.style.background = 'transparent'; };
    closeBtn.onclick = clearOverlay;

    header.appendChild(titleBox);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.style.cssText = 'padding:20px;display:flex;flex-direction:column;gap:14px;';

    var msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:15px;line-height:1.5;color:#fca5a5;font-weight:600;white-space:pre-wrap;word-break:break-word;';
    msgEl.innerText = message;
    body.appendChild(msgEl);

    if (locationStr) {
      var locEl = document.createElement('div');
      locEl.style.cssText = 'display:inline-flex;align-items:center;padding:6px 12px;background:#27272a;border-radius:6px;font-size:12px;color:#93c5fd;word-break:break-all;';
      locEl.innerText = '📍 ' + locationStr;
      body.appendChild(locEl);
    }

    if (lineText) {
      var codeBox = document.createElement('div');
      codeBox.style.cssText = 'background:#09090b;border:1px solid #27272a;border-radius:8px;padding:14px 16px;overflow-x:auto;font-size:13px;line-height:1.6;color:#e4e4e7;';
      
      var codeHtml = '';
      if (line) {
        codeHtml += '<span style="color:#71717a;margin-right:12px;user-select:none;">' + line + ' |</span>';
      }
      codeHtml += escapeHtml(lineText) + '\\n';
      if (column) {
        var indent = '';
        var colNum = parseInt(column, 10);
        if (line) {
          indent += ' '.repeat(String(line).length + 3);
        }
        indent += ' '.repeat(Math.max(0, colNum - 1));
        codeHtml += '<span style="color:#ef4444;font-weight:bold;">' + indent + '^</span>';
      }
      codeBox.innerHTML = '<pre style="margin:0;font-family:inherit;">' + codeHtml + '</pre>';
      body.appendChild(codeBox);
    }

    if (Array.isArray(data.errors) && data.errors.length > 1) {
      var moreEl = document.createElement('div');
      moreEl.style.cssText = 'font-size:12px;color:#a1a1aa;';
      moreEl.innerText = '+ ' + (data.errors.length - 1) + ' more error(s) in terminal';
      body.appendChild(moreEl);
    }

    var footer = document.createElement('div');
    footer.style.cssText = 'padding:12px 20px;background:#09090b;border-top:1px solid #27272a;border-bottom-left-radius:12px;border-bottom-right-radius:12px;font-size:11px;color:#71717a;display:flex;align-items:center;justify-content:space-between;';
    footer.innerHTML = '<span>Fix the error in your editor and save — this overlay will close automatically.</span><span>Press <strong>Esc</strong> to dismiss</span>';

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    host.appendChild(card);

    document.body.appendChild(host);
    overlayEl = host;

    function onKeyDown(ev) {
      if (ev.key === 'Escape') {
        clearOverlay();
        document.removeEventListener('keydown', onKeyDown);
      }
    }
    document.addEventListener('keydown', onKeyDown);
  }

  function connect() {
    if (es) {
      try { es.close(); } catch (_) {}
    }

    es = new window.EventSource('${SSE_ENDPOINT_PATH}');

    es.addEventListener('reload', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'css') {
          clearOverlay();
          reloadCss(data.file);
        } else if (data.type === 'full') {
          clearOverlay();
          console.log('[Webspresso] 🔄 Reloading page...');
          window.location.reload();
        } else if (data.type === 'error') {
          showOverlay(data);
        } else if (data.type === 'clear-error') {
          clearOverlay();
        }
      } catch (err) {
        console.error('[Webspresso] Dev reload error:', err);
      }
    });

    es.onerror = function() {
      es.close();
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(function() {
          reconnectTimer = null;
          connect();
        }, 2000);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
`;

/**
 * Create Dev Reload Hub
 * @param {Object} config
 * @param {import('express').Express} [config.app]
 * @param {string} [config.publicDir]
 * @param {Object} [config.options]
 * @param {boolean} [config.enabled]
 * @param {Object} [config.logger]
 */
function createDevReloadHub(config = {}) {
  const {
    app,
    publicDir,
    options = {},
    enabled = false,
    logger = null,
  } = config;

  if (!enabled) {
    return null;
  }

  const debounceMs = typeof options.debounce === 'number' ? options.debounce : 50;
  const watchCss = options.watchCss !== false;
  const autoInject = options.autoInject !== false;
  const extraWatch = Array.isArray(options.watch) ? options.watch : [];

  const clients = new Set();
  const watchers = [];
  let heartbeatTimer = null;
  let cssDebounceTimer = null;
  let isClosed = false;

  function broadcast(type, payload = {}) {
    if (isClosed) return;
    const data = JSON.stringify({ type, timestamp: Date.now(), ...payload });
    const message = `event: reload\ndata: ${data}\n\n`;
    for (const client of clients) {
      try {
        client.write(message);
      } catch (_) {
        clients.delete(client);
      }
    }
  }

  const hub = {
    broadcast,
    close,
    getClientsCount: () => clients.size,
    handleSse,
    handleScript,
    autoInjectMiddleware,
  };

  // Heartbeat ping every 25s
  heartbeatTimer = setInterval(() => {
    if (isClosed) return;
    for (const client of clients) {
      try {
        client.write(': ping\n\n');
      } catch (_) {
        clients.delete(client);
      }
    }
  }, 25000);
  if (heartbeatTimer.unref) {
    heartbeatTimer.unref();
  }

  // SSE route handler
  function handleSse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: {"status":"connected"}\n\n');
    clients.add(res);

    req.on('close', () => {
      clients.delete(res);
    });
  }

  // Client JS route handler
  function handleScript(req, res) {
    res.type('application/javascript');
    res.send(CLIENT_RUNTIME_SCRIPT);
  }

  // Auto-inject middleware into HTML responses before </body>
  function autoInjectMiddleware(req, res, next) {
    if (!autoInject) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const origSend = res.send.bind(res);
    res.send = function(body) {
      if (typeof body === 'string' && body.includes('</body>')) {
        const scriptTag = `<script defer src="${CLIENT_SCRIPT_PATH}"></script>`;
        if (!body.includes(CLIENT_SCRIPT_PATH)) {
          body = body.replace('</body>', scriptTag + '\n</body>');
        }
      }
      return origSend(body);
    };
    next();
  }

  if (app) {
    app.get(SSE_ENDPOINT_PATH, handleSse);
    app.get(CLIENT_SCRIPT_PATH, handleScript);
    if (autoInject) {
      app.use(autoInjectMiddleware);
    }
  }

  function onCssFileChanged(filename) {
    if (filename && !filename.endsWith('.css')) return;
    if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
    cssDebounceTimer = setTimeout(() => {
      cssDebounceTimer = null;
      if (logger) logger.log(`[Webspresso] ⚡ CSS change detected: ${filename || 'style.css'}`);
      hub.broadcast('css', { file: filename || 'style.css' });
    }, debounceMs);
  }

  function startWatchers() {
    const dirsToWatch = new Set();
    if (watchCss && publicDir && fs.existsSync(publicDir)) {
      const absPublic = path.resolve(publicDir);
      dirsToWatch.add(absPublic);
      const cssSub = path.join(absPublic, 'css');
      if (fs.existsSync(cssSub)) {
        dirsToWatch.add(cssSub);
      }
    }
    for (const w of extraWatch) {
      if (fs.existsSync(w)) {
        dirsToWatch.add(path.resolve(w));
      }
    }

    for (const dir of dirsToWatch) {
      try {
        const w = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          onCssFileChanged(filename);
        });
        watchers.push(w);
      } catch (err) {
        // Fallback without recursive option if platform does not support it
        try {
          const w = fs.watch(dir, (eventType, filename) => {
            onCssFileChanged(filename);
          });
          watchers.push(w);
        } catch (_) {}
      }
    }
  }

  startWatchers();

  function close() {
    isClosed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (cssDebounceTimer) {
      clearTimeout(cssDebounceTimer);
      cssDebounceTimer = null;
    }
    for (const w of watchers) {
      try { w.close(); } catch (_) {}
    }
    watchers.length = 0;
    for (const client of clients) {
      try { client.end(); } catch (_) {}
    }
    clients.clear();
  }

  return hub;
}

module.exports = {
  createDevReloadHub,
  CLIENT_SCRIPT_PATH,
  SSE_ENDPOINT_PATH,
};
