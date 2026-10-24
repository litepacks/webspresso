/**
 * Webspresso Unified Validation Core
 * Centralized Zod extensions, prototype pollution defense, and schema utilities
 * @module core/validation
 */

const z = require('zod');
const { extendZ, generateNanoid, zodNanoid } = require('../orm/utils/nanoid');

/**
 * Standard Zod instance extended with z.nanoid() for framework-wide validation.
 */
const zExtended = extendZ(z);

// Ensure asynchronous refinements and superRefinements never leak dangling unhandled rejections
// if evaluated during a synchronous parse attempt before falling back to async parsing.
if (z.ZodType && z.ZodType.prototype && typeof z.ZodType.prototype._refinement === 'function' && !z.ZodType.prototype._refinement.__webspresso_wrapped) {
  const origRefinement = z.ZodType.prototype._refinement;
  const wrappedRefinement = function (refinement) {
    const wrapped = (val, ctx) => {
      const res = refinement(val, ctx);
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
      return res;
    };
    return origRefinement.call(this, wrapped);
  };
  wrappedRefinement.__webspresso_wrapped = true;
  z.ZodType.prototype._refinement = wrappedRefinement;
}

/**
 * Check if an object contains dangerous prototype pollution keys
 * @param {*} obj
 * @returns {boolean}
 */
function hasDangerousKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  if (Array.isArray(obj)) {
    const len = obj.length;
    for (let i = 0; i < len; i++) {
      if (hasDangerousKeys(obj[i])) return true;
    }
    return false;
  }
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    const val = obj[key];
    if (val !== null && typeof val === 'object' && hasDangerousKeys(val)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitize input payload against prototype pollution
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

const validation = {
  z: zExtended,
  extendZ,
  generateNanoid,
  zodNanoid,
  hasDangerousKeys,
  sanitizeInput,
};

module.exports = validation;

const compiler = require('./compiler');
const apply = require('./apply');
const cache = require('./cache');

Object.assign(validation, {
  // Schema compiler & cache
  compileSchema: compiler.compileSchema,
  invalidateSchema: compiler.invalidateSchema,
  clearAllSchemas: compiler.clearAllSchemas,
  applySchema: apply.applySchema,
  translateValidationIssues: apply.translateValidationIssues,
  schemaCache: cache,

  compiler,
  apply,
  cache,
});

