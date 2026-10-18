'use strict';

/**
 * Webspresso - Circuit Breaker Registry
 * Central registry for named CircuitBreaker instances across the application.
 * @module core/resilience/registry
 */

const { CircuitBreaker } = require('./circuit-breaker');

class CircuitBreakerRegistry {
  constructor() {
    /** @type {Map<string, CircuitBreaker>} */
    this.breakers = new Map();
  }

  /**
   * Retrieve an existing circuit breaker or create a new one with options.
   *
   * @param {string} name - Unique breaker identifier
   * @param {import('./circuit-breaker').CircuitBreakerOptions} [options]
   * @returns {CircuitBreaker}
   */
  getBreaker(name, options = {}) {
    if (!name || typeof name !== 'string') {
      name = 'default';
    }

    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker({ name, ...options });
      this.breakers.set(name, breaker);
      return breaker;
    }

    return this.breakers.get(name);
  }

  /**
   * Check if a named breaker exists
   * @param {string} name
   * @returns {boolean}
   */
  hasBreaker(name) {
    return this.breakers.has(name);
  }

  /**
   * Get all registered circuit breakers
   * @returns {CircuitBreaker[]}
   */
  getAllBreakers() {
    return Array.from(this.breakers.values());
  }

  /**
   * Get telemetry stats summary for all breakers
   * @returns {Record<string, Object>}
   */
  getStats() {
    const summary = {};
    for (const [name, breaker] of this.breakers.entries()) {
      summary[name] = breaker.getStats();
    }
    return summary;
  }

  /**
   * Reset all registered circuit breakers to CLOSED state
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Clear all registered breakers
   */
  clear() {
    for (const breaker of this.breakers.values()) {
      breaker.removeAllListeners();
    }
    this.breakers.clear();
  }
}

const circuitBreakerRegistry = new CircuitBreakerRegistry();

function getBreaker(name, options) {
  return circuitBreakerRegistry.getBreaker(name, options);
}

module.exports = {
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  getBreaker,
};
