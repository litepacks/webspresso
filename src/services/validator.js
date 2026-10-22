/**
 * Webspresso Services Input Validation
 * Powered by Zod with sync/async validation, prototype poisoning defense, and functional schema compilation
 * @module src/services/validator
 */

const { ValidationError } = require('../../core/errors');
const { z: zForServices, sanitizeInput, hasDangerousKeys } = require('../../core/validation');
const z = zForServices;

const descriptorCache = new Map();

/**
 * Compile a concise type string descriptor into a Zod schema
 * @param {string} typeName - Type name descriptor (e.g. 'number', 'string', 'email', 'string?')
 * @returns {z.ZodTypeAny}
 */
function descriptorToZod(typeName) {
  const cached = descriptorCache.get(typeName);
  if (cached) return cached;

  const isOptional = typeName.endsWith('?');
  const baseType = isOptional ? typeName.slice(0, -1).toLowerCase() : typeName.toLowerCase();

  let schema;
  switch (baseType) {
    case 'string':
    case 'text':
      schema = z.string();
      break;
    case 'number':
    case 'int':
    case 'integer':
    case 'float':
      schema = z.number();
      break;
    case 'boolean':
    case 'bool':
      schema = z.boolean();
      break;
    case 'email':
      schema = z.string().email();
      break;
    case 'uuid':
      schema = z.string().uuid();
      break;
    case 'nanoid':
      schema = zForServices.nanoid ? zForServices.nanoid() : z.string();
      break;
    case 'array':
      schema = z.array(z.any());
      break;
    case 'object':
      schema = z.record(z.any());
      break;
    case 'date':
      schema = z.date().or(z.string().datetime()).or(z.string().refine(val => !Number.isNaN(Date.parse(val)), { message: 'Invalid date string' }));
      break;
    case 'function':
      schema = z.function();
      break;
    case 'any':
    default:
      schema = z.any();
      break;
  }

  const finalSchema = isOptional ? schema.optional() : schema;
  if (descriptorCache.size < 200) {
    descriptorCache.set(typeName, finalSchema);
  }
  return finalSchema;
}

function shapeFromDescriptor(descriptorObj) {
  const shape = {};
  for (const [key, val] of Object.entries(descriptorObj)) {
    if (typeof val === 'string') {
      shape[key] = descriptorToZod(val);
    } else if (val instanceof z.ZodType || (val && typeof val.safeParse === 'function')) {
      shape[key] = val;
    } else if (typeof val === 'object' && val !== null) {
      const isOpt = val.optional === true || val.required === false;
      let base = val.type ? descriptorToZod(String(val.type)) : z.any();
      shape[key] = isOpt ? base.optional() : base;
    } else if (typeof val === 'function') {
      shape[key] = z.custom(val);
    } else {
      shape[key] = z.any();
    }
  }
  return z.object(shape);
}

const compiledSchemaCache = new WeakMap();

/**
 * Compile service schema definition into an executable validator
 * @param {Function|Object|null} rawSchema - Schema definition
 * @returns {Object|Function|null} Compiled schema
 */
function compileServiceSchema(rawSchema) {
  if (!rawSchema) return null;

  if (typeof rawSchema === 'object' || typeof rawSchema === 'function') {
    const cached = compiledSchemaCache.get(rawSchema);
    if (cached !== undefined) {
      return cached;
    }
  }

  let compiled = null;

  // If already a Zod schema
  if (rawSchema instanceof z.ZodType || typeof rawSchema.safeParse === 'function') {
    compiled = rawSchema;
  } else if (typeof rawSchema === 'function') {
    // If function: check if ({ z }) schema compiler or custom validator function
    try {
      const res = rawSchema({ z: zForServices });
      if (res && (res instanceof z.ZodType || typeof res.safeParse === 'function')) {
        compiled = res;
      } else if (res && typeof res === 'object' && !(res instanceof Promise) && typeof res.then !== 'function' && (res.constructor === Object || !res.constructor)) {
        if (res.input && (res.input instanceof z.ZodType || typeof res.input.safeParse === 'function' || (typeof res.input === 'object' && res.input !== null))) {
          compiled = (res.input instanceof z.ZodType || typeof res.input.safeParse === 'function')
            ? res.input
            : shapeFromDescriptor(res.input);
        } else {
          compiled = shapeFromDescriptor(res);
        }
      }
    } catch (e) {
      // If invoking with { z } throws, treat as a direct validator function
    }
    if (!compiled) {
      compiled = rawSchema;
    }
  } else if (typeof rawSchema === 'object' && rawSchema !== null) {
    if (rawSchema.input && (rawSchema.input instanceof z.ZodType || typeof rawSchema.input.safeParse === 'function' || (typeof rawSchema.input === 'object' && rawSchema.input !== null))) {
      compiled = (rawSchema.input instanceof z.ZodType || typeof rawSchema.input.safeParse === 'function')
        ? rawSchema.input
        : shapeFromDescriptor(rawSchema.input);
    } else {
      // If object descriptor: { id: 'number', name: 'string', email: 'email' }
      const keys = Object.keys(rawSchema);
      if (keys.length === 0) {
        compiled = null;
      } else {
        compiled = shapeFromDescriptor(rawSchema);
      }
    }
  } else {
    compiled = rawSchema;
  }

  if (typeof rawSchema === 'object' || typeof rawSchema === 'function') {
    compiledSchemaCache.set(rawSchema, compiled);
  }

  return compiled;
}

