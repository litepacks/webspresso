/**
 * Studio access gate — 404 when disabled; basic auth in production.
 */

/**
 * @param {import('./index').StudioResolvedConfig} config
 * @param {string} nodeEnv
 * @returns {import('../..').WebspressoHandler}
 */
function createStudioGate(config, nodeEnv = process.env.NODE_ENV || 'development') {
  const basePath = config.path || '/_webspresso';

  return function studioGate(req, res, next) {
    const urlPath = req.path || req.url?.split('?')[0] || '';
    if (!urlPath.startsWith(basePath)) {
      return next();
    }

    if (!config.enabled) {
      return res.status(404).send('Not Found');
    }

    if (config.auth === 'dev-only' && nodeEnv === 'production') {
      return res.status(404).send('Not Found');
    }

    if (config.auth === 'basic') {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Webspresso Studio"');
        return res.status(401).send('Authentication required');
      }
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user !== config.basicAuth?.user || pass !== config.basicAuth?.pass) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Webspresso Studio"');
        return res.status(401).send('Invalid credentials');
      }
    }

    return next();
  };
}

module.exports = { createStudioGate };
