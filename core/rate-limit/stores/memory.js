/**
 * Webspresso In-Memory Rate Limit Store
 * Sliding window algorithm with automatic cleanup and memory bound safety.
 * @module core/rate-limit/stores/memory
 */

'use strict';

class MemoryRateLimitStore {
  /**
   * @param {Object} [options]
   * @param {number} [options.cleanupIntervalMs=30000] - Interval to sweep expired keys
   */
  constructor(options = {}) {
    /** @type {Map<string, number[]>} Map of key -> timestamps */
    this.hits = new Map();
    this.cleanupIntervalMs = options.cleanupIntervalMs || 30000;

    // Periodic sweep to prevent memory growth
    this._cleanupTimer = setInterval(() => {
      this.sweep();
    }, this.cleanupIntervalMs);

    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Increment request count for a given key within windowMs
   * @param {string} key
   * @param {number} windowMs
   * @returns {Promise<{ totalHits: number, resetTime: Date }>}
   */
  async increment(key, windowMs) {
    const now = Date.now();
    const threshold = now - windowMs;

    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    // Filter out expired timestamps
    let validIndex = 0;
    while (validIndex < timestamps.length && timestamps[validIndex] <= threshold) {
      validIndex++;
    }
    if (validIndex > 0) {
      timestamps.splice(0, validIndex);
    }

    timestamps.push(now);

    const oldest = timestamps[0];
    const resetTime = new Date(oldest + windowMs);

    return {
      totalHits: timestamps.length,
      resetTime,
    };
  }

  /**
   * Decrement request count (e.g. when request is skipped or failed)
   * @param {string} key
   * @returns {Promise<void>}
   */
  async decrement(key) {
    const timestamps = this.hits.get(key);
    if (timestamps && timestamps.length > 0) {
      timestamps.pop();
      if (timestamps.length === 0) {
        this.hits.delete(key);
      }
    }
  }

  /**
   * Reset hits for a single key
   * @param {string} key
   * @returns {Promise<void>}
   */
  async resetKey(key) {
    this.hits.delete(key);
  }

  /**
   * Reset all stored keys
   * @returns {Promise<void>}
   */
  async resetAll() {
    this.hits.clear();
  }

  /**
   * Sweep stale keys that have no recent hits
   */
  sweep() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      if (timestamps.length === 0) {
        this.hits.delete(key);
      } else {
        const latest = timestamps[timestamps.length - 1];
        // If the newest hit is older than 1 hour, safely purge
        if (now - latest > 3600000) {
          this.hits.delete(key);
        }
      }
    }
  }

  /**
   * Destroy store and stop background cleanup timer
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.hits.clear();
  }
}

module.exports = {
  MemoryRateLimitStore,
};
