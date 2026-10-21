/**
 * In-Memory Secret Provider for Webspresso
 * Holds secrets in memory, ideal for tests, local mocking, and staging overrides.
 *
 * @module core/secrets/providers/memory
 */

'use strict';

class MemorySecretProvider {
  /**
   * @param {Object} [options]
   * @param {Record<string, string|Object>} [options.secrets]
   */
  constructor(options = {}) {
    this.name = 'memory';
    this.store = new Map();

    if (options.secrets && typeof options.secrets === 'object') {
      for (const [key, val] of Object.entries(options.secrets)) {
        this.set(key, val);
      }
    }
  }

  /**
   * Store a secret in memory
   * @param {string} secretName
   * @param {string|Object} value
   */
  set(secretName, value) {
    if (!secretName || typeof secretName !== 'string') return;
    const stringVal = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    this.store.set(secretName, stringVal);
  }

  /**
   * Delete a secret from memory
   * @param {string} secretName
   */
  delete(secretName) {
    this.store.delete(secretName);
  }

  /**
   * Clear all secrets from memory
   */
  clear() {
    this.store.clear();
  }

  /**
   * Fetch secret value by name
   * @param {string} secretName
   * @returns {Promise<string|null>}
   */
  async get(secretName) {
    if (!secretName || typeof secretName !== 'string') {
      return null;
    }
    const val = this.store.get(secretName);
    return val !== undefined ? val : null;
  }

  /**
   * Health check / ping provider
   * @returns {Promise<boolean>}
   */
  async ping() {
    return true;
  }
}

module.exports = {
  MemorySecretProvider,
};
