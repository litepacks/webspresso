'use strict';

/**
 * Webspresso Resilience Exceptions
 * Semantic errors for Circuit Breaker and Fault Tolerance failures.
 * @module core/resilience/errors
 */

const { ServiceUnavailableError, GatewayTimeoutError } = require('../errors/http');

/**
 * CircuitBreakerOpenError
 * Thrown when an invocation is rejected because the circuit is in the OPEN state.
 * Maps directly to HTTP 503 Service Unavailable.
 */
class CircuitBreakerOpenError extends ServiceUnavailableError {
  /**
   * @param {string} breakerName - Name of the circuit breaker
   * @param {number} [resetTimeoutMs] - Time until the breaker attempts half-open
   * @param {Object} [options]
   */
  constructor(breakerName = 'default', resetTimeoutMs = 0, options = {}) {
    const message = `Circuit breaker '${breakerName}' is OPEN and failing fast`;
    super(message, {
      code: 'CIRCUIT_BREAKER_OPEN',
      expose: true,
      ...options,
    });

    this.breakerName = breakerName;
    this.resetTimeoutMs = resetTimeoutMs;
    this.state = 'OPEN';
  }
}

/**
 * CircuitBreakerTimeoutError
 * Thrown when an invocation inside a circuit breaker exceeds the configured per-call timeout.
 * Maps directly to HTTP 504 Gateway Timeout.
 */
class CircuitBreakerTimeoutError extends GatewayTimeoutError {
  /**
   * @param {string} breakerName - Name of the circuit breaker
   * @param {number} timeoutMs - Timeout duration in milliseconds
   * @param {Object} [options]
   */
  constructor(breakerName = 'default', timeoutMs = 0, options = {}) {
    const message = `Execution in circuit breaker '${breakerName}' timed out after ${timeoutMs}ms`;
    super(message, {
      code: 'CIRCUIT_BREAKER_TIMEOUT',
      expose: true,
      ...options,
    });

    this.breakerName = breakerName;
    this.timeoutMs = timeoutMs;
  }
}

module.exports = {
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
};
