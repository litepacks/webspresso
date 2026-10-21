'use strict';

/**
 * Webspresso Hono HTTP Adapter
 * Adapter bridging Webspresso pipelines and routes onto Hono
 * @module core/http/hono-adapter
 */

const { HttpAdapter } = require('./adapter');
const { executeApiPipeline, executePagePipeline } = require('./pipeline');

/**
 * Parses cookies from cookie header
 * @param {string} cookieHeader
 * @returns {Record<string, string>}
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch (_) {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Creates an Express-compatible Request abstraction from a Hono Context
 * @param {import('hono').Context} c
 * @returns {Object}
 */
function createHonoCompatReq(c) {
  const rawHeaders = c.req.raw ? Object.fromEntries(c.req.raw.headers.entries()) : (c.req.header() || {});
  const cookieHeader = c.req.header('cookie') || '';
  const cookies = parseCookies(cookieHeader);

  let pathname = '/';
  try {
    const url = new URL(c.req.url);
    pathname = url.pathname;
  } catch (_) {
    pathname = c.req.path || '/';
  }

  const req = {
    method: c.req.method,
    url: c.req.url,
    path: pathname,
    headers: rawHeaders,
    params: c.req.param() || {},
    query: c.req.query() || {},
    body: {},
    cookies,
    headersSent: false,
    user: null,
    session: null,
    auth: null,
    db: null,
    service: null,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '127.0.0.1',
    protocol: 'http',
    get(name) {
      return c.req.header(name) ?? null;
    },
    header(name) {
      return c.req.header(name) ?? null;
    },
  };

  return req;
}

/**
 * Creates an Express-compatible Response abstraction that renders to a Web Response
 * @param {import('hono').Context} c
 * @returns {Object}
 */
function createHonoCompatRes(c) {
  let statusCode = 200;
  const headers = new Headers();
  let bodyContent = null;
  let headersSent = false;

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code) {
      statusCode = code;
    },
    get headersSent() {
      return headersSent;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    type(mime) {
      if (!mime) return res;
      let contentType = mime;
      if (mime === 'html') contentType = 'text/html; charset=utf-8';
      else if (mime === 'json') contentType = 'application/json; charset=utf-8';
      else if (mime === 'text' || mime === 'txt') contentType = 'text/plain; charset=utf-8';
      else if (mime === 'css') contentType = 'text/css; charset=utf-8';
      else if (mime === 'js' || mime === 'javascript') contentType = 'application/javascript; charset=utf-8';
      else if (!mime.includes('/')) contentType = `text/${mime}`;
      headers.set('content-type', contentType);
      return res;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
      return res;
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    cookie(name, value, opts = {}) {
      let cookieStr = `${name}=${encodeURIComponent(value)}`;
      if (opts.maxAge) cookieStr += `; Max-Age=${opts.maxAge}`;
      if (opts.httpOnly) cookieStr += '; HttpOnly';
      if (opts.secure) cookieStr += '; Secure';
      if (opts.path) cookieStr += `; Path=${opts.path}`;
      else cookieStr += '; Path=/';
      if (opts.sameSite) cookieStr += `; SameSite=${opts.sameSite}`;
      headers.append('set-cookie', cookieStr);
      return res;
    },
    redirect(urlOrStatus, maybeUrl) {
      headersSent = true;
      let url;
      let status = 302;
      if (typeof urlOrStatus === 'number') {
        status = urlOrStatus;
        url = maybeUrl;
      } else {
        url = urlOrStatus;
        if (typeof maybeUrl === 'number') status = maybeUrl;
      }
      statusCode = status;
      headers.set('location', url);
      return res;
    },
    writeHead(code, reasonOrHeaders, maybeHeaders) {
      statusCode = code;
      const h = typeof reasonOrHeaders === 'object' ? reasonOrHeaders : maybeHeaders;
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          headers.set(k.toLowerCase(), String(v));
        }
      }
      return res;
    },
    end(data) {
      headersSent = true;
      if (data !== undefined) {
        bodyContent = data;
      }
      if (typeof res._onEnd === 'function') {
        res._onEnd();
      }
      return res;
    },
    json(data) {
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json; charset=utf-8');
      }
      return res.end(JSON.stringify(data));
    },
    send(data) {
      if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
        return res.json(data);
      }
      return res.end(data);
    },
    streamText(sourceOrCallback, maybeOptions = {}) {
      headersSent = true;
      const contentType = maybeOptions.contentType || 'text/plain; charset=utf-8';
      headers.set('content-type', contentType);
      headers.set('cache-control', 'no-cache, no-transform');
      headers.set('x-content-type-options', 'nosniff');

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const controller = {
        async write(chunk) {
          const text = typeof chunk === 'object' && !Buffer.isBuffer(chunk) ? JSON.stringify(chunk) : String(chunk);
          await writer.write(encoder.encode(text));
        },
        async close() {
          await writer.close();
        },
      };

      (async () => {
        try {
          if (typeof sourceOrCallback === 'function') {
            const ret = sourceOrCallback(controller);
            if (ret && typeof ret[Symbol.asyncIterator] === 'function') {
              for await (const chunk of ret) {
                await controller.write(chunk);
              }
            } else if (ret && typeof ret.then === 'function') {
              await ret;
            }
          } else if (sourceOrCallback && typeof sourceOrCallback[Symbol.asyncIterator] === 'function') {
            for await (const chunk of sourceOrCallback) {
              await controller.write(chunk);
            }
          }
        } finally {
          try { await writer.close(); } catch (_) {}
        }
      })();

      res._streamBody = readable;
      return res;
    },
    streamJson(sourceOrCallback, maybeOptions = {}) {
      return res.streamText(sourceOrCallback, {
        ...maybeOptions,
        contentType: maybeOptions.contentType || 'application/x-ndjson; charset=utf-8',
        map: (item) => (typeof item === 'string' && item.endsWith('\n') ? item : `${JSON.stringify(item)}\n`),
      });
    },
    toResponse() {
      if (res._streamBody) {
        return new Response(res._streamBody, {
          status: statusCode,
          headers,
        });
      }
      return new Response(bodyContent, {
        status: statusCode,
        headers,
      });
    },
  };

  return res;
}

