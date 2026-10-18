'use strict';

/**
 * Webspresso Enterprise Resilience & Fault Tolerance Engine
 * Circuit Breaker, Exponential Backoff Retry with Jitter, and Failure Protection.
 * @module core/resilience
 */

const {
  CircuitBreaker,
  createCircuitBreaker,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
} = require('./circuit-breaker');

const {
  retry,
  withRetry,
  isTransientError,
  calculateBackoffDelay,
} = require('./retry');

const {
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  getBreaker,
} = require('./registry');

const {
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} = require('./errors');

module.exports = {
  CircuitBreaker,
  createCircuitBreaker,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,

  retry,
  withRetry,
  isTransientError,
  calculateBackoffDelay,

  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  getBreaker,

  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
};
