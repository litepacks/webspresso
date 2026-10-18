/**
 * Webspresso Exceptions & Error Handling Module
 * @module core/errors
 */

const { WebspressoError } = require('./base');
const {
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
  RequestTimeoutError,
  TooManyRequestsError,
  ServiceUnavailableError,
  GatewayTimeoutError,
} = require('./http');
const {
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestError,
  RequestAbortedError,
  RouterError,
  RouteNotFoundError,
  RouteGenerationError,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} = require('./domain');
const {
  getStatusTitle,
  normalizeError,
  toErrorResponseObject,
} = require('./normalize');
const {
  preferJsonErrorResponse,
  createCentralErrorHandler,
  renderDefaultErrorHtml,
} = require('./middleware');

module.exports = {
  // Base
  WebspressoError,

  // HTTP Exceptions
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
  RequestTimeoutError,
  TooManyRequestsError,
  ServiceUnavailableError,
  GatewayTimeoutError,

  // Domain Exceptions
  ValidationError,
  ConfigurationError,
  PluginError,
  SecurityError,
  RequestError,
  RequestAbortedError,
  RouterError,
  RouteNotFoundError,
  RouteGenerationError,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,

  // Utilities & Middleware
  getStatusTitle,
  normalizeError,
  toErrorResponseObject,
  preferJsonErrorResponse,
  createCentralErrorHandler,
  renderDefaultErrorHtml,
};
