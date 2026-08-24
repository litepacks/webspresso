/**
 * Realtime Reconnection & Exponential Backoff Manager
 * @module core/realtime/reconnect-manager
 */

class ReconnectManager {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true] - Whether automatic reconnection is enabled
   * @param {number} [options.maxAttempts=10] - Maximum reconnection attempts before giving up
   * @param {number} [options.baseDelay=500] - Initial reconnection delay in ms
   * @param {number} [options.maxDelay=30000] - Maximum reconnection delay in ms
   * @param {number} [options.factor=2] - Exponential growth factor
   * @param {boolean} [options.jitter=true] - Whether to apply randomized jitter
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.baseDelay = options.baseDelay ?? 500;
    this.maxDelay = options.maxDelay ?? 30000;
    this.factor = options.factor ?? 2;
    this.jitter = options.jitter !== false;

    this.attempts = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._timer = null;
    this._isReconnecting = false;
    this._isAborted = false;
  }

  calculateDelay(attempt) {
    const rawDelay = this.baseDelay * Math.pow(this.factor, attempt);
    const capped = Math.min(rawDelay, this.maxDelay);

    if (!this.jitter) {
      return Math.round(capped);
    }

    const randomJitter = capped * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + randomJitter));
  }

  canReconnect() {
    if (!this.enabled || this._isAborted) return false;
    if (this.maxAttempts > 0 && this.attempts >= this.maxAttempts) {
      return false;
    }
    return true;
  }

  isReconnecting() {
    return this._isReconnecting || this._timer !== null;
  }

  schedule(reconnectFn, onAttempt) {
    if (!this.canReconnect()) {
      return false;
    }

    if (this.isReconnecting()) {
      return false;
    }

    const currentAttempt = this.attempts + 1;
    const delay = this.calculateDelay(this.attempts);
    this.attempts = currentAttempt;

    if (typeof onAttempt === 'function') {
      try {
        onAttempt({ attempt: currentAttempt, delay, maxAttempts: this.maxAttempts });
      } catch (e) {
        console.error('[realtime] Error in onAttempt callback:', e);
      }
    }

    this._timer = setTimeout(async () => {
      this._timer = null;
      if (this._isAborted) return;

      this._isReconnecting = true;
      try {
        await reconnectFn();
        this.reset();
      } catch (err) {
        this._isReconnecting = false;
        if (this._isAborted) return;

        if (this.canReconnect()) {
          this.schedule(reconnectFn, onAttempt);
        }
      } finally {
        this._isReconnecting = false;
      }
    }, delay);

    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }

    return true;
  }

  reset() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.attempts = 0;
    this._isReconnecting = false;
  }

  cancel() {
    this._isAborted = true;
    this.reset();
  }
}

module.exports = { ReconnectManager };
