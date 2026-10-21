'use strict';

/**
 * Webspresso Enterprise Circuit Breaker
 * Protects downstream systems from cascading failures with CLOSED, OPEN, and HALF_OPEN states,
 * rolling window failure rates, per-call execution timeouts, graceful fallbacks, and event monitoring.
 * @module core/resilience/circuit-breaker
 */

const EventEmitter = require('events');
const { parseDurationMs } = require('../utils/time');
const { CircuitBreakerOpenError, CircuitBreakerTimeoutError } = require('./errors');

const STATE_CLOSED = 'CLOSED';
const STATE_OPEN = 'OPEN';
const STATE_HALF_OPEN = 'HALF_OPEN';

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {string} [name='default'] - Breaker identifier
 * @property {number} [failureThreshold=5] - Consecutive failure count to open circuit
 * @property {number} [failureRateThreshold] - Percentage failure rate threshold (0.1 to 1.0)
 * @property {number} [minimumRequests=5] - Minimum requests in rolling window for failure rate calculation
 * @property {number|string} [rollingWindowMs=10000] - Rolling window for metrics in ms or duration string
 * @property {number} [successThreshold=2] - Consecutive successes in HALF_OPEN to close circuit
 * @property {number|string} [resetTimeout=10000] - Duration in ms or duration string to stay OPEN before HALF_OPEN
 * @property {number|string} [timeout=0] - Per-call execution timeout in ms or duration string (0 = disabled)
 * @property {function(Error, ...*): *} [fallback] - Fallback handler when OPEN or call fails
 * @property {function(Error): boolean} [isFailure] - Custom error classifier predicate
 * @property {function(string, string, CircuitBreaker): void} [onStateChange] - State transition listener
 */

class CircuitBreaker extends EventEmitter {
  /**
   * @param {CircuitBreakerOptions} [options]
   */
  constructor(options = {}) {
    super();

    this.name = options.name || 'default';
    this.failureThreshold = typeof options.failureThreshold === 'number' ? Math.max(1, options.failureThreshold) : 5;
    this.failureRateThreshold = typeof options.failureRateThreshold === 'number'
      ? Math.min(1, Math.max(0.01, options.failureRateThreshold))
      : null;
    this.minimumRequests = typeof options.minimumRequests === 'number' ? Math.max(1, options.minimumRequests) : 5;
    
    this.rollingWindowMs = options.rollingWindowMs !== undefined
      ? parseDurationMs(options.rollingWindowMs, 10000)
      : (options.rollingWindow !== undefined ? parseDurationMs(options.rollingWindow, 10000) : 10000);

    this.successThreshold = typeof options.successThreshold === 'number' ? Math.max(1, options.successThreshold) : 2;

    this.resetTimeoutMs = options.resetTimeout !== undefined
      ? parseDurationMs(options.resetTimeout, 10000)
      : (options.resetTimeoutMs !== undefined ? parseDurationMs(options.resetTimeoutMs, 10000) : 10000);

    this.timeoutMs = options.timeout !== undefined
      ? parseDurationMs(options.timeout, 0)
      : (options.timeoutMs !== undefined ? parseDurationMs(options.timeoutMs, 0) : 0);

    this.fallback = typeof options.fallback === 'function' ? options.fallback : null;
    this.isFailure = typeof options.isFailure === 'function'
      ? options.isFailure
      : (err) => {
          if (!err) return false;
          const status = err.status || err.statusCode || err.response?.status;
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
            return false;
          }
          return true;
        };

    if (typeof options.onStateChange === 'function') {
      this.on('stateChange', options.onStateChange);
    }

    this.state = STATE_CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastStateChange = Date.now();
    this.lastFailureTime = null;
    this.lastSuccessTime = null;

