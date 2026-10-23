/**
 * Standard HTTP Mocks for Tests
 * Provides comprehensive, lightweight Express/Webspresso mock request, response, and next helpers.
 * @module tests/utils/http
 */

/**
 * Creates a mock Express / Webspresso Request object.
 *
 * @param {Object} [options={}] - Custom request properties
 * @returns {Object} Mock Request
 */
function createMockRequest(options = {}) {
  const headers = {};
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  const req = {
    method: (options.method || 'GET').toUpperCase(),
    path: options.path || '/',
    url: options.url || options.path || '/',
    originalUrl: options.originalUrl || options.url || options.path || '/',
    query: options.query ? { ...options.query } : {},
    params: options.params ? { ...options.params } : {},
    body: options.body !== undefined ? options.body : {},
    headers,
    cookies: options.cookies ? { ...options.cookies } : {},
    signedCookies: options.signedCookies ? { ...options.signedCookies } : {},
    session: options.session ? { ...options.session } : {},
    locals: options.locals ? { ...options.locals } : {},
    ip: options.ip || '127.0.0.1',
    protocol: options.protocol || 'http',
    secure: Boolean(options.secure),
    socket: options.socket || { remoteAddress: '127.0.0.1', destroy: () => {} },
    connection: options.connection || { remoteAddress: '127.0.0.1' },

    // Webspresso-specific context attributes
    input: options.input || {
      body: options.body !== undefined ? options.body : {},
      query: options.query ? { ...options.query } : {},
      params: options.params ? { ...options.params } : {},
    },
    auth: options.auth !== undefined ? options.auth : null,
    user: options.user !== undefined ? options.user : null,
    adminUser: options.adminUser !== undefined ? options.adminUser : null,
    db: options.db !== undefined ? options.db : null,
    service: options.service !== undefined ? options.service : null,
    queue: options.queue !== undefined ? options.queue : null,
    logger: options.logger !== undefined ? options.logger : null,

    get(name) {
      return this.headers[name.toLowerCase()] || null;
    },

    header(name) {
      return this.get(name);
    },

    accepts(type) {
      const accept = this.headers['accept'] || '';
      return accept.includes(type);
    },

    is(type) {
      const contentType = this.headers['content-type'] || '';
      return contentType.includes(type);
    },

    ...options,
  };

  // Re-ensure headers are merged lowercase even if passed in options
  if (options.headers) {
    req.headers = { ...headers };
  }

  return req;
}

/**
 * Creates a mock Express / Webspresso Response object.
 * Supports chaining, headers, cookies, json body recording, redirect, and optional Vitest spies.
 *
 * @param {Object} [options={}] - Custom response options
 * @param {boolean} [options.spy=false] - Whether to wrap terminal methods with vi.fn()
 * @returns {Object} Mock Response
 */