class HonoHttpAdapter extends HttpAdapter {
  constructor(app = null, options = {}) {
    let honoInstance = app;
    if (!honoInstance) {
      const { Hono } = require('hono');
      honoInstance = new Hono();
    }
    super(honoInstance, options);
  }

  use(...args) {
    if (!this.app || typeof this.app.use !== 'function') {
      throw new Error('HonoHttpAdapter: underlying Hono app does not support .use()');
    }

    let path = '*';
    let handlers = args;
    if (typeof args[0] === 'string') {
      path = args[0];
      handlers = args.slice(1);
    }

    for (const h of handlers) {
      if (typeof h !== 'function') continue;

      if (h.length >= 3) {
        // Express-style middleware (req, res, next)
        this.app.use(path, async (c, next) => {
          const req = createHonoCompatReq(c);
          const res = createHonoCompatRes(c);
          let calledNext = false;
          await new Promise((resolve, reject) => {
            let settled = false;
            const done = (err) => {
              if (settled) return;
              settled = true;
              if (err) reject(err);
              else resolve();
            };
            res._onEnd = () => done();

            try {
              h(req, res, (err) => {
                if (!err) calledNext = true;
                done(err);
              });
            } catch (err) {
              done(err);
            }
          });

          if (res.headersSent) {
            return res.toResponse();
          }
          if (calledNext) {
            await next();
          }
        });
      } else {
        // Hono middleware (c, next)
        this.app.use(path, h);
      }
    }
    return this;
  }

  route(method, path, ...handlers) {
    const m = (method || '').toLowerCase();
    // Normalize Express bracket parameters: e.g. /api/notes/[id] -> /api/notes/:id
    const honoPath = path.replace(/\[([^\]]+)\]/g, ':$1');

