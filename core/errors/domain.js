/**
 * Framework Domain Exceptions
 * Includes Validation, Configuration, Plugin, Router, Security, and Request errors.
 * @module core/errors/domain
 */

const { WebspressoError } = require('./base');
const { HttpError, NotFoundError } = require('./http');

/**
 * Validation Error
 * Represents schema or business rule validation failures.
 * Maps to HTTP 422 Unprocessable Entity by default.
 */
class ValidationError extends HttpError {
  /**
   * @param {string} [message='Validation failed']
   * @param {Object} [options]
   * @param {Record<string, string[]|string>} [options.fields={}] - Field-specific validation error messages
   * @param {number} [options.status=422]
   * @param {string} [options.code='VALIDATION_ERROR']
   * @param {unknown} [options.details]
   * @param {unknown} [options.cause]
   */
  constructor(message = 'Validation failed', options = {}) {
    super(options.status || 422, message, {
      code: options.code || 'VALIDATION_ERROR',
      expose: true,
      ...options,
    });

    this.fields = options.fields || {};
  }
}

/**
 * Configuration Error
 * Represents framework, server, or application bootstrap misconfiguration.
 */
class ConfigurationError extends WebspressoError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'CONFIGURATION_ERROR',
      status: 500,
      ...options,
    });
  }
}

/**
 * Plugin Error
 * Represents plugin lifecycle, registration, or dependency failure.
 */
class PluginError extends WebspressoError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.plugin] - Name of the plugin that threw the error
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'PLUGIN_ERROR',
      status: 500,
      ...options,
    });

    this.plugin = options.plugin || null;
  }
}

/**
 * Security Error
 * Represents suspicious requests, invalid signatures, CSRF/cookie tampering.
 * Maps to HTTP 400 Bad Request by default, with internal details masked.
 */
class SecurityError extends HttpError {
  /**
   * @param {string} [message='Security violation']
   * @param {Object} [options]
   */
  constructor(message = 'Security violation', options = {}) {
    super(options.status || 400, message, {
      code: options.code || 'SECURITY_ERROR',
      expose: false,
      ...options,
    });
  }
}

/**
 * Base Request Transport Error
 */
class RequestError extends HttpError {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(status = 400, message = 'Request Error', options = {}) {
    super(status, message, options);
  }
}

/**
 * Request Aborted Error
 * Thrown when client connection is terminated/aborted before response completion.
 */
class RequestAbortedError extends RequestError {
  /**
   * @param {string} [message='Request aborted by client']
   * @param {Object} [options]
   */
  constructor(message = 'Request aborted by client', options = {}) {
    super(options.status || 499, message, {
      code: options.code || 'REQUEST_ABORTED',
      expose: false,
      ...options,
    });
  }
}

/**
 * Base Router Error
 */
class RouterError extends WebspressoError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
  }
}

/**
 * Route Not Found Error
 * Represents a URL that cannot be resolved to any page or route handler.
 * Maps to HTTP 404.
 */
class RouteNotFoundError extends NotFoundError {
  /**
   * @param {string} [pathOrMessage='Route not found']
   * @param {Object} [options]
   */
  constructor(pathOrMessage = 'Route not found', options = {}) {
    const msg = typeof pathOrMessage === 'string' && pathOrMessage.startsWith('/')
      ? `Route not found: ${pathOrMessage}`
      : pathOrMessage;

    super(msg, {
      code: options.code || 'ROUTE_NOT_FOUND',
      ...options,
    });

    if (typeof pathOrMessage === 'string' && pathOrMessage.startsWith('/')) {
      this.path = pathOrMessage;
    }
  }
}

/**
 * Route Generation Error
 * Developer error when generating a URL for a named route with missing or invalid parameters.
 */
class RouteGenerationError extends RouterError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ROUTE_GENERATION_ERROR',
      status: 500,
      ...options,
    });
  }
}

module.exports = {
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestError,
  RequestAbortedError,
  RouterError,
  RouteNotFoundError,
  RouteGenerationError,
};
