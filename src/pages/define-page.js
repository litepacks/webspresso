'use strict';

/**
 * Webspresso Page Definition Helper
 * @module src/pages/define-page
 */

/**
 * Defines a page route with load, head, and render lifecycle methods
 * @param {Object} config
 * @param {Array<string|Function>} [config.middleware] - Route-level middleware names or functions
 * @param {Function} [config.load] - Async server data loader: async (ctx) => data
 * @param {Function} [config.head] - Dynamic head metadata: (data, ctx) => ({ title, meta, ... })
 * @param {Function} [config.render] - Component renderer (used for pure JS pages): (data, ctx) => string|Promise<string>
 * @param {string|boolean} [config.layout] - Layout override
 * @param {Object} [config.hooks] - Page lifecycle hooks
 * @returns {Object}
 */
function definePage(config = {}) {
  if (typeof config === 'function') {
    // If a loader function is passed directly
    return {
      load: config,
      __isWebspressoPage: true,
    };
  }

  return {
    ...config,
    __isWebspressoPage: true,
  };
}

module.exports = {
  definePage,
};