    /** @type {Array<{ time: number, success: boolean }>} Rolling window samples */
    this._samples = [];

    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      timedOutCalls: 0,
      fallbackCalls: 0,
    };
  }

  static get STATE_CLOSED() { return STATE_CLOSED; }
  static get STATE_OPEN() { return STATE_OPEN; }
  static get STATE_HALF_OPEN() { return STATE_HALF_OPEN; }

  get isClosed() { return this.state === STATE_CLOSED; }
  get isOpen() { return this.state === STATE_OPEN; }
  get isHalfOpen() { return this.state === STATE_HALF_OPEN; }

  /**
   * Transition circuit breaker state
   * @private
   */
  _transitionTo(newState) {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === STATE_CLOSED) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.emit('close', this);
    } else if (newState === STATE_OPEN) {
      this.consecutiveSuccesses = 0;
      this.emit('open', this);
    } else if (newState === STATE_HALF_OPEN) {
      this.consecutiveSuccesses = 0;
      this.emit('halfOpen', this);
    }

    this.emit('stateChange', oldState, newState, this);
  }

  /**
   * Manually force open the circuit
   */
  open() {
    this._transitionTo(STATE_OPEN);
    return this;
  }

  /**
   * Manually force close the circuit
   */
  close() {
    this._transitionTo(STATE_CLOSED);
    return this;
  }

  /**
   * Manually transition to half-open
   */
  halfOpen() {
    this._transitionTo(STATE_HALF_OPEN);
    return this;
  }

  /**
   * Reset circuit breaker state and metrics
   */
  reset() {
    this.state = STATE_CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastStateChange = Date.now();
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this._samples = [];

    this.metrics.totalCalls = 0;
    this.metrics.successfulCalls = 0;
    this.metrics.failedCalls = 0;
    this.metrics.rejectedCalls = 0;
    this.metrics.timedOutCalls = 0;
    this.metrics.fallbackCalls = 0;

    return this;
  }

  /**
   * Prune sample measurements outside the rolling window
   * @private
   */
  _pruneSamples() {
    const cutoff = Date.now() - this.rollingWindowMs;
    while (this._samples.length > 0 && this._samples[0].time < cutoff) {
      this._samples.shift();
    }
  }

  /**
   * Record invocation sample in rolling window
   * @private
   */
  _recordSample(success) {
    this._samples.push({ time: Date.now(), success });
    this._pruneSamples();
  }

  /**
   * Calculate current failure rate in rolling window (0.0 to 1.0)
   */
  getFailureRate() {
    this._pruneSamples();
    if (this._samples.length === 0) return 0;

    let failures = 0;
    for (let i = 0; i < this._samples.length; i++) {
      if (!this._samples[i].success) failures++;
    }

    return failures / this._samples.length;
  }

  /**
   * Process successful call
   * @private
   */
  _onSuccess() {
    this.lastSuccessTime = Date.now();
    this.metrics.successfulCalls++;
    this._recordSample(true);

    if (this.state === STATE_HALF_OPEN) {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this._transitionTo(STATE_CLOSED);
      }
    } else if (this.state === STATE_CLOSED) {
      this.consecutiveFailures = 0;
    }

    this.emit('success', this);
  }

  /**
   * Process failed call
   * @private
   */
  _onFailure(err) {
    this.lastFailureTime = Date.now();
    this.metrics.failedCalls++;
    this._recordSample(false);

    if (this.state === STATE_HALF_OPEN) {
      // In HALF_OPEN, any failure immediately trips circuit back to OPEN
      this._transitionTo(STATE_OPEN);
    } else if (this.state === STATE_CLOSED) {
      this.consecutiveFailures++;

      // Check consecutive failures
      if (this.consecutiveFailures >= this.failureThreshold) {
        this._transitionTo(STATE_OPEN);
      } else if (
        this.failureRateThreshold !== null &&
        this._samples.length >= this.minimumRequests &&
        this.getFailureRate() >= this.failureRateThreshold
      ) {
        this._transitionTo(STATE_OPEN);
      }
    }

    this.emit('failure', err, this);
  }

  /**
   * Execute an async function protected by this circuit breaker.
   *
   * @param {Function} fn - Async or sync function to execute
   * @param {...*} args - Arguments forwarded to fn
   * @returns {Promise<*>}
   */
  async execute(fn, ...args) {
    this.metrics.totalCalls++;

    // 1. Check if OPEN state should attempt recovery to HALF_OPEN
    if (this.state === STATE_OPEN) {
      const now = Date.now();
      if (now - this.lastStateChange >= this.resetTimeoutMs) {
        this._transitionTo(STATE_HALF_OPEN);
      } else {
        // Fast-fail: Circuit is OPEN and reset timeout has not expired
        this.metrics.rejectedCalls++;
        const openErr = new CircuitBreakerOpenError(this.name, this.resetTimeoutMs);

        if (this.fallback) {
          this.metrics.fallbackCalls++;
          this.emit('fallback', openErr, this);
          return await this.fallback(openErr, ...args);
        }

        throw openErr;
      }
    }

    // 2. Execute operation with optional timeout
    let timerId = null;
    let timedOut = false;

    try {
      let execPromise;
      if (this.timeoutMs > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            timedOut = true;
            this.metrics.timedOutCalls++;
            const timeoutErr = new CircuitBreakerTimeoutError(this.name, this.timeoutMs);
            this.emit('timeout', timeoutErr, this);
            reject(timeoutErr);
          }, this.timeoutMs);
          if (typeof timerId?.unref === 'function') timerId.unref();
        });

        execPromise = Promise.race([
          Promise.resolve().then(() => fn(...args)),
          timeoutPromise,
        ]);
      } else {
        execPromise = Promise.resolve().then(() => fn(...args));
      }

      const result = await execPromise;
      if (timerId) clearTimeout(timerId);

      this._onSuccess();
      return result;
    } catch (err) {
      if (timerId) clearTimeout(timerId);

      const isCountedFailure = this.isFailure(err);
      if (isCountedFailure) {
        this._onFailure(err);
      }

      // If fallback configured, invoke fallback on error
      if (this.fallback) {
        this.metrics.fallbackCalls++;
        this.emit('fallback', err, this);
        return await this.fallback(err, ...args);
      }

      throw err;
    }
  }

  /**
   * Manually record a success (useful for tests or custom telemetry integration)
   * @returns {CircuitBreaker}
   */
  recordSuccess() {
    this.metrics.totalCalls++;
    this._onSuccess();
    return this;
  }

  /**
   * Manually record a failure (useful for tests or custom telemetry integration)
   * @param {Error} [err]
   * @returns {CircuitBreaker}
   */
  recordFailure(err = new Error('Circuit breaker failure recorded')) {
    this.metrics.totalCalls++;
    this._onFailure(err);
    return this;
  }

  /**
   * Get the current circuit breaker state
   * @returns {'CLOSED'|'OPEN'|'HALF_OPEN'}
   */
  getState() {
    return this.state;
  }

  /**
   * Wrap a function with this circuit breaker
   * @param {Function} fn
   * @returns {Function}
   */
  wrap(fn) {
    return (...args) => this.execute(fn, ...args);
  }

  /**
   * Telemetry stats snapshot
   */
  getStats() {
    this._pruneSamples();
    return {
      name: this.name,
      state: this.state,
      totalCalls: this.metrics.totalCalls,
      successfulCalls: this.metrics.successfulCalls,
      successes: this.metrics.successfulCalls,
      failedCalls: this.metrics.failedCalls,
      failures: this.metrics.failedCalls,
      rejectedCalls: this.metrics.rejectedCalls,
      timedOutCalls: this.metrics.timedOutCalls,
      fallbackCalls: this.metrics.fallbackCalls,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      failureRate: this.getFailureRate(),
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
    };
  }
}

/**
 * Factory helper
 * @param {CircuitBreakerOptions} [options]
 * @returns {CircuitBreaker}
 */
function createCircuitBreaker(options) {
  return new CircuitBreaker(options);
}

module.exports = {
  CircuitBreaker,
  createCircuitBreaker,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
};
