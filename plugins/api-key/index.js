/**
 * API Key Plugin for Webspresso
 * Zero-dependency B2B & Developer API Key Management
 * @module plugins/api-key
 */

'use strict';

const { safeCompare, hashKey, maskKey, generateKey } = require('./crypto');
const { hasScope, hasRequiredScopes, normalizeScopes, matchScope } = require('./scopes');
const { createApiKeyModel } = require('./model');
const { generateApiKeysMigration } = require('./migration-template');
const {
  createApiKeyMiddleware,
  extractApiKey,
  sendUnauthorized,
  sendForbidden,
  resolveKnex,
} = require('./middleware');

/**
 * Programmatic helper to create an API key record
 * 
 * @param {Object} [data]
 * @param {string} [data.name='Default API Key']
 * @param {string|string[]} [data.scopes=[]]
 * @param {number|string|null} [data.userId]
 * @param {number|string|null} [data.user_id]
 * @param {Date|string|null} [data.expiresAt]
 * @param {Date|string|null} [data.expires_at]
 * @param {number|null} [data.rateLimit]
 * @param {number|null} [data.rate_limit]
 * @param {any} [data.metadata]
 * @param {string} [data.prefix]
 * @param {number} [data.byteLength]
 * @param {Object} [options]
 * @returns {Promise<{ key: string, record: Object }>}
 */
