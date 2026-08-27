/**
 * ORM Query Complexity & DoS Protection
 * @module core/orm/complexity
 */

'use strict';

const { BadRequestError } = require('../errors/http');

class QueryComplexityError extends BadRequestError {
  /**
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(message, details = {}) {
    super(message || 'Query complexity limit exceeded', details);
    this.name = 'QueryComplexityError';
    this.code = 'QUERY_COMPLEXITY_EXCEEDED';
  }
}

const DEFAULT_QUERY_LIMITS = Object.freeze({
  maxLimit: 100,
  defaultLimit: 15,
  maxIncludes: 5,
  maxFilterConditions: 25,
});

/**
 * Resolve query limits for a given model
 * @param {import('./types').ModelDefinition} [model]
 * @returns {typeof DEFAULT_QUERY_LIMITS}
 */
function resolveQueryLimits(model) {
  if (!model || !model.queryLimits) {
    return DEFAULT_QUERY_LIMITS;
  }
  return {
    maxLimit: Number(model.queryLimits.maxLimit) || DEFAULT_QUERY_LIMITS.maxLimit,
    defaultLimit: Number(model.queryLimits.defaultLimit) || DEFAULT_QUERY_LIMITS.defaultLimit,
    maxIncludes: Number(model.queryLimits.maxIncludes) || DEFAULT_QUERY_LIMITS.maxIncludes,
    maxFilterConditions: Number(model.queryLimits.maxFilterConditions) || DEFAULT_QUERY_LIMITS.maxFilterConditions,
  };
}

/**
 * Validate and clamp query complexity parameters against model / default limits
 * @param {import('./types').ModelDefinition} [model]
 * @param {Object} params
 * @param {number} [params.perPage]
 * @param {number} [params.limit]
 * @param {string[]} [params.includes]
 * @param {number} [params.filterCount]
 * @param {boolean} [params.strict=false] - If true, throws QueryComplexityError instead of clamping
 * @returns {{ limit: number, perPage: number, includes: string[] }}
 */
function validateQueryComplexity(model, params = {}) {
  const limits = resolveQueryLimits(model);
  const strict = params.strict === true;

  // 1. Validate includes
  let includes = Array.isArray(params.includes) ? params.includes : [];
  if (includes.length > limits.maxIncludes) {
    if (strict) {
      throw new QueryComplexityError(
        `Too many eager-loaded relations (${includes.length}). Maximum allowed is ${limits.maxIncludes}.`,
        { maxIncludes: limits.maxIncludes, requested: includes.length }
      );
    }
    includes = includes.slice(0, limits.maxIncludes);
  }

  // 2. Validate perPage / limit
  let requestedLimit = params.perPage !== undefined ? params.perPage : params.limit;
  if (requestedLimit !== undefined) {
    const numLimit = parseInt(requestedLimit, 10);
    if (!isNaN(numLimit)) {
      if (numLimit > limits.maxLimit) {
        if (strict) {
          throw new QueryComplexityError(
            `Requested limit (${numLimit}) exceeds maximum allowed limit of ${limits.maxLimit}.`,
            { maxLimit: limits.maxLimit, requested: numLimit }
          );
        }
        requestedLimit = limits.maxLimit;
      } else if (numLimit < 1) {
        requestedLimit = limits.defaultLimit;
      } else {
        requestedLimit = numLimit;
      }
    } else {
      requestedLimit = limits.defaultLimit;
    }
  } else {
    requestedLimit = limits.defaultLimit;
  }

  // 3. Validate filter count
  if (params.filterCount !== undefined && params.filterCount > limits.maxFilterConditions) {
    if (strict) {
      throw new QueryComplexityError(
        `Too many filter conditions (${params.filterCount}). Maximum allowed is ${limits.maxFilterConditions}.`,
        { maxFilterConditions: limits.maxFilterConditions, requested: params.filterCount }
      );
    }
  }

  return {
    limit: requestedLimit,
    perPage: requestedLimit,
    includes,
  };
}

module.exports = {
  QueryComplexityError,
  DEFAULT_QUERY_LIMITS,
  resolveQueryLimits,
  validateQueryComplexity,
};
