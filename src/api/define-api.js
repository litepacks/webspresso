'use strict';

/**
 * Webspresso API Definition Helper
 * @module src/api/define-api
 */

/**
 * Defines an API route with schema validation, response metadata, and handler
 * @param {Object} config
 * @param {string} [config.description] - Endpoint description for OpenAPI
 * @param {Array<string>} [config.tags] - Endpoint tags for OpenAPI
 * @param {Array<string|Function>} [config.middleware] - Named or functional middlewares
 * @param {Object|Function} [config.schema] - Request schemas (params, query, body, headers)
 * @param {Object} [config.response] - Expected response schemas by status code
 * @param {Function} config.handler - Request handler: async (req, ctx) => data
 * @returns {Object}
 */
function defineApi(config = {}) {
  if (typeof config === 'function') {
    return {
      handler: config,
      __isWebspressoApi: true,
    };
  }

  return {
    ...config,
    __isWebspressoApi: true,
  };
}

module.exports = {
  defineApi,
};