async function createApiKey(data = {}, options = {}) {
  const prefix = data.prefix || options.prefix || 'wsp_live_';
  const byteLength = data.byteLength || options.byteLength || 24;
  const tableName = options.tableName || 'api_keys';

  const generated = generateKey({ prefix, byteLength });
  const rawKey = generated.key;
  const keyHash = generated.hash;
  const keyHint = generated.hint;

  const scopesList = normalizeScopes(data.scopes);
  const userId = data.userId !== undefined ? data.userId : (data.user_id !== undefined ? data.user_id : null);
  const expiresAt = data.expiresAt || data.expires_at || null;
  const rateLimit = data.rateLimit !== undefined ? data.rateLimit : (data.rate_limit !== undefined ? data.rate_limit : null);
  const metadata = data.metadata || null;

  const recordData = {
    name: data.name || 'Default API Key',
    key_hash: keyHash,
    key_hint: keyHint,
    prefix,
    user_id: userId,
    scopes: JSON.stringify(scopesList),
    rate_limit: rateLimit,
    metadata: metadata ? JSON.stringify(metadata) : null,
    expires_at: expiresAt ? new Date(expiresAt) : null,
    last_used_at: null,
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const kx = resolveKnex(options);
  if (kx) {
    const insertRes = await kx(tableName).insert(recordData);
    let insertedId = 1;
    if (Array.isArray(insertRes) && insertRes.length > 0) {
      insertedId = typeof insertRes[0] === 'object' && insertRes[0] !== null ? insertRes[0].id : insertRes[0];
    } else if (typeof insertRes === 'number') {
      insertedId = insertRes;
    }
    recordData.id = insertedId;
  }

  return {
    key: rawKey, // Plaintext API key — returned ONLY once at creation!
    record: {
      ...recordData,
      scopes: scopesList,
      metadata,
    },
  };
}

/**
 * Programmatic helper to verify a raw API key against database or options
 * 
 * @param {string} rawKey
 * @param {Object} [options]
 * @returns {Promise<Object|null>}
 */
async function verifyApiKey(rawKey, options = {}) {
  if (!rawKey || typeof rawKey !== 'string') {
    return null;
  }

  const hash = hashKey(rawKey);
  const tableName = options.tableName || 'api_keys';
  const kx = resolveKnex(options);

  let record = null;
  if (options.findKeyByHash) {
    record = await options.findKeyByHash(hash);
  } else if (options.verify) {
    record = await options.verify(rawKey);
  } else if (kx) {
    record = await kx(tableName).where({ key_hash: hash }).first();
  }

  if (!record) {
    return null;
  }

  if (record.key_hash && !safeCompare(record.key_hash, hash)) {
    return null;
  }

  if (record.revoked_at || record.is_active === false || record.revoked === true) {
    return null;
  }

  if (record.expires_at) {
    const expiresTime = new Date(record.expires_at).getTime();
    if (!isNaN(expiresTime) && expiresTime <= Date.now()) {
      return null;
    }
  }

  return record;
}

/**
 * Programmatic helper to revoke an API key by ID or SHA-256 hash
 * 
 * @param {number|string} idOrHash
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
async function revokeApiKey(idOrHash, options = {}) {
  const tableName = options.tableName || 'api_keys';
  const kx = resolveKnex(options);
  if (!kx) {
    return false;
  }

  const isHash = typeof idOrHash === 'string' && idOrHash.length === 64 && /^[0-9a-fA-F]+$/.test(idOrHash);
  const condition = isHash ? { key_hash: idOrHash } : { id: idOrHash };

  const updatedRows = await kx(tableName).where(condition).update({
    revoked_at: new Date(),
    updated_at: new Date(),
  });

  return updatedRows > 0;
}

/**
 * Webspresso API Key Plugin Factory
 * 
 * @param {Object} [options] - Plugin configuration options
 * @param {any} [options.db] - Webspresso database or Knex instance
 * @param {any} [options.knex] - Knex instance
 * @param {string} [options.tableName='api_keys'] - API keys table name
 * @param {string} [options.prefix='wsp_live_'] - Default prefix for generated keys
 * @param {number} [options.byteLength=24] - Random byte length for keys
 * @param {boolean} [options.global=false] - Whether to apply API key auth globally
 * @param {string|string[]|boolean} [options.routes=true] - Route prefixes (when global: true)
 * @param {string[]} [options.skipPaths] - Array of path prefixes to skip
 * @param {Function} [options.skip] - Custom predicate function (req) => boolean
 * @param {Array|Object} [options.keys] - Static in-memory keys for testing / serverless
 * @param {boolean} [options.trackUsage=true] - Automatically update last_used_at
 * @param {number} [options.updateLastUsedThrottleMs=60000] - Throttle time for last_used_at writes
 * @param {boolean} [options.allowQueryParam=false] - Allow query parameter extraction (?apiKey=...)
 * @param {string} [options.queryParamName='apiKey'] - Query parameter name
 * @param {Function} [options.findKeyByHash] - Custom lookup (hash, req) => Promise<record|null>
 * @param {Function} [options.verify] - Custom verification (rawKey, req) => Promise<record|null>
 * @param {Function} [options.getUser] - Custom user loader (record, req) => Promise<user|null>
 * @param {Function} [options.onAuthenticated] - Callback (req, record) => void
 * @param {Function|string|Object} [options.unauthorizedResponse] - Custom 401 response
 * @param {Function|string|Object} [options.forbiddenResponse] - Custom 403 response
 * @returns {Object} Webspresso Plugin Definition
 */
function apiKeyPlugin(options = {}) {
  const { global: applyGlobal = false, ...pluginDefaults } = options;

  return {
    name: 'api-key',
    version: '1.0.0',
    description: 'B2B & Developer API Key Management Plugin with named middleware, scopes, and constant-time verification',
    options,

    api: {
      createMiddleware: (routeOpts = {}) =>
        createApiKeyMiddleware({ ...pluginDefaults, ...routeOpts }),
      generateKey: (opts = {}) =>
        generateKey({ prefix: pluginDefaults.prefix, byteLength: pluginDefaults.byteLength, ...opts }),
      hashKey,
      maskKey: (rawKey, pfx) => maskKey(rawKey, pfx || pluginDefaults.prefix),
      safeCompare,
      hasScope,
      hasRequiredScopes,
      normalizeScopes,
      matchScope,
      createApiKey: (data, opts = {}) =>
        createApiKey(data, { ...pluginDefaults, ...opts }),
      verifyApiKey: (rawKey, opts = {}) =>
        verifyApiKey(rawKey, { ...pluginDefaults, ...opts }),
      revokeApiKey: (idOrHash, opts = {}) =>
        revokeApiKey(idOrHash, { ...pluginDefaults, ...opts }),
      getMigrationTemplate: (name) =>
        generateApiKeysMigration(name || pluginDefaults.tableName || 'api_keys'),
      getModel: (name) =>
        createApiKeyModel(name || pluginDefaults.tableName || 'api_keys'),
    },

    register(ctx) {
      // 1. Optionally register ApiKey ORM Model if DB is available and supports registerModel
      const db = options.db || (ctx && ctx.db);
      if (db && typeof db.registerModel === 'function' && typeof db.hasModel === 'function') {
        const modelName = 'ApiKey';
        if (!db.hasModel(modelName)) {
          const modelDef = createApiKeyModel(pluginDefaults.tableName || 'api_keys');
          db.registerModel(modelDef);
        }
      }

      // 2. Register named middleware factory: middleware: ['apiKey'] or [['apiKey', { scopes: [...] }]]
      if (ctx.middlewares) {
        ctx.middlewares.apiKey = (routeOpts = {}) =>
          createApiKeyMiddleware({ ...pluginDefaults, ...routeOpts });
        ctx.middlewares.apiKeyAuth = ctx.middlewares.apiKey;
      }

      // 3. Mount global middleware if global: true
      if (applyGlobal && ctx.app) {
        const globalMw = createApiKeyMiddleware(options);
        ctx.app.use(globalMw);
      }
    },
  };
}

apiKeyPlugin.apiKeyPlugin = apiKeyPlugin;
apiKeyPlugin.createApiKeyMiddleware = createApiKeyMiddleware;
apiKeyPlugin.generateKey = generateKey;
apiKeyPlugin.hashKey = hashKey;
apiKeyPlugin.maskKey = maskKey;
apiKeyPlugin.safeCompare = safeCompare;
apiKeyPlugin.hasScope = hasScope;
apiKeyPlugin.hasRequiredScopes = hasRequiredScopes;
apiKeyPlugin.normalizeScopes = normalizeScopes;
apiKeyPlugin.matchScope = matchScope;
apiKeyPlugin.createApiKeyModel = createApiKeyModel;
apiKeyPlugin.generateApiKeysMigration = generateApiKeysMigration;
apiKeyPlugin.extractApiKey = extractApiKey;
apiKeyPlugin.createApiKey = createApiKey;
apiKeyPlugin.verifyApiKey = verifyApiKey;
apiKeyPlugin.revokeApiKey = revokeApiKey;
apiKeyPlugin.sendUnauthorized = sendUnauthorized;
apiKeyPlugin.sendForbidden = sendForbidden;

module.exports = apiKeyPlugin;
module.exports.apiKeyPlugin = apiKeyPlugin;
module.exports.createApiKeyMiddleware = createApiKeyMiddleware;
module.exports.generateKey = generateKey;
module.exports.hashKey = hashKey;
module.exports.maskKey = maskKey;
module.exports.safeCompare = safeCompare;
module.exports.hasScope = hasScope;
module.exports.hasRequiredScopes = hasRequiredScopes;
module.exports.normalizeScopes = normalizeScopes;
module.exports.matchScope = matchScope;
module.exports.createApiKeyModel = createApiKeyModel;
module.exports.generateApiKeysMigration = generateApiKeysMigration;
module.exports.extractApiKey = extractApiKey;
module.exports.createApiKey = createApiKey;
module.exports.verifyApiKey = verifyApiKey;
module.exports.revokeApiKey = revokeApiKey;
module.exports.sendUnauthorized = sendUnauthorized;
module.exports.sendForbidden = sendForbidden;
