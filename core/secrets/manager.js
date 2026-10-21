/**
 * Secret Manager Core for Webspresso
 * Provides multi-cloud secret resolution, in-memory caching with TTL,
 * JSON bundle unpacking, subkey dot-notation, and process.env hydration.
 *
 * @module core/secrets/manager
 */

'use strict';

const { EnvSecretProvider } = require('./providers/env');
const { MemorySecretProvider } = require('./providers/memory');
const { GcpSecretProvider } = require('./providers/gcp');
const { AwsSecretProvider } = require('./providers/aws');

/**
 * Parse human TTL string ('5m', '1h', '30s') or number to milliseconds
 * @param {string|number} ttl
 * @returns {number}
 */
function parseTtlMs(ttl) {
  if (typeof ttl === 'number' && Number.isFinite(ttl)) {
    return Math.max(0, ttl);
  }
  if (typeof ttl === 'string') {
    const trimmed = ttl.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
    if (!match) return 300_000;
    const value = parseFloat(match[1]);
    const unit = match[2] || 'ms';
    switch (unit) {
      case 'ms': return Math.round(value);
      case 's': return Math.round(value * 1000);
      case 'm': return Math.round(value * 60_000);
      case 'h': return Math.round(value * 3_600_000);
      case 'd': return Math.round(value * 86_400_000);
      default: return 300_000;
    }
  }
  return 300_000; // 5 minutes default
}

/**
 * Detect target cloud provider automatically from environment
 * @returns {'gcp'|'aws'|'env'}
 */
function detectCloudProvider() {
  if (
    process.env.K_SERVICE ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    return 'gcp';
  }

  if (
    process.env.AWS_EXECUTION_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ) {
    return 'aws';
  }

  return 'env';
}

class SecretNotFoundError extends Error {
  constructor(secretName) {
    super(`Secret "${secretName}" was not found in the configured secret provider.`);
    this.name = 'SecretNotFoundError';
    this.secretName = secretName;
  }
}

class SecretManager {
  /**
   * @param {Object} [options]
   * @param {'auto'|'gcp'|'cloudrun'|'aws'|'env'|'memory'|Object} [options.provider='auto']
   * @param {string|number} [options.cacheTtl='5m']
   * @param {boolean} [options.cache=true]
   * @param {string} [options.projectId] - For GCP
   * @param {string} [options.region] - For AWS
   * @param {Object} [options.client] - Duck-typed official client
   * @param {Record<string, any>} [options.mockSecrets] - Initial memory secrets
   * @param {Function} [options.httpTransport]
   */
  constructor(options = {}) {
    this.options = options;
    this.cacheEnabled = options.cache !== false;
    this.cacheTtlMs = parseTtlMs(options.cacheTtl ?? '5m');
    this.cacheStore = new Map(); // key -> { value, expiresAt }

    let providerType = options.provider || 'auto';
    if (providerType === 'auto') {
      providerType = detectCloudProvider();
    }

    if (typeof providerType === 'object' && providerType !== null) {
      this.provider = providerType;
    } else if (providerType === 'gcp' || providerType === 'cloudrun') {
      this.provider = new GcpSecretProvider(options);
    } else if (providerType === 'aws') {
      this.provider = new AwsSecretProvider(options);
    } else if (providerType === 'memory') {
      this.provider = new MemorySecretProvider({
        secrets: options.mockSecrets || options.secrets,
      });
    } else {
      this.provider = new EnvSecretProvider(options);
    }
  }

  /**
   * Invalidate cached secret
   * @param {string} secretName
   */
  invalidate(secretName) {
    if (secretName) {
      this.cacheStore.delete(secretName);
    }
  }

  /**
   * Clear entire in-memory secrets cache
   */
  clearCache() {
    this.cacheStore.clear();
  }

