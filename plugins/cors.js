/**
 * Webspresso CORS Plugin
 * Zero-dependency CORS middleware & preflight handler
 * @module plugins/cors
 */

/**
 * Configure CORS middleware
 * @param {Object} [options] - CORS configuration
 * @param {string|string[]|RegExp|Function} [options.origin='*'] - Allowed origin(s)
 * @param {string|string[]} [options.methods] - Allowed HTTP methods
 * @param {string|string[]} [options.allowedHeaders] - Allowed request headers
 * @param {string|string[]} [options.exposedHeaders] - Headers exposed to response
 * @param {boolean} [options.credentials=false] - Allow credentials (cookies/authorization headers)
 * @param {number} [options.maxAge=86400] - Access-Control-Max-Age header in seconds
 * @param {boolean} [options.preflightContinue=false] - Pass OPTIONS to next handler
 * @param {number} [options.optionsSuccessStatus=204] - OPTIONS preflight success status
 * @param {string|string[]|boolean} [options.routes=true] - Route prefixes or true for all
 * @returns {Function} Express middleware handler
 */
function createCorsMiddleware(options = {}) {
  const defaults = {
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: [],
    credentials: false,
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    routes: true,
  };

  const config = { ...defaults, ...options };

  const methodsStr = Array.isArray(config.methods)
    ? config.methods.join(',')
    : String(config.methods);

  const allowedHeadersStr = Array.isArray(config.allowedHeaders)
    ? config.allowedHeaders.join(',')
    : String(config.allowedHeaders);

  const exposedHeadersStr = Array.isArray(config.exposedHeaders)
    ? config.exposedHeaders.join(',')
    : String(config.exposedHeaders);

  function isOriginAllowed(reqOrigin, callback) {
    if (!config.origin || config.origin === '*') {
      return callback(null, config.origin);
    }
    if (!reqOrigin) {
      return callback(null, false);
    }
    if (typeof config.origin === 'string') {
      return callback(null, config.origin === reqOrigin ? reqOrigin : false);
    }
    if (Array.isArray(config.origin)) {
      for (const item of config.origin) {
        if (typeof item === 'string' && item === reqOrigin) {
          return callback(null, reqOrigin);
        }
        if (item instanceof RegExp && item.test(reqOrigin)) {
          return callback(null, reqOrigin);
        }
      }
      return callback(null, false);
    }
    if (config.origin instanceof RegExp) {
      return callback(null, config.origin.test(reqOrigin) ? reqOrigin : false);
    }
    if (typeof config.origin === 'function') {
      return config.origin(reqOrigin, callback);
    }
    return callback(null, false);
  }

  function shouldApplyToRoute(reqPath) {
    if (config.routes === true || !config.routes) return true;
    const routesList = Array.isArray(config.routes) ? config.routes : [config.routes];
    return routesList.some((prefix) => reqPath.startsWith(prefix));
  }

  return (req, res, next) => {
    const reqPath = req.path || req.url || '/';

    if (!shouldApplyToRoute(reqPath)) {
      return next();
    }

    const reqOrigin = req.headers.origin;

    isOriginAllowed(reqOrigin, (err, allowedOrigin) => {
      if (err) {
        return next(err);
      }

      if (allowedOrigin) {
        if (allowedOrigin === '*' && config.credentials) {
          res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
        } else {
          res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        }
        res.setHeader('Vary', 'Origin');
      }

      if (config.credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      if (exposedHeadersStr) {
        res.setHeader('Access-Control-Expose-Headers', exposedHeadersStr);
      }

      // Preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        if (allowedOrigin) {
          if (methodsStr) {
            res.setHeader('Access-Control-Allow-Methods', methodsStr);
          }
          if (allowedHeadersStr) {
            res.setHeader('Access-Control-Allow-Headers', allowedHeadersStr);
          } else if (req.headers['access-control-request-headers']) {
            res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
          }
          if (config.maxAge) {
            res.setHeader('Access-Control-Max-Age', String(config.maxAge));
          }
        }

        if (config.preflightContinue) {
          return next();
        }

        res.statusCode = config.optionsSuccessStatus;
        res.setHeader('Content-Length', '0');
        return res.end();
      }

      next();
    });
  };
}

/**
 * Webspresso CORS Plugin Factory
 * @param {Object} [options] - CORS options
 * @returns {Object} Plugin definition
 */
function corsPlugin(options = {}) {
  return {
    name: 'cors',
    version: '1.0.0',
    options,
    register(ctx) {
      const corsMiddleware = createCorsMiddleware(options);

      if (ctx.middlewares) {
        ctx.middlewares.cors = corsMiddleware;
      }

      if (ctx.app && options.global !== false) {
        ctx.app.use(corsMiddleware);
      }
    },
  };
}

corsPlugin.createCorsMiddleware = createCorsMiddleware;

module.exports = corsPlugin;
