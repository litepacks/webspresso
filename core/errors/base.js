/**
 * Base Webspresso Error Class
 * @module core/errors/base
 */

class WebspressoError extends Error {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.code] - Machine-readable error code
   * @param {unknown} [options.details] - Additional contextual details
   * @param {unknown} [options.cause] - Underlying root cause error
   * @param {number} [options.status] - Optional HTTP status code mapping
   */
  constructor(message, options = {}) {
    super(message, {
      cause: options.cause,
    });

    this.name = this.constructor.name;
    this.code = options.code;
    this.details = options.details;
    if (typeof options.status === 'number') {
      this.status = options.status;
    }
  }
}

module.exports = {
  WebspressoError,
};
