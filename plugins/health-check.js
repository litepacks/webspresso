/**
 * Health check plugin — liveness/readiness style HTTP endpoint for load balancers and monitoring
 */

const pathMod = require('path');
const PKG = require(pathMod.join(__dirname, '..', 'package.json'));

/**
 * @param {Object} [options]
 * @param {string} [options.path='/health'] — GET endpoint path
 * @param {boolean} [options.enabled=true] — Disable entirely when false
 * @param {function} [options.authorize] — (req) => boolean; optional gate (e.g. internal network only)
 * @param {boolean} [options.verbose=true] — Include timestamp, uptime, env, framework version
 * @param {function} [options.checks] — async ({ req, db, options }) => Record<string, string> — custom checks; thrown error → 503
 */
function healthCheckPlugin(options = {}) {
  const {
    path: routePath = '/health',
    enabled,
    authorize,
    verbose = true,
    checks,
  } = options;

  const isEnabled = enabled !== undefined ? enabled : true;
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;

  return {
    name: 'health-check',
    version: '1.0.0',
    description: 'HTTP health endpoint for probes and monitoring',

    onRoutesReady(ctx) {
      if (!isEnabled) {
        return;
      }

      ctx.addRoute('get', normalizedPath, async (req, res) => {
        if (authorize && !authorize(req)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const body = {
          status: 'ok',
        };

        if (verbose) {
          body.timestamp = new Date().toISOString();
          body.uptime = process.uptime();
          body.env = process.env.NODE_ENV || 'development';
          body.framework = {
            name: PKG.name,
            version: PKG.version,
          };
        }

        if (typeof checks === 'function') {
          try {
            const result = await checks({
              req,
              db: ctx.db,
              options: ctx.options,
            });
            if (result && typeof result === 'object') {
              body.checks = result;
            }
          } catch (err) {
            body.status = 'unhealthy';
            body.error = err.message || String(err);
            return res.status(503).json(body);
          }
        }

        res.json(body);
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`  Health check: GET ${normalizedPath}`);
      }
    },
  };
}

module.exports = healthCheckPlugin;