    for (const handler of handlers) {
      if (typeof handler !== 'function') continue;

      const honoHandler = async (c) => {
        const req = createHonoCompatReq(c);
        const res = createHonoCompatRes(c);

        // Parse body if present
        const contentType = c.req.header('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            req.body = await c.req.json();
          } catch (_) {
            req.body = {};
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          try {
            req.body = await c.req.parseBody();
          } catch (_) {
            req.body = {};
          }
        }

        try {
          const result = await handler(req, res);
          if (res.headersSent) {
            return res.toResponse();
          }
          if (result !== undefined) {
            if (typeof result === 'object' && result !== null) {
              return c.json(result);
            }
            return c.text(String(result));
          }
          return res.toResponse();
        } catch (err) {
          if (res.headersSent) {
            return res.toResponse();
          }
          const status = err.status || err.statusCode || 500;
          return c.json({
            error: err.name || 'Error',
            message: err.message,
            status,
            ...(err.issues ? { issues: err.issues } : {}),
          }, status);
        }
      };

      if (m === 'all') {
        this.app.all(honoPath, honoHandler);
      } else if (typeof this.app[m] === 'function') {
        this.app[m](honoPath, honoHandler);
      } else {
        this.app.on(m.toUpperCase(), honoPath, honoHandler);
      }
    }
    return this;
  }

  /**
   * Register a defineApi endpoint on Hono using Webspresso's executeApiPipeline
   * @param {string} method - HTTP method
   * @param {string} path - URL path
   * @param {Object} apiDef - API definition from defineApi
   * @param {Object} [context={}] - App / Core context
   */
  registerApi(method, path, apiDef, context = {}) {
    const handler = typeof apiDef === 'function' ? apiDef : (apiDef.handler || apiDef);
    const compiledSchema = apiDef.schema ? apiDef.schema : null;
    const descriptor = { path, method: method.toUpperCase(), file: 'virtual' };

    return this.route(method, path, async (req, res) => {
      return executeApiPipeline({
        descriptor,
        context,
        apiDef,
        handlerFn: handler,
        compiledSchema,
        middlewares: apiDef.middleware || [],
        req,
        res,
      });
    });
  }

  /**
   * Register a definePage SSR route on Hono using Webspresso's executePagePipeline
   * @param {string} path - URL path
   * @param {Object} pageDef - Page definition from definePage
   * @param {Object} [context={}] - App / Core context
   */
  registerPage(path, pageDef, context = {}) {
    const descriptor = { path, method: 'GET', file: 'virtual' };
    return this.route('get', path, async (req, res) => {
      return executePagePipeline({
        descriptor,
        context,
        pageDef,
        middlewares: pageDef.middleware || [],
        req,
        res,
        nunjucks: context.nunjucks,
      });
    });
  }

  /**
   * Direct fetch request execution via Hono's app.request()
   * @param {string|Request} input
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async request(input, init) {
    return Promise.resolve(this.app.request(input, init));
  }

  /**
   * Standard Web / Cloudflare Workers Fetch Handler
   * Enables: export default honoAdapter; or export default { fetch: (req, env, ctx) => honoAdapter.fetch(req, env, ctx) }
   * @param {Request} request
   * @param {any} [env]
   * @param {any} [ctx]
   * @returns {Response|Promise<Response>}
   */
  fetch(request, env, ctx) {
    return this.app.fetch(request, env, ctx);
  }

  /**
   * Listen on port using native Node http.createServer with Web Fetch bridge
   * @param {number|string} port
   * @param {Function} [callback]
   */
  listen(port, callback) {
    const http = require('http');
    const server = http.createServer(async (nodeReq, nodeRes) => {
      try {
        const protocol = nodeReq.socket.encrypted ? 'https' : 'http';
        const host = nodeReq.headers.host || `localhost:${port}`;
        const url = `${protocol}://${host}${nodeReq.url}`;

        const chunks = [];
        for await (const chunk of nodeReq) {
          chunks.push(chunk);
        }
        const body = chunks.length > 0 && nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD'
          ? Buffer.concat(chunks)
          : undefined;

        const webReq = new Request(url, {
          method: nodeReq.method,
          headers: nodeReq.headers,
          body,
          duplex: 'half',
        });

        const webRes = await Promise.resolve(this.app.fetch(webReq));

        nodeRes.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          nodeRes.setHeader(key, val);
        });

        const resBuffer = await webRes.arrayBuffer();
        nodeRes.end(Buffer.from(resBuffer));
      } catch (err) {
        nodeRes.statusCode = 500;
        nodeRes.end('Internal Server Error');
      }
    });

    return server.listen(port, callback);
  }
}

function createHonoHttpAdapter(app = null, options = {}) {
  return new HonoHttpAdapter(app, options);
}

module.exports = {
  HonoHttpAdapter,
  createHonoHttpAdapter,
  createHonoCompatReq,
  createHonoCompatRes,
};
