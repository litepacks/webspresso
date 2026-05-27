/**
 * Hono Context ↔ Express-shaped req/res for route handlers and plugins
 * @module src/http/context
 */

const qs = require('qs');
const { parseCookieHeader, getSignedCookies, sign, serializeCookie } = require('./cookies');

/**
 * @param {import('hono').Context} c
 * @param {{ cookieSecret?: string, trustProxy?: boolean }} [opts]
 * @returns {object}
 */
function buildReq(c, opts = {}) {
  const url = new URL(c.req.url);
  const cookieHeader = c.req.header('cookie') || '';
  const cookies = parseCookieHeader(cookieHeader);
  const signedCookies = getSignedCookies(cookies, opts.cookieSecret || '');

  let clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '';
  if (!clientIp && c.env?.incoming?.socket?.remoteAddress) {
    clientIp = c.env.incoming.socket.remoteAddress;
  }

  const sessionWrapper = c.get('sessionWrapper');

  const req = {
    method: c.req.method,
    path: url.pathname,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    query: qs.parse(url.search.slice(1), { allowDots: true, parseArrays: true }),
    params: c.req.param() || {},
    body: c.get('parsedBody') ?? {},
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    cookies,
    signedCookies,
    get(name) {
      return c.req.header(name) ?? null;
    },
    accepts(type) {
      const accept = (c.req.header('accept') || '').toLowerCase();
      if (!accept) return type === 'html';
      if (type === 'html') return accept.includes('text/html') || accept.includes('*/*');
      return accept.includes(type);
    },
    get timedout() {
      return !!c.get('timedout');
    },
    set timedout(v) {
      c.set('timedout', !!v);
    },
    get session() {
      return sessionWrapper || c.get('sessionData') || null;
    },
    set session(v) {
      c.set('sessionData', v);
    },
    get user() {
      return c.get('user') ?? null;
    },
    set user(v) {
      c.set('user', v);
    },
    get auth() {
      return c.get('auth') ?? null;
    },
    set auth(v) {
      c.set('auth', v);
    },
    get db() {
      return c.get('db') ?? null;
    },
    set db(v) {
      c.set('db', v);
    },
    get input() {
      return c.get('input') ?? { body: undefined, params: undefined, query: undefined };
    },
    set input(v) {
      c.set('input', v);
    },
    ip: clientIp,
    xhr: c.req.header('x-requested-with') === 'XMLHttpRequest',
    protocol: url.protocol.replace(':', ''),
  };

  return req;
}

/**
 * @param {import('hono').Context} c
 * @param {{ cookieSecret?: string }} [opts]
 */
