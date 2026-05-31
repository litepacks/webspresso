/**
 * @deprecated Use createApp({ studio: true }) or studioPlugin() from webspresso/plugins/studio
 */

const studioPlugin = require('../studio');

let warned = false;

/**
 * @param {Object} options
 * @param {string} [options.path]
 * @param {boolean} [options.enabled]
 */
function dashboardPlugin(options = {}) {
  if (!warned) {
    warned = true;
    console.warn(
      '[webspresso] dashboardPlugin is deprecated; use createApp({ studio: true }) or studioPlugin()'
    );
  }
  const enabled =
    options.enabled !== undefined ? options.enabled : process.env.NODE_ENV !== 'production';

  return studioPlugin({
    ...options,
    path: options.path || '/_webspresso',
    enabled,
  });
}

module.exports = dashboardPlugin;
