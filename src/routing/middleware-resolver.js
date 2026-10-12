'use strict';

const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

/**
 * True when the registry entry is (options) => (req, res, next) => …
 * Express handlers typically have length >= 2 (req, res) or 3 (req, res, next).
 * @param {Function} fn
 * @returns {boolean}
 */
function isMiddlewareFactory(fn) {
  return typeof fn === 'function' && fn.length <= 1;
}

/**
 * Resolve a named middleware from createApp({ middlewares }).
 * @param {string} name
 * @param {Function} entry
 * @param {boolean} fromTuple - true when route used ['name', options]
 * @param {unknown} tupleOptions - second element of the tuple (only when fromTuple)
 * @param {Object} middlewareRegistry - for error messages
 * @returns {Function} Express middleware
 */
function resolveNamedMiddleware(name, entry, fromTuple, tupleOptions, middlewareRegistry) {
  if (!entry) {
    throw new Error(`Middleware "${name}" not found in registry. Available: ${Object.keys(middlewareRegistry).join(', ') || 'none'}`);
  }
  if (typeof entry !== 'function') {
    throw new Error(`Middleware "${name}" must be a function`);
  }

  if (fromTuple) {
    if (!isMiddlewareFactory(entry)) {
      throw new Error(
        `Middleware "${name}" must be a factory (options) => (req, res, next) => … when using ["${name}", options] tuple form`
      );
    }
    const produced = entry(tupleOptions);
    if (typeof produced !== 'function') {
      throw new Error(`Middleware factory "${name}" must return an Express middleware function`);
    }
    return produced;
  }

  if (isMiddlewareFactory(entry)) {
    const produced = entry({});
    if (typeof produced !== 'function') {
      throw new Error(`Middleware factory "${name}" must return an Express middleware function`);
    }
    return produced;
  }

  return entry;
}

/**
 * Resolve middleware from config — functions, string names, or [name, options] tuples
 * @param {Array} middlewareConfig - middleware functions, names, or ['name', options] tuples
 * @param {Object} [middlewareRegistry] - Named middleware registry (plain handlers or option factories)
 * @returns {Array<Function>} Array of resolved middleware functions
 */
function resolveMiddlewares(middlewareConfig, middlewareRegistry = EMPTY_OBJECT) {
  if (!middlewareConfig || !Array.isArray(middlewareConfig) || middlewareConfig.length === 0) {
    return EMPTY_ARRAY;
  }
  
  return middlewareConfig.map((mw, index) => {
    if (typeof mw === 'function') {
      return mw;
    }
    
    if (typeof mw === 'string') {
      return resolveNamedMiddleware(mw, middlewareRegistry[mw], false, undefined, middlewareRegistry);
    }

    if (Array.isArray(mw) && mw.length === 2 && typeof mw[0] === 'string') {
      const name = mw[0];
      return resolveNamedMiddleware(name, middlewareRegistry[name], true, mw[1], middlewareRegistry);
    }
    
    throw new Error(
      `Invalid middleware at index ${index}: must be a function, string name, or [name, options] tuple`
    );
  });
}

module.exports = {
  isMiddlewareFactory,
  resolveNamedMiddleware,
  resolveMiddlewares,
};
