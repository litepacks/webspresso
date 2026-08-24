/**
 * Realtime error classes & normalization utilities
 * @module core/realtime/errors
 */

/**
 * Strips tokens, secrets, and sensitive query parameters from strings/URLs
 * 
 * @param {string} input
 * @returns {string}
 */
function sanitizeErrorMessage(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/([?&](?:token|access_token|secret|key|auth|password|apiKey)=)[^&#\s]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9-_=.]+/gi, '$1***')
    .replace(/(Basic\s+)[A-Za-z0-9-_=.]+/gi, '$1***');
}

/**
 * Standard Realtime Error
 */
class RealtimeError extends Error {
  /**
   * @param {string} code - Standardized error code
   * @param {string} message - Human-readable error description (sanitized)
   * @param {Error|unknown} [cause] - Original root cause error
   */
  constructor(code, message, cause = null) {
    const sanitizedMsg = sanitizeErrorMessage(message);
    super(sanitizedMsg);
    this.name = 'RealtimeError';
    this.code = code;
    if (cause) {
      this.cause = cause instanceof Error ? cause : new Error(sanitizeErrorMessage(String(cause)));
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      cause: this.cause ? this.cause.message || String(this.cause) : null,
    };
  }
}

/**
 * Normalize any error into a standard RealtimeError
 * 
 * @param {unknown} err
 * @param {string} [defaultCode='REALTIME_ERROR']
 * @param {string} [defaultMessage='An unexpected realtime error occurred']
 * @returns {RealtimeError}
 */
function normalizeRealtimeError(err, defaultCode = 'REALTIME_ERROR', defaultMessage = 'An unexpected realtime error occurred') {
  if (err instanceof RealtimeError) {
    return err;
  }
  if (err instanceof Error) {
    const code = err.code && typeof err.code === 'string' ? err.code : defaultCode;
    return new RealtimeError(code, err.message || defaultMessage, err);
  }
  return new RealtimeError(defaultCode, typeof err === 'string' ? err : defaultMessage, err);
}

module.exports = {
  RealtimeError,
  normalizeRealtimeError,
  sanitizeErrorMessage,
};