/**
 * Format Zod validation errors into a clean string, fields map, and fieldErrors array map
 * @param {z.ZodError} zodError
 * @param {string} serviceName
 * @returns {{ message: string, fields: Record<string, string>, fieldErrors: Record<string, string[]> }}
 */
function formatZodErrors(zodError, serviceName) {
  const fields = {};
  const fieldErrors = {};
  const lines = [];

  for (const issue of (zodError && zodError.issues) || []) {
    const pathKey = issue.path && issue.path.length > 0 ? issue.path.join('.') : '_root';
    const fieldMsg = issue.message || 'invalid value';
    if (!fields[pathKey]) {
      fields[pathKey] = fieldMsg;
    }
    if (!fieldErrors[pathKey]) {
      fieldErrors[pathKey] = [];
    }
    fieldErrors[pathKey].push(fieldMsg);
    lines.push(`- ${pathKey}: ${fieldMsg}`);
  }

  const message = `Invalid service input for ${serviceName}:\n${lines.join('\n')}`;
  return { message, fields, fieldErrors };
}

/**
 * Normalize raw validation issues into a consistent structure
 * @param {Array<Object>} issues
 * @returns {Array<{ path: string, message: string, code?: string }>}
 */
function normalizeValidationIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : (issue.path ? String(issue.path) : '_root'),
    message: issue.message || 'invalid value',
    code: issue.code || 'invalid_type',
  }));
}

/**
 * Create a standardized ValidationError for services input validation
 * @param {string} message
 * @param {Object} [options]
 * @param {string} options.serviceName
 * @param {Record<string, string>} [options.fields]
 * @param {Record<string, string[]>} [options.fieldErrors]
 * @param {Array<Object>} [options.details]
 * @param {Error} [options.cause]
 * @param {number} [options.status=400]
 * @returns {ValidationError}
 */
function createServiceValidationError(message, {
  serviceName,
  fields = {},
  fieldErrors = {},
  details = [],
  cause = null,
  status = 400,
} = {}) {
  const normalizedIssues = normalizeValidationIssues(details);

  const err = new ValidationError(message, {
    status,
    statusCode: status,
    code: 'VALIDATION_ERROR',
    service: serviceName,
    fields,
    fieldErrors,
    details,
    issues: details,
    cause,
  });

  err.name = 'ValidationError';
  err.code = 'VALIDATION_ERROR';
  err.status = status;
  err.statusCode = status;
  err.service = serviceName;
  err.fields = fields;
  err.fieldErrors = fieldErrors;
  err.details = details;
  err.issues = details;
  err.normalizedIssues = normalizedIssues;

  return err;
}

/**
 * Validate service input against compiled schema (supports sync & async Zod/custom schemas)
 * @param {Object|Function|null} schema - Schema definition
 * @param {*} input - Input to validate
 * @param {string} serviceName - Service name
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.rejectDangerousKeys=false] - Whether to strictly reject prototype pollution keys
 * @returns {*|Promise<*>} Validated input
 * @throws {ValidationError} When validation fails
 */
