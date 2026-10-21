/**
 * Environment Variable Secret Provider for Webspresso
 * Reads secrets directly from process.env
 *
 * @module core/secrets/providers/env
 */

'use strict';

class EnvSecretProvider {
  constructor(options = {}) {
    this.name = 'env';
    this.prefix = options.prefix || '';
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
    const envKey = this.prefix ? `${this.prefix}${secretName}` : secretName;
    const value = process.env[envKey];
    if (value === undefined) {
      return null;
    }
    return value;
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
  EnvSecretProvider,
};
