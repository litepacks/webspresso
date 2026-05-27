/**
 * Supertest-compatible HTTP helpers for Hono (Webspresso compat app)
 */

/**
 * @param {Response} res
 * @param {{ asBuffer?: boolean }} [opts]
 */
async function buildSupertestResponse(res, opts = {}) {
  const contentType = res.headers.get('content-type') || '';
  const asBuffer =
    opts.asBuffer ||
    /spreadsheet|octet-stream|zip|excel/i.test(contentType);
  let text;
  let body;
  if (asBuffer) {
    body = Buffer.from(await res.arrayBuffer());
    text = '';
  } else {
    text = await res.text();
    body = text;
    if (contentType.includes('application/json') && text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return {
    status: res.status,
    statusCode: res.status,
    ok: res.ok,
    text,
    body,
    headers,
    type: contentType.split(';')[0].trim(),
    get(name) {
      return res.headers.get(name);
    },
    header: {
      get(name) {
        return res.headers.get(name);
      },
    },
  };
}

/**
 * @param {{ fetch: Function }} app
 */
function createClient(app, cookieJar = new Map()) {
  const fetchFn = app.fetch.bind(app);
  const baseUrl = 'http://127.0.0.1';

  function storeCookies(res) {
    const raw = res.headers.getSetCookie?.() || [];
    if (raw.length) {
      for (const line of raw) {
        const part = line.split(';')[0];
        const eq = part.indexOf('=');
        if (eq > 0) cookieJar.set(part.slice(0, eq).trim(), part.slice(eq + 1));
      }
      return;
    }
    const single = res.headers.get('set-cookie');
    if (single) {
      const part = single.split(';')[0];
      const eq = part.indexOf('=');
      if (eq > 0) cookieJar.set(part.slice(0, eq).trim(), part.slice(eq + 1));
    }
  }

  function cookieHeader() {
    if (cookieJar.size === 0) return '';
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function start(method, path) {
    const state = {
      method: method.toUpperCase(),
      path,
      headers: {},
      body: undefined,
    };

    /** @type {Promise<any>|null} */
    let runPromise = null;

    const api = {
      set(field, value) {
        if (value === undefined && typeof field === 'object') {
          Object.assign(state.headers, field);
        } else {
          state.headers[field] = value;
        }
        return api;
      },
      type(t) {
        state.headers['Content-Type'] = t;
        return api;
      },
      send(data) {
        state.body = data;
        return api;
      },
      field(name, value) {
        state.formFields = state.formFields || [];
        state.formFields.push({ name, value });
        return api;
      },
      attach(name, fileOrPath, filenameOrOpts) {
        state.formFiles = state.formFiles || [];
        if (Buffer.isBuffer(fileOrPath)) {
          state.formFiles.push({
            name,
            buffer: fileOrPath,
            filename: typeof filenameOrOpts === 'string' ? filenameOrOpts : 'upload.bin',
            contentType:
              filenameOrOpts && typeof filenameOrOpts === 'object'
                ? filenameOrOpts.contentType
                : undefined,
          });
        } else if (filenameOrOpts && typeof filenameOrOpts === 'object') {
          state.formFiles.push({
            name,
            buffer: fileOrPath,
            filename: filenameOrOpts.filename || 'upload.bin',
            contentType: filenameOrOpts.contentType,
          });
        } else {
          state.formFiles.push({ name, filePath: fileOrPath, filename: filenameOrOpts });
        }
        return api;
      },
      expect(statusOrFn, maybePattern) {
        runPromise = (runPromise || execute()).then(async (response) => {
          await assertExpect(response, statusOrFn, maybePattern);
          return response;
        });
        return api;
      },
      buffer(encode) {
        state.bufferResponse = encode;
        return api;
      },
      parse(_fn) {
        return api;
      },
      then(onFulfilled, onRejected) {
        return (runPromise || execute()).then(onFulfilled, onRejected);
      },
    };

    async function assertExpect(response, statusOrFn, maybePattern) {
      if (typeof statusOrFn === 'function') {
        await statusOrFn(response);
        return;
      }
      if (typeof statusOrFn === 'number') {
        if (response.status !== statusOrFn) {
          throw new Error(
            `expected ${statusOrFn} "${state.method} ${state.path}", got ${response.status}: ${response.text.slice(0, 400)}`
          );
        }
      }
      if (typeof statusOrFn === 'string' && maybePattern instanceof RegExp) {
        const val = response.get(statusOrFn) || response.headers[statusOrFn.toLowerCase()];
        if (!maybePattern.test(val || '')) {
          throw new Error(`expected header ${statusOrFn} to match ${maybePattern}, got ${val}`);
        }
      }
    }

    async function execute() {
      const url = state.path.startsWith('http') ? state.path : `${baseUrl}${state.path}`;
      const init = {
        method: state.method,
        headers: { ...state.headers },
      };
      const jarCookie = cookieHeader();
      if (jarCookie && !init.headers.Cookie && !init.headers.cookie) {
        init.headers.Cookie = jarCookie;
      }
      if (state.formFiles?.length || state.formFields?.length) {
        const fd = new FormData();
        for (const { name, value } of state.formFields || []) {
          fd.append(name, value);
        }
        const fs = require('fs');
        const pathMod = require('path');
        for (const entry of state.formFiles || []) {
          const buf = entry.buffer || fs.readFileSync(entry.filePath);
          const blob = new Blob([buf], entry.contentType ? { type: entry.contentType } : {});
          fd.append(
            entry.name,
            blob,
            entry.filename || (entry.filePath ? pathMod.basename(entry.filePath) : 'upload.bin')
          );
        }
        init.body = fd;
        delete init.headers['Content-Type'];
        delete init.headers['content-type'];
      } else if (state.body !== undefined) {
        init.body =
          typeof state.body === 'string' || state.body instanceof Buffer
            ? state.body
            : JSON.stringify(state.body);
        if (!init.headers['Content-Type'] && !init.headers['content-type']) {
          init.headers['Content-Type'] = 'application/json';
        }
      }
      const res = await fetchFn(new Request(url, init));
      storeCookies(res);
      return buildSupertestResponse(res, { asBuffer: state.bufferResponse });
    }

    return api;
  }

  const client = {
    get: (path) => start('GET', path),
    post: (path) => start('POST', path),
    put: (path) => start('PUT', path),
    patch: (path) => start('PATCH', path),
    delete: (path) => start('DELETE', path),
    head: (path) => start('HEAD', path),
    options: (path) => start('OPTIONS', path),
  };
  return client;
}

function request(app) {
  return createClient(app, new Map());
}

request.agent = function agent(app) {
  return createClient(app, new Map());
};

module.exports = { request, createClient, buildSupertestResponse };