function validateServiceInput(schema, input, serviceName, options = {}) {
  if (options && options.rejectDangerousKeys === true && hasDangerousKeys(input)) {
    throw createServiceValidationError(`Invalid service input for ${serviceName}: dangerous prototype keys detected`, {
      serviceName,
      fields: { _root: 'Dangerous prototype keys detected in input' },
      fieldErrors: { _root: ['Dangerous prototype keys detected in input'] },
      details: [{ path: [], message: 'Dangerous prototype keys detected in input', code: 'prototype_pollution' }],
      status: 400,
    });
  }

  const sanitized = sanitizeInput(input);

  if (!schema) {
    return sanitized;
  }

  const compiled = compileServiceSchema(schema);
  if (!compiled) {
    return sanitized;
  }

  // 1. Zod schema validation
  if (compiled instanceof z.ZodType || typeof compiled.safeParse === 'function') {
    try {
      const result = compiled.safeParse(sanitized);
      if (!result.success) {
        const { message, fields, fieldErrors } = formatZodErrors(result.error, serviceName);
        throw createServiceValidationError(message, {
          serviceName,
          fields,
          fieldErrors,
          details: result.error.issues,
          status: 400,
        });
      }
      return result.data;
    } catch (err) {
      if (err instanceof ValidationError) {
        throw err;
      }
      // If error occurred because of async refinements, evaluate with safeParseAsync
      if (typeof compiled.safeParseAsync === 'function') {
        return compiled.safeParseAsync(sanitized).then((asyncResult) => {
          if (!asyncResult.success) {
            const { message, fields, fieldErrors } = formatZodErrors(asyncResult.error, serviceName);
            throw createServiceValidationError(message, {
              serviceName,
              fields,
              fieldErrors,
              details: asyncResult.error.issues,
              status: 400,
            });
          }
          return asyncResult.data;
        }).catch((asyncErr) => {
          if (asyncErr instanceof ValidationError) {
            if (!asyncErr.service) asyncErr.service = serviceName;
            if (!asyncErr.code) asyncErr.code = 'VALIDATION_ERROR';
            if (asyncErr.statusCode === undefined) asyncErr.statusCode = asyncErr.status || 400;
            if (asyncErr.status === undefined) asyncErr.status = 400;
            throw asyncErr;
          }
          throw createServiceValidationError(`Invalid service input for ${serviceName}: ${asyncErr.message}`, {
            serviceName,
            fields: { _root: asyncErr.message },
            fieldErrors: { _root: [asyncErr.message] },
            details: [{ path: [], message: asyncErr.message }],
            cause: asyncErr,
            status: 400,
          });
        });
      }
      throw err;
    }
  }

  // 2. Custom validation function (sync or async)
  if (typeof compiled === 'function') {
    try {
      const res = compiled(sanitized);
      if (res instanceof Promise) {
        return res.then((asyncRes) => {
          if (asyncRes === false) {
            throw createServiceValidationError(`Invalid service input for ${serviceName}: custom validation rejected input`, {
              serviceName,
              fields: { _root: 'custom validation rejected input' },
              fieldErrors: { _root: ['custom validation rejected input'] },
              details: [{ path: [], message: 'custom validation rejected input' }],
              status: 400,
            });
          }
          return typeof asyncRes === 'object' && asyncRes !== null ? asyncRes : sanitized;
        }).catch((asyncErr) => {
          if (asyncErr instanceof ValidationError) {
            if (!asyncErr.service) asyncErr.service = serviceName;
            if (!asyncErr.code) asyncErr.code = 'VALIDATION_ERROR';
            if (asyncErr.statusCode === undefined) asyncErr.statusCode = asyncErr.status || 400;
            if (asyncErr.status === undefined) asyncErr.status = 400;
            throw asyncErr;
          }
          throw createServiceValidationError(`Invalid service input for ${serviceName}: ${asyncErr.message}`, {
            serviceName,
            fields: { _root: asyncErr.message },
            fieldErrors: { _root: [asyncErr.message] },
            details: [{ path: [], message: asyncErr.message }],
            cause: asyncErr,
            status: 400,
          });
        });
      }
      if (res === false) {
        throw createServiceValidationError(`Invalid service input for ${serviceName}: custom validation rejected input`, {
          serviceName,
          fields: { _root: 'custom validation rejected input' },
          fieldErrors: { _root: ['custom validation rejected input'] },
          details: [{ path: [], message: 'custom validation rejected input' }],
          status: 400,
        });
      }
      return typeof res === 'object' && res !== null ? res : sanitized;
    } catch (err) {
      if (err instanceof ValidationError) {
        if (!err.service) err.service = serviceName;
        if (!err.code) err.code = 'VALIDATION_ERROR';
        if (err.statusCode === undefined) err.statusCode = err.status || 400;
        if (err.status === undefined) err.status = 400;
        throw err;
      }
      throw createServiceValidationError(`Invalid service input for ${serviceName}: ${err.message}`, {
        serviceName,
        fields: { _root: err.message },
        fieldErrors: { _root: [err.message] },
        details: [{ path: [], message: err.message }],
        cause: err,
        status: 400,
      });
    }
  }

  return sanitized;
}

module.exports = {
  z: zForServices,
  compileServiceSchema,
  descriptorToZod,
  formatZodErrors,
  sanitizeInput,
  validateServiceInput,
  createServiceValidationError,
  normalizeValidationIssues,
};
