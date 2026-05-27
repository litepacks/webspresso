/**
 * Hono app with Express-compatible surface (use, get, post, set, listen)
 * @module src/http/compat-app
 */

const path = require('path');
const { Hono } = require('hono');
const { serveStatic } = require('@hono/node-server/serve-static');
const { expressToHono, runExpressHandlers } = require('./middleware');
const { listen } = require('./node-serve');

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

/**
 * @param {{ cookieSecret?: string }} [globalOpts]
 */
function createCompatApp(globalOpts = {}) {
  const hono = new Hono();
  /** @type {Map<string, unknown>} */
  const settings = new Map();
  settings.set('trust proxy', 1);

  const opts = { ...globalOpts };

  function wrapHandlers(...handlers) {
    const fns = handlers.filter((h) => typeof h === 'function');
    if (fns.length === 0) return async (c) => c.text('Not Found', 404);

    return async (c) => {
      await runExpressHandlers(c, fns, opts);
      const ret = c.get('compatReturnValue');
      if (ret) return ret;
      if (c.finalized) return;
      return c.text('Not Found', 404);
    };
  }

  function registerRoute(method, path, ...handlers) {
    const m = method.toLowerCase();
    const routePath = path === '/' ? '/' : path;
    const handler = wrapHandlers(...handlers);

    if (m === 'all') {
      for (const rm of ROUTE_METHODS) {
        if (rm === 'all') continue;
        hono.on(rm.toUpperCase(), routePath, handler);
      }
      return;
    }
    hono.on(m.toUpperCase(), routePath, handler);
  }

  function use(...args) {
    if (args.length === 0) return;

    let path = '*';
    let handlers = args;

    if (typeof args[0] === 'string') {
      path = args[0];
      handlers = args.slice(1);
    }

    for (const h of handlers) {
      if (!h) continue;

      if (h && typeof h === 'object' && h._hono) {
        const base = path === '*' ? '/' : path.replace(/\/$/, '') || '/';
        hono.route(base, h._hono);
        continue;
      }

      if (h && typeof h === 'object' && h.fetch && typeof h.fetch === 'function') {
        const base = path === '*' ? '/' : path.replace(/\/$/, '') || '/';
        hono.route(base, h);
        continue;
      }

      hono.use(path, expressToHono(h, opts));
    }
  }

  hono.notFound(async (c) => {
    if (app._notFoundHandler) {
      return app._notFoundHandler(c);
    }
    return c.text('Not Found', 404);
  });

  hono.onError(async (err, c) => {
    if (app._errorHandler) {
      return app._errorHandler(c, err);
    }
    throw err;
  });

  const app = {
    _hono: hono,
    _settings: settings,
    _notFoundHandler: null,
    _errorHandler: null,

    get fetch() {
      return hono.fetch.bind(hono);
    },

    notFound(handler) {
      this._notFoundHandler = handler;
    },

    onError(handler) {
      this._errorHandler = handler;
    },

    useSecureHeaders(headerMap) {
      hono.use('*', async (c, next) => {
        for (const [k, v] of Object.entries(headerMap)) {
          if (v === '') c.res.headers.delete(k);
          else c.header(k, v);
        }
        await next();
      });
    },

    set(key, value) {
      settings.set(key, value);
    },

    get(key, ...rest) {
      if (rest.length === 0 && typeof key === 'string' && !ROUTE_METHODS.has(key.toLowerCase())) {
        if (settings.has(key)) return settings.get(key);
        if (!key.startsWith('/') && !key.includes('*')) {
          return settings.get(key);
        }
      }
      return registerRoute('get', key, ...rest);
    },

    use,
    listen(port, callback) {
      return listen(app, port, callback);
    },

    mountStatic(publicDir, { maxAge = 0 } = {}) {
      const root = path.resolve(publicDir);
      hono.use(
        '*',
        serveStatic({
          root,
          onNotFound: (_p, c) => c,
        })
      );
    },

    mountBodyParsers() {
      hono.use('*', async (c, next) => {
        const method = c.req.method;
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
          c.set('parsedBody', {});
          return next();
        }
        const ct = (c.req.header('content-type') || '').toLowerCase();
        try {
          if (ct.includes('application/json')) {
            c.set('parsedBody', await c.req.json());
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            const text = await c.req.text();
            c.set('parsedBody', Object.fromEntries(new URLSearchParams(text)));
          } else if (ct.includes('multipart/form-data')) {
            c.set('parsedBody', await c.req.parseBody());
          } else {
            c.set('parsedBody', {});
          }
        } catch {
          c.set('parsedBody', {});
        }
        await next();
      });
    },

    mountTimeout(ms) {
      const duration = typeof ms === 'string' ? parseTimeout(ms) : ms;
      hono.use('*', async (c, next) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          c.set('timedout', true);
          controller.abort();
        }, duration);
        try {
          await next();
        } finally {
          clearTimeout(timer);
        }
      });
    },

    mountHaltOnTimedout() {
      hono.use('*', async (c, next) => {
        if (c.get('timedout')) return;
        await next();
      });
    },
  };

  for (const m of ROUTE_METHODS) {
    if (m === 'all') {
      app.all = (path, ...handlers) => registerRoute('all', path, ...handlers);
    } else {
      app[m] = (path, ...handlers) => registerRoute(m, path, ...handlers);
    }
  }

  app.post = (path, ...handlers) => registerRoute('post', path, ...handlers);
  app.put = (path, ...handlers) => registerRoute('put', path, ...handlers);
  app.patch = (path, ...handlers) => registerRoute('patch', path, ...handlers);
  app.delete = (path, ...handlers) => registerRoute('delete', path, ...handlers);
  app.options = (path, ...handlers) => registerRoute('options', path, ...handlers);
  app.head = (path, ...handlers) => registerRoute('head', path, ...handlers);

  return app;
}

/**
 * @param {string} str e.g. '30s', '1m'
 * @returns {number}
 */
function parseTimeout(str) {
  if (typeof str === 'number') return str;
  const m = String(str).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!m) return 30000;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60000;
  if (unit === 'h') return n * 3600000;
  return 30000;
}

module.exports = { createCompatApp };
