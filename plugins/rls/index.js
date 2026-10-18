/**
 * Webspresso RLS Plugin — Dynamic Model Row-Level Security
 * Automatically bridges request authentication (req.user, req.auth, req.tenantId)
 * to ORM repositories with role-based bypass and route-level overrides.
 * Zero external dependencies.
 * @module plugins/rls
 */

/**
 * Default user extractor from HTTP request
 * @param {import('express').Request} req
 * @returns {Object|null}
 */
function defaultGetUser(req) {
  if (!req) return null;
  return req.user || req.adminUser || (req.auth && req.auth.user) || null;
}

/**
 * Default tenant extractor from HTTP request
 * @param {import('express').Request} req
 * @param {Object|null} [user]
 * @returns {unknown|null}
 */
function defaultGetTenantId(req, user) {
  if (!req) return null;
  if (req.tenantId !== undefined && req.tenantId !== null) return req.tenantId;
  if (req.tenant !== undefined && req.tenant !== null) return req.tenant;
  if (user && typeof user === 'object') {
    if (user.tenant_id !== undefined && user.tenant_id !== null) return user.tenant_id;
    if (user.tenantId !== undefined && user.tenantId !== null) return user.tenantId;
    if (user.organization_id !== undefined && user.organization_id !== null) return user.organization_id;
    if (user.organizationId !== undefined && user.organizationId !== null) return user.organizationId;
  }
  return null;
}

/**
 * Create Express middleware for Row Level Security
 * Wraps req.db methods to automatically inject authenticated user and tenant context
 *
 * @param {Object} [options]
 * @param {string[]|Function|false} [options.bypassRoles=['admin', 'superadmin']] - Roles that bypass RLS
 * @param {Function} [options.getUser] - Custom user extractor (req) => user
 * @param {Function} [options.getTenantId] - Custom tenant extractor (req, user) => tenantId
 * @param {boolean} [options.enabled=true] - Whether RLS middleware is active
 * @returns {Function} Express middleware handler
 */
function createRlsMiddleware(options = {}) {
  const {
    bypassRoles = ['admin', 'superadmin'],
    getUser = defaultGetUser,
    getTenantId = defaultGetTenantId,
    enabled = true,
  } = options;

  return (req, res, next) => {
    if (!enabled) return next();

    const user = typeof getUser === 'function' ? getUser(req) : null;
    const tenantId = typeof getTenantId === 'function' ? getTenantId(req, user) : null;

    // Check if user has global bypass role
    let isBypassed = false;
    if (user && bypassRoles) {
      if (typeof bypassRoles === 'function') {
        isBypassed = Boolean(bypassRoles(user, req));
      } else if (Array.isArray(bypassRoles)) {
        const uRole = user.role || user.roleName || user.type;
        const uRoles = Array.isArray(user.roles) ? user.roles : (uRole ? [uRole] : []);
        isBypassed = bypassRoles.some((r) => uRoles.includes(r));
      }
    }

    // Wrap req.db if it exists on the request
    if (req.db && typeof req.db.getRepository === 'function' && !req.db._rlsWrapped) {
      const origGetRepo = req.db.getRepository.bind(req.db);
      const origQuery = req.db.query ? req.db.query.bind(req.db) : null;
      const origCreateRepo = req.db.createRepository ? req.db.createRepository.bind(req.db) : null;

      const reqDb = Object.create(req.db);
      reqDb._rlsWrapped = true;

      reqDb.getRepository = (modelName, customContext = {}) => {
        const ctx = {
          user,
          tenantId: customContext.tenantId !== undefined ? customContext.tenantId : tenantId,
          rlsDisabled: isBypassed || customContext.rlsDisabled === true,
          ...customContext,
        };
        return origGetRepo(modelName, ctx);
      };

      if (origCreateRepo) {
        reqDb.createRepository = (model, customContext = {}) => {
          const ctx = {
            user,
            tenantId: customContext.tenantId !== undefined ? customContext.tenantId : tenantId,
            rlsDisabled: isBypassed || customContext.rlsDisabled === true,
            ...customContext,
          };
          return origCreateRepo(model, ctx);
        };
      }

      if (origQuery) {
        reqDb.query = (modelName, customContext = {}) => {
          const ctx = {
            user,
            tenantId: customContext.tenantId !== undefined ? customContext.tenantId : tenantId,
            rlsDisabled: isBypassed || customContext.rlsDisabled === true,
            ...customContext,
          };
          return origQuery(modelName, ctx);
        };
      }

      req.db = reqDb;
    }

    next();
  };
}

/**
 * Webspresso RLS Plugin Factory
 *
 * @param {Object} [options] - Plugin configuration options
 * @param {boolean} [options.global=true] - Mount global middleware on app
 * @param {string[]|Function|false} [options.bypassRoles=['admin', 'superadmin']] - Global roles bypassing RLS
 * @param {Function} [options.getUser] - Custom user extractor
 * @param {Function} [options.getTenantId] - Custom tenant extractor
 * @param {boolean} [options.enabled=true] - Enabled flag
 * @returns {Object} Webspresso Plugin Definition
 */
function rlsPlugin(options = {}) {
  const { global: applyGlobal = true, ...pluginDefaults } = options;

  return {
    name: 'rls',
    version: '1.0.0',
    description: 'Dynamic Model Row-Level Security (RLS) with automatic request context binding',
    options,

    api: {
      createMiddleware: (routeOpts = {}) =>
        createRlsMiddleware({ ...pluginDefaults, ...routeOpts }),
    },

    register(ctx) {
      // Named middleware for route definitions: middleware: ['rls']
      if (ctx.middlewares) {
        ctx.middlewares.rls = (routeOpts = {}) =>
          createRlsMiddleware({ ...pluginDefaults, ...routeOpts });
      }

      // Global middleware (mounted by default unless global: false)
      if (applyGlobal && ctx.app) {
        ctx.app.use(createRlsMiddleware(options));
      }
    },
  };
}

rlsPlugin.rlsPlugin = rlsPlugin;
rlsPlugin.createRlsMiddleware = createRlsMiddleware;

module.exports = rlsPlugin;
module.exports.rlsPlugin = rlsPlugin;
module.exports.createRlsMiddleware = createRlsMiddleware;
