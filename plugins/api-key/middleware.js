/**
 * API Key Plugin — Express Middleware & Request Extraction
 * @module plugins/api-key/middleware
 */

'use strict';

const { hashKey, safeCompare } = require('./crypto');
const { hasRequiredScopes, normalizeScopes } = require('./scopes');

/**
 * Check if request matches path prefix list
 * 
 * @param {string} path
 * @param {string|string[]|boolean} routes
 * @returns {boolean}
 */
function shouldApplyToRoute(path, routes) {
  if (routes === true || routes == null) return true;
  const list = Array.isArray(routes) ? routes : [routes];
  return list.some((prefix) => path.startsWith(prefix));
}

/**
 * Check if request path should be skipped
 * 
 * @param {import('express').Request} req
 * @param {string[]} skipPaths
 * @param {Function} [skipFn]
 * @returns {boolean}
 */
function isSkipped(req, skipPaths = [], skipFn) {
  if (typeof skipFn === 'function' && skipFn(req)) {
    return true;
  }
  const p = req.path || req.url || '';
  if (Array.isArray(skipPaths) && skipPaths.some((prefix) => p.startsWith(prefix))) {
    return true;
  }
  return false;
}

/**
 * Extract raw API key from incoming request
 * 
 * @param {import('express').Request} req
 * @param {Object} [options]
 * @returns {string|null}
 */
function extractApiKey(req, options = {}) {
  if (typeof options.extractKey === 'function') {
    const customKey = options.extractKey(req);
    if (customKey && typeof customKey === 'string') {
      return customKey.trim();
    }
  }

  const headers = req.headers || {};

  // 1. Check custom configured header if given
  if (options.headerName && typeof options.headerName === 'string') {
    const headerVal = headers[options.headerName.toLowerCase()];
    if (headerVal && typeof headerVal === 'string') {
      return headerVal.trim();
    }
  }

  // 2. Check standard X-API-Key header
  const xApiKey = headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey.trim();
  }

  // 3. Check Api-Key header
  const apiKeyHdr = headers['api-key'];
  if (apiKeyHdr && typeof apiKeyHdr === 'string') {
    return apiKeyHdr.trim();
  }

  // 4. Check Authorization: Bearer <key> or Authorization: ApiKey <key>
  const authHeader = headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const trimmed = authHeader.trim();
    if (/^bearer\s+/i.test(trimmed)) {
      return trimmed.replace(/^bearer\s+/i, '').trim();
    }
    if (/^apikey\s+/i.test(trimmed)) {
      return trimmed.replace(/^apikey\s+/i, '').trim();
    }
    if (/^api-key\s+/i.test(trimmed)) {
      return trimmed.replace(/^api-key\s+/i, '').trim();
    }
  }

  // 5. Check query parameter if explicitly enabled
  const allowQuery = options.allowQueryParam === true || options.queryParam === true;
  if (allowQuery && req.query && typeof req.query === 'object') {
    const queryParamName = options.queryParamName || 'apiKey';
    const val = req.query[queryParamName] || req.query.apiKey || req.query.api_key;
    if (val && typeof val === 'string') {
      return val.trim();
    }
  }

  return null;
}

/**
 * Check if the request accepts or prefers JSON
 * 
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function prefersJson(req) {
  const p = req.path || req.url || '';
  if (p.startsWith('/api/') || p.startsWith('/_admin/api/')) {
    return true;
  }
  const accept = req.headers && req.headers.accept;
  if (accept && accept.includes('application/json')) {
    return true;
  }
  return !!(req.xhr || (req.headers && req.headers['x-requested-with'] === 'XMLHttpRequest'));
}

/**
 * Send 401 Unauthorized response
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} config
 * @param {string} message
 */
function sendUnauthorized(req, res, config, message = 'Authentication required: API key is missing or invalid.') {
  res.statusCode = 401;

  if (typeof config.unauthorizedResponse === 'function') {
    return config.unauthorizedResponse(req, res, { reason: 'unauthorized', message });
  }

  if (config.unauthorizedResponse && typeof config.unauthorizedResponse === 'object') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(config.unauthorizedResponse));
  }

  if (typeof config.unauthorizedResponse === 'string') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(config.unauthorizedResponse);
  }

  if (prefersJson(req)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Unauthorized', message }));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Unauthorized');
}

/**
 * Send 403 Forbidden response
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} config
 * @param {string} message
 * @param {Object} [details]
 */
