/**
 * Start Hono app on Node (@hono/node-server)
 * @module src/http/node-serve
 */

const { serve } = require('@hono/node-server');

/**
 * @param {{ fetch: Function }} app - Hono or compat app with .fetch
 * @param {number|string} [port]
 * @param {Function} [callback]
 * @returns {import('@hono/node-server').ServerType}
 */
function listen(app, port, callback) {
  const p =
    port !== undefined && port !== null && port !== ''
      ? Number(port)
      : Number(process.env.PORT || 3000);
  const server = serve(
    {
      fetch: app.fetch.bind(app),
      port: p,
    },
    callback
      ? (info) => {
          callback(null, info);
        }
      : undefined
  );
  return server;
}

module.exports = { listen };
