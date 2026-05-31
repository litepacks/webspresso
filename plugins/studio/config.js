/**
 * Studio configuration resolution and validation.
 */

const DEFAULT_PATH = '/_webspresso';

/**
 * @param {boolean|string} [studioOption]
 * @param {string} [nodeEnv]
 * @returns {import('./index').StudioResolvedConfig|null}
 */
function resolveStudioConfig(studioOption, nodeEnv = process.env.NODE_ENV || 'development') {
  if (studioOption === false || studioOption === null) {
    return null;
  }

  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const raw =
    studioOption === true || studioOption === undefined
      ? {}
      : typeof studioOption === 'object'
        ? studioOption
        : {};

  const enabled =
    raw.enabled !== undefined
      ? raw.enabled === true
      : !isProduction && !isTest;

  if (!enabled) {
    return { enabled: false, path: raw.path || DEFAULT_PATH };
  }

  const path = normalizePath(raw.path || DEFAULT_PATH);
  const auth = raw.auth || (isProduction ? 'basic' : 'dev-only');
  const exposeEnv = raw.exposeEnv === true;
  const basicAuth = raw.basicAuth || null;
  const requestTimeline = {
    enabled: raw.requestTimeline?.enabled !== false && !isProduction,
    maxEntries: raw.requestTimeline?.maxEntries ?? 100,
  };
  const cacheActions = raw.cacheActions === true;
  const slowQueryThresholdMs = raw.slowQueryThresholdMs ?? 500;
  const inspectRoutes = raw.inspectRoutes !== false && (!isProduction || raw.inspectRoutes === true);

  validateStudioConfig({
    enabled,
    path,
    auth,
    basicAuth,
    nodeEnv,
    exposeEnv,
    requestTimeline,
    cacheActions,
    slowQueryThresholdMs,
    inspectRoutes,
  });

  return {
    enabled,
    path,
    auth,
    exposeEnv,
    basicAuth,
    requestTimeline,
    cacheActions,
    slowQueryThresholdMs,
    inspectRoutes,
  };
}

/**
 * @param {string} p
 */
function normalizePath(p) {
  const s = String(p || DEFAULT_PATH).trim();
  if (!s.startsWith('/')) return '/' + s;
  return s.replace(/\/+$/, '') || '/';
}

/**
 * @param {object} config
 */
function validateStudioConfig(config) {
  const { enabled, path, auth, basicAuth, nodeEnv } = config;

  if (path === '/_admin' || path.startsWith('/_admin/')) {
    throw new Error('studio.path cannot overlap with admin panel (/_admin)');
  }

  if (!enabled) return;

  if (nodeEnv === 'production' && (auth === 'none' || auth === 'dev-only')) {
    throw new Error(
      'Studio cannot run in production without authentication. Set studio.auth to "basic" and provide studio.basicAuth.'
    );
  }

  if (auth === 'basic') {
    if (!basicAuth?.user || !basicAuth?.pass) {
      throw new Error('studio.basicAuth.user and studio.basicAuth.pass are required when studio.auth is "basic"');
    }
  }
}

module.exports = {
  resolveStudioConfig,
  normalizePath,
  DEFAULT_PATH,
};