function createMockResponse(options = {}) {
  const rawHeaders = {};
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      rawHeaders[key.toLowerCase()] = value;
    }
  }

  const headers = new Proxy(rawHeaders, {
    get(target, prop) {
      if (typeof prop === 'string') {
        const lower = prop.toLowerCase();
        if (lower in target) return target[lower];
      }
      return target[prop];
    },
    set(target, prop, val) {
      if (typeof prop === 'string') {
        target[prop.toLowerCase()] = val;
      } else {
        target[prop] = val;
      }
      return true;
    },
    has(target, prop) {
      if (typeof prop === 'string') {
        return prop.toLowerCase() in target;
      }
      return prop in target;
    },
    deleteProperty(target, prop) {
      if (typeof prop === 'string') {
        delete target[prop.toLowerCase()];
      }
      delete target[prop];
      return true;
    },
  });

  const listeners = {};

  let resolveDone;
  const donePromise = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const res = {
    statusCode: options.statusCode !== undefined ? options.statusCode : 200,
    headers,
    locals: options.locals ? { ...options.locals } : {},
    body: null,
    _body: null,
    payload: null,
    jsonData: null,
    data: null,
    _json: null,
    _ended: false,
    headersSent: false,
    cookies: {},
    redirectUrl: null,
    renderedView: null,
    renderedData: null,
    done: donePromise,

    status(code) {
      this.statusCode = code;
      return this;
    },

    sendStatus(code) {
      this.statusCode = code;
      this._ended = true;
      this.headersSent = true;
      if (resolveDone) resolveDone(this);
      return this;
    },

    set(nameOrObj, val) {
      if (typeof nameOrObj === 'object' && nameOrObj !== null) {
        for (const [k, v] of Object.entries(nameOrObj)) {
          this.headers[k.toLowerCase()] = String(v);
        }
      } else if (typeof nameOrObj === 'string') {
        this.headers[nameOrObj.toLowerCase()] = String(val);
      }
      return this;
    },

    setHeader(name, val) {
      this.headers[name.toLowerCase()] = val;
      return this;
    },

    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },

    getHeaders() {
      return { ...this.headers };
    },

    hasHeader(name) {
      return Object.prototype.hasOwnProperty.call(this.headers, name.toLowerCase());
    },

    removeHeader(name) {
      delete this.headers[name.toLowerCase()];
      return this;
    },

    writeHead(statusCode, headersObj = {}) {
      this.statusCode = statusCode;
      this.headersSent = true;
      for (const [k, v] of Object.entries(headersObj)) {
        this.headers[k.toLowerCase()] = v;
      }
      return this;
    },

    type(contentType) {
      this.headers['content-type'] = contentType;
      return this;
    },

    send(body) {
      this.body = body;
      this._body = body;
      this._ended = true;
      this.headersSent = true;
      if (resolveDone) resolveDone(this);
      return this;
    },

    json(data) {
      if (!this.getHeader('content-type')) {
        this.setHeader('content-type', 'application/json');
      }
      this.jsonData = data;
      this.data = data;
      this.payload = data;
      this._json = data;
      this.body = data;
      this._body = data;
      this._ended = true;
      this.headersSent = true;
      if (resolveDone) resolveDone(this);
      return this;
    },

    end(data) {
      if (data !== undefined) {
        this.body = data;
      }
      this._ended = true;
      this.headersSent = true;
      if (resolveDone) resolveDone(this);
      return this;
    },

    write(chunk) {
      if (this.body === null) {
        this.body = chunk;
      } else if (typeof this.body === 'string') {
        this.body += chunk;
      }
      return this;
    },

    redirect(statusOrUrl, maybeUrl) {
      if (typeof statusOrUrl === 'number') {
        this.statusCode = statusOrUrl;
        this.redirectUrl = maybeUrl;
      } else {
        this.statusCode = 302;
        this.redirectUrl = statusOrUrl;
      }
      this.headers['location'] = this.redirectUrl;
      this._redirect = this.redirectUrl;
      this._ended = true;
      this.headersSent = true;
      if (resolveDone) resolveDone(this);
      return this;
    },

    cookie(name, value, cookieOpts = {}) {
      this.cookies[name] = { value, options: cookieOpts };
      return this;
    },

    clearCookie(name, cookieOpts = {}) {
      delete this.cookies[name];
      this._clearedCookies = this._clearedCookies || {};
      this._clearedCookies[name] = cookieOpts;
      return this;
    },

    render(view, data, callback) {
      this.renderedView = view;
      this.renderedData = data;
      this._rendered = { tpl: view, data };
      if (typeof callback === 'function') {
        callback(null, '<html></html>');
      }
      return this;
    },

    compress(enabled) {
      this._compress = enabled;
      return this;
    },

    on(event, callback) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(callback);
      return this;
    },

    emit(event, ...args) {
      const cbs = listeners[event] || [];
      for (const cb of cbs) {
        try {
          cb(...args);
        } catch (_) {}
      }
      return this;
    },
  };

  // Wrap in vi.fn() spies if requested and Vitest is available
  if (options.spy && typeof vi !== 'undefined' && typeof vi.fn === 'function') {
    res.status = vi.fn(res.status.bind(res));
    res.sendStatus = vi.fn(res.sendStatus.bind(res));
    res.send = vi.fn(res.send.bind(res));
    res.json = vi.fn(res.json.bind(res));
    res.end = vi.fn(res.end.bind(res));
    res.redirect = vi.fn(res.redirect.bind(res));
    res.setHeader = vi.fn(res.setHeader.bind(res));
    res.render = vi.fn(res.render.bind(res));
    res.cookie = vi.fn(res.cookie.bind(res));
    res.clearCookie = vi.fn(res.clearCookie.bind(res));
  }

  return res;
}

/**
 * Creates a mock Express next function.
 * Tracks calls and errors.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.spy=false]
 * @returns {Function}
 */
function createMockNext(options = {}) {
  let fn;
  const next = (err) => {
    const errorVal = err !== undefined ? err : null;
    next.called = true;
    next.callCount++;
    next.error = errorVal;
    if (fn && fn !== next) {
      fn.called = true;
      fn.callCount++;
      fn.error = errorVal;
    }
  };
  next.called = false;
  next.callCount = 0;
  next.error = null;

  if (options.spy && typeof vi !== 'undefined' && typeof vi.fn === 'function') {
    fn = vi.fn(next);
    fn.called = false;
    fn.callCount = 0;
    fn.error = null;
    return fn;
  }

  fn = next;
  return next;
}

function createMockSpyRes(options = {}) {
  return createMockResponse({ ...options, spy: true });
}

function createMockSpyNext(options = {}) {
  return createMockNext({ ...options, spy: true });
}

module.exports = {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockSpyNext,
  // Convenient short aliases
  createMockReq: createMockRequest,
  createMockRes: createMockResponse,
  createMockSpyRes,
};
