/**
 * HTTP error helpers for Webspresso (Hono)
 * @module src/http/errors
 */

/**
 * @param {{ path?: string, accepts?: (type: string) => boolean }} req
 * @returns {boolean}
 */
function preferJsonErrorResponse(req) {
  if (req.path && req.path.startsWith('/api')) return true;
  if (typeof req.accepts === 'function') {
    return !req.accepts('html');
  }
  return true;
}

/**
 * @param {string} message
 * @param {number} [status=500]
 */
function createHttpError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  preferJsonErrorResponse,
  createHttpError,
};
