/**
 * Webspresso Services Input Validation
 * Powered by Zod with sync/async validation, prototype poisoning defense, and functional schema compilation
 * @module src/services/validator
 */

const z = require('zod');
const { ValidationError } = require('../../core/errors');
const { extendZ } = require('../../core/orm/utils/nanoid');

/** Zod instance extended with z.nanoid() */
const zForServices = extendZ(z);

/**
 * Check if object contains dangerous prototype pollution keys
 * @param {*} obj
 * @returns {boolean}
 */
function hasDangerousKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some(item => hasDangerousKeys(item));
  }
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (typeof obj[key] === 'object' && obj[key] !== null && hasDangerousKeys(obj[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize input against prototype pollution
 * @param {*} input
 * @returns {*} Sanitized input
 */
function sanitizeInput(input) {
  if (input === null || typeof input !== 'object') {
    return input;
  }
  if (!hasDangerousKeys(input)) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item));
  }
  const clean = {};
  for (const key of Object.keys(input)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    clean[key] = sanitizeInput(input[key]);
  }
  return clean;
}

/**
 * Compile a concise type string descriptor into a Zod schema
 * @param {string} typeName - Type name descriptor (e.g. 'number', 'string', 'email', 'string?')
 * @returns {z.ZodTypeAny}
 */
function descriptorToZod(typeName) {
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

  return isOptional ? schema.optional() : schema;
}

/**
 * Compile service schema definition into an executable validator
 * @param {Function|Object|null} rawSchema - Schema definition
 * @returns {Object|Function|null} Compiled schema
 */
function compileServiceSchema(rawSchema) {
  if (!rawSchema) return null;

  // If already a Zod schema
  if (rawSchema instanceof z.ZodType || typeof rawSchema.safeParse === 'function') {
    return rawSchema;
  }

  // If function: check if ({ z }) schema compiler or custom validator function
  if (typeof rawSchema === 'function') {
    try {
      const compiled = rawSchema({ z: zForServices });
      if (compiled && (compiled instanceof z.ZodType || typeof compiled.safeParse === 'function')) {
        return compiled;
      }
    } catch (e) {
      // If invoking with { z } throws, treat as a direct validator function
    }
    return rawSchema;
  }

  // If object descriptor: { id: 'number', name: 'string', email: 'email' }
  if (typeof rawSchema === 'object' && rawSchema !== null) {
    const keys = Object.keys(rawSchema);
    if (keys.length === 0) {
      return null;
    }
    const shape = {};
    for (const [key, val] of Object.entries(rawSchema)) {
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

  return rawSchema;
}

/**
 * Format Zod validation errors into a clean string and fields map
 * @param {z.ZodError} zodError
 * @param {string} serviceName
 * @returns {{ message: string, fields: Record<string, string> }}
 */
function formatZodErrors(zodError, serviceName) {
  const fields = {};
  const lines = [];

  for (const issue of zodError.issues || []) {
    const pathKey = issue.path && issue.path.length > 0 ? issue.path.join('.') : '_root';
    const fieldMsg = issue.message || 'invalid value';
    fields[pathKey] = fieldMsg;
    lines.push(`- ${pathKey}: ${fieldMsg}`);
  }

  const message = `Invalid service input for ${serviceName}:\n${lines.join('\n')}`;
  return { message, fields };
}

/**
 * Validate service input against compiled schema (supports sync & async Zod/custom schemas)
 * @param {Object|Function|null} schema - Schema definition
 * @param {*} input - Input to validate
 * @param {string} serviceName - Service name
 * @returns {*|Promise<*>} Validated input
 * @throws {ValidationError} When validation fails
 */
function validateServiceInput(schema, input, serviceName) {
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
        const { message, fields } = formatZodErrors(result.error, serviceName);
        throw new ValidationError(message, {
          fields,
          details: result.error.issues,
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
            const { message, fields } = formatZodErrors(asyncResult.error, serviceName);
            throw new ValidationError(message, {
              fields,
              details: asyncResult.error.issues,
            });
          }
          return asyncResult.data;
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
            throw new ValidationError(`Invalid service input for ${serviceName}: custom validation rejected input`);
          }
          return typeof asyncRes === 'object' && asyncRes !== null ? asyncRes : sanitized;
        });
      }
      if (res === false) {
        throw new ValidationError(`Invalid service input for ${serviceName}: custom validation rejected input`);
      }
      return typeof res === 'object' && res !== null ? res : sanitized;
    } catch (err) {
      if (err instanceof ValidationError) {
        throw err;
      }
      throw new ValidationError(`Invalid service input for ${serviceName}: ${err.message}`, {
        cause: err,
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
};
