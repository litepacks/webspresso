/**
 * Webspresso Cloud Secrets Management
 *
 * Zero-dependency cloud secrets manager supporting Google Cloud Secret Manager,
 * AWS Secrets Manager & SSM Parameter Store, in-memory caching with TTL,
 * JSON bundle unpacking, dot-notation subkeys, and process.env hydration.
 *
 * @module core/secrets
 */

'use strict';

const { SecretManager, SecretNotFoundError, detectCloudProvider } = require('./manager');
const { EnvSecretProvider } = require('./providers/env');
const { MemorySecretProvider } = require('./providers/memory');
const { GcpSecretProvider } = require('./providers/gcp');
const { AwsSecretProvider } = require('./providers/aws');

// Global singleton instance
let defaultSecretManager = null;

/**
 * Factory to create a SecretManager instance
 * @param {Object} [options]
 * @returns {SecretManager}
 */
function createSecretManager(options = {}) {
  return new SecretManager(options);
}

/**
 * Get or initialize default SecretManager singleton
 * @param {Object} [options]
 * @returns {SecretManager}
 */
function getDefaultSecretManager(options = {}) {
  if (!defaultSecretManager || Object.keys(options).length > 0) {
    defaultSecretManager = new SecretManager(options);
  }
  return defaultSecretManager;
}

/**
 * Convenience helper to resolve a single secret
 * @param {string} secretName
 * @param {Object} [options]
 * @returns {Promise<any>}
 */
async function resolveSecret(secretName, options = {}) {
  const manager = getDefaultSecretManager(options);
  return manager.get(secretName, options);
}

/**
 * Convenience helper to load secrets and inject them into process.env at bootstrap
 *
 * Example:
 * ```javascript
 * const { loadSecrets } = require('webspresso/core/secrets');
 *
 * await loadSecrets({
 *   provider: 'cloudrun', // or 'auto'
 *   secrets: {
 *     SESSION_SECRET: 'prod-session-secret:latest',
 *     DATABASE_URL: 'production-db-url',
 *   }
 * });
 * ```
 *
 * @param {Object} options
 * @param {'auto'|'gcp'|'cloudrun'|'aws'|'env'|'memory'} [options.provider='auto']
 * @param {Record<string, string>|string[]} [options.secrets]
 * @param {string} [options.bundle] - JSON secret bundle to unpack
 * @param {boolean} [options.inject=true] - Set into process.env
 * @param {boolean} [options.override=false] - Override existing process.env
 * @returns {Promise<Record<string, any>>}
 */
async function loadSecrets(options = {}) {
  const manager = createSecretManager(options);
  const result = {};

  if (options.secrets) {
    const loaded = await manager.load(options.secrets, {
      inject: options.inject !== false,
      override: options.override === true,
    });
    Object.assign(result, loaded);
  }

  if (options.bundle) {
    const bundleLoaded = await manager.loadBundle(options.bundle, {
      inject: options.inject !== false,
      override: options.override === true,
    });
    Object.assign(result, bundleLoaded);
  }

  return result;
}

module.exports = {
  SecretManager,
  SecretNotFoundError,
  createSecretManager,
  getDefaultSecretManager,
  resolveSecret,
  loadSecrets,
  detectCloudProvider,
  EnvSecretProvider,
  MemorySecretProvider,
  GcpSecretProvider,
  AwsSecretProvider,
};
