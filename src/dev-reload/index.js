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
  var wasConnected = false;
  var reconnectDelay = 200;

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

  function safeReload(reason) {
    clearOverlay();
    var reasonMsg = reason ? ' (' + reason + ')' : '';
    console.log('[Webspresso] 🔄 Reloading page' + reasonMsg + '...');

    // Ping server with lightweight HEAD request to make sure it is ready before full reload.
    // This prevents browser "This site can't be reached" (ERR_CONNECTION_REFUSED) screens
    // when the dev server is in the middle of restarting.
    function pingAndReload() {
      if (typeof window.fetch !== 'function') {
        window.location.reload();
        return;
      }

      fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
        .then(function(res) {
          if (res.ok || res.status < 500) {
            window.location.reload();
          } else {
            setTimeout(pingAndReload, 150);
          }
        })
        .catch(function() {
          setTimeout(pingAndReload, 150);
        });
    }

    setTimeout(pingAndReload, 30);
  }

  function connect() {
    if (es) {
      try { es.close(); } catch (_) {}
    }

    es = new window.EventSource('${SSE_ENDPOINT_PATH}');

    es.addEventListener('open', function() {
      reconnectDelay = 200;
      if (wasConnected) {
        console.log('[Webspresso] 🔄 Dev server reconnected, reloading page...');
        safeReload('server reconnected');
        return;
      }
      wasConnected = true;
    });

    es.addEventListener('reload', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'css') {
          clearOverlay();
          reloadCss(data.file);
        } else if (data.type === 'full') {
          safeReload(data.reason);
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
      try { es.close(); } catch (_) {}
      if (!reconnectTimer) {
        var delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 1500);
        reconnectTimer = setTimeout(function() {
          reconnectTimer = null;
          connect();
        }, delay);
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
 * @param {string} [config.pagesDir]
 * @param {string} [config.viewsDir]
 * @param {Object} [config.options]
 * @param {boolean} [config.enabled]
 * @param {Object} [config.logger]
 * @param {Function} [config.onTemplateChange]
 * @param {Object} [config.nunjucksEnv]
 */
function createDevReloadHub(config = {}) {
  const {
    app,
    publicDir,
    pagesDir,
    viewsDir,
    options = {},
    enabled = false,
    logger = null,
    onTemplateChange = null,
    nunjucksEnv = null,
  } = config;

  if (!enabled) {
    return null;
  }

  const debounceMs = typeof options.debounce === 'number' ? options.debounce : 50;
  const watchCss = options.watchCss !== false;
  const watchTemplates = options.watchTemplates !== false;
  const autoInject = options.autoInject !== false;
  const watchPublicAll = options.watchPublicAll === true;
  const extraWatch = Array.isArray(options.watch) ? options.watch : [];

  const templateExtensions = new Set(
    (Array.isArray(options.templateExtensions)
      ? options.templateExtensions
      : ['.njk', '.html', '.jinja', '.jinja2']
    ).map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
  );

  const pageExtensions = new Set(
    (Array.isArray(options.pageExtensions)
      ? options.pageExtensions
      : ['.njk', '.html', '.jinja', '.jinja2', '.js', '.json']
    ).map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
  );

  const clients = new Set();
  const watchers = [];
  const watchedPaths = new Set();
  let heartbeatTimer = null;
  let cssDebounceTimer = null;
  let templateDebounceTimer = null;
  let isClosed = false;

  let activeNunjucksEnv = nunjucksEnv;
  let onTemplateChangeCallback = onTemplateChange;

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

  function invalidateTemplateCache(changedFile) {
    try {
      const { clearNjkFrontmatterCaches } = require('../njk-frontmatter');
      clearNjkFrontmatterCaches();
    } catch (_) {}

    if (activeNunjucksEnv) {
      try {
        if (typeof activeNunjucksEnv.invalidateCache === 'function') {
          activeNunjucksEnv.invalidateCache();
        }
        if (Array.isArray(activeNunjucksEnv.loaders)) {
          for (const loader of activeNunjucksEnv.loaders) {
            if (loader && loader.cache) {
              loader.cache = {};
            }
            if (loader && typeof loader.invalidateCache === 'function') {
              loader.invalidateCache();
            }
          }
        }
      } catch (_) {}
    }

    if (typeof onTemplateChangeCallback === 'function') {
      try {
        onTemplateChangeCallback(changedFile);
      } catch (_) {}
    }
  }

  const hub = {
    broadcast,
    close,
    getClientsCount: () => clients.size,
    getWatchersCount: () => watchers.length,
    getWatchedPaths: () => Array.from(watchedPaths),
    handleSse,
    handleScript,
    autoInjectMiddleware,
    attachNunjucks: (env) => {
      activeNunjucksEnv = env;
    },
    setOnTemplateChange: (fn) => {
      onTemplateChangeCallback = fn;
    },
    invalidateTemplateCache,
    triggerTemplateReload: (filename, reason = 'template') => {
      onTemplateFileChanged(filename, reason);
    },
    triggerCssReload: (filename) => {
      onCssFileChanged(filename);
    },
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

  function shouldIgnore(filename) {
    if (!filename) return false;
    const basename = path.basename(filename);
    if (basename.startsWith('.')) return true;
    if (
      basename.endsWith('~') ||
      basename.endsWith('.swp') ||
      basename.endsWith('.swo') ||
      basename.endsWith('.tmp')
    ) {
      return true;
    }
    if (basename.endsWith('.test.js') || basename.endsWith('.spec.js')) {
      return true;
    }
    const normalized = filename.replace(/\\/g, '/');
    if (
      normalized.includes('/node_modules/') ||
      normalized.startsWith('node_modules/') ||
      normalized.includes('/.git/') ||
      normalized.startsWith('.git/')
    ) {
      return true;
    }
    return false;
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

  function onTemplateFileChanged(filename, reason = 'template') {
    if (templateDebounceTimer) clearTimeout(templateDebounceTimer);
    templateDebounceTimer = setTimeout(() => {
      templateDebounceTimer = null;
      invalidateTemplateCache(filename);
      if (logger) logger.log(`[Webspresso] 🔄 Template change detected: ${filename || 'view.njk'}`);
      hub.broadcast('full', { file: filename || 'view.njk', reason });
    }, debounceMs);
  }

  function watchDirectory(targetDir, handler) {
    if (!targetDir) return;
    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) return;
    if (watchedPaths.has(absDir)) return;
    watchedPaths.add(absDir);

    function addWatcher(dirToWatch, recursive) {
      try {
        const w = fs.watch(dirToWatch, { recursive }, (eventType, filename) => {
          handler(eventType, filename, dirToWatch);
        });
        w.on('error', () => {});
        watchers.push(w);
        return true;
      } catch (_) {
        return false;
      }
    }

    const recursiveSuccess = addWatcher(absDir, true);
    if (!recursiveSuccess) {
      const visited = new Set();
      function walkAndWatch(currentDir) {
        try {
          const real = fs.realpathSync(currentDir);
          if (visited.has(real)) return;
          visited.add(real);
        } catch (_) {
          return;
        }
        addWatcher(currentDir, false);
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.isSymbolicLink()) {
              walkAndWatch(path.join(currentDir, entry.name));
            }
          }
        } catch (_) {}
      }
      walkAndWatch(absDir);
    }
  }

  function startWatchers() {
    // 1. Watch publicDir for CSS hot-reload (and optional public assets)
    if (watchCss && publicDir && fs.existsSync(publicDir)) {
      watchDirectory(publicDir, (eventType, filename) => {
        if (!filename || shouldIgnore(filename)) return;
        const ext = path.extname(filename).toLowerCase();
        if (ext === '.css') {
          onCssFileChanged(filename);
        } else if (watchPublicAll) {
          onTemplateFileChanged(filename, 'public');
        }
      });
      const cssSub = path.join(path.resolve(publicDir), 'css');
      if (fs.existsSync(cssSub)) {
        watchDirectory(cssSub, (eventType, filename) => {
          if (!filename || shouldIgnore(filename)) return;
          if (filename.endsWith('.css')) {
            onCssFileChanged(filename);
          }
        });
      }
    }

    // 2. Watch viewsDir for template live-reload
    if (watchTemplates && viewsDir && fs.existsSync(viewsDir)) {
      watchDirectory(viewsDir, (eventType, filename) => {
        if (!filename || shouldIgnore(filename)) return;
        const ext = path.extname(filename).toLowerCase();
        if (ext === '.css') {
          onCssFileChanged(filename);
        } else if (templateExtensions.has(ext)) {
          onTemplateFileChanged(filename, 'views');
        }
      });
    }

    // 3. Watch pagesDir for page templates and loaders
    if (watchTemplates && pagesDir && fs.existsSync(pagesDir)) {
      watchDirectory(pagesDir, (eventType, filename) => {
        if (!filename || shouldIgnore(filename)) return;
        const ext = path.extname(filename).toLowerCase();
        if (ext === '.css') {
          onCssFileChanged(filename);
        } else if (pageExtensions.has(ext)) {
          onTemplateFileChanged(filename, 'pages');
        }
      });
    }

    // 4. Extra watch paths
    for (const extra of extraWatch) {
      if (!extra || !fs.existsSync(extra)) continue;
      const absExtra = path.resolve(extra);
      try {
        const stat = fs.statSync(absExtra);
        if (stat.isDirectory()) {
          watchDirectory(absExtra, (eventType, filename) => {
            if (!filename || shouldIgnore(filename)) return;
            const ext = path.extname(filename).toLowerCase();
            if (ext === '.css') {
              onCssFileChanged(filename);
            } else {
              onTemplateFileChanged(filename, 'extra');
            }
          });
        } else {
          const w = fs.watch(absExtra, (eventType, filename) => {
            const fileTarget = filename || path.basename(absExtra);
            if (!fileTarget || shouldIgnore(fileTarget)) return;
            const ext = path.extname(fileTarget).toLowerCase();
            if (ext === '.css') {
              onCssFileChanged(fileTarget);
            } else {
              onTemplateFileChanged(fileTarget, 'extra');
            }
          });
          w.on('error', () => {});
          watchers.push(w);
          watchedPaths.add(absExtra);
        }
      } catch (_) {}
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
    if (templateDebounceTimer) {
      clearTimeout(templateDebounceTimer);
      templateDebounceTimer = null;
    }
    for (const w of watchers) {
      try { w.close(); } catch (_) {}
    }
    watchers.length = 0;
    watchedPaths.clear();
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
