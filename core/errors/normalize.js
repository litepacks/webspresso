/**
 * Error Normalization & Formatting Utilities
 * Standardizes errors across all layers and formats safe HTTP error payloads.
 * @module core/errors/normalize
 */

const { WebspressoError } = require('./base');
const { HttpError } = require('./http');

const HTTP_TITLES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Get human-readable title for an HTTP status code
 * @param {number} status
 * @returns {string}
 */
function getStatusTitle(status) {
  return HTTP_TITLES[status] || (status >= 500 ? 'Internal Server Error' : 'Error');
}

/**
 * Normalize any thrown value (Error, string, object, null) into a standardized HttpError or WebspressoError
 * @param {unknown} err - The raw thrown error
 * @param {boolean} [isDev=false] - Whether in development environment
 * @returns {HttpError|WebspressoError}
 */
function normalizeError(err, isDev = false) {
  // Handle nullish throws
  if (err === null || err === undefined) {
    return new HttpError(500, 'Internal Server Error', {
      expose: false,
    });
  }

  // If already a WebspressoError / HttpError
  if (err instanceof WebspressoError) {
    return err;
  }

  // If standard JavaScript Error (TypeError, RangeError, standard Error)
  if (err instanceof Error) {
    const status = typeof err.status === 'number'
      ? err.status
      : (typeof err.statusCode === 'number' ? err.statusCode : 500);

    const isClientError = status < 500;
    const expose = typeof err.expose === 'boolean' ? err.expose : isClientError;

    const httpErr = new HttpError(
      status,
      (expose || isDev) ? (err.message || getStatusTitle(status)) : getStatusTitle(status),
      {
        code: err.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : undefined),
        details: err.details,
        cause: err,
        headers: err.headers,
        expose,
      }
    );

    // Retain original stack
    if (err.stack) {
      httpErr.stack = err.stack;
    }

    return httpErr;
  }

  // If primitive string or number thrown
  if (typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean') {
    const msg = String(err);
    return new HttpError(500, isDev ? msg : 'Internal Server Error', {
      details: { rawValue: err },
      expose: false,
    });
  }

  // If plain object thrown (e.g. { message: 'Failed', status: 400 })
  if (typeof err === 'object') {
    const status = typeof err.status === 'number'
      ? err.status
      : (typeof err.statusCode === 'number' ? err.statusCode : 500);

    const msg = typeof err.message === 'string' ? err.message : getStatusTitle(status);

    return new HttpError(status, (status < 500 || isDev) ? msg : getStatusTitle(status), {
      code: err.code,
      details: err.details,
      headers: err.headers,
      expose: typeof err.expose === 'boolean' ? err.expose : status < 500,
    });
  }

  return new HttpError(500, 'Internal Server Error', { expose: false });
}

/**
 * Format a normalized error into a clean JSON response object conforming to contract
 * @param {HttpError|WebspressoError|Error} error - Normalized error
 * @param {boolean} [isDev=false] - Whether running in development mode
 * @returns {Record<string, unknown>}
 */
function toErrorResponseObject(error, isDev = false) {
  const status = typeof error.status === 'number' ? error.status : 500;
  const errorTitle = error.name === 'ValidationError'
    ? 'Validation Error'
    : getStatusTitle(status);

  let shouldExpose;
  if (typeof error.expose === 'boolean') {
    shouldExpose = error.expose || isDev;
  } else {
    shouldExpose = isDev || status < 500;
  }

  const message = shouldExpose && error.message ? error.message : getStatusTitle(status);

  const payload = {
    status,
    error: errorTitle,
    message,
  };

  if (error.code) {
    payload.code = error.code;
  }

  // Include validation fields if present
  if (error.fields && Object.keys(error.fields).length > 0 && shouldExpose) {
    payload.fields = error.fields;
  }

  // Include contextual details if expose is true or in dev
  if (error.details !== undefined && shouldExpose) {
    payload.details = error.details;
  }

  // Include stack and cause strictly in development mode
  if (isDev) {
    if (error.stack) {
      payload.stack = error.stack;
    }
    if (error.cause) {
      payload.cause = error.cause instanceof Error ? (error.cause.stack || error.cause.message) : error.cause;
    }
  }

  return payload;
}

module.exports = {
  getStatusTitle,
  normalizeError,
  toErrorResponseObject,
};