function sendForbidden(req, res, config, message = 'Forbidden: Insufficient API key permissions.', details = {}) {
  res.statusCode = 403;

  if (typeof config.forbiddenResponse === 'function') {
    return config.forbiddenResponse(req, res, { reason: 'forbidden', message, ...details });
  }

  if (config.forbiddenResponse && typeof config.forbiddenResponse === 'object') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(config.forbiddenResponse));
  }

  if (typeof config.forbiddenResponse === 'string') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(config.forbiddenResponse);
  }

  if (prefersJson(req)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      error: 'Forbidden',
      message,
      ...(details.requiredScopes ? { requiredScopes: details.requiredScopes } : {}),
    }));
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Forbidden');
}

/**
 * Helper to resolve Knex instance from options or request
 * 
 * @param {Object} config
 * @param {import('express').Request} [req]
 * @returns {any|null}
 */
function resolveKnex(config, req) {
  if (config.knex) return config.knex;
  if (config.db) {
    if (typeof config.db === 'function') return config.db;
    if (config.db.knex) return config.db.knex;
  }
  if (req && req.db) {
    if (typeof req.db === 'function') return req.db;
    if (req.db.knex) return req.db.knex;
  }
  return null;
}

/**
 * Find API key record from static in-memory keys
 * 
 * @param {string} rawKey
 * @param {string} keyHash
 * @param {Array|Object} keys
 * @returns {Object|null}
 */
function findInStaticKeys(rawKey, keyHash, keys) {
  if (!keys) return null;

  if (Array.isArray(keys)) {
    for (const item of keys) {
      if (item.key && safeCompare(item.key, rawKey)) {
        return item;
      }
      const itemHash = item.key_hash || item.keyHash || (item.key ? hashKey(item.key) : null);
      if (itemHash && safeCompare(itemHash, keyHash)) {
        return item;
      }
    }
  } else if (typeof keys === 'object') {
    // Map of key/hash => record
    for (const [keyOrHash, val] of Object.entries(keys)) {
      if (safeCompare(keyOrHash, rawKey) || safeCompare(keyOrHash, keyHash)) {
        return typeof val === 'object' && val !== null ? { ...val } : { name: val, key_hash: keyHash };
      }
    }
  }

  return null;
}

/**
 * Create API Key Express middleware
 * 
 * @param {Object} [options]
 * @param {any} [options.db] - Webspresso db or Knex instance
 * @param {any} [options.knex] - Knex instance
 * @param {string} [options.tableName='api_keys'] - API keys table name
 * @param {Array|Object} [options.keys] - Static in-memory keys for testing/serverless
 * @param {string|string[]} [options.scopes] - Required scopes for route
 * @param {boolean} [options.requireAllScopes=true] - Require all scopes (true) or any scope (false)
 * @param {boolean} [options.optional=false] - If true, passes through when no key is provided
 * @param {boolean} [options.trackUsage=true] - Automatically update last_used_at
 * @param {number} [options.updateLastUsedThrottleMs=60000] - Throttle time for last_used_at writes
 * @param {Function} [options.findKeyByHash] - Custom lookup (hash, req) => Promise<record|null>
 * @param {Function} [options.verify] - Custom verification (rawKey, req) => Promise<record|null>
 * @param {Function} [options.getUser] - Custom user loader (record, req) => Promise<user|null>
 * @param {Function} [options.onAuthenticated] - Callback (req, record) => void
 * @param {boolean} [options.allowQueryParam=false] - Allow query parameter extraction
 * @param {string} [options.queryParamName='apiKey'] - Query parameter name
 * @param {string|string[]|boolean} [options.routes=true] - Route prefixes to protect
 * @param {string[]} [options.skipPaths] - Array of path prefixes to skip
 * @param {Function} [options.skip] - Custom predicate function (req) => boolean
 * @param {Function|string|Object} [options.unauthorizedResponse] - Custom 401 response
 * @param {Function|string|Object} [options.forbiddenResponse] - Custom 403 response
 * @returns {Function} Express middleware handler
 */
