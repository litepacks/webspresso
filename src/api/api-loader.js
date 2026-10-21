'use strict';

/**
 * Webspresso API Loader
 * Handles validation and execution of defineApi() endpoints
 * @module src/api/api-loader
 */

const path = require('path');
const { ZodError } = require('zod');
const { z: zForApi } = require('../../core/validation');
const { resolveMiddlewares } = require('../file-router');
const { translateValidationIssues, getTranslatorForRequest } = require('./validation-i18n');
const { executeApiPipeline, enrichRouteError } = require('../../core/http');

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

  const isDev = context.isDev !== undefined ? context.isDev : (appOptions.isDev !== undefined ? appOptions.isDev : process.env.NODE_ENV === 'development');
  let cachedMiddlewares = null;
  let cachedApiDef = null;
  let cachedHandlerFn = null;
  let cachedCompiledSchema = null;

  return async (req, res, next) => {
    try {
      // 1. Reload module in development
      if (isDev) {
        try {
          const resolvedPath = descriptor._resolvedPath || (descriptor._resolvedPath = require.resolve(descriptor.file));
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

      // 2. Resolve middlewares (module-local first, cached across requests)
      if (!cachedMiddlewares) {
        const moduleMiddlewares = descriptor.moduleConfig?.middlewares || {};
        const combinedRegistry = Object.assign({}, middlewares, moduleMiddlewares);
        cachedMiddlewares = resolveMiddlewares(apiDef.middleware, combinedRegistry);
      }

      // 3. Execute framework-agnostic API pipeline
      await executeApiPipeline({
        descriptor,
        context,
        apiDef,
        handlerFn,
        compiledSchema,
        middlewares: cachedMiddlewares,
        req,
        res,
      });
    } catch (err) {
      enrichRouteError(err, descriptor, req);
      return next(err);
    }
  };
}

module.exports = {
  createApiHandler,
  compileApiSchema,
  validateRequestInput,
};
