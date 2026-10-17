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

module.exports = {
  z: zExtended,
  extendZ,
  generateNanoid,
  zodNanoid,
  hasDangerousKeys,
  sanitizeInput,
};