function createApiKeyMiddleware(options = {}) {
  const config = {
    tableName: 'api_keys',
    requireAllScopes: true,
    optional: false,
    trackUsage: true,
    updateLastUsedThrottleMs: 60000,
    routes: true,
    skipPaths: [],
    ...options,
  };

  const requiredScopes = normalizeScopes(config.scopes);

  return async (req, res, next) => {
    const reqPath = req.path || req.url || '/';

    if (!shouldApplyToRoute(reqPath, config.routes)) {
      return next();
    }

    if (isSkipped(req, config.skipPaths, config.skip)) {
      return next();
    }

    const rawKey = extractApiKey(req, config);

    // If key missing:
    if (!rawKey) {
      if (config.optional) {
        return next();
      }
      return sendUnauthorized(req, res, config, 'Authentication required: API key is missing.');
    }

    const computedHash = hashKey(rawKey);
    let record = null;

    try {
      // 1. Custom verify hook
      if (typeof config.verify === 'function') {
        record = await config.verify(rawKey, req);
      }
      // 2. Custom findKeyByHash hook
      else if (typeof config.findKeyByHash === 'function') {
        record = await config.findKeyByHash(computedHash, req);
      }
      // 3. Static in-memory keys
      else if (config.keys) {
        record = findInStaticKeys(rawKey, computedHash, config.keys);
      }
      // 4. Database lookup via Knex / ORM
      else {
        const kx = resolveKnex(config, req);
        if (kx) {
          record = await kx(config.tableName).where({ key_hash: computedHash }).first();
        } else if (req.db && typeof req.db.getRepository === 'function') {
          try {
            const apiKeyRepo = req.db.getRepository('ApiKey');
            if (apiKeyRepo) {
              record = await apiKeyRepo.findOne({ key_hash: computedHash });
            }
          } catch (_) {
            // Ignore repository lookup error and fallback
          }
        }
      }

      // Timing-safe constant check: If record has key_hash, verify it matches
      if (record && record.key_hash) {
        const isValid = safeCompare(record.key_hash, computedHash);
        if (!isValid) {
          record = null;
        }
      } else if (!record) {
        // Dummy timing-safe comparison to prevent timing leak on existence
        safeCompare(computedHash, computedHash);
      }

      // Record not found
      if (!record) {
        return sendUnauthorized(req, res, config, 'Invalid API key.');
      }

      // Check if key is revoked
      if (record.revoked_at || record.is_active === false || record.revoked === true) {
        return sendUnauthorized(req, res, config, 'API key has been revoked.');
      }

      // Check if key has expired
      if (record.expires_at) {
        const expiresTime = new Date(record.expires_at).getTime();
        if (!isNaN(expiresTime) && expiresTime <= Date.now()) {
          return sendUnauthorized(req, res, config, 'API key has expired.');
        }
      }

      // Normalize scopes on the record
      const grantedScopes = normalizeScopes(record.scopes);

      // Verify required scopes
      if (requiredScopes.length > 0) {
        const hasAccess = hasRequiredScopes(grantedScopes, requiredScopes, config.requireAllScopes);
        if (!hasAccess) {
          return sendForbidden(req, res, config, 'Forbidden: Insufficient API key permissions.', {
            requiredScopes,
            grantedScopes,
          });
        }
      }

      // Non-blocking usage tracking (last_used_at)
      if (config.trackUsage !== false && record.id) {
        const lastUsedMs = record.last_used_at ? new Date(record.last_used_at).getTime() : 0;
        const throttleMs = typeof config.updateLastUsedThrottleMs === 'number' ? config.updateLastUsedThrottleMs : 60000;
        const now = Date.now();

        if (now - lastUsedMs >= throttleMs) {
          record.last_used_at = new Date(now);
          const kx = resolveKnex(config, req);
          setImmediate(async () => {
            try {
              if (typeof config.updateLastUsed === 'function') {
                await config.updateLastUsed(record.id, record);
              } else if (kx) {
                await kx(config.tableName).where({ id: record.id }).update({ last_used_at: new Date(now) });
              }
            } catch (_) {
              // Non-blocking write: never fail the API request
            }
          });
        }
      }

      // Attach context to request
      req.apiKey = record;
      req.auth = req.auth || {};
      req.auth.apiKey = record;

      // User resolution
      let user = null;
      if (typeof config.getUser === 'function') {
        user = await config.getUser(record, req);
      } else if (record.user) {
        user = record.user;
      } else if (record.user_id && req.db && typeof req.db.getRepository === 'function') {
        try {
          const userRepo = req.db.getRepository('User');
          if (userRepo) {
            user = await userRepo.findById(record.user_id);
          }
        } catch (_) {
          // Swallow user lookup failure
        }
      }

      if (user) {
        req.auth.user = user;
        if (!req.user) {
          req.user = user;
        }
      }

      // onAuthenticated hook
      if (typeof config.onAuthenticated === 'function') {
        await config.onAuthenticated(req, record);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  createApiKeyMiddleware,
  extractApiKey,
  sendUnauthorized,
  sendForbidden,
  resolveKnex,
  shouldApplyToRoute,
  isSkipped,
};