  /**
   * Fetch a secret value
   * Supports:
   * - Dot notation for subkeys: e.g. get('my-bundle.DATABASE_URL')
   * - JSON parsing: get('my-bundle', { parseJson: true })
   * - Default fallback: get('MISSING', { fallback: 'default' })
   * - Required validation: get('MISSING', { required: true })
   *
   * @param {string} secretName
   * @param {Object} [options]
   * @param {any} [options.fallback]
   * @param {boolean} [options.required=false]
   * @param {boolean} [options.parseJson=false]
   * @param {boolean} [options.bypassCache=false]
   * @returns {Promise<any>}
   */
  async get(secretName, options = {}) {
    if (!secretName || typeof secretName !== 'string') {
      if (options.required) {
        throw new SecretNotFoundError(String(secretName));
      }
      return options.fallback !== undefined ? options.fallback : null;
    }

    const { fallback, required = false, parseJson = false, bypassCache = false } = options;

    // Handle dot notation subkey (e.g. "prod/bundle.DB_PASSWORD")
    if (secretName.includes('.') && !secretName.startsWith('.')) {
      const dotIndex = secretName.indexOf('.');
      const bundleName = secretName.substring(0, dotIndex);
      const subKey = secretName.substring(dotIndex + 1);

      const bundleVal = await this.get(bundleName, { bypassCache });
      if (bundleVal) {
        try {
          const parsed = typeof bundleVal === 'object' ? bundleVal : JSON.parse(bundleVal);
          if (parsed && Object.prototype.hasOwnProperty.call(parsed, subKey)) {
            return parsed[subKey];
          }
        } catch (_) {}
      }

      if (required) {
        throw new SecretNotFoundError(secretName);
      }
      return fallback !== undefined ? fallback : null;
    }

    // Check in-memory cache
    if (this.cacheEnabled && !bypassCache) {
      const cached = this.cacheStore.get(secretName);
      if (cached && Date.now() < cached.expiresAt) {
        return this._formatResult(cached.value, parseJson);
      }
    }

    // Resolve via provider
    let rawValue = null;
    if (this.provider && typeof this.provider.get === 'function') {
      rawValue = await this.provider.get(secretName);
    }

    if (rawValue === null || rawValue === undefined) {
      // Fallback to process.env if cloud provider didn't have it
      if (process.env[secretName] !== undefined) {
        rawValue = process.env[secretName];
      }
    }

    if (rawValue === null || rawValue === undefined) {
      if (required) {
        throw new SecretNotFoundError(secretName);
      }
      return fallback !== undefined ? fallback : null;
    }

    // Save to cache
    if (this.cacheEnabled) {
      this.cacheStore.set(secretName, {
        value: rawValue,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    return this._formatResult(rawValue, parseJson);
  }

  /**
   * Internal formatter
   * @private
   */
  _formatResult(val, parseJson) {
    if (!parseJson) return val;
    if (typeof val === 'object' && val !== null) return val;
    try {
      return JSON.parse(val);
    } catch (_) {
      return val;
    }
  }

  /**
   * Load multiple secrets and optionally inject them into process.env
   * @param {Record<string, string>|string[]} secretsMapOrArray - Map of { ENV_KEY: 'secret-name' } or array of names
   * @param {Object} [options]
   * @param {boolean} [options.inject=true] - Set into process.env
   * @param {boolean} [options.override=false] - Override existing process.env
   * @returns {Promise<Record<string, string>>}
   */
  async load(secretsMapOrArray, options = {}) {
    const { inject = true, override = false } = options;
    const result = {};

    let mappings = {};
    if (Array.isArray(secretsMapOrArray)) {
      for (const name of secretsMapOrArray) {
        mappings[name] = name;
      }
    } else if (typeof secretsMapOrArray === 'object' && secretsMapOrArray !== null) {
      mappings = secretsMapOrArray;
    }

    for (const [envKey, secretName] of Object.entries(mappings)) {
      let val = await this.get(secretName);
      if ((val === null || val === undefined) && envKey !== secretName) {
        val = await this.get(envKey);
      }
      if (val !== null && val !== undefined) {
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        result[envKey] = strVal;
        if (inject) {
          if (override || process.env[envKey] === undefined) {
            process.env[envKey] = strVal;
          }
        }
      }
    }

    return result;
  }

  /**
   * Unpack a JSON secret bundle and inject all key-values into process.env
   * @param {string} bundleName - Secret name holding JSON object
   * @param {Object} [options]
   * @param {boolean} [options.inject=true]
   * @param {boolean} [options.override=false]
   * @returns {Promise<Record<string, any>>}
   */
  async loadBundle(bundleName, options = {}) {
    const { inject = true, override = false } = options;
    const bundleContent = await this.get(bundleName, { parseJson: true });

    if (!bundleContent || typeof bundleContent !== 'object') {
      return {};
    }

    const result = {};
    for (const [key, val] of Object.entries(bundleContent)) {
      const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      result[key] = strVal;
      if (inject) {
        if (override || process.env[key] === undefined) {
          process.env[key] = strVal;
        }
      }
    }

    return result;
  }
}

module.exports = {
  SecretManager,
  SecretNotFoundError,
  parseTtlMs,
  detectCloudProvider,
};
