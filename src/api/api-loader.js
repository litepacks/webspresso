'use strict';

/**
 * Webspresso API Loader
 * Handles validation and execution of defineApi() endpoints
 * @module src/api/api-loader
 */

const { ZodError } = require('zod');
const { z: zForApi } = require('../../core/validation');
const { resolveMiddlewares } = require('../file-router');

/**
 * Compiles a schema definition from an API module
 * @param {Object|Function} schemaDef
 * @returns {Object|null}
 */
function compileApiSchema(schemaDef) {
  if (!schemaDef) return null;
  if (typeof schemaDef === 'function') {
    try {
      return schemaDef({ z: zForApi });
    } catch (err) {
      throw new Error(`Failed to compile API schema: ${err.message}`);
    }
  }
  if (typeof schemaDef === 'object') {
    return schemaDef;
  }
  return null;
}

/**
 * Validates request input against compiled schema
 * @param {import('express').Request} req
 * @param {Object} compiledSchema
 */
function validateRequestInput(req, compiledSchema) {
  req.input = {
    body: undefined,
    params: undefined,
    query: undefined,
    headers: undefined,
  };

  if (!compiledSchema) return;

  if (compiledSchema.body && typeof compiledSchema.body.parse === 'function') {
    req.input.body = compiledSchema.body.parse(req.body);
  } else {
    req.input.body = req.body;
  }

  if (compiledSchema.params && typeof compiledSchema.params.parse === 'function') {
    req.input.params = compiledSchema.params.parse(req.params);
  } else {
    req.input.params = req.params;
  }

  if (compiledSchema.query && typeof compiledSchema.query.parse === 'function') {
    req.input.query = compiledSchema.query.parse(req.query);
  } else {
    req.input.query = req.query;
  }

  if (compiledSchema.headers && typeof compiledSchema.headers.parse === 'function') {
    req.input.headers = compiledSchema.headers.parse(req.headers);
  }
}

/**
 * Creates an Express route handler for a discovered API descriptor
 * @param {Object} descriptor - Route descriptor
 * @param {Object} context - Server context
 * @returns {Function}
 */
function createApiHandler(descriptor, context) {
  const {
    middlewares = {},
    serviceRegistry = null,
    db = null,
    options: appOptions = {},
  } = context;

  const isDev = process.env.NODE_ENV === 'development';
  let cachedMiddlewares = null;
  let cachedApiDef = null;
  let cachedHandlerFn = null;
  let cachedCompiledSchema = null;

  return async (req, res, next) => {
    try {
      // 1. Reload module in development
      if (isDev) {
        try {
          const resolvedPath = require.resolve(descriptor.file);
          if (require.cache[resolvedPath]) {
            delete require.cache[resolvedPath];
            cachedMiddlewares = null;
            cachedApiDef = null;
            cachedHandlerFn = null;
            cachedCompiledSchema = null;
          }
        } catch {}
      }

      let apiDef = cachedApiDef;
      let handlerFn = cachedHandlerFn;
      let compiledSchema = cachedCompiledSchema;

      if (!apiDef) {
        let apiModule = {};
        try {
          apiModule = require(descriptor.file);
        } catch (loadErr) {
          return next(loadErr);
        }

        apiDef = typeof apiModule === 'function'
          ? Object.assign({ handler: apiModule }, apiModule)
          : (apiModule.default || apiModule);
        handlerFn = apiDef.handler || (typeof apiModule === 'function' ? apiModule : null);

        if (typeof handlerFn !== 'function') {
          throw new Error(`API file "${descriptor.source}" does not export a valid handler function`);
        }

        compiledSchema = compileApiSchema(apiDef.schema);

        if (!isDev) {
          cachedApiDef = apiDef;
          cachedHandlerFn = handlerFn;
          cachedCompiledSchema = compiledSchema;
        }
      }

      // 2. Injections
      if (db) req.db = db;
      if (serviceRegistry) {
        req.service = (name, input, opts) =>
          serviceRegistry.call(name, input, { req, res, db }, opts);
      }

      // 3. Schema validation
      if (compiledSchema) {
        try {
          validateRequestInput(req, compiledSchema);
        } catch (err) {
          if (err instanceof ZodError || err.name === 'ZodError' || Array.isArray(err?.issues)) {
            return res.status(400).json({
              error: 'Validation Error',
              issues: err.issues,
            });
          }
          throw err;
        }
      } else {
        req.input = {
          body: req.body,
          params: req.params,
          query: req.query,
        };
      }

      // 4. Resolve and execute middlewares (module-local first, cached across requests)
      if (!cachedMiddlewares) {
        const moduleMiddlewares = descriptor.moduleConfig?.middlewares || {};
        const combinedRegistry = Object.assign({}, middlewares, moduleMiddlewares);
        cachedMiddlewares = resolveMiddlewares(apiDef.middleware, combinedRegistry);
      }

      for (const mw of cachedMiddlewares) {
        if (typeof mw !== 'function') continue;
        await new Promise((resolve, reject) => {
          try {
            mw(req, res, (err) => {
              if (err) reject(err);
              else resolve();
            });
          } catch (syncErr) {
            reject(syncErr);
          }
        });
        if (res.headersSent) return;
      }

      // 5. Execute handler
      const apiCtx = {
        req,
        res,
        params: req.params || {},
        query: req.query || {},
        body: req.body || {},
        input: req.input,
        service: (name, input, opts) =>
          serviceRegistry ? serviceRegistry.call(name, input, { req, res, db }, opts) : null,
        module: descriptor.module || null,
        config: appOptions,
        logger: console,
        db,
      };

      req.ctx = apiCtx;
      res.service = apiCtx.service;
      res.input = apiCtx.input;
      res.module = apiCtx.module;

      const result = await handlerFn(req, res, apiCtx);

      // 6. Auto-respond if handler returned a value and response not yet sent
      if (!res.headersSent) {
        if (result !== undefined) {
          return res.json(result);
        }
      }
    } catch (err) {
      if (err && typeof err === 'object') {
        if (!err.route) err.route = descriptor.path;
        if (!err.method) err.method = descriptor.method ? descriptor.method.toUpperCase() : (req.method || 'GET');
        if (!err.source) err.source = descriptor.source || descriptor.file;
        if (!err.file) err.file = descriptor.file;
        if (!err.module) err.module = descriptor.module || null;
        if (!err.phase) err.phase = 'handler';
        if (!err.requestId) err.requestId = req.id || (req.headers && req.headers['x-request-id']) || null;
      }
      return next(err);
    }
  };
}

module.exports = {
  createApiHandler,
  compileApiSchema,
  validateRequestInput,
};
