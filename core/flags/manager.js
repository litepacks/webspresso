/**
 * Webspresso Feature Flag Manager
 * Orchestrates flag storage, context evaluation, middleware injection, and route guards.
 * @module core/flags/manager
 */

'use strict';

const { MemoryFlagStore } = require('./store');
const { evaluateFlag } = require('./evaluator');
const { NotFoundError, ForbiddenError } = require('../errors');

class FeatureFlagManager {
  /**
   * @param {Object} [options]
   * @param {Object|string} [options.flags] - Initial flags map or file path
   * @param {Object} [options.store] - Custom flag store instance
   * @param {string} [options.envPrefix='FEATURE_'] - Environment variable prefix
   * @param {Function} [options.identify] - Custom function to extract distinct ID from request
   */
  constructor(options = {}) {
    this.store = options.store || new MemoryFlagStore(options.flags);
    this.envPrefix = options.envPrefix || 'FEATURE_';
    this.identify = typeof options.identify === 'function'
      ? options.identify
      : ((req) => req?.user?.id || req?.user?.userId || req?.session?.userId || req?.ip || 'anonymous');

    // Bind methods for direct extraction
    this.middleware = this.middleware.bind(this);
  }

  /**
   * Check if a feature flag is enabled for the given context
   * @param {string} flagKey
   * @param {Object} [context]
   * @returns {boolean}
   */
  isEnabled(flagKey, context = {}) {
    const def = this.store.get(flagKey);
    const res = evaluateFlag(flagKey, def, context, { envPrefix: this.envPrefix });
    return res.enabled;
  }

  /**
   * Get active variant name for a multivariate feature flag
   * @param {string} flagKey
   * @param {Object} [context]
   * @returns {string|null}
   */
  getVariant(flagKey, context = {}) {
    const def = this.store.get(flagKey);
    const res = evaluateFlag(flagKey, def, context, { envPrefix: this.envPrefix });
    return res.enabled ? res.variant : null;
  }

  /**
   * Full evaluation of a flag with metadata and decision reason
   * @param {string} flagKey
   * @param {Object} [context]
   * @returns {{ enabled: boolean, variant: string|null, reason: string, bucket?: number }}
   */
  evaluate(flagKey, context = {}) {
    const def = this.store.get(flagKey);
    return evaluateFlag(flagKey, def, context, { envPrefix: this.envPrefix });
  }

  /**
   * Evaluate all registered flags for the given context
   * @param {Object} [context]
   * @returns {Record<string, boolean>}
   */
  getAllFlags(context = {}) {
    const all = this.store.getAll();
    const result = {};
    for (const key of Object.keys(all)) {
      result[key] = this.isEnabled(key, context);
    }
    return result;
  }

  /**
   * Set or update a feature flag
   * @param {string} flagKey
   * @param {Object|boolean} definition
   */
  setFlag(flagKey, definition) {
    this.store.set(flagKey, definition);
  }

  /**
   * Remove a feature flag
   * @param {string} flagKey
   * @returns {boolean}
   */
  removeFlag(flagKey) {
    return this.store.delete(flagKey);
  }

  /**
   * Create a scoped flags object bound to a specific request/context
   * @param {Object} context
   */
  forContext(context = {}) {
    return {
      isEnabled: (key) => this.isEnabled(key, context),
      getVariant: (key) => this.getVariant(key, context),
      evaluate: (key) => this.evaluate(key, context),
      all: () => this.getAllFlags(context),
    };
  }

  /**
   * Universal Express & Hono Middleware
   */
  middleware() {
    return async (reqOrC, resOrNext, maybeNext) => {
      // 1. Hono signature: (c, next)
      const isHono = typeof reqOrC.header === 'function' && typeof reqOrC.text === 'function' && typeof resOrNext === 'function';

      if (isHono) {
        const c = reqOrC;
        const next = resOrNext;

        const context = {
          user: c.get?.('user') || null,
          distinctId: this.identify(c.req),
          ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1',
          path: c.req.path,
        };

        const flagsContext = this.forContext(context);
        if (typeof c.set === 'function') {
          c.set('flags', flagsContext);
        }
        c.hasFeature = (key, customCtx) => this.isEnabled(key, Object.assign({}, context, customCtx));
        c.getVariant = (key, customCtx) => this.getVariant(key, Object.assign({}, context, customCtx));

        return next();
      }

      // 2. Express signature: (req, res, next)
      const req = reqOrC;
      const res = resOrNext;
      const next = maybeNext || (() => {});

      const context = {
        user: req.user || req.auth?.user || null,
        session: req.session || null,
        ip: req.ip || req.connection?.remoteAddress || '127.0.0.1',
        distinctId: this.identify(req),
        path: req.path,
        query: req.query,
      };

      const flagsContext = this.forContext(context);
      req.flags = flagsContext;
      req.hasFeature = (key, customCtx) => this.isEnabled(key, Object.assign({}, context, customCtx));
      req.getVariant = (key, customCtx) => this.getVariant(key, Object.assign({}, context, customCtx));

      if (res && res.locals) {
        res.locals.hasFeature = req.hasFeature;
        res.locals.getVariant = req.getVariant;
        res.locals.flags = flagsContext.all;
      }

      return next();
    };
  }

  /**
   * Route Guard Middleware: blocks access if feature is disabled
   * @param {string} flagKey
   * @param {Object} [options]
   * @param {number} [options.statusCode=404]
   * @param {string} [options.message='Not Found']
   * @param {Function} [options.fallback]
   * @returns {Function}
   */
  guard(flagKey, options = {}) {
    const statusCode = options.statusCode || 404;
    const message = options.message || (statusCode === 403 ? 'Forbidden' : 'Not Found');

    return (req, res, next) => {
      const isEnabled = typeof req?.hasFeature === 'function'
        ? req.hasFeature(flagKey)
        : this.isEnabled(flagKey, req);

      if (isEnabled) {
        return next();
      }

      if (typeof options.fallback === 'function') {
        return options.fallback(req, res, next);
      }

      if (res && typeof res.status === 'function') {
        return res.status(statusCode).json({
          error: statusCode === 403 ? 'Forbidden' : 'Not Found',
          message,
          feature: flagKey,
        });
      }

      if (statusCode === 403) {
        return next(new ForbiddenError(message));
      }
      return next(new NotFoundError(message));
    };
  }
}

/**
 * Factory to create a FeatureFlagManager instance
 * @param {Object} [options]
 * @returns {FeatureFlagManager}
 */
function createFeatureFlagManager(options = {}) {
  return new FeatureFlagManager(options);
}

module.exports = {
  FeatureFlagManager,
  createFeatureFlagManager,
};
