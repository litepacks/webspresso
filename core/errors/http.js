/**
 * HTTP Exception Hierarchy
 * @module core/errors/http
 */

const { WebspressoError } = require('./base');

/**
 * Base HTTP Error
 */
class HttpError extends WebspressoError {
  /**
   * @param {number} status - HTTP status code
   * @param {string} [message] - Error message
   * @param {Object} [options]
   * @param {string} [options.code] - Machine-readable error code
   * @param {unknown} [options.details] - Additional contextual details
   * @param {unknown} [options.cause] - Underlying root cause error
   * @param {Record<string, string>} [options.headers] - Response headers to attach
   * @param {boolean} [options.expose] - Whether to expose message to clients in production
   */
  constructor(status = 500, message = 'Internal Server Error', options = {}) {
    super(message, options);

    this.status = typeof status === 'number' ? status : 500;
    this.headers = options.headers || {};
    this.expose = options.expose !== undefined ? Boolean(options.expose) : this.status < 500;
  }
}

/**
 * 400 Bad Request
 */
class BadRequestError extends HttpError {
  constructor(message = 'Bad Request', options = {}) {
    super(400, message, { code: 'BAD_REQUEST', ...options });
  }
}

/**
 * 401 Unauthorized
 */
class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', options = {}) {
    super(401, message, { code: 'UNAUTHORIZED', ...options });
  }
}

/**
 * 403 Forbidden
 */
class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', options = {}) {
    super(403, message, { code: 'FORBIDDEN', ...options });
  }
}

/**
 * 404 Not Found
 */
class NotFoundError extends HttpError {
  constructor(message = 'Not Found', options = {}) {
    super(404, message, { code: 'NOT_FOUND', ...options });
  }
}

/**
 * 405 Method Not Allowed
 */
class MethodNotAllowedError extends HttpError {
  constructor(message = 'Method Not Allowed', options = {}) {
    super(405, message, { code: 'METHOD_NOT_ALLOWED', ...options });
  }
}

/**
 * 409 Conflict
 */
class ConflictError extends HttpError {
  constructor(message = 'Conflict', options = {}) {
    super(409, message, { code: 'CONFLICT', ...options });
  }
}

/**
 * 413 Payload Too Large
 */
class PayloadTooLargeError extends HttpError {
  constructor(message = 'Payload Too Large', options = {}) {
    super(413, message, { code: 'PAYLOAD_TOO_LARGE', ...options });
  }
}

/**
 * 415 Unsupported Media Type
 */
class UnsupportedMediaTypeError extends HttpError {
  constructor(message = 'Unsupported Media Type', options = {}) {
    super(415, message, { code: 'UNSUPPORTED_MEDIA_TYPE', ...options });
  }
}

/**
 * 422 Unprocessable Entity
 */
class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable Entity', options = {}) {
    super(422, message, { code: 'UNPROCESSABLE_ENTITY', ...options });
  }
}

/**
 * 429 Too Many Requests
 */
class TooManyRequestsError extends HttpError {
  constructor(message = 'Too Many Requests', options = {}) {
    super(429, message, { code: 'TOO_MANY_REQUESTS', ...options });
  }
}

module.exports = {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnprocessableEntityError,
  TooManyRequestsError,
};
