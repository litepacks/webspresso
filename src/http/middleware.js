/**
 * Run Express-style (req, res, next) middleware and handlers on Hono
 * @module src/http/middleware
 */

const { buildReq, createCompatResponse } = require('./context');

/**
 * One compat res per Hono request (so global middleware can patch res.json/send).
 * @param {import('hono').Context} c
 * @param {{ cookieSecret?: string }} opts
 */
function getCompatRes(c, opts) {
  let res = c.get('compatRes');
  if (!res) {
    res = createCompatResponse(c, opts);
    c.set('compatRes', res);
  }
  return res;
}

/**
 * @param {object} req
 * @param {object} res
 * @param {Function} fn
 * @returns {Promise<{ type: 'next' | 'done' | 'error', err?: Error }>}
 */
async function runExpressMiddlewareOnPair(req, res, fn) {
  const done = (err) => {
    if (err) throw err;
  };

  try {
    const result = fn(req, res, done);
    if (result && typeof result.then === 'function') {
      await result;
    } else {
      await new Promise((r) => setImmediate(r));
    }
    if (res._handled || res._ended) {
      res._notifyFinish();
      return { type: 'done' };
    }
    return { type: 'next' };
  } catch (err) {
    return { type: 'error', err };
  }
}

/**
 * @param {import('hono').Context} c
 * @param {Function} fn
 * @param {{ cookieSecret?: string }} [opts]
 * @returns {Promise<'next'|'done'|'error'>}
 */
async function runExpressMiddleware(c, fn, opts = {}) {
  const req = buildReq(c, opts);
  const res = getCompatRes(c, opts);
  return runExpressMiddlewareOnPair(req, res, fn);
}

/**
 * @param {import('hono').Context} c
 * @param {Function[]} handlers
 * @param {{ cookieSecret?: string }} [opts]
 */
async function runExpressHandlers(c, handlers, opts = {}) {
  const req = buildReq(c, opts);
  const res = getCompatRes(c, opts);

  for (const fn of handlers) {
    if (typeof fn !== 'function') continue;
    const outcome = await runExpressMiddlewareOnPair(req, res, fn);
    if (outcome.type === 'error') throw outcome.err;
    if (outcome.type === 'done') return;
  }
}

/**
 * Convert Express middleware to Hono middleware
 * @param {Function} fn
 * @param {{ cookieSecret?: string }} [opts]
 */
function expressToHono(fn, opts = {}) {
  return async (c, next) => {
    const outcome = await runExpressMiddleware(c, fn, opts);
    if (outcome.type === 'error') throw outcome.err;
    if (outcome.type === 'done') {
      const ret = c.get('compatReturnValue');
      if (ret) return ret;
      return;
    }
    await next();
  };
}

module.exports = {
  runExpressMiddleware,
  runExpressHandlers,
  expressToHono,
  getCompatRes,
};
