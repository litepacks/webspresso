/**
 * Webspresso HTTP layer (Hono)
 * @module src/http
 */

const { createCompatApp } = require('./compat-app');
const { buildReq, createCompatResponse, attachSessionWrapper, bindSessionWrapper } = require('./context');
const { preferJsonErrorResponse, createHttpError } = require('./errors');
const { runExpressMiddleware, runExpressHandlers, expressToHono, getCompatRes } = require('./middleware');
const { getDefaultHelmetConfig, helmetToSecureHeaders } = require('./secure-headers');
const { listen } = require('./node-serve');

module.exports = {
  createCompatApp,
  buildReq,
  createCompatResponse,
  attachSessionWrapper,
  bindSessionWrapper,
  preferJsonErrorResponse,
  createHttpError,
  runExpressMiddleware,
  runExpressHandlers,
  expressToHono,
  getCompatRes,
  getDefaultHelmetConfig,
  helmetToSecureHeaders,
  listen,
};