function createCompatResponse(c, opts = {}) {
  let statusCode = 200;
  /** @type {Record<string, string>} */
  const headers = {};
  let ended = false;
  let handled = false;
  /** @type {Function[]} */
  const finishListeners = [];

  const res = {
    statusCode: 200,
    headers: {},
    locals: {},

    status(code) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },

    set(name, value) {
      headers[name.toLowerCase()] = String(value);
      return res;
    },

    setHeader(name, value) {
      return res.set(name, value);
    },

    type(t) {
      return res.set('content-type', t);
    },

    getHeader(name) {
      return headers[name.toLowerCase()];
    },

    cookie(name, value, cookieOpts = {}) {
      let val = String(value);
      if (cookieOpts.signed && opts.cookieSecret) {
        val = `s:${sign(val, opts.cookieSecret)}`;
      }
      const existing = c.res.headers.get('Set-Cookie');
      const serialized = serializeCookie(name, val, {
        maxAge: cookieOpts.maxAge,
        httpOnly: cookieOpts.httpOnly,
        secure: cookieOpts.secure,
        sameSite: cookieOpts.sameSite
          ? cookieOpts.sameSite.charAt(0).toUpperCase() + cookieOpts.sameSite.slice(1).toLowerCase()
          : undefined,
        path: cookieOpts.path || '/',
      });
      if (existing) {
        c.header('Set-Cookie', [existing, serialized], { append: true });
      } else {
        c.header('Set-Cookie', serialized);
      }
      return res;
    },

    clearCookie(name, cookieOpts = {}) {
      return res.cookie(name, '', { ...cookieOpts, maxAge: 0 });
    },

    async redirect(urlOrStatus, maybeUrl) {
      handled = true;
      ended = true;
      let url;
      let status;
      if (typeof urlOrStatus === 'number') {
        status = urlOrStatus;
        url = maybeUrl;
      } else {
        url = urlOrStatus;
        status = maybeUrl != null ? maybeUrl : 302;
      }
      if (status == null || status < 200 || status > 599) {
        status = 302;
      }
      const ret = await c.redirect(url, status);
      c.set('compatReturnValue', ret);
      res._notifyFinish();
      return ret;
    },

    async json(data) {
      handled = true;
      ended = true;
      for (const [k, v] of Object.entries(headers)) {
        c.header(k, v);
      }
      c.set('lastJsonBody', data);
      const ret = await c.json(data, statusCode);
      c.set('compatReturnValue', ret);
      res._notifyFinish();
      return ret;
    },

    async send(body) {
      handled = true;
      ended = true;
      if (
        typeof body === 'string' &&
        body.trimStart().startsWith('<') &&
        !headers['content-type']
      ) {
        headers['content-type'] = 'text/html; charset=utf-8';
      }
      for (const [k, v] of Object.entries(headers)) {
        c.header(k, v);
      }
      const ct = headers['content-type'] || '';
      let ret;
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        ret = await c.body(body, statusCode);
      } else if (typeof body === 'object') {
        ret = await c.json(body, statusCode);
      } else if (
        typeof body === 'string' &&
        (ct.includes('html') || (!ct && body.trimStart().startsWith('<')))
      ) {
        ret = await c.html(body, statusCode);
      } else if (ct) {
        const h = new Headers();
        for (const [k, v] of Object.entries(headers)) {
          h.set(k, v);
        }
        ret = new Response(String(body), { status: statusCode, headers: h });
      } else {
        ret = await c.text(String(body), statusCode);
      }
      c.set('compatReturnValue', ret);
      res._notifyFinish();
      return ret;
    },

    render(_view, _data, callback) {
      if (callback) callback(new Error('res.render is not supported; use Nunjucks directly'));
      return res;
    },

    on(event, fn) {
      if (event === 'finish') finishListeners.push(fn);
      return res;
    },

    get _ended() {
      return ended;
    },
    get _handled() {
      return handled;
    },
    _markHandled() {
      handled = true;
      ended = true;
    },
    _notifyFinish() {
      for (const fn of finishListeners) {
        try {
          fn();
        } catch (e) {
          console.error('res finish listener error:', e);
        }
      }
    },
  };

  return res;
}

/**
 * Attach express-session-like API to hono-sessions Session wrapper
 * @param {import('hono').Context} c
 * @param {import('hono-sessions').Session} [honoSession]
 */
function attachSessionWrapper(c, honoSession) {
  const cache = honoSession?.getCache?.()?._data || {};

  const wrapper = {
    regenerate(cb) {
      if (honoSession) {
        const fresh = { _data: {}, _expire: null, _delete: false, _accessed: null };
        honoSession.setCache(fresh, true);
      }
      if (typeof cb === 'function') cb();
    },
    destroy(cb) {
      if (honoSession) honoSession.deleteSession();
      if (typeof cb === 'function') cb();
    },
    save(cb) {
      if (typeof cb === 'function') cb();
    },
  };

  return new Proxy(wrapper, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (honoSession && typeof prop === 'string') {
        const entry = cache[prop];
        return entry?.value;
      }
      return undefined;
    },
    set(_target, prop, value) {
      if (prop === 'regenerate' || prop === 'destroy' || prop === 'save') return true;
      if (honoSession && typeof prop === 'string') {
        honoSession.set(prop, value);
      }
      return true;
    },
    deleteProperty(_target, prop) {
      if (honoSession && typeof prop === 'string') {
        honoSession.delete(prop);
      }
      return true;
    },
  });
}

function bindSessionWrapper(c) {
  const honoSession = c.get('session');
  const wrapper = attachSessionWrapper(c, honoSession);
  c.set('sessionWrapper', wrapper);
}

module.exports = {
  buildReq,
  createCompatResponse,
  attachSessionWrapper,
  bindSessionWrapper,
};
